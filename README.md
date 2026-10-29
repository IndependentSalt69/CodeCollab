# CodeCollab

CodeCollab provides authenticated coding rooms, a shared driver-controlled editor, chat, and Python, C++ and Java execution through a separate queue worker and Docker daemon.

**Release status: trusted prototype development only.** Local execution is tested, but the Docker Desktop/nested-daemon profile is not production-qualified. See [the current completion report](docs/CODEX_COMPLETION_REPORT.md) for measured results, remaining blockers and recovery steps. Older milestone documents are historical records.

## Windows setup

From the repository root, run `.\setup.ps1` first. It checks everything the project needs and either sets it up or tells you exactly what to do:

```powershell
.\setup.ps1
.\start.ps1
.\verify.ps1
# Additional disposable runner executions:
.\verify.ps1 -ExecutionSmoke
# Read-only diagnostics with targeted next steps:
.\diagnose.ps1
```

What `setup.ps1` does (safe to run again at any time):

- **Tools:** checks Git, Node.js 20+ and Docker Desktop (Linux engine + Compose v2). If Docker Desktop is installed but not running, it starts it and waits. Missing tools are listed with the exact `winget` install command.
- **Configuration:** creates `infrastructure/.env` with random secrets when it is absent. An existing file is preserved: settings newly added to `.env.example` are appended, empty duplicate lines are removed, and real conflicts are reported by key name and line number (values are never printed). JWT secrets must contain at least 32 characters. Do not replace existing database credentials without rotating the corresponding database users.
- **Ports:** checks that ports 3000, 5000, 6379 and 7880-7881 are not reserved by Windows or used by another program, and prints the fix (for reserved ports: `net stop winnat` then `net start winnat` in an Administrator PowerShell).
- **Voice chat:** fills in LiveKit's local dev-mode settings when they are empty and starts a local LiveKit server container (`codecollab-livekit`). Use `-SkipVoice` to skip this, or set your own `LIVEKIT_*` values to use another LiveKit server.
- **Dependencies:** runs `npm ci` when `node_modules` is missing or older than `package-lock.json` (`-SkipInstall` to skip).

If anything needs your attention, setup ends with a numbered list of exact steps and exits with code 1; fix them and run it again.

### Prerequisites
- Windows PowerShell
- Docker Desktop configured for Linux containers
- Internet access for initial image pulls and builds
- Git, if you need to clone or update the repository
- Node.js 20+ for host-based development commands and tests

MongoDB and Redis are started by Docker Compose; they do not need to be installed separately for this workflow.

### First-Time Setup and Startup (Windows / PowerShell)

Open PowerShell in the repository root (`AWT_2026`) and run these commands in order: `.\setup.ps1`, `.\start.ps1`, then `.\verify.ps1`.

- **`setup.ps1`** checks tools, ports and configuration, creates or updates `infrastructure\.env` (existing secrets are never overwritten), starts the local voice server and installs dependencies. Keep `.env` private and never commit it.
- **`start.ps1`** builds the application and Python, C++, and Java runner images before changing the running stack. It transfers the runner images to the isolated execution daemon, verifies them, and starts the execution worker.
- **`verify.ps1`** checks all six Compose services, the frontend and backend HTTP endpoints, and all three runner images inside the execution daemon. It is read-only and does not start, stop, or rebuild services.

### Access Endpoints & Local Development

- **Docker Container Stack:**
  - Frontend: **http://localhost:3000**
  - Backend Health: **http://localhost:5000/health**
- **Local Two-Terminal Development Workflow (Vite + Nodemon):**
  - Frontend (Vite dev server): **http://localhost:5173**
  - Backend API: **http://localhost:5001**
  - See [Local Development Guide](docs/LOCAL_DEVELOPMENT.md) for startup details and architecture.

If startup fails, read the first reported error before retrying. Check that Docker Desktop is running and configured for Linux containers. Initial builds require network access to image registries and package repositories.

### Local Development and Multi-Device Testing

This Docker Desktop configuration is for trusted local development. It warns that inner cgroup enforcement is not production-qualified; passing local health checks does not prove production sandbox security.

Do not expose this development stack to the public internet. On another device, `localhost` refers to that device, not the CodeCollab laptop. LAN access may require configuring the frontend API and realtime URLs, along with the backend's allowed client origin. Keep the execution daemon API (ports 2375/2376), MongoDB, and Redis private; do not expose them to the LAN.
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

**Run Code opens a live program I/O session.** Type directly after the prompt inside the terminal and press Enter. Backspace edits the current line; accepted input stays beside its prompt in the transcript. Repeat for further prompts without restarting the program. There is no separate input footer or Send button. **Send EOF / Close Input** closes stdin while preserving trailing output; **Stop** terminates the sandbox; **Clear** only clears displayed output. Optional initial input is separate and does not close stdin. Only the initiating client, while still the room's driver, can control the run. Authorized room members can watch program output; typed input echoes are local to the initiating client.

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
