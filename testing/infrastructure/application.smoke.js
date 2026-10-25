// Live local test, intentionally excluded from Jest's default discovery.
// Requires the exact disposable containers documented in CODEX_COMPLETION_REPORT.md.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { io } = require('socket.io-client');
const base = 'http://127.0.0.1:53000';
const sockets = [];
const suffix = Date.now();
const examples = {
  python: 'print("completion-smoke")',
  cpp: '#include <iostream>\nint main(){std::cout << "completion-smoke\\n";}',
  java: 'public class Main { public static void main(String[] args){System.out.println("completion-smoke");} }',
};
function event(socket, name) {
  return new Promise((resolve, reject) => {
    const callback = value => { clearTimeout(timer); resolve(value); };
    const timer = setTimeout(() => { socket.off(name, callback); reject(Error(`Timed out waiting for ${name}`)); }, 20000);
    socket.once(name, callback);
  });
}
function ack(socket, name, payload) {
  return new Promise((resolve, reject) => socket.timeout(5000).emit(name, payload, (err, result) => err ? reject(Error('Socket acknowledgement timed out')) : resolve(result)));
}
async function request(path, { method = 'GET', token, data, socketId, origin = base } = {}) {
  const response = await fetch(base + path, { method, signal: AbortSignal.timeout(20000), headers: {
    'Content-Type': 'application/json', Origin: origin,
    ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(socketId ? { 'x-socket-id': socketId } : {}),
  }, ...(data ? { body: JSON.stringify(data) } : {}) });
  return { status: response.status, headers: response.headers, data: await response.json() };
}
async function main() {
  if (process.env.CODECOLLAB_DISPOSABLE_SMOKE !== 'true') throw Error('Set CODECOLLAB_DISPOSABLE_SMOKE=true only for the disposable fixture stack.');
  for (const service of ['frontend', 'backend', 'worker', 'mongo', 'redis']) {
    const labels = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .Config.Labels}}', `codecollab-completion-${service}-20261025`], { encoding: 'utf8' }));
    assert.equal(labels['codecollab.temporary'], 'completion-20261025', 'Refusing a non-fixture container');
  }
  const configuration = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .Config.Env}}', 'codecollab-completion-backend-20261025'], { encoding: 'utf8' }));
  assert(configuration.includes('MONGO_URI=mongodb://mongo:27017/codecollab_completion_smoke'), 'Refusing a non-fixture database');
  const health = await request('/health');
  assert.equal(health.data.status, 'ok');
  assert.equal((await request('/ready')).data.status, 'ready', 'Database/Redis readiness failed through frontend proxy');
  assert.equal(health.headers.get('access-control-allow-origin'), base);
  assert.equal((await request('/health', { origin: 'https://unapproved.example.test' })).headers.get('access-control-allow-origin'), null);
  console.log('PASS frontend proxy/backend JSON health and explicit CORS origins');
  const users = [];
  for (const role of ['owner', 'outsider']) {
    const registration = await request('/api/auth/register', { method: 'POST', data: { username: `${role}${suffix}`, email: `${role}${suffix}@example.test`, password: 'Disposable-only-Password-123!' } });
    assert.equal(registration.status, 201, 'Registration failed');
    const token = registration.data.token;
    assert(token, 'Missing auth token');
    const created = await request('/api/rooms', { method: 'POST', token, data: { name: `${role} fixture`, language: 'python', isPrivate: true } });
    assert.equal(created.status, 201, 'Room creation failed');
    const roomId = created.data.room.roomId;
    assert(roomId, 'Missing room ID');
    const socket = io(base, { transports: ['websocket'], auth: { token }, autoConnect: false, reconnection: false });
    sockets.push(socket);
    const connected = event(socket, 'connect'); socket.connect(); await connected;
    const joined = await ack(socket, 'room:join', { roomId, token });
    assert.equal(joined.ok, true, 'Authenticated socket room join failed');
    users.push({ token, roomId, socket });
  }
  const [owner, outsider] = users;
  assert.equal((await request('/api/execute', { method: 'POST', data: { roomId: owner.roomId, language: 'python', code: examples.python } })).status, 401);
  assert.equal((await request(`/api/rooms/${owner.roomId}`, { token: outsider.token })).status, 403);
  assert.equal((await request('/api/execute', { method: 'POST', token: outsider.token, socketId: outsider.socket.id, data: { roomId: owner.roomId, language: 'python', code: examples.python } })).status, 403);
  assert.equal((await request('/api/execute', { method: 'POST', token: owner.token, socketId: owner.socket.id, data: { roomId: owner.roomId, language: '__proto__', code: 'x' } })).status, 400);
  console.log('PASS authenticated rooms, WebSocket proxy, unauthenticated/cross-room/prototype-language rejection');
  let leaked = false;
  outsider.socket.on('execution:completed', () => { leaked = true; });
  for (const [language, code] of Object.entries(examples)) {
    const completion = event(owner.socket, 'execution:completed');
    // Attach rejection handling immediately even if HTTP fails before the event arrives.
    completion.catch(() => {});
    const result = await request('/api/execute', { method: 'POST', token: owner.token, socketId: owner.socket.id, data: { roomId: owner.roomId, language, code, timeout: 10000 } });
    assert.equal(result.status, 200, `${language} API execution failed`);
    assert.equal(result.data.result.exitCode, 0, `${language} runner failed`);
    assert.equal(result.data.result.stdout.trim(), 'completion-smoke');
    const broadcast = await completion;
    assert.equal(broadcast.roomId, owner.roomId);
    assert.equal(broadcast.stdout.trim(), 'completion-smoke');
    assert.equal(leaked, false, 'Result leaked to another room');
    console.log(`PASS ${language}: frontend API -> auth/room -> Redis queue -> isolated worker -> stdout and room-only realtime result`);
  }
}
main().catch(error => {
  // Assertions never print response objects/tokens or connection environments.
  console.error(`FAIL application smoke: ${error.message.split('\n')[0]}`);
  process.exitCode = 1;
}).finally(() => { for (const socket of sockets) socket.disconnect(); });
