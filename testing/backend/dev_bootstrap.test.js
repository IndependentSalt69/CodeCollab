/**
 * Regression Tests for CodeCollab Local Development Bootstrap & Configuration
 *
 * Validates:
 * - Missing REDIS_URL derives correct local connection URL targeting 127.0.0.1:6379
 * - URL-sensitive characters in Redis passwords are safely URL-encoded
 * - Explicit process environment overrides (REDIS_URL, PORT) are respected
 * - Credentials and generated URLs are sanitized and never exposed
 * - Local backend defaults to port 5001, overriding container port 5000
 * - Client origins explicitly permit local Vite frontend (localhost:5173, 127.0.0.1:5173) without wildcards
 * - Production Docker startup remains unchanged (NODE_ENV=production skips dev bootstrap)
 * - Vite configuration uses port 5173 with strictPort and proxies API/Socket.IO to 5001
 */

const path = require('path');
const {
  buildRedisUrl,
  sanitizeRedisUrl,
  resolveRedisConfig,
  initDevBootstrap,
} = require('../../backend/src/config/devBootstrap');
const { getClientOrigins } = require('../../backend/src/config/clientOrigins');

describe('Local Development Bootstrap & Configuration Regressions', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    delete process.env.REDIS_PASSWORD;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('1. Redis URL Derivation & Resolution', () => {
    it('derives local Redis connection targeting 127.0.0.1:6379 from infrastructure/.env password', () => {
      const mockFs = {
        existsSync: (p) => p.includes(path.join('infrastructure', '.env')),
        readFileSync: () => 'REDIS_PASSWORD=mock_infra_secret_abc123\nPORT=5000\n',
      };

      const result = resolveRedisConfig({
        env: {},
        rootDir: '/mock/project',
        fs: mockFs,
      });

      expect(result.source).toBe('infrastructure/.env');
      expect(result.redisUrl).toBe('redis://:mock_infra_secret_abc123@127.0.0.1:6379/0');
      expect(result.redisUrl).not.toContain('redis:6379'); // strictly loopback, not Docker hostname
    });

    it('safely percent-encodes URL-sensitive characters in passwords', () => {
      const sensitivePassword = 'p@ss:w/o?r#d%123!$&\'()*+,;=';
      const url = buildRedisUrl({
        host: '127.0.0.1',
        port: 6379,
        password: sensitivePassword,
        db: 0,
      });

      expect(url).not.toContain(sensitivePassword); // special chars are encoded
      const parsed = new URL(url);
      expect(parsed.hostname).toBe('127.0.0.1');
      expect(parsed.port).toBe('6379');
      expect(decodeURIComponent(parsed.password)).toBe(sensitivePassword);
    });

    it('normalizes Docker hostname "redis" to "127.0.0.1" for host-side execution', () => {
      const url = buildRedisUrl({
        host: 'redis',
        port: 6379,
        password: 'mock_password',
      });

      expect(url).toBe('redis://:mock_password@127.0.0.1:6379/0');
      expect(url).not.toContain('@redis:');
    });

    it('respects explicit process.env.REDIS_URL override without modification', () => {
      const explicitUrl = 'redis://custom-redis-host:6380/3';
      const result = resolveRedisConfig({
        env: { REDIS_URL: explicitUrl },
        rootDir: '/mock/project',
      });

      expect(result.source).toBe('process.env.REDIS_URL');
      expect(result.redisUrl).toBe(explicitUrl);
    });

    it('respects explicit process.env.REDIS_PASSWORD override', () => {
      const result = resolveRedisConfig({
        env: { REDIS_PASSWORD: 'mock_process_pwd' },
        rootDir: '/mock/project',
      });

      expect(result.source).toBe('process.env.REDIS_PASSWORD');
      expect(result.redisUrl).toBe('redis://:mock_process_pwd@127.0.0.1:6379/0');
    });

    it('fails closed with actionable error when no Redis configuration is present', () => {
      const mockEmptyFs = {
        existsSync: () => false,
        readFileSync: () => '',
      };

      expect(() => {
        resolveRedisConfig({
          env: {},
          rootDir: '/mock/project',
          fs: mockEmptyFs,
        });
      }).toThrow(/Missing Redis configuration/);
    });
  });

  describe('2. Safe URL Sanitization (SEC-LOG-01)', () => {
    it('redacts password from Redis URLs for diagnostics and logs', () => {
      const liveUrl = 'redis://:super_secret_redis_password_987@127.0.0.1:6379/0';
      const sanitized = sanitizeRedisUrl(liveUrl);

      expect(sanitized).toBe('redis://:***@127.0.0.1:6379/0');
      expect(sanitized).not.toContain('super_secret_redis_password_987');
    });

    it('redacts both username and password when present', () => {
      const userPassUrl = 'redis://app_user:secret_pass_xyz@127.0.0.1:6379/0';
      const sanitized = sanitizeRedisUrl(userPassUrl);

      expect(sanitized).toBe('redis://app_user:***@127.0.0.1:6379/0');
      expect(sanitized).not.toContain('secret_pass_xyz');
    });

    it('handles URLs without credentials cleanly', () => {
      expect(sanitizeRedisUrl('redis://127.0.0.1:6379/0')).toBe('redis://127.0.0.1:6379/0');
    });
  });

  describe('3. Development Port & CORS Bootstrap', () => {
    it('sets local backend port to 5001 when parent shell is unset or port 5000 is from .env', () => {
      const testEnv = { PORT: '5000' };
      const mockFs = {
        existsSync: () => true,
        readFileSync: () => 'REDIS_PASSWORD=mock_test_pwd\n',
      };

      initDevBootstrap({
        env: testEnv,
        rootDir: '/mock/project',
        fs: mockFs,
      });

      expect(testEnv.PORT).toBe('5001');
    });

    it('preserves deliberately supplied non-default port override from parent shell', () => {
      const testEnv = { PORT: '5002' };
      const mockFs = {
        existsSync: () => true,
        readFileSync: () => 'REDIS_PASSWORD=mock_test_pwd\n',
      };

      initDevBootstrap({
        env: testEnv,
        rootDir: '/mock/project',
        fs: mockFs,
      });

      expect(testEnv.PORT).toBe('5002');
    });

    it('explicitly adds Vite development origins (5173) to CLIENT_URL without wildcards', () => {
      const testEnv = { CLIENT_URL: 'http://localhost:3000' };
      const mockFs = {
        existsSync: () => true,
        readFileSync: () => 'REDIS_PASSWORD=mock_test_pwd\n',
      };

      initDevBootstrap({
        env: testEnv,
        rootDir: '/mock/project',
        fs: mockFs,
      });

      expect(testEnv.CLIENT_URL).toContain('http://localhost:5173');
      expect(testEnv.CLIENT_URL).toContain('http://127.0.0.1:5173');
      expect(testEnv.CLIENT_URL).toContain('http://localhost:3000');

      // Verify clientOrigins parser accepts the generated list and rejects wildcards
      const origins = getClientOrigins(testEnv.CLIENT_URL);
      expect(origins).toContain('http://localhost:5173');
      expect(origins).toContain('http://127.0.0.1:5173');
      expect(origins).toContain('http://localhost:3000');
      expect(origins).not.toContain('*');
    });

    it('populates process.env.REDIS_URL before session and transport initialization', () => {
      const testEnv = {};
      const mockFs = {
        existsSync: () => true,
        readFileSync: () => 'REDIS_PASSWORD=transport_test_pwd\n',
      };

      initDevBootstrap({
        env: testEnv,
        rootDir: '/mock/project',
        fs: mockFs,
      });

      expect(testEnv.REDIS_URL).toBe('redis://:transport_test_pwd@127.0.0.1:6379/0');
    });
  });

  describe('4. Production Environment Isolation', () => {
    it('skips dev bootstrap entirely when NODE_ENV=production', () => {
      const prodEnv = {
        NODE_ENV: 'production',
        PORT: '5000',
        CLIENT_URL: 'http://localhost:3000',
      };

      const result = initDevBootstrap({ env: prodEnv });
      expect(result.skipped).toBe(true);
      expect(prodEnv.PORT).toBe('5000'); // remains 5000 for Docker
      expect(prodEnv.CLIENT_URL).toBe('http://localhost:3000');
      expect(prodEnv.REDIS_URL).toBeUndefined();
    });
  });

  describe('5. Vite Local Development Configuration', () => {
    it('vite.config.ts configures dev port 5173, strictPort: true, and proxies to local backend 5001', () => {
      const fsModule = require('fs');
      const viteConfigContent = fsModule.readFileSync(
        path.resolve(__dirname, '../../frontend/vite.config.ts'),
        'utf8'
      );

      expect(viteConfigContent).toContain('5173');
      expect(viteConfigContent).toContain('strictPort: true');
      expect(viteConfigContent).toContain('5001');
      expect(viteConfigContent).toContain("ws: true");
      expect(viteConfigContent).toContain("'/api'");
      expect(viteConfigContent).toContain("'/socket.io'");
    });
  });
});

