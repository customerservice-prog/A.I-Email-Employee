function ok(res, data, status = 200) {
  const requestId = res.locals.requestId;
  return res.status(status).json({
    success: true,
    data,
    requestId,
  });
}

function fail(res, status, message, code, extra = {}) {
  const requestId = res.locals.requestId;
  return res.status(status).json({
    success: false,
    error: { message, code, ...extra },
    requestId,
  });
}

module.exports = { ok, fail };
