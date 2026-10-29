"""Trusted launcher for disposable C++/Java containers, never a host fallback.

The engine bounds the entire container lifetime (compilation + execution), output,
CPU, memory, and PIDs. All writable artifacts live in the disposable /work tmpfs.
"""
import os
import re
import signal
import subprocess
import sys
import tempfile
import time

MAX_CODE_BYTES = 64 * 1024
# A second, in-container deadline survives loss of the Node worker. It never raises policy limits.
DEADLINE = time.monotonic() + min(10000, max(1, int(os.environ["CODECOLLAB_TIMEOUT_MS"]))) / 1000 if os.environ.get("CODECOLLAB_TIMEOUT_MS") else None
JAVA_LIMITS = [
    "-Xms16m", "-Xmx96m", "-Xss256k", "-XX:+UseSerialGC",
    "-XX:ActiveProcessorCount=2", "-XX:CICompilerCount=2",
    "-XX:MaxMetaspaceSize=64m", "-XX:ReservedCodeCacheSize=32m",
    "-XX:-UsePerfData", "-XX:+ExitOnOutOfMemoryError",
]


def find_java_main_class(code: str) -> str:
    """Identifies the public class name or primary launch class for a Java submission."""
    # Strip block comments /* ... */
    cleaned = re.sub(r'/\*.*?\*/', '', code, flags=re.DOTALL)
    # Strip line comments // ...
    cleaned = re.sub(r'//.*', '', cleaned)
    # Strip string literals "..."
    cleaned = re.sub(r'"(?:\\.|[^"\\])*"', '""', cleaned)
    # Strip char literals '.'
    cleaned = re.sub(r"'(?:\\.|[^'\\])*'", "''", cleaned)

    # 1. Look for a public top-level class, record, enum, or interface
    pub_match = re.search(
        r'\bpublic\s+(?:(?:final|abstract|sealed|non-sealed|static)\s+)*(?:class|record|enum|interface)\s+([A-Za-z_$][A-Za-z0-9_$]*)',
        cleaned
    )
    if pub_match:
        return pub_match.group(1)

    # 2. Look for any top-level class/record/enum
    class_match = re.search(
        r'\b(?:class|record|enum)\s+([A-Za-z_$][A-Za-z0-9_$]*)',
        cleaned
    )
    if class_match:
        return class_match.group(1)

    return "Main"


def run_phase(argv, directory, inherit_stdin=False):
    # No shell, user filenames, class names, or compiler flags.
    # Compiler runs with DEVNULL; executed user program inherits container stdin.
    stdin_target = None if inherit_stdin else subprocess.DEVNULL
    child = subprocess.Popen(argv, cwd=directory, stdin=stdin_target,
                             start_new_session=True)
    try:
        try:
            result = child.wait(timeout=max(0.001, DEADLINE - time.monotonic()) if DEADLINE else None)
        except subprocess.TimeoutExpired:
            print("Execution deadline exceeded", file=sys.stderr, flush=True)
            return 124
        return result if result >= 0 else 128 - result
    finally:
        # Reap/kill descendants even after a compiler or user program fails.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()


def main():
    if len(sys.argv) != 4 or sys.argv[1] not in ("cpp", "java") or sys.argv[2] != "--code":
        print("Expected language and --code submission", file=sys.stderr)
        return 2
    language, code = sys.argv[1], sys.argv[3]
    if not code.strip() or "\0" in code or len(code.encode("utf-8")) > MAX_CODE_BYTES:
        print("Submission must be non-empty UTF-8 source of at most 64 KiB, without NUL bytes", file=sys.stderr)
        return 2
    if os.getuid() == 0:
        print("Runner refuses to execute as root", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix="submission-", dir="/work") as directory:
        if language == "cpp":
            filename = "main.cpp"
            with open(os.path.join(directory, filename), "w", encoding="utf-8") as source:
                source.write(code)
            compiler = ["g++", "-std=c++17", "-O0", "-pipe", "-fmax-errors=20", "main.cpp", "-o", "program"]
            program = [os.path.join(directory, "program")]
        else:
            class_name = find_java_main_class(code)
            filename = f"{class_name}.java"
            with open(os.path.join(directory, filename), "w", encoding="utf-8") as source:
                source.write(code)
            compiler = ["javac", *["-J" + flag for flag in JAVA_LIMITS], "-encoding", "UTF-8",
                        "-proc:none", "-d", directory, filename]
            program = ["java", *JAVA_LIMITS, "-cp", directory, class_name]

        result = run_phase(compiler, directory, inherit_stdin=False)
        if result != 0:
            return result
        return run_phase(program, directory, inherit_stdin=True)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError) as error:
        print(f"Runner error: {error}", file=sys.stderr)
        sys.exit(1)
