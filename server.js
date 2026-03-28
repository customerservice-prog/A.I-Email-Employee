require('dotenv').config();

const { validateEnv } = require('./lib/config');
const logger = require('./lib/logger');

validateEnv();

if (process.env.SENTRY_DSN) {
  try {
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || '0') || 0,
    });
  } catch (e) {
    console.warn(
      '[InboxPilot] SENTRY_DSN is set but @sentry/node failed to load:',
      e.message
    );
  }
}

if (process.env.NODE_ENV === 'production') {
  if (!process.env.NYLAS_WEBHOOK_SECRET?.trim()) {
    logger.warn('production_missing_nylas_webhook_secret', {
      msg: 'Nylas webhooks will be rejected until NYLAS_WEBHOOK_SECRET is set',
    });
  }
}
if (String(process.env.AUTO_SEND_FROM_WEBHOOK).toLowerCase() !== 'true') {
  logger.info('auto_send_from_webhook_disabled', {
    msg: 'Webhook path will not auto-send; use Review Queue or set AUTO_SEND_FROM_WEBHOOK=true after testing',
  });
}

const path = require('path');
const fs = require('fs');
const { buildApp } = require('./app');
const { ensureReady } = require('./db/connection');

const app = buildApp();
const PORT = process.env.PORT || 3001;

const clientDist = path.join(__dirname, 'client', 'dist');
const dashboardDir = path.join(__dirname, 'dashboard');
const staticRoot = fs.existsSync(path.join(clientDist, 'index.html'))
  ? clientDist
  : dashboardDir;

ensureReady()
  .then(() => {
    app.listen(PORT, () => {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: 'info',
          msg: 'inboxpilot_api_listen',
          port: PORT,
          static: path.relative(__dirname, staticRoot) || '.',
        })
      );
    });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
