const executeCode = require('../engine/executeCode');
const { keys, connect, append, pause } = require('../engine/sessionProtocol');

// A BullMQ job owns one transport connection and the same sandbox engine used by batch jobs.
module.exports = async function processInteractive(job) {
  const names = keys(job.data.sessionId);
  const redis = await connect();
  const abort = new AbortController();
  let control, done = false, sequence = 0, inputSequence = 0, cursor = '0-0', transportFailure = false;
  let result;
  const publish = async event => {
    if (sequence >= 2047 && event.type !== 'finished') throw Error('Terminal event limit exceeded');
    sequence++;
    await append(redis, names.output, names.lease, { ...event, seq: sequence }, 2048);
  };
  const pump = async () => {
    try {
      while (!done) {
        if (await redis.get(names.lease) !== 'alive') { abort.abort(); return; }
        const rows = await redis.xread('COUNT', 32, 'STREAMS', names.input, cursor);
        for (const [id, fields] of rows?.[0]?.[1] || []) {
          cursor = id;
          const event = JSON.parse(fields[1]);
          if (!Number.isSafeInteger(event.seq) || event.seq !== inputSequence + 1) throw Error('Input sequence mismatch');
          inputSequence = event.seq;
          if (event.action === 'cancel') { abort.abort(); return; }
          if (!control) throw Error('Input arrived before program readiness');
          if (event.action === 'input') await control.write(event.data);
          else if (event.action === 'eof') control.eof();
          else throw Error('Invalid terminal action');
        }
        await pause(25);
      }
    } catch { transportFailure = true; abort.abort(); }
  };
  let pumping;
  try {
    if (await redis.get(names.lease) !== 'alive') { result = { status: 'cancelled', exitCode: 130 }; return result; }
    await publish({ type: 'status', status: 'starting' });
    pumping = pump();
    result = await executeCode({ ...job.data, io: {
      signal: abort.signal,
      async onReady(value) { control = value; await publish({ type: 'status', status: 'running' }); },
      async onOutput(channel, text) { await publish({ type: 'output', channel, text }); },
    } });
    if (transportFailure) result = { ...result, status: 'failed', error: 'Execution transport disconnected' };
  } catch {
    result = { status: 'failed', exitCode: 1, error: 'Execution worker could not complete the sandbox session' };
  } finally {
    done = true;
    if (pumping) await pumping;
    // executeCode resolves only after sandbox/stream cleanup. Do not duplicate buffered output.
    if (result) await publish({ type: 'finished', status: result.status, exitCode: result.exitCode,
      executionTimeMs: result.executionTimeMs, error: result.error }).catch(() => {});
    redis.disconnect();
  }
  return { status: result?.status || 'cancelled', exitCode: result?.exitCode ?? 130 };
};
