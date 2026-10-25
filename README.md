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

For a missing or weak **local demo** JWT only, run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\setup.ps1 -RepairLocalJwtSecret`. This explicitly replaces only that setting with 32 random bytes, preserves other values, and leaves an already valid JWT unchanged. Applying the updated backend configuration invalidates existing sessions. The process-only execution-policy option also works when Windows marks downloaded scripts unsigned; it does not change the machine policy. Use the same `powershell.exe -NoProfile -ExecutionPolicy Bypass -File` prefix for `start.ps1` and `verify.ps1` when needed.

This laptop intentionally keeps its external MongoDB target. If Atlas rejects the current public IP, add only that IP in the existing project's Network Access settings, then rerun diagnostics. Until `/ready` returns `ready`, authentication, rooms and collaboration remain blocked even if the frontend and runners work. See the current assessment at the top of the completion report; do not change database credentials or switch to local MongoDB to hide this failure.

Startup validates the Linux engine, Compose, files and environment before building. It builds all three runners and the application before starting services, using cached layers. Images are transferred only when their filesystem/configuration differs, and verified inside the isolated daemon before starting the worker. `-SkipBuild` explicitly reuses existing images; it does not validate them against current source. Temporary archives are removed in `finally` blocks; failed remote cleanup is reported.

Running containers are preserved (`--no-recreate`). After a code/configuration update, diagnostics reports drift. Apply updates only during a maintenance window with explicit service recreation; startup does not restart an active daemon. An inactive MongoDB container left in `created`/`exited` state after a failed port bind can be recreated safely with its existing data volume to apply the selected port.

Default endpoints are frontend `http://localhost:3000`, backend liveness `http://127.0.0.1:5000/health`, and backend dependency readiness `http://127.0.0.1:5000/ready`. Readiness checks database and Redis connectivity. Worker health checks Redis, the daemon and all three images. Neither health check proves authenticated execution; use the smoke and application tests too.

## MongoDB port conflicts on Windows

MongoDB is always published on **127.0.0.1**. `MONGO_HOST_PORT=27017` in `infrastructure/.env` sets the preferred host port. Internal connections remain `mongo:27017`; changing the host port must not change that internal URI.

Startup attempts an exclusive TCP loopback bind, which detects occupied ports and Windows access-denied/excluded-port failures. It tries up to 32 ports starting at the preferred port, then 37017–37048, with at most 64 distinct attempts. If this project's MongoDB is already running, its existing loopback mapping wins. Only the selected port entry is atomically saved; unrelated settings are preserved. Duplicate/malformed entries stop selection rather than being silently rewritten.

The scripts temporarily clear Compose interpolation overrides from their process environment, pin the selected Mongo port, then restore the parent values. This prevents a stale `$env:MONGO_HOST_PORT` from overriding `--env-file`. When running Compose manually, clear stale process overrides first and explicitly use `--env-file infrastructure/.env`.

For a failed bind:

```powershell
.\diagnose.ps1
netsh interface ipv4 show excludedportrange protocol=tcp
# Choose another preferred MONGO_HOST_PORT locally if both search ranges are excluded.
.\start.ps1
```

A port can become occupied between the probe and Docker's bind. Retry startup after inspecting the failure. Never stop random services, kill arbitrary processes, delete MongoDB volumes or prune Docker to recover a port. Changing `.env` passwords does not update users already stored in a volume.

## Trusted testing from another laptop or phone

Use only a trusted private Wi-Fi network and trusted submitted code. Public tunnels and public untrusted execution are outside this local profile's safety boundary.

1. Find the host laptop's active Wi-Fi IPv4 address with `Get-NetIPConfiguration`. Avoid VPN, Docker/WSL and disconnected adapters.
2. In `infrastructure/.env`, set `FRONTEND_BIND_ADDRESS` to that specific LAN address. Add `http://<LAN-IP>:3000` to `CLIENT_URL`, keeping `http://localhost:3000` in the comma-separated origin list if needed. The normal default remains loopback. While bound specifically to the LAN address, use that address on the host laptop too; restore `127.0.0.1` to return to localhost binding.
3. Rebuild frontend/backend and explicitly recreate only those services during a maintenance window. Do not recreate the execution daemon for a LAN change. MongoDB, Redis and backend remain loopback; the execution API remains on its private internal network.
4. If Windows Firewall blocks TCP 3000, the operator may allow that application/port on the **Private** profile scoped to the local subnet. The scripts do not add firewall rules. Never expose ports 2375, 27017 or 6379 to the LAN.
5. On the second device, open `http://<LAN-IP>:3000`. Create separate test users, join the same room, check editor/chat changes, switch drivers, and run Python/C++/Java. Verify results arrive only in the intended room and viewers/non-members cannot execute.
6. In browser network tools confirm `/api/*` and `/socket.io/*` use the host laptop's address, not the client's localhost. Confirm a WebSocket 101 handshake or working polling, and no CORS failures. Test from a second room to check result isolation.

The frontend uses same-origin API and realtime URLs through Nginx (Compose) or Vite's dev proxy. Optional `VITE_API_URL` and `VITE_REALTIME_URL` are **build-time** overrides for separate deployments; runtime Compose environment cannot change an already-built JavaScript bundle. Both HTTP and realtime use the same explicit backend origin allowlist. A real device-to-device test remains required; local proxy tests are not a substitute.

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
