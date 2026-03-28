/**
 * Reads x-tenant-id and sets req.tenantId (defaults to 'default').
 */
function tenantAuth(req, res, next) {
  const raw = req.headers['x-tenant-id'];
  const trimmed =
    raw !== undefined && raw !== null ? String(raw).trim() : '';
  req.tenantId = trimmed || 'default';
  next();
}

module.exports = tenantAuth;
module.exports.tenantAuth = tenantAuth;
