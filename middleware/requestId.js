const { randomUUID } = require('crypto');

function requestIdMiddleware(req, res, next) {
  const id =
    req.headers['x-request-id'] ||
    req.headers['x-correlation-id'] ||
    randomUUID();
  res.locals.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}

module.exports = { requestIdMiddleware };
