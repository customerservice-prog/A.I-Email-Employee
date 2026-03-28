const { resolveSession } = require('../services/authService');
const logger = require('../lib/logger');

const COOKIE_NAME = 'inboxpilot_session';

/**
 * Binds req.tenantId from the authenticated session (or machine key).
 * Client header x-tenant-id is IGNORED — prevents cross-tenant access when API secret leaks.
 */
async function sessionAuth(req, res, next) {
  const path = req.originalUrl?.split('?')[0] || req.path || '';

  if (!path.startsWith('/api')) {
    return next();
  }
  if (
    path.startsWith('/api/auth') ||
    path.startsWith('/api/webhook')
  ) {
    return next();
  }

  const machineKey = process.env.INBOXPILOT_MACHINE_KEY;
  const machineHeader = req.get('x-inboxpilot-machine-key');
  if (machineKey && machineHeader === machineKey) {
    if (
      process.env.NODE_ENV === 'production' &&
      String(process.env.ALLOW_MACHINE_API_KEY || '').toLowerCase() !== 'true'
    ) {
      logger.warn('machine_api_key_rejected_in_production', {
        requestId: res.locals.requestId,
      });
      return res.status(403).json({
        success: false,
        error: {
          message: 'Machine API key is disabled in production',
          code: 'machine_key_forbidden',
        },
        requestId: res.locals.requestId,
      });
    }
    req.tenantId = String(
      process.env.INBOXPILOT_MACHINE_TENANT || 'default'
    ).trim();
    req.authKind = 'machine';
    req.userId = null;
    return next();
  }

  const raw =
    (req.cookies && req.cookies[COOKIE_NAME]) ||
    '';

  if (!raw) {
    return res.status(401).json({
      success: false,
      error: {
        message: 'Authentication required',
        code: 'auth_required',
      },
      requestId: res.locals.requestId,
    });
  }

  const session = await resolveSession(raw);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: {
        message: 'Session expired or invalid',
        code: 'session_invalid',
      },
      requestId: res.locals.requestId,
    });
  }

  req.tenantId = session.tenantKey;
  req.userId = session.userId;
  req.userEmail = session.email;
  req.authKind = 'session';
  return next();
}

module.exports = sessionAuth;
module.exports.COOKIE_NAME = COOKIE_NAME;
