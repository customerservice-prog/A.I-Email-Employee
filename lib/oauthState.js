const crypto = require('crypto');

function stateSecret() {
  const s = (process.env.INBOXPILOT_API_SECRET || process.env.OAUTH_STATE_SECRET || '').trim();
  if (s.length >= 16) return s;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Set INBOXPILOT_API_SECRET (min 24 chars in production) or OAUTH_STATE_SECRET (16+) for OAuth state'
    );
  }
  return 'dev-inboxpilot-oauth-state-insecure';
}

function safeEqualUtf8(a, b) {
  try {
    const ba = Buffer.from(String(a), 'utf8');
    const bb = Buffer.from(String(b), 'utf8');
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/**
 * @param {{ userId: number, tenantKey: string }} p
 * @param {number} [ttlSec]
 */
function signNylasOAuthState(p, ttlSec = 900) {
  const payload = {
    uid: p.userId,
    tk: p.tenantKey,
    exp: Math.floor(Date.now() / 1000) + ttlSec,
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * @param {string} token
 * @returns {{ userId: number, tenantKey: string } | null}
 */
function verifyNylasOAuthState(token) {
  if (!token || typeof token !== 'string') return null;
  const i = token.lastIndexOf('.');
  if (i <= 0) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url');
  if (!safeEqualUtf8(sig, expect)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload || typeof payload.exp !== 'number' || now > payload.exp) return null;
  if (!payload.uid || !payload.tk) return null;
  return { userId: Number(payload.uid), tenantKey: String(payload.tk) };
}

module.exports = {
  signNylasOAuthState,
  verifyNylasOAuthState,
};
