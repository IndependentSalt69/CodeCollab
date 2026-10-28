const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const IORedis = require('ioredis');

/**
 * Redacts credentials from connection URLs for safe logging (SEC-LOG-01).
 *
 * @param {string} url
 * @returns {string} Sanitized URL
 */
function sanitizeRedisUrl(url = '') {
  if (typeof url !== 'string') return '';
  return url.replace(/(:\/\/)([^:@\s]+)?(?::([^@\s]+))?@/, (match, proto, user) => {
    return user ? `${proto}${user}:***@` : `${proto}:***@`;
  });
}

/**
 * Constructs a Redis connection URL from individual parameters.
 * Normalizes host to '127.0.0.1' (replaces Docker-internal 'redis').
 * Safely percent-encodes username and password.
 *
 * @param {Object} options
 * @param {string} [options.host='127.0.0.1']
 * @param {number|string} [options.port=6379]
 * @param {string} [options.username='']
 * @param {string} [options.password='']
 * @param {number|string} [options.db=0]
 * @returns {string} Fully formed Redis URL
 */
function buildRedisUrl(options = {}) {
  const rawHost = options.host || '127.0.0.1';
  const host = rawHost === 'redis' ? '127.0.0.1' : rawHost;
  const port = typeof options.port === 'number' ? options.port : (parseInt(options.port, 10) || 6379);
  const db = typeof options.db === 'number' ? options.db : (parseInt(options.db, 10) || 0);

  const username = options.username ? encodeURIComponent(options.username) : '';
  const password = options.password ? encodeURIComponent(options.password) : '';

  let authPart = '';
  if (username && password) {
    authPart = `${username}:${password}@`;
  } else if (password) {
    authPart = `:${password}@`;
  } else if (username) {
    authPart = `${username}@`;
  }

  return `redis://${authPart}${host}:${port}/${db}`;
}

/**
 * Resolves Redis configuration following strict precedence:
 * 1. Explicit process.env.REDIS_URL
 * 2. Explicit process.env.REDIS_PASSWORD
 * 3. Root .env (REDIS_URL or REDIS_PASSWORD)
 * 4. infrastructure/.env (REDIS_URL or REDIS_PASSWORD)
 * 5. Fails closed with actionable diagnostic if no configuration is found.
 *
 * @param {Object} [options]
 * @returns {{ redisUrl: string, source: string }}
 */
function resolveRedisConfig(options = {}) {
  const env = options.env || process.env;
  const rootDir = options.rootDir || path.resolve(__dirname, '../../../');
  const fileSystem = options.fs || fs;

  // 1. Explicit REDIS_URL in process environment
  if (typeof env.REDIS_URL === 'string' && env.REDIS_URL.trim() !== '') {
    return {
      redisUrl: env.REDIS_URL.trim(),
      source: 'process.env.REDIS_URL',
    };
  }

  // 2. Explicit REDIS_PASSWORD in process environment
  if (typeof env.REDIS_PASSWORD === 'string' && env.REDIS_PASSWORD.trim() !== '') {
    const rawHost = env.REDIS_HOST || '127.0.0.1';
    const host = rawHost === 'redis' ? '127.0.0.1' : rawHost;
    const port = parseInt(env.REDIS_PORT, 10) || 6379;
    const username = env.REDIS_USER || env.REDIS_USERNAME || '';
    const password = env.REDIS_PASSWORD;
    const db = parseInt(env.REDIS_DB, 10) || 0;

    return {
      redisUrl: buildRedisUrl({ host, port, username, password, db }),
      source: 'process.env.REDIS_PASSWORD',
    };
  }

  // Helper to read and parse .env files silently without logging
  const readEnvFile = (filePath) => {
    try {
      if (fileSystem.existsSync(filePath)) {
        const content = fileSystem.readFileSync(filePath, 'utf8');
        return dotenv.parse(content);
      }
    } catch (_) {
      // Ignore read errors
    }
    return null;
  };

  // 3. Inspect root .env
  const rootEnvPath = path.join(rootDir, '.env');
  const rootEnv = readEnvFile(rootEnvPath);
  if (rootEnv) {
    if (typeof rootEnv.REDIS_URL === 'string' && rootEnv.REDIS_URL.trim() !== '') {
      return {
        redisUrl: rootEnv.REDIS_URL.trim(),
        source: '.env',
      };
    }
    if (typeof rootEnv.REDIS_PASSWORD === 'string' && rootEnv.REDIS_PASSWORD.trim() !== '') {
      const rawHost = rootEnv.REDIS_HOST || '127.0.0.1';
      const host = rawHost === 'redis' ? '127.0.0.1' : rawHost;
      const port = parseInt(rootEnv.REDIS_PORT, 10) || 6379;
      const username = rootEnv.REDIS_USER || rootEnv.REDIS_USERNAME || '';
      const password = rootEnv.REDIS_PASSWORD;
      const db = parseInt(rootEnv.REDIS_DB, 10) || 0;

      return {
        redisUrl: buildRedisUrl({ host, port, username, password, db }),
        source: '.env',
      };
    }
  }

  // 4. Inspect infrastructure/.env
  const infraEnvPath = path.join(rootDir, 'infrastructure', '.env');
  const infraEnv = readEnvFile(infraEnvPath);
  if (infraEnv) {
    if (typeof infraEnv.REDIS_URL === 'string' && infraEnv.REDIS_URL.trim() !== '') {
      return {
        redisUrl: infraEnv.REDIS_URL.trim(),
        source: 'infrastructure/.env',
      };
    }
    if (typeof infraEnv.REDIS_PASSWORD === 'string' && infraEnv.REDIS_PASSWORD.trim() !== '') {
      const rawHost = infraEnv.REDIS_HOST || '127.0.0.1';
      const host = rawHost === 'redis' ? '127.0.0.1' : rawHost;
      const port = parseInt(infraEnv.REDIS_PORT, 10) || 6379;
      const username = infraEnv.REDIS_USER || infraEnv.REDIS_USERNAME || '';
      const password = infraEnv.REDIS_PASSWORD;
      const db = parseInt(infraEnv.REDIS_DB, 10) || 0;

      return {
        redisUrl: buildRedisUrl({ host, port, username, password, db }),
        source: 'infrastructure/.env',
      };
    }
  }

  throw new Error(
    '[CodeCollab Dev Bootstrap] Missing Redis configuration: neither REDIS_URL nor REDIS_PASSWORD was found in environment or infrastructure/.env.'
  );
}

/**
 * Bootstraps local development environment variables synchronously.
 * Must run before importing modules that depend on REDIS_URL, PORT, or CLIENT_URL.
 *
 * @param {Object} [options]
 * @returns {{ port: string, clientUrl: string, redisSource?: string }}
 */
function initDevBootstrap(options = {}) {
  const env = options.env || process.env;
  if (env.NODE_ENV === 'production') {
    return { skipped: true };
  }

  const rootDir = options.rootDir || path.resolve(__dirname, '../../../');
  const rootEnvPath = path.join(rootDir, '.env');

  // 1. Record parent environment port before loading .env
  const initialPort = env.PORT;

  // 2. Load root .env (preserves existing env variables)
  if (fs.existsSync(rootEnvPath)) {
    dotenv.config({ path: rootEnvPath });
  }

  // 3. Port: local backend defaults to 5001.
  // If parent shell explicitly set PORT (and it's not 5000), keep it.
  // If unset or if .env provided 5000 (Docker container port), default to 5001.
  if (!initialPort || initialPort === '5000') {
    env.PORT = '5001';
  }

  // 4. Client origins: explicitly allow Vite development server (5173) alongside 3000
  const currentOrigins = (env.CLIENT_URL || 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const devOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  for (const origin of devOrigins) {
    if (!currentOrigins.includes(origin)) {
      currentOrigins.push(origin);
    }
  }
  env.CLIENT_URL = currentOrigins.join(',');

  // 5. Redis URL: derive local loopback connection if not explicitly set
  let redisSource;
  if (!env.REDIS_URL || env.REDIS_URL.trim() === '') {
    const redisConfig = resolveRedisConfig({ env, rootDir, fs: options.fs });
    env.REDIS_URL = redisConfig.redisUrl;
    redisSource = redisConfig.source;
  } else {
    redisSource = 'explicit';
  }

  return {
    port: env.PORT,
    clientUrl: env.CLIENT_URL,
    redisSource,
  };
}

/**
 * Validates essential local development dependencies (Redis) with fast-failing diagnostics.
 *
 * @param {Object} [options]
 * @param {number} [options.timeoutMs=2000]
 * @returns {Promise<void>}
 */
async function verifyDevDependencies(options = {}) {
  const timeoutMs = options.timeoutMs || 2000;
  const redisUrl = (options.env || process.env).REDIS_URL;

  if (!redisUrl) {
    throw new Error(
      '[CodeCollab Dev Bootstrap] REDIS_URL is not configured. Run initDevBootstrap() before dependency verification.'
    );
  }

  const safeUrl = sanitizeRedisUrl(redisUrl);
  let parsedUrl;
  try {
    parsedUrl = new URL(redisUrl);
  } catch (_) {
    throw new Error(`[CodeCollab Dev Bootstrap] Invalid REDIS_URL format: ${safeUrl}`);
  }

  const client = new IORedis({
    host: parsedUrl.hostname || '127.0.0.1',
    port: parseInt(parsedUrl.port, 10) || 6379,
    password: parsedUrl.password ? decodeURIComponent(parsedUrl.password) : undefined,
    username: parsedUrl.username ? decodeURIComponent(parsedUrl.username) : undefined,
    db: parsedUrl.pathname && parsedUrl.pathname.length > 1 ? parseInt(parsedUrl.pathname.slice(1), 10) || 0 : 0,
    lazyConnect: true,
    connectTimeout: timeoutMs,
    commandTimeout: timeoutMs,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  });

  client.on('error', () => {
    // Suppress unhandled EventEmitter errors during preflight probe
  });

  let timeoutTimer;
  try {
    const timeoutPromise = new Promise((_, reject) => {
      timeoutTimer = setTimeout(() => {
        reject(new Error(`Connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    await Promise.race([client.connect(), timeoutPromise]);
    const pong = await client.ping();
    if (pong !== 'PONG') {
      throw new Error(`Unexpected Redis response: "${pong}"`);
    }
  } catch (err) {
    const message = err?.message || String(err);
    if (message.includes('ECONNREFUSED') || message.includes('Connection timed out') || message.includes('ENOTFOUND')) {
      throw new Error(
        `[CodeCollab Dev Bootstrap] Redis preflight failed at ${safeUrl}: connection refused or timed out.\n` +
        `The Docker service 'redis' is not running or port 6379 is unreachable.\n` +
        `Safe recovery command: docker compose -f infrastructure/docker-compose.yml up -d redis`
      );
    }
    if (message.includes('WRONGPASS') || message.includes('NOAUTH') || message.includes('authentication')) {
      throw new Error(
        `[CodeCollab Dev Bootstrap] Redis preflight failed: authentication error for ${safeUrl}.\n` +
        `Please verify REDIS_PASSWORD in infrastructure/.env matches the running Redis container.`
      );
    }
    throw new Error(`[CodeCollab Dev Bootstrap] Redis preflight failed for ${safeUrl}: ${message}`);
  } finally {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    try {
      client.disconnect(false);
    } catch (_) {
      // Disconnect cleanly
    }
  }
}

module.exports = {
  initDevBootstrap,
  resolveRedisConfig,
  buildRedisUrl,
  sanitizeRedisUrl,
  verifyDevDependencies,
};

