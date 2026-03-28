const express = require('express');
const { requireDatabase } = require('../middleware/database');
const { pool } = require('../db/connection');
const {
  validateRegisterBody,
  validateLoginBody,
  validateResetRequestBody,
  validateResetPasswordBody,
} = require('../lib/validateAuth');
const {
  registerUser,
  verifyLogin,
  findOrCreateUserFromGoogle,
  createSessionForUser,
  resolveSession,
  destroySession,
  createPasswordResetToken,
  consumePasswordReset,
} = require('../services/authService');
const { SESSION_DAYS } = require('../services/authService');
const { verifyGoogleIdToken } = require('../services/googleSignIn');
const {
  buildHostedAuthUrl,
  exchangeCodeAndDescribeGrant,
} = require('../services/nylasConnect');
const {
  signNylasOAuthState,
  verifyNylasOAuthState,
} = require('../lib/oauthState');
const {
  getTenantSettings,
  setTenantNylasGrant,
  applyAutoLinkedBusinessEmail,
} = require('../services/tenantSettings');
const logger = require('../lib/logger');
const { sendPasswordResetEmail } = require('../services/transactionalMail');

const router = express.Router();

/** Public: which auth features are configured (no DB). */
router.get('/options', (req, res) => {
  const requestId = res.locals.requestId;
  return res.json({
    success: true,
    data: {
      googleSignInConfigured: Boolean((process.env.GOOGLE_CLIENT_ID || '').trim()),
      nylasConnectConfigured: Boolean(
        (process.env.NYLAS_CLIENT_ID || '').trim() &&
          (process.env.NYLAS_API_KEY || '').trim()
      ),
      appBaseUrl: (process.env.APP_BASE_URL || '').trim(),
    },
    requestId,
  });
});

router.use(requireDatabase);

const COOKIE_NAME = 'inboxpilot_session';

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: String(process.env.COOKIE_SECURE || '').toLowerCase() === 'true' ||
      process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  };
}

function readRawToken(req) {
  const c = req.cookies && req.cookies[COOKIE_NAME];
  return c && typeof c === 'string' ? c : '';
}

function clientRedirectBase() {
  return (
    process.env.CLIENT_BASE_URL ||
    process.env.APP_BASE_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');
}

router.post('/register', async (req, res) => {
  const requestId = res.locals.requestId;
  const parsed = validateRegisterBody(req.body);
  if (parsed.error) {
    return res.status(400).json({
      success: false,
      error: { message: parsed.error, code: 'validation' },
      requestId,
    });
  }
  try {
    const user = await registerUser(parsed.value);
    const { token, expiresAt } = await createSessionForUser(user.id);
    res.cookie(COOKIE_NAME, token, sessionCookieOptions());
    return res.status(201).json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, tenantKey: user.tenant_key },
        sessionExpiresAt: expiresAt.toISOString(),
      },
      requestId,
    });
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({
        success: false,
        error: { message: 'An account with this email already exists', code: 'exists' },
        requestId,
      });
    }
    return res.status(500).json({
      success: false,
      error: { message: 'Registration failed', code: 'register_error' },
      requestId,
    });
  }
});

router.post('/google', async (req, res) => {
  const requestId = res.locals.requestId;
  const credential = req.body?.credential || req.body?.idToken;
  if (!credential || typeof credential !== 'string') {
    return res.status(400).json({
      success: false,
      error: { message: 'Missing Google credential', code: 'validation' },
      requestId,
    });
  }
  try {
    const profile = await verifyGoogleIdToken(credential);
    const user = await findOrCreateUserFromGoogle(profile);
    const { token, expiresAt } = await createSessionForUser(user.id);
    res.cookie(COOKIE_NAME, token, sessionCookieOptions());
    const tenant = await getTenantSettings(user.tenant_key);
    return res.json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, tenantKey: user.tenant_key },
        sessionExpiresAt: expiresAt.toISOString(),
        nylas: {
          grantConfigured: tenant.nylasGrantConfigured,
          mailboxEmail: tenant.nylasConnectedEmail,
          grantFromTenant: tenant.nylasGrantFromTenant,
        },
      },
      requestId,
    });
  } catch (e) {
    const code = e.code || 'google_auth_failed';
    if (code === 'google_not_configured') {
      return res.status(503).json({
        success: false,
        error: { message: e.message, code },
        requestId,
      });
    }
    if (code === 'google_email_conflict') {
      return res.status(409).json({
        success: false,
        error: { message: e.message, code },
        requestId,
      });
    }
    logger.warn('google_sign_in_failed', { requestId, code, err: e.message });
    return res.status(401).json({
      success: false,
      error: { message: e.message || 'Google sign-in failed', code },
      requestId,
    });
  }
});

router.get('/nylas/start', async (req, res) => {
  const base = clientRedirectBase();
  const raw = readRawToken(req);
  const session = raw ? await resolveSession(raw) : null;
  if (!session) {
    return res.redirect(302, `${base}/login?next=nylas`);
  }
  let state;
  try {
    state = signNylasOAuthState({
      userId: session.userId,
      tenantKey: session.tenantKey,
    });
  } catch (e) {
    logger.error('nylas_oauth_state_failed', { err: e.message });
    return res.redirect(
      302,
      `${base}/connect?nylas=error&reason=${encodeURIComponent(e.message)}`
    );
  }
  try {
    const url = buildHostedAuthUrl({
      state,
      loginHint: session.email,
    });
    return res.redirect(302, url);
  } catch (e) {
    logger.warn('nylas_hosted_auth_url_failed', { err: e.message });
    return res.redirect(
      302,
      `${base}/connect?nylas=error&reason=${encodeURIComponent(e.message)}`
    );
  }
});

router.get('/nylas/callback', async (req, res) => {
  const base = clientRedirectBase();
  const code = req.query.code;
  const stateQ = req.query.state;
  if (req.query.error) {
    return res.redirect(302, `${base}/connect?nylas=denied`);
  }
  const decoded = verifyNylasOAuthState(
    typeof stateQ === 'string' ? stateQ : ''
  );
  if (!code || typeof code !== 'string' || !decoded) {
    return res.redirect(302, `${base}/connect?nylas=error&reason=bad_state`);
  }
  const ur = await pool.query(
    `SELECT id, email, tenant_key FROM users WHERE id = $1 LIMIT 1`,
    [decoded.userId]
  );
  const row = ur.rows[0];
  if (!row || row.tenant_key !== decoded.tenantKey) {
    return res.redirect(302, `${base}/connect?nylas=error&reason=user_mismatch`);
  }
  try {
    const { grantId, connectedEmail } = await exchangeCodeAndDescribeGrant(code);
    await setTenantNylasGrant(decoded.tenantKey, {
      grantId,
      connectedEmail,
    });
    const auto = await applyAutoLinkedBusinessEmail(decoded.tenantKey, {
      grantEmail: connectedEmail || '',
      userEmail: row.email,
    });
    const extra = auto.linked ? '&autoLinked=1' : '';
    return res.redirect(302, `${base}/connect?nylas=ok${extra}`);
  } catch (e) {
    logger.warn('nylas_callback_failed', { err: e.message });
    return res.redirect(
      302,
      `${base}/connect?nylas=error&reason=${encodeURIComponent(e.message)}`
    );
  }
});

router.post('/login', async (req, res) => {
  const requestId = res.locals.requestId;
  const parsed = validateLoginBody(req.body);
  if (parsed.error) {
    return res.status(400).json({
      success: false,
      error: { message: parsed.error, code: 'validation' },
      requestId,
    });
  }
  const user = await verifyLogin(parsed.value.email, parsed.value.password);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: { message: 'Invalid email or password', code: 'invalid_credentials' },
      requestId,
    });
  }
  const { token, expiresAt } = await createSessionForUser(user.id);
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
  return res.json({
    success: true,
    data: {
      user: { id: user.id, email: user.email, tenantKey: user.tenant_key },
      sessionExpiresAt: expiresAt.toISOString(),
    },
    requestId,
  });
});

router.post('/logout', async (req, res) => {
  const requestId = res.locals.requestId;
  const raw = readRawToken(req);
  if (raw) await destroySession(raw);
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({ success: true, data: { loggedOut: true }, requestId });
});

router.get('/me', async (req, res) => {
  const requestId = res.locals.requestId;
  const raw = readRawToken(req);
  const session = raw ? await resolveSession(raw) : null;
  if (!session) {
    return res.status(401).json({
      success: false,
      error: { message: 'Not authenticated', code: 'auth_required' },
      requestId,
    });
  }
  let tenant;
  try {
    tenant = await getTenantSettings(session.tenantKey);
  } catch {
    tenant = null;
  }
  return res.json({
    success: true,
    data: {
      user: {
        id: session.userId,
        email: session.email,
        tenantKey: session.tenantKey,
      },
      nylas: tenant
        ? {
            grantConfigured: tenant.nylasGrantConfigured,
            mailboxEmail: tenant.nylasConnectedEmail,
            grantFromTenant: tenant.nylasGrantFromTenant,
          }
        : null,
    },
    requestId,
  });
});

router.post('/forgot-password', async (req, res) => {
  const requestId = res.locals.requestId;
  const parsed = validateResetRequestBody(req.body);
  if (parsed.error) {
    return res.status(400).json({
      success: false,
      error: { message: parsed.error, code: 'validation' },
      requestId,
    });
  }
  const out = await createPasswordResetToken(parsed.value.email);
  if (out) {
    const mailResult = await sendPasswordResetEmail({
      to: out.email,
      resetUrl: out.url,
    });
    if (!mailResult.sent && process.env.NODE_ENV === 'production') {
      logger.warn('password_reset_email_not_sent', {
        reason: mailResult.reason || 'unknown',
      });
    }
  }
  const data = {
    message:
      'If an account exists for that email, you will receive password reset instructions shortly.',
  };
  if (process.env.NODE_ENV !== 'production' && out) {
    data.devResetUrl = out.url;
  }
  return res.json({
    success: true,
    data,
    requestId,
  });
});

router.post('/reset-password', async (req, res) => {
  const requestId = res.locals.requestId;
  const parsed = validateResetPasswordBody(req.body);
  if (parsed.error) {
    return res.status(400).json({
      success: false,
      error: { message: parsed.error, code: 'validation' },
      requestId,
    });
  }
  const result = await consumePasswordReset(
    parsed.value.token,
    parsed.value.password
  );
  if (!result.ok) {
    return res.status(400).json({
      success: false,
      error: { message: result.error, code: 'reset_failed' },
      requestId,
    });
  }
  res.clearCookie(COOKIE_NAME, { path: '/' });
  return res.json({
    success: true,
    data: { message: 'Password updated. Sign in with your new password.' },
    requestId,
  });
});

module.exports = router;
