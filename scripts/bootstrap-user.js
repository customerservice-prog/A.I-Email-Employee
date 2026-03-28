/**
 * Create or reset a password user (local/QA). Do not use in production with weak env exposure.
 *
 *   INBOXPILOT_BOOTSTRAP_EMAIL=x@y.com INBOXPILOT_BOOTSTRAP_PASSWORD='...' node scripts/bootstrap-user.js
 */
require('dotenv').config();
const bcrypt = require('bcrypt');
const { ensureReady, pool } = require('../db/connection');
const { registerUser, findUserByEmail } = require('../services/authService');

const BCRYPT_ROUNDS = 12;

async function main() {
  const email = String(process.env.INBOXPILOT_BOOTSTRAP_EMAIL || '').trim().toLowerCase();
  const password = process.env.INBOXPILOT_BOOTSTRAP_PASSWORD;
  if (!email || !password || String(password).length < 10) {
    console.error(
      '[InboxPilot] Set INBOXPILOT_BOOTSTRAP_EMAIL and INBOXPILOT_BOOTSTRAP_PASSWORD (min 10 chars).'
    );
    process.exit(1);
  }
  await ensureReady();
  if (!pool) {
    console.error('[InboxPilot] DATABASE_URL not configured.');
    process.exit(1);
  }
  const existing = await findUserByEmail(email);
  const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  if (existing) {
    await pool.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [hash, existing.id]
    );
    console.log('[InboxPilot] Updated password for existing user:', email);
  } else {
    await registerUser({ email, password: String(password) });
    console.log('[InboxPilot] Created user:', email);
  }
  console.log('[InboxPilot] Sign in at http://localhost:3000/login (Vite) or http://localhost:PORT/#/signin (legacy dashboard).');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
