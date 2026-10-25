// Explicit opt-in functional check: no queue jobs, user records or database mutations.
const executeCode = require('../engine/executeCode');
const { validateWorkerPreflight } = require('./index');
const examples = {
  python: 'print("codecollab-smoke")',
  cpp: '#include <iostream>\nint main(){std::cout << "codecollab-smoke\\n";}',
  java: 'public class Main { public static void main(String[] args) { System.out.println("codecollab-smoke"); } }',
};
(async () => {
  let failed = false;
  try { await validateWorkerPreflight(); } catch (_) {
    console.error('FAIL worker preflight; inspect daemon capabilities and worker configuration');
    process.exit(1);
  }
  for (const [language, code] of Object.entries(examples)) {
    try {
      const result = await executeCode({ language, code, timeout: 10000 });
      const ok = result.exitCode === 0 && result.stdout.trim() === 'codecollab-smoke';
      console.log(`${ok ? 'PASS' : 'FAIL'} ${language} live worker-engine execution`);
      failed ||= !ok;
    } catch (_) { failed = true; console.error(`FAIL ${language}; run diagnostics for images/resources/cleanup`); }
  }
  process.exitCode = failed ? 1 : 0;
})();
