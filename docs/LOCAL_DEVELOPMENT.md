# CodeCollab — Local Development Guide

This guide describes the standard local development workflow for CodeCollab on Windows (and cross-platform).

The setup allows you to run the local Node.js backend and Vite frontend alongside the containerized execution environment without manual environment variable exports, port collisions, or Redis authentication friction.

---

## 1. Daily Development Workflow

### Prerequisites

Ensure Docker Desktop is running. Start the supporting infrastructure containers (Redis, rootless execution daemon, and execution worker):

```powershell
docker compose --env-file infrastructure/.env -f infrastructure/docker-compose.yml --profile local-dev-execution up -d redis execution-daemon execution-worker
```

> **Note:** If you already started the full Docker stack via `docker compose up -d`, the existing stack can remain running. The local backend and frontend use distinct development ports (5001 and 5173) and will not conflict with containers on ports 3000 and 5000.

### Two-Terminal Startup

Open two terminal windows in PowerShell:

**Terminal 1 — Backend:**
```powershell
cd D:\AWT_2026\backend
npm run dev
```

**Terminal 2 — Frontend:**
```powershell
cd D:\AWT_2026\frontend
npm run dev
```

Open your browser to: **`http://localhost:5173`** (or `http://127.0.0.1:5173`).

---

## 2. Expected Local URLs and Ports

| Component | Port | Host Address | Description |
| :--- | :--- | :--- | :--- |
| **Local Vite Frontend** | `5173` | `http://127.0.0.1:5173` | Vite development server with strict port enforcement |
| **Local Backend API** | `5001` | `http://127.0.0.1:5001` | Express & Socket.IO server started via nodemon |
| **Docker Frontend** *(optional)* | `3000` | `http://127.0.0.1:3000` | Containerized Nginx frontend (if running in Docker) |
| **Docker Backend** *(optional)* | `5000` | `http://127.0.0.1:5000` | Containerized Express backend (if running in Docker) |
| **Docker Redis** | `6379` | `127.0.0.1:6379` | Authenticated Redis instance published to localhost |
| **Docker Execution Worker** | N/A | Internal bridge | Consumes execution jobs from Redis BullMQ queue |
| **Docker Execution Daemon** | N/A | Internal bridge | Rootless DinD daemon for isolated sandbox containers |

---

## 3. How Environment Bootstrap Works

The backend features an automatic, development-only environment bootstrap (`backend/src/config/devBootstrap.js`):

1. **Loads `.env` Configuration:** Automatically reads root `D:\AWT_2026\.env` (containing MongoDB Atlas URI, JWT configuration, and authentication settings) without modifying process overrides.
2. **Assigns Development Port:** Sets `PORT=5001` automatically for local processes so they do not conflict with containerized backend services on port 5000.
3. **Derives Local Redis URL:** If `REDIS_URL` is not explicitly set in the shell, the bootstrap reads `REDIS_PASSWORD` from `infrastructure/.env`, safely URL-encodes special characters, and derives `redis://:<password>@127.0.0.1:6379/0`.
4. **Configures Strict CORS:** Adds `http://localhost:5173` and `http://127.0.0.1:5173` to `CLIENT_URL` so Express and Socket.IO accept browser connections without wildcard CORS.
5. **Fast-Failing Preflight Checks:** Verifies Redis connectivity on startup with a strict 2-second probe. If Redis is unreachable or credentials fail, the server stops immediately with clear diagnostics.
6. **Nodemon Preservation:** Because bootstrap runs at the entry point of `backend/src/index.js`, environment resolution is automatically preserved across all nodemon file-change restarts.
7. **Production Docker Safety:** When `NODE_ENV=production` is set (as in `backend/Dockerfile`), the bootstrap is completely bypassed and containerized defaults remain untouched.

---

## 4. Frontend-to-Backend Communication

- **Vite Proxy:** `frontend/vite.config.ts` proxies all API requests (`/api`, `/health`, `/ready`) and Socket.IO handshakes (`/socket.io`) directly to `http://127.0.0.1:5001`.
- **WebSocket Upgrade:** Vite handles HTTP upgrade headers (`ws: true`) seamlessly for Socket.IO polling and WebSocket transports.
- **Strict Port:** `strictPort: true` ensures that Vite will fail immediately if port 5173 is occupied rather than silently switching ports.

---

## 5. Troubleshooting & Diagnostics

### Redis Connectivity or Authentication Issues

If backend startup fails with `[CodeCollab Dev Bootstrap] Redis preflight failed`:
- **Connection Refused:** Docker Redis is not running or port 6379 is occupied.
  ```powershell
  docker compose -f infrastructure/docker-compose.yml up -d redis
  ```
- **Authentication Error:** Verify that `REDIS_PASSWORD` in `infrastructure/.env` matches the running Redis container password.

### MongoDB Connectivity Issues

If MongoDB logs `[MongoDB] Connection error`:
- Check internet connection and DNS resolution for MongoDB Atlas.
- Verify that your local machine's public IP address is permitted in the MongoDB Atlas IP Access List (Network Access).
- Do not modify database connection strings or credentials.

### Port Conflicts

- **Port 5001 occupied:** Check running Node processes with `Get-Process node` or specify an explicit port:
  ```powershell
  $env:PORT="5002"; npm run dev
  ```
- **Port 5173 occupied:** Stop existing Vite servers or check listening ports with `netstat -ano | findstr 5173`.

### Socket.IO Realtime Issues

- Check browser developer console Network tab under `WS` / `socket.io` to ensure polling returns HTTP 200 and WebSocket upgrades return HTTP 101.
- Verify `CLIENT_URL` includes your browser origin.

---

## 6. Stopping Local Development Safely

To stop the development servers:
- In Terminal 1 and Terminal 2, press `Ctrl+C`.
- If you wish to stop background Docker dependencies:
  ```powershell
  docker compose -f infrastructure/docker-compose.yml stop redis execution-daemon execution-worker
  ```
  *(Do not use `down -v` or `prune`, as that would destroy persistent volumes).*

