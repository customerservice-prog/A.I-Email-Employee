const { hasDatabase } = require('../db/connection');

/**
 * Returns 503 when DATABASE_URL is not configured.
 */
function requireDatabase(req, res, next) {
  if (!hasDatabase()) {
    return res.status(503).json({
      success: false,
      error: { message: 'Database not configured', code: 'no_database' },
      requestId: res.locals.requestId,
    });
  }
  next();
}

module.exports = { requireDatabase };
