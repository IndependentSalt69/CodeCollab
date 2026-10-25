// Read-only application checks against the actual laptop stack. No accounts, rooms or jobs created.
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const base = 'http://localhost:3000';
let socket;
async function request(path, options = {}) {
  return fetch(base + path, { signal: AbortSignal.timeout(5000), ...options });
}
(async () => {
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /id="root"/);
  const health = await request('/health', { headers: { Origin: base } });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, 'ok');
  assert.equal(health.headers.get('access-control-allow-origin'), base);
  const disallowed = await request('/health', { headers: { Origin: 'https://unapproved.example.test' } });
  assert.equal(disallowed.headers.get('access-control-allow-origin'), null);
  assert.equal((await request('/api/auth/me')).status, 401);
  assert.equal((await request('/api/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  console.log('PASS frontend HTML, JSON health/API proxy, explicit CORS and unauthenticated API denial');
  socket = io(base, { transports: ['websocket'], autoConnect: false, reconnection: false, timeout: 5000 });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', () => reject(Error('WebSocket proxy connection failed')));
    socket.connect();
  });
  const result = await new Promise((resolve, reject) => socket.timeout(5000).emit('room:join', { roomId: 'nonexistent-laptop-proxy-check' }, (err, result) => err ? reject(Error('Room authorization acknowledgement timed out')) : resolve(result)));
  assert.equal(result.ok, false);
  assert.match(result.error, /Authentication required/);
  console.log('PASS same-origin WebSocket transport and unauthenticated room-join denial');
  const ready = await request('/ready');
  const state = await ready.json();
  if (ready.status === 503 && state.status === 'not_ready') {
    console.log(`BLOCKED readiness: database=${state.database === true}, redis=${state.redis === true}; authenticated demo checks require both dependencies`);
    process.exitCode = 2;
  } else {
    assert.equal(ready.status, 200);
    assert.deepEqual([state.status, state.database, state.redis], ['ready', true, true]);
    console.log('PASS dependency readiness; registration/rooms/collaboration still require separate authenticated tests');
  }
})().catch(() => { console.error('FAIL local proxy smoke; inspect diagnostics'); process.exitCode = 1; })
  .finally(() => { if (socket) socket.disconnect(); });
