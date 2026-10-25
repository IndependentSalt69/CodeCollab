const { StringDecoder } = require('node:string_decoder');

// Docker's non-TTY protocol: an 8-byte header followed by a stdout/stderr payload.
// Consume incrementally and await the sink, so slow Redis clients backpressure the socket.
async function consumeOutput(stream, receive) {
  let header = Buffer.alloc(0), remaining = 0, channel;
  for await (const chunk of stream) {
    let offset = 0;
    while (offset < chunk.length) {
      if (!remaining) {
        const count = Math.min(8 - header.length, chunk.length - offset);
        header = Buffer.concat([header, chunk.subarray(offset, offset + count)]);
        offset += count;
        if (header.length < 8) continue;
        channel = header[0] === 1 ? 'stdout' : header[0] === 2 ? 'stderr' : null;
        remaining = header.readUInt32BE(4);
        header = Buffer.alloc(0);
        if (!channel || remaining > 16 * 1024 * 1024) throw Error('Invalid Docker output frame');
      }
      const count = Math.min(remaining, chunk.length - offset, 4096);
      if (count) await receive(channel, chunk.subarray(offset, offset + count));
      remaining -= count;
      offset += count;
    }
  }
  if (header.length || remaining) throw Error('Incomplete Docker output frame');
}

function outputCollector(limit, emit, terminate) {
  const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  const state = { stdout: '', stderr: '', exceeded: false };
  const sizes = { stdout: 0, stderr: 0 };
  return {
    state,
    async receive(channel, chunk) {
      if (state.exceeded) return;
      const accepted = chunk.subarray(0, Math.max(0, limit - sizes[channel]));
      sizes[channel] += accepted.length;
      const text = decoders[channel].write(accepted);
      state[channel] += text;
      if (text && emit) await emit(channel, text);
      if (accepted.length < chunk.length) {
        state.exceeded = true;
        state.limitExceededReason = `${channel} exceeded maximum limit of 64KB`;
        const marker = '\n[Output truncated: exceeded 64KB limit]';
        state[channel] += marker;
        await terminate();
        if (emit) await emit(channel, marker);
        const diagnostic = `\n[${state.limitExceededReason}]`;
        state.stderr += diagnostic;
        if (emit) await emit('stderr', diagnostic);
      }
    },
    async finish() {
      for (const channel of ['stdout', 'stderr']) {
        const tail = decoders[channel].end();
        state[channel] += tail;
        if (tail && emit) await emit(channel, tail);
      }
    },
  };
}
module.exports = { consumeOutput, outputCollector };
