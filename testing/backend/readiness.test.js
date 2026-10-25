const { readiness } = require('../../backend/src/config/readiness');
const dependencies = () => ({ connection: { readyState: 1, db: { admin: () => ({ ping: async () => {} }) } }, redisProbe: async () => true });
test('requires a responding database and Redis', async () => {
  await expect(readiness(dependencies())).resolves.toEqual({ ready: true, database: true, redis: true });
});
test('a disconnected database is not ready despite HTTP liveness', async () => {
  const input = dependencies(); input.connection.readyState = 0;
  await expect(readiness(input)).resolves.toEqual({ ready: false, database: false, redis: true });
});
test('does not expose database connection errors', async () => {
  const input = dependencies(); input.connection.db.admin = () => ({ ping: async () => { throw Error('sensitive connection detail'); } });
  await expect(readiness(input)).resolves.toEqual({ ready: false, database: false, redis: true });
});
test('Redis failure prevents readiness', async () => {
  const input = dependencies(); input.redisProbe = async () => false;
  await expect(readiness(input)).resolves.toEqual({ ready: false, database: true, redis: false });
});
test('bounds stalled dependency checks', async () => {
  jest.useFakeTimers();
  try {
    const input = dependencies(); input.redisProbe = () => new Promise(() => {});
    const result = readiness(input);
    await jest.advanceTimersByTimeAsync(3001);
    await expect(result).resolves.toEqual({ ready: false, database: false, redis: false });
  } finally { jest.useRealTimers(); }
});
