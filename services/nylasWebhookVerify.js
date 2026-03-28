const crypto = require('crypto');

/**
 * Verifies Nylas webhook HMAC (v3 style). If secret unset, skips verification (dev only).
 * @param {Buffer|string} rawBody
 * @param {string|undefined} signatureHeader hex digest from Nylas
 * @param {string|undefined} secret
 */
function verifyNylasWebhook(rawBody, signatureHeader, secret) {
  if (!secret) {
    return process.env.NODE_ENV !== 'production';
  }
  if (!signatureHeader) {
    return false;
  }
  const body =
    typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : rawBody;
  const h = crypto.createHmac('sha256', secret).update(body).digest('hex');
  try {
    const a = Buffer.from(h, 'utf8');
    const b = Buffer.from(String(signatureHeader).trim(), 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

module.exports = { verifyNylasWebhook };
