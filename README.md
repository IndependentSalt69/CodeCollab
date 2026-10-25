# CodeCollab

CodeCollab provides authenticated coding rooms, a shared driver-controlled editor, chat, and Python, C++ and Java execution through a separate queue worker and Docker daemon.

**Release status: trusted prototype development only.** Local execution is tested, but the Docker Desktop/nested-daemon profile is not production-qualified. See [the current completion report](docs/CODEX_COMPLETION_REPORT.md) for measured results, remaining blockers and recovery steps. Older milestone documents are historical records.

## Windows setup

Install Docker Desktop with Linux containers, PowerShell 5.1 or newer, and Node.js/npm for host-side tests. From the repository root:

```powershell
.\setup.ps1
.\start.ps1
.\verify.ps1
# Additional disposable runner executions:
.\verify.ps1 -ExecutionSmoke
# Read-only diagnostics with targeted next steps:
.\diagnose.ps1
```

Setup creates `infrastructure/.env` only when absent, using random secrets. Existing configuration is validated and preserved. Missing, empty, duplicate, malformed or placeholder settings fail with key names rather than secret values. JWT secrets must contain at least 32 characters. Generated hex passwords work in the MongoDB/Redis connection URLs. Do not replace existing database credentials without rotating the corresponding database users.

### Prerequisites
- Windows PowerShell
- Docker Desktop configured for Linux containers
- Internet access for initial image pulls and builds
- Git, if you need to clone or update the repository
- Node.js 18+ only for host-based development commands and tests

MongoDB and Redis are started by Docker Compose; they do not need to be installed separately for this workflow.

### First-Time Setup and Startup (Windows / PowerShell)

Open PowerShell in the repository root (`AWT_2026`) and run these commands in order: `.\setup.ps1`, `.\start.ps1`, then `.\verify.ps1`.

- **`setup.ps1`** creates `infrastructure\.env` with unique local secrets if the file is missing. It preserves an existing file. Keep the file private and never commit it.
- **`start.ps1`** builds the application and Python, C++, and Java runner images before changing the running stack. It transfers the runner images to the isolated execution daemon, verifies them, and starts the execution worker.
- **`verify.ps1`** checks all six Compose services, the frontend and backend HTTP endpoints, and all three runner images inside the execution daemon. It is read-only and does not start, stop, or rebuild services.

Open **http://localhost:3000** on the same laptop. The backend health endpoint is **http://localhost:5000/health**.

If startup fails, read the first reported error before retrying. Check that Docker Desktop is running and configured for Linux containers. Initial builds require network access to image registries and package repositories.

### Local Development and Multi-Device Testing

This Docker Desktop configuration is for trusted local development. It warns that inner cgroup enforcement is not production-qualified; passing local health checks does not prove production sandbox security.

Do not expose this development stack to the public internet. On another device, `localhost` refers to that device, not the CodeCollab laptop. LAN access may require configuring the frontend API and realtime URLs, along with the backend's allowed client origin. Keep the execution daemon API (ports 2375/2376), MongoDB, and Redis private; do not expose them to the LAN.
## Running Tests

## Tests

Install workspace dependencies with `npm ci` from the root. Use a disposable Redis and explicit `REDIS_URL`; several suites clear their test queues. Never point tests at shared application Redis or a real database. The completion report records the isolated services used for this run.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File testing/infrastructure/dev_workflow.tests.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File testing/infrastructure/startup_failures.tests.ps1
npm test
npm run test:execution
npm run build
# Only with MONGO_TEST_URI pointing at a disposable local MongoDB:
npm run test:integration:mongo
```

Infrastructure tests cover actual loopback binds, synthetic excluded-port results, bounded exhaustion, environment preservation, Compose interpolation, startup failure ordering and archive cleanup. Jest combines unit/mocked checks with live Docker/Redis suites. The MongoDB suite is opt-in and uses a disposable database. `testing/infrastructure/application.smoke.js` is a separate live authenticated test guarded to use the exact disposable fixture containers described in the report.

## Execution and production security

**Run Code opens a live program I/O session.** Wait for a prompt, enter a response in **Program input**, and press Enter. Repeat for further prompts without restarting the program. **Send EOF / Close Input** closes stdin while preserving trailing output; **Stop** terminates the sandbox; **Clear** only clears displayed output. Optional initial input is separate and does not close stdin. Only the initiating client, while still the room's driver, can control the run. Authorized room members can watch output.

Python 3.11, C++ (GCC 13) and Java 17 are the only executable languages. The total deadline is **10 seconds**, including compilation and time spent waiting for input; typing does not extend it. Input is limited to 64 KiB UTF-8 per run and output to 64 KiB per stream. This is program stdin/stdout, without a PTY, shell, terminal control sequences or job control. See [the interactive protocol and recovery notes](docs/INTERACTIVE_TERMINAL.md).

Supported sources are Python, C++17 and Java 17 (`public class Main`, default package). Compilation and execution share the timeout. The executor bounds source/output, uses argument arrays, removes containers, and enforces a read-only root filesystem, non-root user, dropped capabilities, no-new-privileges and no network. C++ alone gets an executable scratch mount for its compiled binary. Java compilation disables annotation processors and bounds the JVM.

The local rootless DinD profile retains its outer 1 CPU / 512 MiB / 128-PID limits. `init: true` reaps orphaned daemon helpers. Existing deployments require an explicit drained maintenance recreation to adopt it; never raise limits or restart a shared daemon automatically. Diagnostics reports PID/memory controller events and zombie/helper counts. Working local execution does not prove per-runner kernel enforcement.

Production/staging/unknown execution modes reject host-daemon fallback and require `runsc`, a native Linux rootless Docker daemon under systemd, cgroup v2 and advertised CPU/memory/PID support. Development cgroup exceptions cannot disable production checks. These are necessary startup checks, not security qualification: live CPU throttling, memory OOM, PID limits, gVisor workload identity, timeouts, output limits, cleanup and authenticated room isolation must all be demonstrated on the actual target.

```sh
# On the intended native Linux target, after provisioning the dedicated rootless daemon:
NODE_ENV=production CONTAINER_RUNTIME=runsc DOCKER_HOST=unix:///run/user/<execution-uid>/docker.sock \
  npm run eval:enforcement -- --strict --prod-pid
```

The resource harness does not create all application-path evidence and cannot independently certify a release. Windows/Docker Desktop and WSL are not accepted production targets. Deployment remains blocked until the native target and its full evidence are available.
