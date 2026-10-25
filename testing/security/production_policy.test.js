const { verifyProductionDaemon, parseDockerConnectionConfig } = require('../../execution/engine/dockerConfig');
const { checkDependencies } = require('../../execution/worker/healthcheck');
const { getClientOrigins } = require('../../backend/src/config/clientOrigins');

const capable = { SecurityOptions: ['name=rootless'], CgroupDriver: 'systemd', CgroupVersion: '2',
  OperatingSystem: 'Debian GNU/Linux', KernelVersion: '6.1.0', Runtimes: { runsc: {} },
  MemoryLimit: true, CPUShares: true, CpuCfsQuota: true, CpuCfsPeriod: true, PidsLimit: true };
const original = { ...process.env };
afterEach(() => { process.env = { ...original }; });
describe('Production policy (mock capabilities, not kernel qualification)', () => {
  beforeEach(() => { process.env.NODE_ENV = 'production'; delete process.env.ALLOW_UNENFORCED_CGROUPS; delete process.env.REQUIRE_CGROUP_ENFORCEMENT; });
  test.each(['', 'runc'])('cannot downgrade runsc to %s', async runtime => {
    await expect(verifyProductionDaemon({ info: async () => capable }, runtime)).rejects.toThrow(/runsc/);
  });
  test.each([{ SecurityOptions: [] }, { CgroupDriver: 'none' }, { CgroupVersion: '1' },
    { OperatingSystem: 'Docker Desktop' }, { KernelVersion: '6.6-microsoft-standard-WSL2' },
    { CpuCfsQuota: false }, { Runtimes: {} }])('rejects unsuitable daemon %j', async change => {
    await expect(verifyProductionDaemon({ info: async () => ({ ...capable, ...change }) }, 'runsc')).rejects.toThrow();
  });
  test('capable advertisement passes startup gate only', async () => {
    await expect(verifyProductionDaemon({ info: async () => capable }, 'runsc')).resolves.toBeUndefined();
  });
  test.each(['production', 'staging', ''])('rejects default host fallback in %s', mode => {
    process.env.NODE_ENV = mode;
    expect(() => parseDockerConnectionConfig('', { allowFallback: true })).toThrow(/not permitted/);
    expect(() => parseDockerConnectionConfig('unix:///var/run/docker.sock', { allowHostSocket: true })).toThrow(/not permitted/);
  });
  test('unreachable daemon fails closed', async () => {
    await expect(verifyProductionDaemon({ info: async () => { throw Error('unreachable'); } }, 'runsc')).rejects.toThrow('unreachable');
  });
});
describe('Worker dependency health (mocks)', () => {
  const image = { inspect: jest.fn().mockResolvedValue({}) };
  const docker = { ping: jest.fn().mockResolvedValue(), getImage: jest.fn(() => image) };
  test('checks every language and Redis', async () => {
    await checkDependencies({ docker, redis: { ping: async () => 'PONG' } });
    expect(docker.getImage.mock.calls.map(([name]) => name)).toEqual(['codecollab-runner-python:latest', 'codecollab-runner-cpp:latest', 'codecollab-runner-java:latest']);
  });
  test('fails on missing image', async () => {
    await expect(checkDependencies({ docker: { ...docker, getImage: () => ({ inspect: async () => { throw Error('image missing'); } }) }, redis: {} })).rejects.toThrow('image missing');
  });
  test('fails on unavailable Redis', async () => {
    await expect(checkDependencies({ docker, redis: { ping: async () => { throw Error('unavailable'); } } })).rejects.toThrow('unavailable');
  });
});
describe('Explicit browser origin allowlist', () => {
  test('supports localhost plus an explicit LAN origin', () => {
    expect(getClientOrigins('http://localhost:3000, http://192.168.1.2:3000')).toEqual(['http://localhost:3000', 'http://192.168.1.2:3000']);
  });
  test.each(['*', 'http://host/path', 'http://user:pass@host', 'file:///tmp', 'http://host,', ''])('rejects unsafe or malformed origin %s', value => {
    expect(() => getClientOrigins(value)).toThrow(/exact HTTP/);
  });
});
