const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { pool } = require('../db/connection');
const { ensureTenant } = require('./tenantSettings');
const logger = require('../lib/logger');

const SESSION_DAYS = 14;
const RESET_HOURS = 2;
const BCRYPT_ROUNDS = 12;

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

function newSessionToken() {
  return `ip_${crypto.randomBytes(32).toString('base64url')}`;
}

function newResetToken() {
  return crypto.randomBytes(32).toString('base64url');
}

async function pickTenantKeyForNewUser() {
  const uc = await pool.query(`SELECT COUNT(*)::int AS c FROM users`);
  const n = uc.rows[0]?.c ?? 0;
  if (n === 0) {
    const hasDefault = await pool.query(
      `SELECT 1 FROM tenants WHERE tenant_key = 'default' LIMIT 1`
    );
    if (hasDefault.rowCount > 0) {
      return 'default';
    }
  }
  return `t_${crypto.randomUUID().replace(/-/g, '')}`;
}

/**
 * @param {{ email: string, password: string }} input
 */
async function registerUser(input) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  const tenantKey = await pickTenantKeyForNewUser();
  await ensureTenant(tenantKey);

  const ins = await pool.query(
    `INSERT INTO users (tenant_key, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, tenant_key, email, created_at`,
    [tenantKey, input.email, passwordHash]
  );
  return ins.rows[0];
}

/**
 * @param {string} email normalized
 */
async function findUserByEmail(email) {
  const r = await pool.query(
    `SELECT id, tenant_key, email, password_hash, google_sub, auth_provider, created_at
     FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  return r.rows[0] || null;
}

/**
 * @param {string} email
 * @param {string} password
 */
async function verifyLogin(email, password) {
  const user = await findUserByEmail(email);
  if (!user || !user.password_hash) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  return user;
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

/**
 * @param {{ sub: string, email: string, emailVerified?: boolean }} google
 */
async function findOrCreateUserFromGoogle(google) {
  const email = normalizeEmail(google.email);
  if (!email || !google.sub) {
    throw Object.assign(new Error('Invalid Google profile'), { code: 'google_invalid' });
  }
  if (google.emailVerified === false) {
    throw Object.assign(new Error('Google email not verified'), { code: 'google_unverified' });
  }

  const bySub = await pool.query(
    `SELECT id, tenant_key, email, password_hash, google_sub, auth_provider
     FROM users WHERE google_sub = $1 LIMIT 1`,
    [google.sub]
  );
  if (bySub.rows[0]) return bySub.rows[0];

  const byEmail = await pool.query(
    `SELECT id, tenant_key, email, password_hash, google_sub, auth_provider
     FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  const existing = byEmail.rows[0];
  if (existing) {
    if (existing.google_sub && existing.google_sub !== google.sub) {
      throw Object.assign(new Error('This email is linked to another Google account'), {
        code: 'google_email_conflict',
      });
    }
    const authProvider =
      existing.password_hash && String(existing.auth_provider || '') !== 'google'
        ? 'both'
        : 'google';
    const up = await pool.query(
      `UPDATE users SET google_sub = $2, auth_provider = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING id, tenant_key, email, password_hash, google_sub, auth_provider`,
      [existing.id, google.sub, authProvider]
    );
    return up.rows[0];
  }

  const tenantKey = await pickTenantKeyForNewUser();
  await ensureTenant(tenantKey);

  const ins = await pool.query(
    `INSERT INTO users (tenant_key, email, password_hash, google_sub, auth_provider)
     VALUES ($1, $2, NULL, $3, 'google')
     RETURNING id, tenant_key, email, password_hash, google_sub, auth_provider`,
    [tenantKey, email, google.sub]
  );
  return ins.rows[0];
}

/**
 * Replace any existing sessions for this user (single active session).
 * @param {number} userId
 * @returns {Promise<{ token: string, expiresAt: Date }>}
 */
async function createSessionForUser(userId) {
  await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [userId]);
  const token = newSessionToken();
  const tokenHash = sha256Hex(token);
  const expiresAt = new Date(
    Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  );
  await pool.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );
  return { token, expiresAt };
}

/**
 * @param {string} rawToken
 */
async function resolveSession(rawToken) {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 10) {
    return null;
  }
  const tokenHash = sha256Hex(rawToken.trim());
  const r = await pool.query(
    `SELECT u.id AS user_id, u.tenant_key, u.email, s.expires_at
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1`,
    [tokenHash]
  );
  const row = r.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
    return null;
  }
  return {
    userId: row.user_id,
    tenantKey: row.tenant_key,
    email: row.email,
  };
}

/**
 * @param {string} rawToken
 */
async function destroySession(rawToken) {
  if (!rawToken) return;
  const tokenHash = sha256Hex(rawToken.trim());
  await pool.query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}

/**
 * @param {string} email normalized
 * @returns {Promise<{ rawToken: string } | null>}
 */
async function createPasswordResetToken(email) {
  const user = await findUserByEmail(email);
  if (!user || !user.password_hash) return null;
  const rawToken = newResetToken();
  const tokenHash = sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + RESET_HOURS * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, tokenHash, expiresAt]
  );
  const base =
    process.env.APP_BASE_URL || 'http://localhost:3042';
  const url = `${base.replace(/\/$/, '')}/#/reset?token=${encodeURIComponent(rawToken)}`;
  if (process.env.NODE_ENV === 'production') {
    logger.info('password_reset_issued', { userId: user.id });
  } else {
    logger.info('password_reset_issued', {
      email: user.email,
      resetUrl: url,
    });
  }
  return { rawToken, url, email: user.email };
}

/**
 * @param {string} rawToken
 * @param {string} newPassword
 */
async function consumePasswordReset(rawToken, newPassword) {
  const tokenHash = sha256Hex(rawToken.trim());
  const r = await pool.query(
    `SELECT id, user_id, expires_at, used_at FROM password_reset_tokens
     WHERE token_hash = $1 ORDER BY id DESC LIMIT 1`,
    [tokenHash]
  );
  const row = r.rows[0];
  if (!row || row.used_at) {
    return { ok: false, error: 'Invalid or expired reset link' };
  }
  if (new Date(row.expires_at) < new Date()) {
    return { ok: false, error: 'Reset link has expired' };
  }
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [
    passwordHash,
    row.user_id,
  ]);
  await pool.query(
    `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
    [row.id]
  );
  await pool.query(`DELETE FROM sessions WHERE user_id = $1`, [row.user_id]);
  return { ok: true };
}

module.exports = {
  registerUser,
  findUserByEmail,
  verifyLogin,
  findOrCreateUserFromGoogle,
  createSessionForUser,
  resolveSession,
  destroySession,
  createPasswordResetToken,
  consumePasswordReset,
  sha256Hex,
  SESSION_DAYS,
};
