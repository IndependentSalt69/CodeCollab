const path = require('path');

// Development-only environment bootstrap (loads .env, sets local PORT 5001, derives REDIS_URL, configures CORS)
if (process.env.NODE_ENV !== 'production') {
  const { initDevBootstrap } = require('./config/devBootstrap');
  initDevBootstrap();
} else {
  require('dotenv').config({
    path: path.resolve(__dirname, '../../.env'),
  });
}

const express = require('express');
const cors = require('cors');
const http = require('http');
const connectDB = require('./config/db');

const { initRealtimeServer } = require('../../realtime/server');
const executeRouter = require('./routes/execute');
const authRouter = require('./routes/auth');
const helmet = require('helmet');
const roomsRouter = require('./routes/rooms');
const { globalErrorHandler } = require('./middleware/errorHandler');
const { getClientOrigins } = require('./config/clientOrigins');
const clientOrigins = getClientOrigins();
const { readiness } = require('./config/readiness');

const app = express();
const httpServer = http.createServer(app);

connectDB().catch((err) => {
  console.error(`[MongoDB] Initial connection error: ${err.message}`);
});

// Security headers (SEC-API-02)
app.use(helmet({
  contentSecurityPolicy: false, // Prevent breaking frontend cross-origin asset loading
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// Middleware
app.use(cors({
  origin: clientOrigins,
}));
app.use(express.json());

// Initialize realtime layer
const io = initRealtimeServer(httpServer, {
  origin: clientOrigins,
});

// Attach io to Express app instance
app.set('io', io);
app.use((req, res, next) => {
  req.io = io;
  next();
});

// Routes
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});
app.get('/ready', async (req, res) => {
  const state = await readiness({ connection: require('mongoose').connection });
  res.status(state.ready ? 200 : 503).json({ status: state.ready ? 'ready' : 'not_ready', database: state.database, redis: state.redis });
});

app.use('/api/auth', authRouter);
app.use('/api/rooms', roomsRouter);
app.use('/api/execute', executeRouter);

// Global sanitized error handler (SEC-API-02)
app.use(globalErrorHandler);

// Start server
const PORT = process.env.PORT || 5000;

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const { verifyDevDependencies } = require('./config/devBootstrap');
    await verifyDevDependencies();
  }

  return new Promise((resolve) => {
    httpServer.listen(PORT, () => {
      console.log(`Backend server running on port ${PORT}`);
      console.log(`Realtime server initialized`);
      resolve(httpServer);
    });
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    console.error(`[Startup Error] ${err.message}`);
    process.exit(1);
  });
}

module.exports = { app, httpServer, io, startServer };
