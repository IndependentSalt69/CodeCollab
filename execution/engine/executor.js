const Docker = require('dockerode');
const { PassThrough } = require('stream');
const sandboxConfig = require('./sandboxConfig');
const { parseMemoryToBytes, parseCpuToNanoCPUs } = require('./resourceLimits');

const { parseDockerConnectionConfig, validateRuntime, verifyRuntimeAvailable, verifyProductionDaemon } = require('./dockerConfig');

// Singleton Docker instance for the execution engine
let dockerInstance = null;
function getDockerClient(customConfig) {
  if (customConfig) {
    const opts = typeof customConfig === 'string'
      ? parseDockerConnectionConfig(customConfig)
      : customConfig;
    return new Docker(opts);
  }
  if (!dockerInstance) {
    const dockerOpts = parseDockerConnectionConfig(process.env.DOCKER_HOST);
    dockerInstance = new Docker(dockerOpts);
  }
  return dockerInstance;
}

function resetDockerClient() {
  dockerInstance = null;
}

const { LANGUAGE_IMAGE_MAP, EXECUTABLE_LANGUAGES } = require('./languages');

/**
 * Parses Docker multiplexed stream buffer into stdout and stderr strings with output limits.
 *
 * @param {Buffer} buffer
 * @param {number} [maxOutput]
 * @returns {{ stdout: string, stderr: string, outputLimitExceeded: boolean, limitExceededReason: string }}
 */
function demuxBuffer(buffer, maxOutput = sandboxConfig.MAX_OUTPUT_BUFFER_BYTES) {
  let stdout = '';
  let stderr = '';
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let outputLimitExceeded = false;
  let limitExceededReason = '';

  if (!buffer || !Buffer.isBuffer(buffer)) {
    return { stdout, stderr, outputLimitExceeded, limitExceededReason };
  }

  let offset = 0;
  while (offset + 8 <= buffer.length) {
    const type = buffer.readUInt8(offset);
    const length = buffer.readUInt32BE(offset + 4);
    offset += 8;
    const chunk = buffer.subarray(offset, Math.min(offset + length, buffer.length));
    offset += length;

    if (type === 1) {
      if (!outputLimitExceeded) {
        const chunkLen = chunk.length;
        if (stdoutBytes + chunkLen > maxOutput) {
          outputLimitExceeded = true;
          limitExceededReason = 'stdout exceeded maximum limit of 64KB';
          const remaining = Math.max(0, maxOutput - stdoutBytes);
          if (remaining > 0) {
            stdout += chunk.subarray(0, remaining).toString('utf8');
            stdoutBytes += remaining;
          }
          stdout += '\n[Output truncated: exceeded 64KB limit]';
        } else {
          stdoutBytes += chunkLen;
          stdout += chunk.toString('utf8');
        }
      }
    } else if (type === 2) {
      if (!outputLimitExceeded) {
        const chunkLen = chunk.length;
        if (stderrBytes + chunkLen > maxOutput) {
          outputLimitExceeded = true;
          limitExceededReason = 'stderr exceeded maximum limit of 64KB';
          const remaining = Math.max(0, maxOutput - stderrBytes);
          if (remaining > 0) {
            stderr += chunk.subarray(0, remaining).toString('utf8');
            stderrBytes += remaining;
          }
          stderr += '\n[Output truncated: exceeded 64KB limit]';
        } else {
          stderrBytes += chunkLen;
          stderr += chunk.toString('utf8');
        }
      }
    }
  }

  return { stdout, stderr, outputLimitExceeded, limitExceededReason };
}

/**
 * Runs submitted code in an ephemeral Docker container.
 *
 * @param {Object} options
 * @param {string} options.language - 'python', 'cpp', or 'java'
 * @param {string} options.code - User source code
 * @param {string} [options.stdin] - Standard input provided to the program
 * @param {number} [options.timeout] - Max execution time in ms (default 5000, capped at 10000)
 * @param {string|number} [options.memory] - Max memory (default '256m', capped at 256m)
 * @param {string|number} [options.cpu] - CPU quota (default '0.5')
 * @param {boolean} [options.network] - Network access (default false)
 * @returns {Promise<Object>} Execution result object
 */
async function runInSandbox({
  language,
  code,
  stdin,
  timeout = sandboxConfig.DEFAULT_TIMEOUT_MS,
  memory = sandboxConfig.DEFAULT_MEMORY,
  cpu = sandboxConfig.cpu,
  network = sandboxConfig.network,
  runtime = sandboxConfig.CONTAINER_RUNTIME,
}) {
  const normalizedLang = typeof language === 'string' ? language.toLowerCase().trim() : '';
  const imageName = EXECUTABLE_LANGUAGES.includes(normalizedLang) ? LANGUAGE_IMAGE_MAP[normalizedLang] : null;

  if (!imageName) {
    throw new Error(`Unsupported execution language: ${language}`);
  }

  if (typeof code !== 'string') {
    throw new Error('Code must be a string');
  }
  if (!code.trim() || code.includes('\0')) {
    throw new Error('Code must be non-empty and contain no NUL bytes');
  }

  // Defensive code size safety boundary (64 KiB)
  if (Buffer.byteLength(code, 'utf8') > sandboxConfig.MAX_CODE_SIZE_BYTES) {
    throw new Error(`Code exceeds maximum allowed size of ${sandboxConfig.MAX_CODE_SIZE_BYTES / 1024}KB`);
  }

  // Defensive stdin type and size boundary (64 KiB)
  if (stdin !== undefined && stdin !== null) {
    if (typeof stdin !== 'string') {
      throw new Error('stdin must be a string');
    }
    if (Buffer.byteLength(stdin, 'utf8') > sandboxConfig.MAX_STDIN_SIZE_BYTES) {
      throw new Error(`stdin exceeds maximum allowed size of ${sandboxConfig.MAX_STDIN_SIZE_BYTES / 1024}KB`);
    }
  }
  const hasStdin = typeof stdin === 'string';

  // Validate container runtime (runc or runsc)
  const selectedRuntime = validateRuntime(runtime);

  const docker = getDockerClient();
  await verifyProductionDaemon(docker, selectedRuntime);

  // If gVisor (runsc) is requested, verify daemon support; never silently downgrade
  if (selectedRuntime === 'runsc') {
    await verifyRuntimeAvailable(docker, 'runsc');
  }

  // Parse and enforce hard safety ceilings
  let parsedMemoryBytes = parseMemoryToBytes(memory);
  if (parsedMemoryBytes === null || parsedMemoryBytes <= 0) {
    parsedMemoryBytes = sandboxConfig.MAX_MEMORY_BYTES;
  }
  const memoryBytes = Math.min(parsedMemoryBytes, sandboxConfig.MAX_MEMORY_BYTES);

  const nanoCPUs = parseCpuToNanoCPUs(cpu);

  let rawTimeout = typeof timeout === 'number' && timeout > 0 && !isNaN(timeout)
    ? timeout
    : sandboxConfig.DEFAULT_TIMEOUT_MS;
  const timeoutMs = Math.min(rawTimeout, sandboxConfig.MAX_TIMEOUT_MS);

  let container = null;
  const startTime = Date.now();
  let timedOut = false;
  let timer = null;
  let outputMonitor = null;
  let stdinSocket = null;

  try {
    // 1. Create ephemeral container with resource limits, read-only rootfs & isolation
    const containerOpts = {
      Image: imageName,
      Cmd: ['--code', code],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      User: 'sandbox',
      Labels: { 'codecollab.runner': normalizedLang },
      HostConfig: {
        Memory: memoryBytes,
        MemorySwap: memoryBytes,
        NanoCPUs: nanoCPUs,
        NetworkMode: network ? 'bridge' : 'none',
        PidsLimit: 64,
        ReadonlyRootfs: true,
        CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'],
        Tmpfs: {
          '/tmp': 'rw,noexec,nosuid,size=32m',
          // Native binaries need one executable scratch mount. /tmp stays noexec.
          ...(normalizedLang !== 'python' ? {
            '/work': `rw,${normalizedLang === 'cpp' ? 'exec' : 'noexec'},nosuid,nodev,size=32m,uid=1000,gid=1000,mode=700`,
          } : {}),
        },
        ...(selectedRuntime === 'runsc' ? { Runtime: 'runsc' } : {}),
      },
    };

    if (hasStdin) {
      containerOpts.AttachStdin = true;
      containerOpts.OpenStdin = true;
      containerOpts.StdinOnce = true;
    }

    container = await docker.createContainer(containerOpts);

    // 2. Attach multiplexed streams before starting
    let stream = null;
    if (hasStdin) {
      stdinSocket = await new Promise((resolve, reject) => {
        const optsf = {
          path: `/containers/${container.id}/attach?stream=1&stdin=1&stdout=1&stderr=1`,
          method: 'POST',
          isStream: true,
          hijack: true,
          openStdin: false,
          file: Buffer.from(''),
          statusCodes: { 200: true, 404: 'no such container', 500: 'server error' },
        };
        docker.modem.dial(optsf, (err, sock) => {
          if (err) return reject(err);
          resolve(sock);
        });
      });
      stream = stdinSocket;
    } else {
      stream = await container.attach({
        stream: true,
        stdout: true,
        stderr: true,
      });
    }

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    const MAX_OUTPUT = sandboxConfig.MAX_OUTPUT_BUFFER_BYTES;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let outputLimitExceeded = false;
    let limitExceededReason = '';

    stdoutStream.on('data', (chunk) => {
      if (outputLimitExceeded) return;
      const chunkBytes = Buffer.byteLength(chunk);
      if (stdoutBytes + chunkBytes > MAX_OUTPUT) {
        outputLimitExceeded = true;
        limitExceededReason = 'stdout exceeded maximum limit of 64KB';
        const remaining = Math.max(0, MAX_OUTPUT - stdoutBytes);
        if (remaining > 0) {
          stdoutBuffer += chunk.slice(0, remaining).toString('utf8');
          stdoutBytes += remaining;
        }
        stdoutBuffer += '\n[Output truncated: exceeded 64KB limit]';
        if (container) {
          container.kill().catch(() => {});
        }
        return;
      }
      stdoutBytes += chunkBytes;
      stdoutBuffer += chunk.toString('utf8');
    });

    stderrStream.on('data', (chunk) => {
      if (outputLimitExceeded) return;
      const chunkBytes = Buffer.byteLength(chunk);
      if (stderrBytes + chunkBytes > MAX_OUTPUT) {
        outputLimitExceeded = true;
        limitExceededReason = 'stderr exceeded maximum limit of 64KB';
        const remaining = Math.max(0, MAX_OUTPUT - stderrBytes);
        if (remaining > 0) {
          stderrBuffer += chunk.slice(0, remaining).toString('utf8');
          stderrBytes += remaining;
        }
        stderrBuffer += '\n[Output truncated: exceeded 64KB limit]';
        if (container) {
          container.kill().catch(() => {});
        }
        return;
      }
      stderrBytes += chunkBytes;
      stderrBuffer += chunk.toString('utf8');
    });

    docker.modem.demuxStream(stream, stdoutStream, stderrStream);

    // 3. Start container
    await container.start();

    // 4. Send stdin and close stream so container receives EOF
    if (hasStdin && stdinSocket) {
      if (stdin.length > 0) {
        stdinSocket.write(stdin);
      }
      stdinSocket.end();
    }

    // Monitor output limits actively for stdin-attached runs
    if (hasStdin) {
      outputMonitor = setInterval(async () => {
        try {
          if (!container || outputLimitExceeded || timedOut) return;
          const logs = await container.logs({ stdout: true, stderr: true });
          if (logs.length > MAX_OUTPUT) {
            outputLimitExceeded = true;
            limitExceededReason = 'output exceeded maximum limit of 64KB';
            clearInterval(outputMonitor);
            await container.kill().catch(() => {});
          }
        } catch (_) {}
      }, 100);
    }

    // 5. Set timeout enforcement
    const timeoutPromise = new Promise((resolve) => {
      timer = setTimeout(async () => {
        timedOut = true;
        try {
          await container.kill();
        } catch (_) {
          // Container may have already exited
        }
        resolve({ timedOut: true });
      }, timeoutMs);
    });

    // 6. Wait for container completion or timeout
    const waitPromise = container.wait().then((data) => ({ timedOut: false, data }));

    const outcome = await Promise.race([waitPromise, timeoutPromise]);

    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (outputMonitor) {
      clearInterval(outputMonitor);
      outputMonitor = null;
    }

    // Allow stream chunks to finish flushing
    await new Promise((resolve) => setTimeout(resolve, 50));

    // For runs with stdin, retrieve full output from container log buffer to capture any trailing output
    if (hasStdin && container) {
      try {
        const logBuffer = await container.logs({ stdout: true, stderr: true });
        const demuxed = demuxBuffer(logBuffer, MAX_OUTPUT);
        if (demuxed.outputLimitExceeded) {
          outputLimitExceeded = true;
          limitExceededReason = demuxed.limitExceededReason;
        }
        stdoutBuffer = demuxed.stdout;
        stderrBuffer = demuxed.stderr;
      } catch (_) {}
    }

    const executionTimeMs = Date.now() - startTime;

    // Output limit termination takes precedence over timeout
    if (outputLimitExceeded) {
      return {
        language: normalizedLang,
        stdout: stdoutBuffer,
        stderr: stderrBuffer + (stderrBuffer ? '\n' : '') + `Execution failed: ${limitExceededReason}`,
        exitCode: 137,
        executionTimeMs,
        timedOut: false,
        outputLimitExceeded: true,
        status: 'failed',
        limits: {
          timeout: timeoutMs,
          memory: memoryBytes,
          cpu: nanoCPUs,
          network,
          maxOutputBytes: MAX_OUTPUT,
          runtime: selectedRuntime,
        },
      };
    }

    if (timedOut || outcome.timedOut) {
      return {
        language: normalizedLang,
        stdout: stdoutBuffer,
        stderr: stderrBuffer + (stderrBuffer ? '\n' : '') + `Execution timed out after ${timeoutMs}ms`,
        exitCode: 124,
        executionTimeMs,
        timedOut: true,
        status: 'timeout',
        limits: {
          timeout: timeoutMs,
          memory: memoryBytes,
          cpu: nanoCPUs,
          network,
          maxOutputBytes: MAX_OUTPUT,
          runtime: selectedRuntime,
        },
      };
    }

    const exitCode = outcome.data && typeof outcome.data.StatusCode === 'number' ? outcome.data.StatusCode : 0;

    return {
      language: normalizedLang,
      stdout: stdoutBuffer,
      stderr: stderrBuffer,
      exitCode,
      executionTimeMs,
      timedOut: false,
      status: exitCode === 0 ? 'completed' : 'failed',
      limits: {
        timeout: timeoutMs,
        memory: memoryBytes,
        cpu: nanoCPUs,
        network,
        maxOutputBytes: MAX_OUTPUT,
        runtime: selectedRuntime,
      },
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    if (outputMonitor) {
      clearInterval(outputMonitor);
    }
    if (stdinSocket) {
      try {
        stdinSocket.destroy();
      } catch (_) {}
    }
    // 7. Force remove container to guarantee ephemeral cleanup
    if (container) {
      try {
        await container.remove({ force: true });
      } catch (err) {
        if (err.statusCode !== 404) {
          throw new Error(`Sandbox cleanup failed: ${err.message}`);
        }
      }
    }
  }
}

module.exports = {
  runInSandbox,
  getDockerClient,
  resetDockerClient,
  validateRuntime,
  verifyRuntimeAvailable,
  parseMemoryToBytes,
  parseCpuToNanoCPUs,
  LANGUAGE_IMAGE_MAP,
  demuxBuffer,
};

