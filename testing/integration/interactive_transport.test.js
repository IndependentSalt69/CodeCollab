const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const Room = require('../../database/models/Room');
const ExecutionRun = require('../../database/models/ExecutionRun');
const { ExecutionQueue } = require('../../execution/engine/queue');
const { InteractiveSessions } = require('../../backend/src/services/interactiveSessions');
const { setDriver, removeDriver } = require('../../realtime/server/driverState');
const { keys, connect } = require('../../execution/engine/sessionProtocol');

// Real Redis, separate Node worker process and real Docker. Only persistent room lookup is mocked.
describe('interactive backend-to-worker transport and authorization', () => {
  jest.setTimeout(20000);
  const queueName = 'terminal-test-' + randomUUID();
  let queue, worker, manager, redis, driver, viewer, stranger, io, room, events;
  const until = async (predicate, timeout = 12000) => {
    const end = Date.now() + timeout;
    while (!await predicate()) { if (Date.now() > end) throw Error('Timed out waiting for terminal test condition'); await new Promise(resolve => setTimeout(resolve, 30)); }
  };
  const socket = (id, uid, roomId = 'interactive-room') => ({ id, connected: true, rooms: new Set([roomId]),
    data: { authenticated: true, verifiedUser: { userId: uid }, roomVerifiedUsers: new Map([[roomId, { userId: uid }]]) },
    emit: jest.fn(), on: jest.fn() });
  const startChildWorker = async () => {
    const script = `const m=require('./execution/worker');const w=m.startWorker({queueName:process.env.INTERACTIVE_TEST_QUEUE});process.on('message',async()=>{await w.close(false);process.exit(0);});`;
    worker = spawn(process.execPath, ['-e', script], { cwd: process.cwd(), env: { ...process.env, INTERACTIVE_TEST_QUEUE: queueName }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Test worker did not become ready')), 7000);
      worker.stdout.on('data', chunk => { if (chunk.toString().includes('Worker ready')) { clearTimeout(timer); resolve(); } });
      worker.once('exit', code => { clearTimeout(timer); reject(Error('Test worker exited ' + code)); });
    });
  };
  beforeAll(async () => {
    redis = await connect();
    queue = new ExecutionQueue({ queueName, redisUrl: process.env.REDIS_URL });
    await startChildWorker();
  });
  beforeEach(() => {
    events = [];
    driver = socket('driver', 'owner'); viewer = socket('viewer', 'member'); stranger = socket('stranger', 'outsider');
    driver.emit.mockImplementation((name, event) => events.push(event));
    room = { owner: 'owner', members: ['member'] };
    mongoose.connection.readyState = 1;
    jest.spyOn(Room, 'findOne').mockResolvedValue(room);
    jest.spyOn(ExecutionRun, 'create').mockResolvedValue({ _id: 'run-id' });
    jest.spyOn(ExecutionRun, 'updateOne').mockResolvedValue({});
    io = { sockets: { sockets: new Map([driver, viewer, stranger].map(s => [s.id, s])), adapter: { rooms: new Map([['interactive-room', new Set(['driver', 'viewer', 'stranger'])]]) } } };
    manager = new InteractiveSessions(io, { queue });
    setDriver('interactive-room', 'driver');
  });
  afterEach(async () => {
    if (manager) {
      for (const session of manager.sessions.values()) await manager.cancel(session);
      await until(() => manager.sessions.size === 0);
      await manager.close();
    }
    mongoose.connection.readyState = 0;
    removeDriver('interactive-room'); jest.restoreAllMocks();
  });
  afterAll(async () => {
    if (worker?.connected) { const exited = new Promise(resolve => worker.once('exit', resolve)); worker.send('stop'); await exited; }
    if (queue) { await queue.getQueue().obliterate({ force: true }); await queue.close(); } // Unique test queue only.
    redis?.disconnect();
  });
  const start = (code = 'name=input("Name: "); print("Hello",name); age=input("Age: "); print("Next",int(age)+1)', extra = {}) =>
    manager.start(driver, { roomId: 'interactive-room', language: 'python', code, timeout: 7000, ...extra });
  const output = () => events.filter(e => e.type === 'output').map(e => e.text).join('');
  test.each([
    ['python', undefined],
    ['cpp', '#include <iostream>\n#include <string>\nint main(){std::string n;int a;std::cout<<"Name: "<<std::flush;std::getline(std::cin,n);std::cout<<"Hello "<<n<<"\\nAge: "<<std::flush;std::cin>>a;std::cout<<"Next "<<a+1;}'],
    ['java', 'import java.util.Scanner;public class Main{public static void main(String[]a){Scanner s=new Scanner(System.in);System.out.print("Name: ");String n=s.nextLine();System.out.println("Hello "+n);System.out.print("Age: ");System.out.println("Next "+(s.nextInt()+1));}}'],
  ])('%s sends two inputs only after prompts across real processes; cleans mapping/streams/job', async (language, code) => {
    const { sessionId } = await start(code, { language });
    await until(() => output().includes('Name:') && manager.sessions.get(sessionId)?.status === 'running');
    await manager.action(driver, 'input', { sessionId, seq: 1, data: 'Alex Ω "quotes"\n' });
    await until(() => output().includes('Age:'));
    expect(output()).toContain('Hello Alex Ω "quotes"');
    await manager.action(driver, 'input', { sessionId, seq: 2, data: '20\n' });
    await until(() => events.some(e => e.type === 'finished'));
    expect(output()).toContain('Next 21'); expect(events.at(-1).status).toBe('completed');
    expect(viewer.emit).toHaveBeenCalled(); expect(stranger.emit).not.toHaveBeenCalled();
    await until(async () => !await queue.getJob(sessionId) && !await redis.exists(...Object.values(keys(sessionId))));
    expect(manager.sessions.has(sessionId)).toBe(false);
    await expect(manager.action(driver, 'input', { sessionId, seq: 3, data: 'late' })).rejects.toThrow(/unavailable/);
  });
  test('rejects unauthenticated starts, non-members, unsupported languages and guessed sessions', async () => {
    driver.data.authenticated = false;
    await expect(start()).rejects.toThrow(/Authentication/); driver.data.authenticated = true;
    await expect(manager.start(stranger, { roomId: 'interactive-room', language: 'python', code: 'print(1)' })).rejects.toThrow(/membership/);
    for (const language of ['javascript', 'js', '__proto__', 'constructor']) await expect(start(undefined, { language })).rejects.toThrow(/Unsupported/);
    await expect(manager.action(driver, 'cancel', { sessionId: randomUUID() })).rejects.toThrow(/unavailable/);
  });
  test('owner/session binding, current driver, input sequence and per-message limits are enforced', async () => {
    const { sessionId } = await start('input("Ready")');
    await until(() => output().includes('Ready'));
    await expect(manager.action(viewer, 'input', { sessionId, seq: 1, data: 'bad' })).rejects.toThrow(/unavailable/);
    await expect(manager.action(stranger, 'cancel', { sessionId })).rejects.toThrow(/unavailable/);
    await expect(manager.action(driver, 'input', { sessionId, seq: 2, data: 'bad' })).rejects.toThrow(/order/);
    await expect(manager.action(driver, 'input', { sessionId, seq: 1, data: 'x'.repeat(4097) })).rejects.toThrow(/4 KiB/);
    setDriver('interactive-room', 'viewer');
    await expect(manager.action(driver, 'cancel', { sessionId })).rejects.toThrow(/active room driver/);
    setDriver('interactive-room', 'driver');
    await manager.action(driver, 'cancel', { sessionId });
    await until(() => events.at(-1)?.type === 'finished'); expect(events.at(-1).status).toBe('cancelled');
  });
  test('EOF disables further input; room membership is rechecked before output delivery', async () => {
    const { sessionId } = await start('import sys;print("Ready",flush=True);print("EOF",sys.stdin.read())');
    await until(() => output().includes('Ready'));
    room.members = [];
    viewer.emit.mockClear();
    await manager.action(driver, 'eof', { sessionId, seq: 1 });
    await expect(manager.action(driver, 'input', { sessionId, seq: 2, data: 'late' })).rejects.toThrow(/not open|unavailable/);
    await until(() => events.at(-1)?.type === 'finished'); expect(output()).toContain('EOF'); expect(viewer.emit).not.toHaveBeenCalled();
  });
  test('initiator disconnection cancels the actual running job', async () => {
    const { sessionId } = await start('input("Ready")');
    await until(() => output().includes('Ready')); driver.connected = false;
    await until(() => !manager.sessions.has(sessionId));
    await until(async () => !await queue.getJob(sessionId));
  });
  test('backend lease expiry cancels worker execution even without a cancel message', async () => {
    const { sessionId } = await start('input("Ready")');
    await until(() => output().includes('Ready'));
    await redis.del(keys(sessionId).lease);
    await until(async () => !await queue.getJob(sessionId));
    await until(() => !manager.sessions.has(sessionId));
  });
  test('concurrent starts cannot bypass admission and early input cannot beat readiness', async () => {
    const starts = await Promise.allSettled([start('input("Ready")'), start('input("Ready")')]);
    expect(starts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const sessionId = starts.find(result => result.status === 'fulfilled').value.sessionId;
    await expect(manager.action(driver, 'input', { sessionId, seq: 1, data: 'early' })).rejects.toThrow(/not open/);
    await until(() => output().includes('Ready'));
    await manager.action(driver, 'cancel', { sessionId });
  });
  test('cumulative initial/live UTF-8 input and socket request flooding are bounded', async () => {
    const { sessionId } = await start('import sys;print("Ready",flush=True);sys.stdin.read()', { stdin: 'x'.repeat(65536) });
    await until(() => output().includes('Ready'));
    await expect(manager.action(driver, 'input', { sessionId, seq: 1, data: 'x' })).rejects.toThrow(/input limit/);
    manager.register(driver);
    const handler = driver.on.mock.calls.find(([event]) => event === 'terminal:input')[1];
    const replies = [];
    await Promise.all(Array.from({ length: 30 }, () => handler({ sessionId, seq: 1, data: 'x' }, value => replies.push(value))));
    expect(replies.some(reply => /rate exceeded/.test(reply.error))).toBe(true);
    expect(manager.sessions.get(sessionId).inputBytes).toBe(65536);
    await manager.action(driver, 'cancel', { sessionId });
  });
  test('abrupt test-worker loss removes its sandbox; a replacement worker removes the stalled job without replay', async () => {
    const docker = require('../../execution/engine/executor').getDockerClient();
    const before = new Set((await docker.listContainers()).map(container => container.Id));
    const { sessionId } = await start('input("Crash test ready")', { timeout: 4000 });
    await until(() => output().includes('Crash test ready'));
    const owned = (await docker.listContainers()).filter(container => !before.has(container.Id) && container.Labels?.['codecollab.runner'] === 'python');
    expect(owned).toHaveLength(1);
    const exited = new Promise(resolve => worker.once('exit', resolve));
    worker.kill('SIGKILL'); await exited; // Only the child process created by this test.
    await until(async () => { try { await docker.getContainer(owned[0].Id).inspect(); return false; } catch (error) { if (error.statusCode === 404) return true; throw error; } });
    await until(() => !manager.sessions.has(sessionId));
    expect(events.at(-1).status).toBe('failed');
    await startChildWorker(); // Normal BullMQ lock/stalled-job recovery; no forced unlock.
    await until(async () => !await queue.getJob(sessionId), 70000);
    expect(await redis.exists(...Object.values(keys(sessionId)))).toBe(0);
  }, 90000);
});
