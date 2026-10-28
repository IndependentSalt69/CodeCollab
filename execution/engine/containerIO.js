const { consumeOutput, outputCollector } = require('./streamIO');
const { MAX_OUTPUT_BUFFER_BYTES, MAX_STDIN_SIZE_BYTES } = require('./sandboxConfig');

// Shared lifecycle for batch and interactive execution. No alternative host executor.
module.exports = async function containerIO(docker, options, stdin, io, timeoutMs) {
  let container, input, output, timer, controller, outputTask;
  let ended = false, closed = false, cancelled = false, timedOut = false, streamError;
  let inputBytes = 0, inputMessages = 0, inputBusy = false;
  const started = Date.now();
  const kill = async () => { if (container) await container.kill().catch(() => {}); };
  const abort = () => { cancelled = true; void kill(); };
  const collector = outputCollector(MAX_OUTPUT_BUFFER_BYTES, io?.onOutput, kill);
  try {
    if (io?.signal?.aborted) return { status: 'cancelled', exitCode: 130, stdout: '', stderr: '', executionTimeMs: 0 };
    container = await docker.createContainer(options);
    io?.signal?.addEventListener('abort', abort, { once: true });
    output = await container.attach({ stream: true, stdout: true, stderr: true });
    // Separate read attachment survives half-closing the hijacked input socket at EOF.
    if (options.OpenStdin) {
      input = await new Promise((resolve, reject) => docker.modem.dial({
        path: `/containers/${container.id}/attach?stream=1&stdin=1&stdout=0&stderr=0`,
        method: 'POST', isStream: true, hijack: true, openStdin: false, file: Buffer.alloc(0),
        statusCodes: { 200: true, 404: 'no such container', 500: 'server error' },
      }, (error, socket) => error ? reject(error) : resolve(socket)));
      input.on('error', () => { if (!ended && !closed) { streamError = Error('Program input disconnected'); void kill(); } });
    }
    outputTask = consumeOutput(output, collector.receive).catch(error => {
      if (!ended) { streamError = error; return kill(); }
    });
    controller = {
      async write(data) {
        if (ended || closed || !input || inputBusy || io?.signal?.aborted) throw Error('Program input is unavailable');
        if (typeof data !== 'string' || Buffer.byteLength(data) > 4096 || ++inputMessages > 1024) throw Error('Input message limit exceeded');
        inputBytes += Buffer.byteLength(data);
        if (inputBytes > MAX_STDIN_SIZE_BYTES) throw Error('stdin exceeds 64 KiB');
        inputBusy = true;
        try { await new Promise((resolve, reject) => input.write(data, error => error ? reject(error) : resolve())); }
        finally { inputBusy = false; }
      },
      eof() { if (ended || closed || !input || inputBusy) throw Error('Program input is unavailable'); closed = true; input.end(); },
    };
    // Register next-exit before start; interactive AutoRemove can otherwise race wait().
    const waited = container.wait({ condition: 'next-exit' }).then(data => ({ data }));
    waited.catch(() => {});
    await container.start();
    const deadline = new Promise(resolve => { timer = setTimeout(async () => { timedOut = true; await kill(); resolve({}); }, timeoutMs); });
    if (cancelled || io?.signal?.aborted) { cancelled = true; await kill(); }
    if (typeof stdin === 'string' && stdin.length) {
      // UTF-8 size was validated by the caller; bounded writes also preserve surrogate pairs.
      for (let pos = 0; pos < stdin.length;) {
        let end = Math.min(pos + 1024, stdin.length);
        if (end < stdin.length && /[\uD800-\uDBFF]/.test(stdin[end - 1])) end--;
        await controller.write(stdin.slice(pos, end)); pos = end;
      }
    }
    if (io) await io.onReady(controller);
    else if (input) controller.eof();
    const outcome = await Promise.race([waited, deadline]);
    clearTimeout(timer);
    // Drain the bounded read attachment; never retrieve unlimited Docker log buffers.
    let drainTimer;
    await Promise.race([outputTask, new Promise(resolve => { drainTimer = setTimeout(resolve, 1000); })]);
    clearTimeout(drainTimer);
    ended = true;
    output.destroy();
    await collector.finish();
    if (streamError) throw Error('Sandbox I/O connection failed');
    const result = { stdout: collector.state.stdout, stderr: collector.state.stderr, executionTimeMs: Date.now() - started, timedOut: false };
    if (collector.state.exceeded) return { ...result, status: 'failed', exitCode: 137, outputLimitExceeded: true };
    if (cancelled) return { ...result, status: 'cancelled', exitCode: 130 };
    if (timedOut || (outcome.data?.StatusCode === 124 && Date.now() - started >= timeoutMs)) {
      return { ...result, status: 'timeout', timedOut: true, exitCode: 124, stderr: result.stderr + `\nExecution timed out after ${timeoutMs}ms` };
    }
    const exitCode = outcome.data?.StatusCode ?? 1;
    return { ...result, exitCode, status: exitCode === 0 ? 'completed' : 'failed' };
  } finally {
    ended = true;
    clearTimeout(timer);
    io?.signal?.removeEventListener('abort', abort);
    if (input) input.destroy();
    if (output) output.destroy();
    if (container) {
      for (let attempt = 0; attempt < 20; attempt++) {
        try { await container.remove({ force: true }); break; }
        catch (error) {
          if (error.statusCode === 404) break;
          if (error.statusCode !== 409 || attempt === 19) throw Error(`Sandbox cleanup failed (${error.statusCode || 'unreachable'})`);
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
    }
  }
};
