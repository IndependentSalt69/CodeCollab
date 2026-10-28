const Docker = require('dockerode');

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
  io,
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

  const containerOpts = {
    Image: imageName, Cmd: ['--code', code], AttachStdout: true, AttachStderr: true,
    Tty: false, User: 'sandbox', Labels: { 'codecollab.runner': normalizedLang },
    ...(hasStdin || io ? { AttachStdin: true, OpenStdin: true, StdinOnce: true } : {}),
    ...(io ? { Env: [`CODECOLLAB_TIMEOUT_MS=${timeoutMs}`] } : {}),
    HostConfig: {
      Memory: memoryBytes, MemorySwap: memoryBytes, NanoCPUs: nanoCPUs,
      NetworkMode: network ? 'bridge' : 'none', PidsLimit: 64, ReadonlyRootfs: true,
      CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'],
      ...(io ? { AutoRemove: true } : {}),
      Tmpfs: {
        '/tmp': 'rw,noexec,nosuid,size=32m',
        ...(normalizedLang !== 'python' ? {
          '/work': `rw,${normalizedLang === 'cpp' ? 'exec' : 'noexec'},nosuid,nodev,size=32m,uid=1000,gid=1000,mode=700`,
        } : {}),
      },
      ...(selectedRuntime === 'runsc' ? { Runtime: selectedRuntime } : {}),
    },
  };
  const result = await require('./containerIO')(docker, containerOpts, stdin, io, timeoutMs);
  return { ...result, language: normalizedLang, limits: { timeout: timeoutMs, memory: memoryBytes,
    cpu: nanoCPUs, network, maxOutputBytes: sandboxConfig.MAX_OUTPUT_BUFFER_BYTES, runtime: selectedRuntime } };
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

