// Liveness is separate from dependencies: a listening HTTP server can have a broken database.
async function pingRedis() {
  if (!process.env.REDIS_URL) return false;
  const Redis = require('ioredis');
  const client = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 1000,
    commandTimeout: 1000, maxRetriesPerRequest: 0, retryStrategy: () => null });
  client.on('error', () => {});
  try { await client.connect(); return await client.ping() === 'PONG'; }
  catch (_) { return false; }
  finally { client.disconnect(); }
}

async function readiness({ connection, redisProbe = pingRedis }) {
  let timer;
  const checks = Promise.all([
    Promise.resolve().then(async () => {
      if (connection.readyState !== 1) return false;
      await connection.db.admin().ping();
      return true;
    }).catch(() => false),
    Promise.resolve().then(redisProbe).catch(() => false),
  ]);
  try {
    const [database, redis] = await Promise.race([
      checks,
      new Promise(resolve => { timer = setTimeout(() => resolve([false, false]), 3000); }),
    ]);
    return { ready: database === true && redis === true, database: Boolean(database), redis: Boolean(redis) };
  } finally { clearTimeout(timer); }
}
module.exports = { readiness };
