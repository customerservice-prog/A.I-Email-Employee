const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const fs = require('fs');
const path = require('path');
const { pool, ensureReady, hasDatabase } = require('./db/connection');
const { requestIdMiddleware } = require('./middleware/requestId');
const { errorHandler } = require('./middleware/errorHandler');
const { apiLimiter, webhookLimiter } = require('./middleware/rateLimit');
const OpenAIModule = require('openai');
const OpenAI = OpenAIModule.default || OpenAIModule;

const webhookRouter = require('./routes/webhook');
const emailsRouter = require('./routes/emails');
const draftRouter = require('./routes/draft');
const sendRouter = require('./routes/send');
const knowledgeRouter = require('./routes/knowledge');
const statsRouter = require('./routes/stats');
const settingsRouter = require('./routes/settings');

/**
 * Express application (no listen). Used by server.js and integration tests.
 */
function buildApp() {
  const app = express();

  if (String(process.env.TRUST_PROXY).toLowerCase() === 'true') {
    app.set('trust proxy', 1);
  }

  app.use(requestIdMiddleware);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    })
  );
  const corsExtra = String(process.env.CORS_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const corsOrigins = [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:3042',
    'http://127.0.0.1:3042',
    'http://localhost:3043',
    'http://127.0.0.1:3043',
    process.env.APP_BASE_URL,
    ...corsExtra,
  ].filter(Boolean);
  app.use(
    cors({
      origin: [...new Set(corsOrigins)],
      credentials: true,
    })
  );

  app.use('/api/webhook', webhookLimiter);
  app.use('/api/webhook', express.raw({ type: 'application/json', limit: '5mb' }));
  app.use('/api/webhook', webhookRouter);

  app.use(express.json({ limit: '5mb' }));

  const { apiSecretGate } = require('./middleware/apiSecret');
  app.use(apiSecretGate);

  app.use('/api/emails', apiLimiter);
  app.use('/api/draft', apiLimiter);
  app.use('/api/send', apiLimiter);
  app.use('/api/knowledge', apiLimiter);
  app.use('/api/stats', apiLimiter);
  app.use('/api/settings', apiLimiter);

  app.use(require('./middleware/auth'));

  app.get('/health', (req, res) => {
    res.json({
      success: true,
      data: { ok: true },
      requestId: res.locals.requestId,
    });
  });

  app.get('/ready', async (req, res) => {
    const requestId = res.locals.requestId;
    const checks = {
      database: false,
      openai: false,
      nylas_config: Boolean(
        process.env.NYLAS_API_KEY && process.env.NYLAS_GRANT_ID
      ),
    };

    if (hasDatabase()) {
      try {
        await ensureReady();
        await pool.query('SELECT 1');
        checks.database = true;
      } catch {
        checks.database = false;
      }
    }

    if (process.env.OPENAI_API_KEY) {
      try {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        await client.models.list({ limit: 1 });
        checks.openai = true;
      } catch {
        checks.openai = false;
      }
    }

    const ok =
      checks.database && checks.openai && checks.nylas_config;
    res.status(ok ? 200 : 503).json({
      success: ok,
      data: checks,
      requestId,
    });
  });

  app.use('/api/emails', emailsRouter);
  app.use('/api/draft', draftRouter);
  app.use('/api/send', sendRouter);
  app.use('/api/knowledge', knowledgeRouter);
  app.use('/api/stats', statsRouter);
  app.use('/api/settings', settingsRouter);

  const clientDist = path.join(__dirname, 'client', 'dist');
  const dashboardDir = path.join(__dirname, 'dashboard');
  const staticRoot = fs.existsSync(path.join(clientDist, 'index.html'))
    ? clientDist
    : dashboardDir;
  app.use(express.static(staticRoot));
  app.get('*', (req, res, next) => {
    if (
      req.path.startsWith('/api') ||
      req.path.startsWith('/health') ||
      req.path.startsWith('/ready')
    ) {
      return next();
    }
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(staticRoot, 'index.html'), (err) => {
      if (err) next();
    });
  });

  if (process.env.SENTRY_DSN) {
    try {
      const Sentry = require('@sentry/node');
      if (typeof Sentry.setupExpressErrorHandler === 'function') {
        Sentry.setupExpressErrorHandler(app);
      }
    } catch (e) {
      console.warn(
        '[InboxPilot] SENTRY_DSN is set but @sentry/node failed to load:',
        e.message
      );
    }
  }

  app.use(errorHandler);

  return app;
}

module.exports = { buildApp };
