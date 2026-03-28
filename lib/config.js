require('dotenv').config();

const REQUIRED_ALWAYS = ['DATABASE_URL', 'OPENAI_API_KEY'];

const REQUIRED_PRODUCTION = [
  'INBOXPILOT_API_SECRET',
  'NYLAS_API_KEY',
  'NYLAS_GRANT_ID',
  'NYLAS_WEBHOOK_SECRET',
  'APP_BASE_URL',
];

const MIN_API_SECRET_LEN = 24;

/**
 * Validates environment. Exits process in production if critical vars missing.
 */
function validateEnv() {
  const missing = REQUIRED_ALWAYS.filter((k) => !process.env[k]?.trim());
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd) {
    missing.push(
      ...REQUIRED_PRODUCTION.filter((k) => !process.env[k]?.trim())
    );
  }

  const unique = [...new Set(missing)];
  if (unique.length) {
    const msg = `[InboxPilot] Missing required environment variables: ${unique.join(', ')}`;
    if (isProd) {
      console.error(msg);
      process.exit(1);
    }
    console.warn(`WARNING: ${msg}`);
  }

  if (isProd) {
    const secret = process.env.INBOXPILOT_API_SECRET?.trim() || '';
    if (secret.length < MIN_API_SECRET_LEN) {
      console.error(
        `[InboxPilot] INBOXPILOT_API_SECRET must be at least ${MIN_API_SECRET_LEN} characters in production. Generate one: npm run gen:api-secret`
      );
      process.exit(1);
    }
    const dbUrl = (process.env.DATABASE_URL || '').trim().toLowerCase();
    if (!dbUrl || dbUrl === 'pglite' || dbUrl.startsWith('pglite://')) {
      console.error(
        '[InboxPilot] Production requires a real PostgreSQL DATABASE_URL (pglite is for development only).'
      );
      process.exit(1);
    }
  }
}

function getOpenAiModel() {
  return process.env.OPENAI_MODEL || 'gpt-4o';
}

function getAutoSendThreshold() {
  const t = parseFloat(process.env.AUTO_SEND_THRESHOLD || '0.9');
  if (Number.isNaN(t)) return 0.9;
  return Math.min(1, Math.max(0, t));
}

module.exports = {
  validateEnv,
  getOpenAiModel,
  getAutoSendThreshold,
  REQUIRED_ALWAYS,
  REQUIRED_PRODUCTION,
  MIN_API_SECRET_LEN,
};
