const logger = require('../lib/logger');

function clientIp(req) {
  return req.ip || '';
}

function isLocalBypass(req) {
  if (String(process.env.ALLOW_LOCALHOST_API_WITHOUT_KEY).toLowerCase() !== 'true') {
    return false;
  }
  const ip = clientIp(req);
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    ip.endsWith('127.0.0.1')
  );
}

/**
 * Protects /api/* except webhook. Production requires INBOXPILOT_API_SECRET.
 * Header: x-inboxpilot-key or Authorization: Bearer <secret>
 */
function apiSecretGate(req, res, next) {
  const path = req.path || '';
  if (!path.startsWith('/api')) {
    return next();
  }
  if (path === '/api/webhook' || path.startsWith('/api/webhook/')) {
    return next();
  }

  const secret = process.env.INBOXPILOT_API_SECRET;
  const isProd = process.env.NODE_ENV === 'production';

  if (isProd && (!secret || !String(secret).trim())) {
    logger.error('api_secret_missing_in_production', {
      requestId: res.locals.requestId,
    });
    return res.status(503).json({
      success: false,
      error: {
        message: 'Server misconfigured: set INBOXPILOT_API_SECRET',
        code: 'misconfigured',
      },
      requestId: res.locals.requestId,
    });
  }

  if (!secret || !String(secret).trim()) {
    return next();
  }

  if (isLocalBypass(req)) {
    return next();
  }

  const headerKey = req.get('x-inboxpilot-key');
  const auth = req.get('authorization') || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth);
  const got = (headerKey || (bearer ? bearer[1].trim() : '') || '').trim();

  if (got !== secret) {
    logger.warn('api_secret_rejected', {
      requestId: res.locals.requestId,
      path: req.path,
      method: req.method,
    });
    return res.status(401).json({
      success: false,
      error: { message: 'Unauthorized', code: 'unauthorized' },
      requestId: res.locals.requestId,
    });
  }

  return next();
}

module.exports = { apiSecretGate };
