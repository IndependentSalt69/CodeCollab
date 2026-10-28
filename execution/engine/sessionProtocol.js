const Redis = require('ioredis');
const SESSION_TTL_SECONDS = 45;
const LEASE_MS = 3000;
function keys(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(id)) throw Error('Invalid execution session');
  const prefix = `codecollab:terminal:${id}`;
  return { lease: `${prefix}:lease`, input: `${prefix}:input`, output: `${prefix}:output` };
}
async function connect(url = process.env.REDIS_URL) {
  if (!url) throw Error('Execution transport unavailable');
  const redis = new Redis(url, { lazyConnect: true, enableOfflineQueue: false,
    connectTimeout: 1500, commandTimeout: 1500, maxRetriesPerRequest: 0, retryStrategy: () => null });
  redis.on('error', () => {});
  try { await redis.connect(); return redis; } catch { redis.disconnect(); throw Error('Execution transport unavailable'); }
}
async function append(redis, key, lease, value, max) {
  // Atomic TTL avoids orphan keys if either process exits between XADD and EXPIRE.
  const result = await redis.eval(`if redis.call('EXISTS', KEYS[2]) == 0 then return false end
    local id = redis.call('XADD', KEYS[1], 'MAXLEN', ARGV[1], '*', 'data', ARGV[2])
    redis.call('EXPIRE', KEYS[1], ARGV[3]); return id`, 2, key, lease, max, JSON.stringify(value), SESSION_TTL_SECONDS);
  if (!result) throw Error('Execution session expired');
  return result;
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = { keys, connect, append, pause, LEASE_MS, SESSION_TTL_SECONDS };
