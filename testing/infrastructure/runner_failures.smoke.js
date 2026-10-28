// Run inside the existing Compose worker with `node -e <this file> errors|timeouts|output`.
// No database, queue or account writes. Deliberately separate from authenticated application tests.
const assert = require('node:assert/strict');
const executeCode = require('./execution/engine/executeCode');
const { getDockerClient } = require('./execution/engine/executor');
const { validateWorkerPreflight } = require('./execution/worker');
const group = process.argv[1];
const cases = {
  errors: [
    ['python', 'raise RuntimeError("expected demo error")', 1, /expected demo error/],
    ['cpp', 'int main( {', null, /error/i],
    ['java', 'public class Main { invalid syntax }', null, /error/i],
    ['cpp', 'int main(){return 42;}', 42],
    ['java', 'public class Main { public static void main(String[] a){throw new RuntimeException("expected demo error");}}', 1, /expected demo error/],
  ],
  timeouts: [
    ['python', 'while True: pass', 124],
    ['cpp', 'int main(){for(;;){}}', 124],
    ['java', 'public class Main { public static void main(String[] a){while(true){}}}', 124],
  ],
  output: [
    ['python', 'while True: print("012345678901234567890123456789")', 137],
    ['cpp', '#include <cstdio>\nint main(){for(;;) puts("012345678901234567890123456789");}', 137],
    ['java', 'public class Main { public static void main(String[] a){while(true) System.out.println("012345678901234567890123456789");}}', 137],
  ],
};
(async () => {
  assert.equal(process.env.EXECUTION_PROFILE, 'local-dev-execution', 'Requires the local demo worker');
  assert(Object.hasOwn(cases, group), 'Choose errors, timeouts or output');
  await validateWorkerPreflight();
  const docker = getDockerClient();
  const originalCreate = docker.createContainer.bind(docker);
  const created = [];
  docker.createContainer = async config => {
    const container = await originalCreate(config);
    created.push(container.id);
    return container;
  };
  for (const [language, code, exitCode, diagnostic] of cases[group]) {
    const started = Date.now();
    const result = await executeCode({ language, code, timeout: group === 'timeouts' ? 3000 : 10000 });
    assert.equal(result.status, group === 'timeouts' ? 'timeout' : 'failed', `${language} status`);
    assert.notEqual(result.exitCode, 0, `${language} must fail`);
    if (exitCode !== null) assert.equal(result.exitCode, exitCode, `${language} exit code`);
    if (diagnostic) assert.match(result.stderr, diagnostic, `${language} diagnostic`);
    if (group === 'output') {
      assert.match(result.stdout, /Output truncated/);
      assert(Buffer.byteLength(result.stdout) < 66000, `${language} output bound`);
    }
    if (group === 'timeouts') assert(Date.now() - started < 7000, `${language} deadline`);
    for (const id of created) await assert.rejects(docker.getContainer(id).inspect(), { statusCode: 404 });
    console.log(`PASS ${language} ${group}: expected result and owned-container removal`);
  }
})().catch(() => { console.error(`FAIL ${group || 'unknown'} smoke; inspect resources and runner behavior before further runs`); process.exitCode = 1; });
