// Read-only dependency checks. This does not prove job processing or sandbox enforcement.
const Docker = require('dockerode');
const Redis = require('ioredis');
const { parseDockerConnectionConfig } = require('../engine/dockerConfig');
const { LANGUAGE_IMAGE_MAP } = require('../engine/languages');

async function checkDependencies({ docker, redis }) {
  await docker.ping();
  for (const image of Object.values(LANGUAGE_IMAGE_MAP)) await docker.getImage(image).inspect();
  if (await redis.ping() !== 'PONG') throw new Error('Redis ping failed');
}

if (require.main === module) {
  // Bound the entire probe, including failed DNS and stalled Docker sockets.
  const timer = setTimeout(() => { console.error('Worker dependency probe timed out'); process.exit(1); }, 6000);
  let redis;
  (async () => {
    try {
      if (!process.env.REDIS_URL) throw new Error('REDIS_URL missing');
      redis = new Redis(process.env.REDIS_URL, { lazyConnect: true, connectTimeout: 2000, maxRetriesPerRequest: 0, retryStrategy: () => null });
      redis.on('error', () => {});
      await redis.connect();
      await checkDependencies({ docker: new Docker(parseDockerConnectionConfig()), redis });
      console.log('Worker dependencies reachable; all three runner images present');
    } catch (_) {
      // Do not print connection strings or raw errors from Redis/Docker.
      console.error('Worker dependency check failed: check Redis authentication, daemon connectivity and all three runner images');
      process.exitCode = 1;
    } finally { clearTimeout(timer); if (redis) redis.disconnect(); }
  })();
}
module.exports = { checkDependencies };
