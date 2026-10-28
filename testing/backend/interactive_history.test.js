/**
 * Interactive terminal execution history tests
 *
 * Runs started from the interactive terminal (terminal:start) must be saved as
 * ExecutionRun documents so they appear in GET /api/rooms/:roomId/executions.
 * Saving is best effort and must never block or fail the live session.
 * Redis, the queue and the database are faked; no services are needed.
 */

const mongoose = require('mongoose');
const Room = require('../../database/models/Room');
const ExecutionRun = require('../../database/models/ExecutionRun');
const { InteractiveSessions } = require('../../backend/src/services/interactiveSessions');
const { setDriver, removeDriver } = require('../../realtime/server/driverState');

const ROOM = 'history-room';
const OWNER = '67056a1b2c3d4e5f6a7b8c01';

describe('Interactive terminal execution history', () => {
  let manager;
  let redis;
  let streamRows;
  let driver;

  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const pushEvents = (...events) => {
    streamRows = [['out', events.map((event, i) => [`${i + 1}-0`, ['event', JSON.stringify(event)]])]];
  };

  beforeEach(() => {
    streamRows = null;
    redis = {
      status: 'ready',
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn().mockResolvedValue(1),
      eval: jest.fn().mockResolvedValue(1),
      xread: jest.fn(async () => { const rows = streamRows; streamRows = null; return rows; }),
      disconnect: jest.fn(),
    };
    driver = {
      id: 'driver-socket',
      connected: true,
      rooms: new Set([ROOM]),
      data: { authenticated: true, verifiedUser: { userId: OWNER }, roomVerifiedUsers: new Map([[ROOM, { userId: OWNER }]]) },
      emit: jest.fn(),
      on: jest.fn(),
    };
    const io = {
      sockets: { sockets: new Map([[driver.id, driver]]), adapter: { rooms: new Map([[ROOM, new Set([driver.id])]]) } },
    };

    mongoose.connection.readyState = 1;
    jest.spyOn(Room, 'findOne').mockResolvedValue({ roomId: ROOM, owner: OWNER, members: [OWNER] });
    jest.spyOn(ExecutionRun, 'create').mockResolvedValue({ _id: 'run-1' });
    jest.spyOn(ExecutionRun, 'updateOne').mockResolvedValue({});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    setDriver(ROOM, driver.id);

    manager = new InteractiveSessions(io, {
      queue: { add: jest.fn().mockResolvedValue({ remove: jest.fn().mockResolvedValue() }) },
      connect: async () => redis,
    });
  });

  afterEach(async () => {
    await manager.close();
    removeDriver(ROOM);
    mongoose.connection.readyState = 0;
    jest.restoreAllMocks();
  });

  const start = () => manager.start(driver, { roomId: ROOM, language: 'python', code: 'print(input())', stdin: 'first\n' });

  test('saves the run when it starts and its result when it finishes', async () => {
    const { sessionId } = await start();

    expect(ExecutionRun.create).toHaveBeenCalledWith({
      roomId: ROOM,
      triggeredBy: OWNER,
      language: 'python',
      code: 'print(input())',
      stdin: 'first\n',
      status: 'queued',
    });

    pushEvents({ type: 'status', status: 'running', seq: 1 });
    await manager.poll();
    await manager.action(driver, 'input', { sessionId, seq: 1, data: 'second\n' });

    pushEvents(
      { type: 'output', channel: 'stdout', text: 'first\n', seq: 2 },
      { type: 'output', channel: 'stderr', text: 'warning\n', seq: 3 },
      { type: 'finished', status: 'completed', exitCode: 0, executionTimeMs: 321, seq: 4 }
    );
    await manager.poll();
    await flush();

    expect(ExecutionRun.updateOne).toHaveBeenCalledWith({ _id: 'run-1' }, { $set: {
      status: 'completed',
      exitCode: 0,
      executionTimeMs: 321,
      stdin: 'first\nsecond\n',
      stdout: 'first\n',
      stderr: 'warning\n',
    } });
  });

  test('records cancelled runs', async () => {
    const { sessionId } = await start();
    await manager.action(driver, 'cancel', { sessionId });
    await flush();

    expect(ExecutionRun.updateOne).toHaveBeenCalledWith(
      { _id: 'run-1' },
      { $set: expect.objectContaining({ status: 'cancelled', exitCode: 130 }) }
    );
  });

  test('stores the worker error as stderr when the run fails without output', async () => {
    await start();
    pushEvents({ type: 'finished', status: 'failed', exitCode: 1, error: 'Execution worker could not complete the sandbox session', seq: 1 });
    await manager.poll();
    await flush();

    expect(ExecutionRun.updateOne).toHaveBeenCalledWith(
      { _id: 'run-1' },
      { $set: expect.objectContaining({ status: 'failed', stderr: 'Execution worker could not complete the sandbox session' }) }
    );
  });

  test('a database failure does not block or fail the terminal session', async () => {
    ExecutionRun.create.mockRejectedValue(new Error('connection refused'));

    const result = await start();
    expect(result.ok).toBe(true);

    pushEvents({ type: 'finished', status: 'completed', exitCode: 0, seq: 1 });
    await manager.poll();
    await flush();

    expect(driver.emit).toHaveBeenCalledWith('terminal:event', expect.objectContaining({ type: 'finished', status: 'completed' }));
    expect(ExecutionRun.updateOne).not.toHaveBeenCalled();
  });
});
