const http = require('http');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const config = require('./config/env');
const { pool } = require('./config/db');
const { ok } = require('./utils/http');
const { ensureUploadDirs } = require('./utils/files');
const { notFound, errorHandler } = require('./middleware/errorHandler');
const socketService = require('./services/socketService');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const mouRoutes = require('./routes/mou.routes');
const signatureRoutes = require('./routes/signature.routes');
const adminRoutes = require('./routes/admin.routes');
const settingsRoutes = require('./routes/settings.routes');

function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', async (req, res) => {
    await pool.query('SELECT 1');
    ok(res, { status: 'ok', time: new Date().toISOString() });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api/mou', mouRoutes);
  app.use('/api/signature', signatureRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/settings', settingsRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

async function start() {
  await ensureUploadDirs();

  const app = createApp();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: { origin: config.corsOrigin },
    maxHttpBufferSize: 2e6, // base64 signature PNGs (up to 1 MB decoded)
  });
  socketService.init(io);

  server.listen(config.port, () => {
    console.log(`MOU backend listening on http://localhost:${config.port} (${config.nodeEnv})`);
  });

  return { app, server, io };
}

if (require.main === module) {
  start().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { createApp, start };
