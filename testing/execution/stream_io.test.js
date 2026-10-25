const { Readable } = require('node:stream');
const { consumeOutput, outputCollector } = require('../../execution/engine/streamIO');
const frame = (type, text) => {
  const body = Buffer.from(text), header = Buffer.alloc(8);
  header[0] = type; header.writeUInt32BE(body.length, 4);
  return Buffer.concat([header, body]);
};
test('fragmented Docker headers and UTF-8 preserve separate channels and ordering', async () => {
  const bytes = Buffer.concat([frame(1, 'Name: Ω 😀'), frame(2, 'error'), frame(1, ' done')]);
  const chunks = [...bytes].map(byte => Buffer.from([byte])), events = [];
  const collector = outputCollector(65536, async (channel, text) => events.push({ channel, text }), jest.fn());
  await consumeOutput(Readable.from(chunks), collector.receive); await collector.finish();
  expect(collector.state.stdout).toBe('Name: Ω 😀 done'); expect(collector.state.stderr).toBe('error');
  expect(events.filter(e => e.channel === 'stderr').map(e => e.text).join('')).toBe('error');
});
test.each([Buffer.from([1, 0]), frame(3, 'bad'), frame(1, 'truncated').subarray(0, 10)])('malformed or incomplete frames fail closed (%#)', async bytes => {
  await expect(consumeOutput(Readable.from([bytes]), async () => {})).rejects.toThrow(/Docker output frame/);
});
test('output flooding is bounded, terminated once, and a slow sink is awaited', async () => {
  const terminate = jest.fn(), emit = jest.fn(async () => {});
  const collector = outputCollector(65536, emit, terminate);
  await consumeOutput(Readable.from([frame(1, 'x'.repeat(1000000))]), collector.receive);
  await collector.finish();
  expect(terminate).toHaveBeenCalledTimes(1);
  expect(collector.state.stdout.length).toBeLessThan(65600);
  expect(Math.max(...emit.mock.calls.map(([, text]) => Buffer.byteLength(text)))).toBeLessThanOrEqual(4096);
  let release, entered = false, resolved = false;
  const slow = consumeOutput(Readable.from([frame(1, 'data')]), async () => { entered = true; await new Promise(resolve => { release = resolve; }); }).then(() => { resolved = true; });
  while (!entered) await new Promise(resolve => setImmediate(resolve));
  expect(resolved).toBe(false); release(); await slow; expect(resolved).toBe(true);
});
