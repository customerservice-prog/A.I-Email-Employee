const logger = require('../lib/logger');
const { fail } = require('../lib/apiResponse');

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }
  const requestId = res.locals.requestId;
  logger.error('request_failed', {
    requestId,
    err: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack,
  });
  return fail(res, err.status || 500, 'Internal server error', 'internal_error');
}

module.exports = { errorHandler };
