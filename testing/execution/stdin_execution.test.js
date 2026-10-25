const executeCode = require('../../execution/engine/executeCode');
const { getDockerClient } = require('../../execution/engine/executor');

describe('Standard Input (stdin) Execution Regression Tests (Live Sandbox)', () => {
  jest.setTimeout(45000);
  let docker;
  let createdContainers = [];

  beforeAll(async () => {
    process.env.ALLOW_DEFAULT_DOCKER_FALLBACK = 'true';
    docker = getDockerClient();
    await docker.ping();
  });

  beforeEach(() => {
    createdContainers = [];
    const realCreate = docker.createContainer.bind(docker);
    jest.spyOn(docker, 'createContainer').mockImplementation(async (config) => {
      const container = await realCreate(config);
      createdContainers.push(container.id);
      return container;
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    // Verify container cleanup: all containers created during the test must be removed
    for (const id of createdContainers) {
      await expect(docker.getContainer(id).inspect()).rejects.toMatchObject({ statusCode: 404 });
    }
  });

  // 1. Python addition using two input lines
  test('1. Python addition using two input lines', async () => {
    const code = [
      'a = int(input())',
      'b = int(input())',
      'print(a + b)',
    ].join('\n');

    const result = await executeCode({
      language: 'python',
      code,
      stdin: '10\n20\n',
    });

    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('30');
    expect(result.stderr).toBe('');
  });

  // 2. C++ addition using std::cin
  test('2. C++ addition using std::cin', async () => {
    const code = [
      '#include <iostream>',
      'using namespace std;',
      'int main() {',
      '    int a, b;',
      '    cin >> a >> b;',
      '    cout << a + b << "\\n";',
      '    return 0;',
      '}',
    ].join('\n');

    const result = await executeCode({
      language: 'cpp',
      code,
      stdin: '10\n20\n',
    });

    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('30');
    expect(result.stderr).toBe('');
  });

  // 3. Java addition using Scanner(System.in)
  test('3. Java addition using Scanner(System.in)', async () => {
    const code = [
      'import java.util.Scanner;',
      'public class Main {',
      '    public static void main(String[] args) {',
      '        Scanner sc = new Scanner(System.in);',
      '        int a = sc.nextInt();',
      '        int b = sc.nextInt();',
      '        System.out.println(a + b);',
      '        sc.close();',
      '    }',
      '}',
    ].join('\n');

    const result = await executeCode({
      language: 'java',
      code,
      stdin: '10\n20\n',
    });

    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('30');
    expect(result.stderr).toBe('');
  });

  // 4. Multiple lines, spaces and empty input
  test('4. Multiple lines, spaces and empty input behavior', async () => {
    // 4a. Multiline lines and leading/trailing spaces
    const multilineCode = [
      'import sys',
      'lines = [line.strip() for line in sys.stdin.readlines()]',
      'print("COUNT:", len(lines))',
      'print("JOIN:", "|".join(lines))',
    ].join('\n');

    const multilineResult = await executeCode({
      language: 'python',
      code: multilineCode,
      stdin: '  first line  \n  second line  \n  third line  \n',
    });

    expect(multilineResult.status).toBe('completed');
    expect(multilineResult.exitCode).toBe(0);
    expect(multilineResult.stdout).toContain('COUNT: 3');
    expect(multilineResult.stdout).toContain('JOIN: first line|second line|third line');

    // 4b. Empty input behaving like immediate EOF
    const emptyPythonCode = [
      'try:',
      '    val = input()',
      '    print("GOT:", val)',
      'except EOFError:',
      '    print("EOF_CONFIRMED")',
    ].join('\n');

    const emptyResult = await executeCode({
      language: 'python',
      code: emptyPythonCode,
      stdin: '',
    });

    expect(emptyResult.status).toBe('completed');
    expect(emptyResult.exitCode).toBe(0);
    expect(emptyResult.stdout.trim()).toBe('EOF_CONFIRMED');
  });

  // 5. Input containing quotes and shell metacharacters to verify that input is treated as data
  test('5. Input containing quotes and shell metacharacters treated as data', async () => {
    const code = [
      'import sys',
      'data = sys.stdin.read()',
      'print("DATA_LENGTH:", len(data))',
      'sys.stdout.write(data)',
    ].join('\n');

    const complexData = 'Quotes: " \' ` \nShell: $PATH $(whoami) `cat /etc/passwd` ; & | < > && || * ?\n';

    const result = await executeCode({
      language: 'python',
      code,
      stdin: complexData,
    });

    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('DATA_LENGTH: ' + complexData.length);
    expect(result.stdout).toContain('$PATH $(whoami)');
    expect(result.stdout).toContain('; & | < > && ||');
  });

  // 6. Unicode input where supported by the program
  test('6. Unicode input in Python, C++, and Java', async () => {
    const unicodeText = 'こんにちは世界 ⚡🚀 ñ á é í ó ú\n';

    // Python Unicode
    const pyResult = await executeCode({
      language: 'python',
      code: 'import sys\ntext = sys.stdin.read()\nprint("ECHO:", text.strip())',
      stdin: unicodeText,
    });
    expect(pyResult.status).toBe('completed');
    expect(pyResult.stdout).toContain('こんにちは世界 ⚡🚀 ñ á é í ó ú');

    // Java Unicode
    const javaCode = [
      'import java.util.Scanner;',
      'public class Main {',
      '    public static void main(String[] args) {',
      '        Scanner sc = new Scanner(System.in, "UTF-8");',
      '        if (sc.hasNextLine()) {',
      '            System.out.println("JAVA_ECHO: " + sc.nextLine());',
      '        }',
      '    }',
      '}',
    ].join('\n');

    const javaResult = await executeCode({
      language: 'java',
      code: javaCode,
      stdin: unicodeText,
    });
    expect(javaResult.status).toBe('completed');
    expect(javaResult.stdout).toContain('JAVA_ECHO: こんにちは世界 ⚡🚀 ñ á é í ó ú');
  });

  // 7. Missing stdin for backwards compatibility
  test('7. Missing stdin for backwards compatibility', async () => {
    const code = 'print("Backwards compatibility works")';

    // Without stdin property
    const resultWithout = await executeCode({
      language: 'python',
      code,
    });
    expect(resultWithout.status).toBe('completed');
    expect(resultWithout.exitCode).toBe(0);
    expect(resultWithout.stdout.trim()).toBe('Backwards compatibility works');

    // With stdin: undefined
    const resultUndefined = await executeCode({
      language: 'python',
      code,
      stdin: undefined,
    });
    expect(resultUndefined.status).toBe('completed');
    expect(resultUndefined.exitCode).toBe(0);

    // With stdin: null
    const resultNull = await executeCode({
      language: 'python',
      code,
      stdin: null,
    });
    expect(resultNull.status).toBe('completed');
    expect(resultNull.exitCode).toBe(0);
  });

  // 8. Invalid stdin type and input exceeding the configured limit
  test('8. Rejection of invalid stdin type and oversized input before container creation', async () => {
    // Non-string stdin
    await expect(
      executeCode({
        language: 'python',
        code: 'print(1)',
        stdin: 12345,
      })
    ).rejects.toThrow(/stdin must be a string/i);
    expect(createdContainers).toHaveLength(0);

    // Object stdin
    await expect(
      executeCode({
        language: 'python',
        code: 'print(1)',
        stdin: { text: 'invalid' },
      })
    ).rejects.toThrow(/stdin must be a string/i);
    expect(createdContainers).toHaveLength(0);

    // Oversized stdin (> 64 KiB)
    const oversized = 'a'.repeat(65 * 1024);
    await expect(
      executeCode({
        language: 'python',
        code: 'print(1)',
        stdin: oversized,
      })
    ).rejects.toThrow(/stdin exceeds maximum allowed size/i);
    expect(createdContainers).toHaveLength(0);
  });

  // 9. Compilation failure and runtime failure with stdin
  test('9. Compilation failure and runtime failure with stdin provided', async () => {
    // C++ compilation failure
    const badCpp = 'int main() { syntax error }';
    const cppResult = await executeCode({
      language: 'cpp',
      code: badCpp,
      stdin: '10 20\n',
    });
    expect(cppResult.status).toBe('failed');
    expect(cppResult.exitCode).not.toBe(0);
    expect(cppResult.stderr).toMatch(/error/i);

    // Java compilation failure
    const badJava = 'public class Main { invalid syntax }';
    const javaResult = await executeCode({
      language: 'java',
      code: badJava,
      stdin: '10 20\n',
    });
    expect(javaResult.status).toBe('failed');
    expect(javaResult.exitCode).not.toBe(0);
    expect(javaResult.stderr).toMatch(/error/i);

    // Python runtime failure
    const pyRuntimeFail = 'a = int(input())\nraise RuntimeError("Deliberate error after reading " + str(a))';
    const pyResult = await executeCode({
      language: 'python',
      code: pyRuntimeFail,
      stdin: '42\n',
    });
    expect(pyResult.status).toBe('failed');
    expect(pyResult.exitCode).not.toBe(0);
    expect(pyResult.stderr).toContain('Deliberate error after reading 42');
  });

  // 10. Programs that request more input than supplied
  test('10. Programs requesting more input than supplied reach EOF without hanging', async () => {
    // Python: requests 2 inputs, only 1 supplied -> EOFError immediately
    const pyCode = 'a = int(input())\nb = int(input())\nprint(a + b)';
    const pyResult = await executeCode({
      language: 'python',
      code: pyCode,
      stdin: '10\n',
    });
    expect(pyResult.status).toBe('failed');
    expect(pyResult.exitCode).not.toBe(0);
    expect(pyResult.stderr).toContain('EOFError');

    // Java: requests nextInt() on empty stdin -> NoSuchElementException immediately
    const javaCode = [
      'import java.util.Scanner;',
      'public class Main {',
      '    public static void main(String[] args) {',
      '        Scanner sc = new Scanner(System.in);',
      '        int a = sc.nextInt();',
      '        System.out.println(a);',
      '    }',
      '}',
    ].join('\n');
    const javaResult = await executeCode({
      language: 'java',
      code: javaCode,
      stdin: '',
    });
    expect(javaResult.status).toBe('failed');
    expect(javaResult.exitCode).not.toBe(0);
    expect(javaResult.stderr).toContain('NoSuchElementException');

    // C++: cin enters fail/eof state
    const cppCode = [
      '#include <iostream>',
      'using namespace std;',
      'int main() {',
      '    int a, b;',
      '    cin >> a >> b;',
      '    if (cin.eof() || cin.fail()) {',
      '        cout << "EOF_OR_FAIL\\n";',
      '    }',
      '    return 0;',
      '}',
    ].join('\n');
    const cppResult = await executeCode({
      language: 'cpp',
      code: cppCode,
      stdin: '10\n',
    });
    expect(cppResult.status).toBe('completed');
    expect(cppResult.exitCode).toBe(0);
    expect(cppResult.stdout.trim()).toBe('EOF_OR_FAIL');
  });

  // 11. Timeouts and output-limit termination with proper container cleanup
  test('11. Timeout and output limit termination with proper container cleanup', async () => {
    // Timeout with stdin
    const timeoutCode = 's = input()\nimport time\ntime.sleep(10)';
    const timeoutResult = await executeCode({
      language: 'python',
      code: timeoutCode,
      stdin: 'start\n',
      timeout: 1500,
    });
    expect(timeoutResult.status).toBe('timeout');
    expect(timeoutResult.exitCode).toBe(124);
    expect(timeoutResult.stderr).toContain('Execution timed out after 1500ms');

    // Output limit with stdin
    const runawayCode = 's = input()\nwhile True:\n    print("012345678901234567890123456789")';
    const outputResult = await executeCode({
      language: 'python',
      code: runawayCode,
      stdin: 'go\n',
      timeout: 4000,
    });
    expect(outputResult.status).toBe('failed');
    expect(outputResult.exitCode).toBe(137);
    expect(outputResult.stdout).toContain('Output truncated');
  });
});
