# Interactive program terminal

Supported execution identifiers are exactly `python`, `cpp`, `java` (Python 3.11, GCC 13/C++17, Java 17). JavaScript is not an executable option. Java requires `public class Main` in the default package.

## Using it

As the room driver, click **Run Code**, wait for the prompt, type in **Program input** and press Enter. A line including its newline goes to the same running program. Optional initial input is sent first without closing stdin. C++ prompts should use `std::flush` or `std::endl`; programs using buffered output must flush their prompts. Python's runner is unbuffered.

**Send EOF / Close Input** half-closes stdin; stdout/stderr remain attached for trailing output. **Stop** cancels the real queue job/container. **Clear** only clears the displayed output. Once input closes or execution ends, further input is rejected. Viewer clients can watch; input/EOF/Stop require the original initiating socket and user to remain the current driver and a database room member. Driver transfer does not transfer an existing execution session. The original run will finish or time out before the new driver can start another.

The total execution budget is 10 seconds in the UI, including compilation and waiting for input. There is no separate idle extension. Runs are bounded by the existing CPU/memory/PID/network/filesystem policy. Limits: 64 KiB source, 64 KiB total UTF-8 input including initial input, 4 KiB per live input message, at most 1022 live input messages, 64 KiB stdout and 64 KiB stderr plus short truncation markers. The worker additionally bounds input writes, including chunks used for initial input. Extremely fragmented output is capped at 2048 transport events. The frontend keeps bounded text/segments and renders text without HTML or terminal escape interpretation.

This is non-TTY program I/O, not an operating-system terminal. Shell commands, interactive debuggers, terminal control sequences, terminal resizing and job control are unsupported.

## Architecture and event contract

1. Socket.IO authenticates the existing JWT. Start/action handlers recheck token expiry, actual connected socket, verified room join, current database membership and active driver.
2. `terminal:start` takes `{roomId, language, code, stdin?, timeout?, memory?}`. Existing execution request validation applies. The backend generates a random UUID and queues the job with that session ID. Clients cannot choose a container or session ID.
3. `terminal:input` takes `{sessionId, seq, data}`; `terminal:eof` takes `{sessionId, seq}`. Sequence numbers start at 1, advance only after successful acknowledgements, and duplicates/out-of-order input fail. Input is accepted only after the worker announces readiness.
4. `terminal:cancel` takes `{sessionId}` (the UI also includes its sequence). Cancellation does not require a client sequence, so a lost input acknowledgement cannot prevent Stop. Ownership and driver authorization still apply.
5. Replies are `{ok:true, ...}` or `{ok:false,error}`. Commands are serialized per socket, limited to 20 per second; starts to 20 per minute. A backend has at most 25 active sessions and one session per user/room.
6. `terminal:event` includes `{sessionId, roomId, language, canControl, seq, type}`. Status events carry `queued`, `starting`, or `running`. Output carries `{channel:'stdout'|'stderr',text}`; completion carries `completed`, `failed`, `timeout`, or `cancelled`, exit code, duration and optional safe error. Final events follow sandbox cleanup. Output is sent only to currently authenticated database room members. Slow socket buffers are disconnected after 128 queued packets.
7. Redis keys `codecollab:terminal:<uuid>:{lease,input,output}` transport events across services. The backend renews a 3-second lease; the worker polls it and cancels when it disappears. Streams are atomically capped (1024 input/2048 output events) and expire after 45 seconds. Ordered streams avoid Pub/Sub subscription races. Commands wait for bounded Redis acknowledgements; output backpressures the Docker read attachment.
8. The worker opens a persistent hijacked Docker stdin attachment and a separate multiplexed stdout/stderr attachment before starting the container. Incremental framing/UTF-8 decoding preserves channels and partial frames. EOF cannot close the output attachment. The existing sandbox engine owns termination and cleanup for batch and interactive runs.

Source and optional initial input exist in the transient BullMQ job payload. Live input exists briefly in the Redis input stream. Neither is logged by this feature or written to application execution-history records. Completed/failed jobs auto-remove; finalization deletes the session mapping and transport keys. Redis credentials remain private; no daemon endpoint is published.

## Failure and recovery

| Symptom | Behavior and safe next step |
|---|---|
| Queued indefinitely / no worker | Backend ends the session after a bounded 25-second queue deadline. Run `diagnose.ps1`, inspect worker health, and restore the required worker/images. |
| Acknowledgement timeout | Input is disabled because delivery is uncertain. Use Stop before rerunning; do not replay the same line blindly. |
| Browser disconnect / room leave | Backend cancels; loss of the backend lease also cancels the worker. Reconnect and start a new run. Sessions are not resumable. |
| Token expired, membership revoked or driver changed | Input/EOF/Stop authorization fails. No output goes to revoked/expired clients. An existing run ends by its total deadline. |
| Worker exits abruptly | Runner-side deadlines plus Docker AutoRemove bound ordinary waiting programs even without Node cleanup. Backend expires its mapping and transport. BullMQ retains a locked job until a worker is restored and normal lock/stall recovery runs (default intervals can take about a minute). The expired lease prevents replaying submitted code. Do not forcibly unlock active jobs or prune containers. |
| Redis unavailable | Transport fails closed, session lease expires and the worker terminates. Restore Redis; use diagnostics before restarting affected application services. Temporary stream keys expire after recovery. |
| Missing image / unreachable daemon / cleanup error | Session fails; inspect worker/daemon health and image fingerprints. Rebuild/transfer the affected image using the existing setup workflow. Never raise limits, delete volumes or restart a shared daemon blindly. |
| No prompt visible | Ensure the program flushes stdout; check status for compilation error, timeout or output limit. |

The in-container deadline is an availability fallback for worker loss, not a separately qualified security boundary against malicious code. A dead/unreachable daemon cannot confirm cleanup until it recovers. No recovery path weakens resource enforcement. This Docker Desktop demo remains **NOT_QUALIFIED_FOR_PRODUCTION**; native Linux/rootless systemd/cgroup v2/gVisor qualification remains required.

## Reproducible tests

Use disposable Redis with an explicit `REDIS_URL` and the local Docker endpoint; never use application Redis for the test suite. Focused commands:

```powershell
npm.cmd test -- --runTestsByPath testing/execution/interactive_execution.test.js testing/execution/stream_io.test.js testing/integration/interactive_transport.test.js testing/frontend/interactive_terminal.test.js --detectOpenHandles
npm.cmd test -- --detectOpenHandles
npm.cmd run build
```

The transport tests use real Redis, a separate Node worker and live Docker, with room lookup/socket recipients mocked. They do not substitute for browser authentication tests. The completion report records actual browser results and remaining blockers separately.
