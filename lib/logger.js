const { redactString } = require('./redact');

/**
 * Structured JSON logs for observability (requestId on every line).
 * @param {string} level
 * @param {string} msg
 * @param {object} [fields]
 */
function log(level, msg, fields = {}) {
  const safe = { ...fields };
  if (typeof safe.err === 'string') safe.err = redactString(safe.err);
  if (typeof safe.msg === 'string') safe.msg = redactString(safe.msg);
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...safe,
  });
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  info: (msg, f) => log('info', msg, f),
  warn: (msg, f) => log('warn', msg, f),
  error: (msg, f) => log('error', msg, f),
};
