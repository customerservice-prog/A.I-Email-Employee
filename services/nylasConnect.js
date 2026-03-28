const Nylas = require('nylas').default;

function getClient() {
  const apiKey = (process.env.NYLAS_API_KEY || '').trim();
  if (!apiKey) {
    throw Object.assign(new Error('NYLAS_API_KEY is not configured'), { code: 'nylas_not_configured' });
  }
  return new Nylas({
    apiKey,
    apiUri: process.env.NYLAS_API_URI,
  });
}

function redirectUri() {
  const base = (process.env.APP_BASE_URL || '').replace(/\/$/, '');
  if (!base) {
    throw Object.assign(new Error('APP_BASE_URL is required for Nylas OAuth'), {
      code: 'app_base_missing',
    });
  }
  return `${base}/api/auth/nylas/callback`;
}

/**
 * @param {{ state: string, loginHint?: string }} opts
 */
function buildHostedAuthUrl(opts) {
  const clientId = (process.env.NYLAS_CLIENT_ID || '').trim();
  if (!clientId) {
    throw Object.assign(new Error('NYLAS_CLIENT_ID is not configured'), { code: 'nylas_client_missing' });
  }
  const nylas = getClient();
  return nylas.auth.urlForOAuth2({
    clientId,
    redirectUri: redirectUri(),
    provider: 'google',
    state: opts.state,
    loginHint: opts.loginHint,
    accessType: 'offline',
  });
}

function pickGrantId(exchanged) {
  const raw = exchanged?.data ?? exchanged;
  return (
    raw?.grantId ||
    raw?.grant_id ||
    raw?.grantID ||
    (typeof raw?.grant === 'string' ? raw.grant : raw?.grant?.id) ||
    null
  );
}

function pickGrantEmail(grant) {
  const raw = grant?.data ?? grant;
  const email =
    raw?.email ||
    raw?.emailAddress ||
    raw?.email_address ||
    raw?.grant_email ||
    raw?.profile?.email ||
    null;
  return email && String(email).trim() ? String(email).trim() : null;
}

/**
 * @param {string} code
 */
async function exchangeCodeAndDescribeGrant(code) {
  const clientId = (process.env.NYLAS_CLIENT_ID || '').trim();
  if (!clientId) {
    throw Object.assign(new Error('NYLAS_CLIENT_ID is not configured'), { code: 'nylas_client_missing' });
  }
  const nylas = getClient();
  const exchanged = await nylas.auth.exchangeCodeForToken({
    clientId,
    redirectUri: redirectUri(),
    code: String(code).trim(),
  });
  const grantId = pickGrantId(exchanged);
  if (!grantId) {
    throw Object.assign(new Error('Nylas token exchange did not return a grant id'), {
      code: 'nylas_no_grant',
    });
  }
  let connectedEmail = null;
  try {
    const grant = await nylas.grants.find({ grantId });
    connectedEmail = pickGrantEmail(grant);
  } catch {
    /* grant metadata optional */
  }
  return { grantId, connectedEmail };
}

module.exports = {
  buildHostedAuthUrl,
  exchangeCodeAndDescribeGrant,
  redirectUri,
};
