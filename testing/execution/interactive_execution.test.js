const execute = require('../../execution/engine/executeCode');
const { getDockerClient } = require('../../execution/engine/executor');

const samples = {
  python: { prompt: 'print("Before"); name=input("Name: "); print("Hello",name); age=input("Age: "); print("Next",int(age)+1)',
    eof: 'import sys; print("Ready",flush=True); print("EOF",repr(sys.stdin.read()))', wait: 'input("Ready")',
    output: 'while True: print("012345678901234567890123456789")', bad: 'raise RuntimeError("expected")', hello: 'print("Hello")' },
  cpp: { prompt: '#include <iostream>\n#include <string>\nint main(){std::string n; int a;std::cout<<"Before\\nName: "<<std::flush;std::getline(std::cin,n);std::cout<<"Hello "<<n<<"\\nAge: "<<std::flush;if(!(std::cin>>a))return 1;std::cout<<"Next "<<a+1;}',
    eof: '#include <iostream>\n#include <string>\nint main(){std::cout<<"Ready"<<std::flush;std::string s;while(std::getline(std::cin,s)){} std::cout<<"EOF";}',
    wait: '#include <iostream>\nint main(){int n;std::cout<<"Ready"<<std::flush;if(!(std::cin>>n))return 1;}',
    output: '#include <cstdio>\nint main(){for(;;)puts("012345678901234567890123456789");}', bad: 'int main( {', hello: '#include <iostream>\nint main(){std::cout<<"Hello";}' },
  java: { prompt: 'import java.util.Scanner; public class Main {public static void main(String[] a){Scanner s=new Scanner(System.in);System.out.println("Before");System.out.print("Name: ");String n=s.nextLine();System.out.println("Hello "+n);System.out.print("Age: ");System.out.println("Next "+(s.nextInt()+1));}}',
    eof: 'import java.util.Scanner; public class Main {public static void main(String[] a){System.out.print("Ready");Scanner s=new Scanner(System.in);while(s.hasNextLine())s.nextLine();System.out.println("EOF");}}',
    wait: 'import java.util.Scanner; public class Main {public static void main(String[] a){System.out.print("Ready");new Scanner(System.in).nextLine();}}',
    output: 'public class Main {public static void main(String[] a){while(true)System.out.println("012345678901234567890123456789");}}', bad: 'public class Main { invalid syntax }', hello: 'public class Main {public static void main(String[] a){System.out.println("Hello");}}' },
};

describe.each(Object.keys(samples))('%s real interactive Docker stream', language => {
  jest.setTimeout(20000);
  let docker, ids;
  beforeAll(() => { docker = getDockerClient(); });
  beforeEach(() => {
    ids = [];
    const create = docker.createContainer.bind(docker);
    jest.spyOn(docker, 'createContainer').mockImplementation(async options => { const c = await create(options); ids.push(c.id); return c; });
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    for (const id of ids) await expect(docker.getContainer(id).inspect()).rejects.toMatchObject({ statusCode: 404 });
  });
  async function run(code, receive = async () => {}, timeout = 7000) {
    let control, output = '', messages = 0;
    let ready;
    const available = new Promise(resolve => { ready = resolve; });
    const signal = new AbortController();
    const result = await execute({ language, code, timeout, io: {
      signal: signal.signal, onReady(value) { control = value; ready(); },
      async onOutput(channel, text) { await available; output += text; messages++; await receive({ channel, text, output, control, signal }); },
    } });
    return { result, messages, control };
  }
  test('prompts arrive before two separate inputs; Unicode and shell metacharacters stay data', async () => {
    let step = 0;
    const name = 'Alex Ω 雪 "quoted" $(echo literal)';
    const { result, messages, control } = await run(samples[language].prompt, async ({ output, control }) => {
      if (step === 0 && output.includes('Name:')) { expect(output).toContain('Before'); step++; await control.write(name + '\n'); }
      if (step === 1 && output.includes('Age:')) { expect(output).toContain('Hello ' + name); step++; await control.write('20\n'); }
    });
    expect(step).toBe(2); expect(messages).toBeGreaterThan(1);
    expect(result).toMatchObject({ status: 'completed', exitCode: 0 }); expect(result.stdout).toContain('Next 21');
    await expect(control.write('late\n')).rejects.toThrow(/unavailable/);
  });
  test('explicit EOF reaches the program without losing trailing output', async () => {
    let sent = false;
    const { result } = await run(samples[language].eof, ({ output, control }) => { if (!sent && output.includes('Ready')) { sent = true; control.eof(); } });
    expect(result).toMatchObject({ status: 'completed', exitCode: 0 }); expect(result.stdout).toContain('EOF');
  });
  test('missing required input fails after EOF', async () => {
    let sent = false;
    const { result } = await run(samples[language].wait, ({ output, control }) => { if (!sent && output.includes('Ready')) { sent = true; control.eof(); } });
    expect(result.status).toBe('failed'); expect(result.exitCode).not.toBe(0);
  });
  test('cancellation terminates the waiting process', async () => {
    const { result } = await run(samples[language].wait, ({ output, signal }) => { if (output.includes('Ready')) signal.abort(); });
    expect(result).toMatchObject({ status: 'cancelled', exitCode: 130 });
  });
  test('total deadline applies while waiting for input', async () => {
    const { result } = await run(samples[language].wait, undefined, 2000);
    expect(result).toMatchObject({ status: 'timeout', exitCode: 124 });
  });
  test('output flooding terminates with bounded capture', async () => {
    const { result } = await run(samples[language].output);
    expect(result).toMatchObject({ status: 'failed', exitCode: 137 }); expect(Buffer.byteLength(result.stdout)).toBeLessThan(66000);
  });
  test('compiler/runtime errors propagate; programs without input still complete', async () => {
    expect((await run(samples[language].bad)).result.status).toBe('failed');
    expect((await run(samples[language].hello)).result).toMatchObject({ status: 'completed', exitCode: 0 });
  });
});
module.exports.samples = samples;
