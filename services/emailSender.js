const Nylas = require('nylas').default;
const { getEffectiveNylasGrantId } = require('./tenantSettings');

const nylas = new Nylas({
  apiKey: process.env.NYLAS_API_KEY,
  apiUri: process.env.NYLAS_API_URI,
});

// SDK v8 expects send({ identifier, requestBody }); support v7-style send(grantId, body).
const _messagesSend = nylas.messages.send.bind(nylas.messages);
nylas.messages.send = function (grantOrParams, maybeBody) {
  if (typeof maybeBody !== 'undefined') {
    return _messagesSend({
      identifier: grantOrParams,
      requestBody: maybeBody,
    });
  }
  return _messagesSend(grantOrParams);
};

function normalizeRecipients(to) {
  if (!to) {
    throw new Error('Recipient "to" is required');
  }
  if (typeof to === 'string') {
    return [{ email: to.trim() }];
  }
  if (Array.isArray(to)) {
    return to.map((entry) => {
      if (typeof entry === 'string') {
        return { email: entry.trim() };
      }
      if (entry && typeof entry.email === 'string') {
        return { email: entry.email.trim(), name: entry.name };
      }
      throw new Error('Invalid recipient entry in "to" array');
    });
  }
  if (typeof to === 'object' && typeof to.email === 'string') {
    return [{ email: to.email.trim(), name: to.name }];
  }
  throw new Error('Invalid "to" format');
}

/**
 * @param {object} params
 * @param {string|object|Array} params.to
 * @param {string} params.subject
 * @param {string} params.body
 * @param {string} [params.threadId]
 * @param {string} [params.tenantId]
 */
async function sendEmail({ to, subject, body, threadId, tenantId: _tenantId }) {
  if (String(process.env.INBOXPILOT_MOCK_NYLAS_SEND || '').toLowerCase() === '1') {
    return {
      id: 'nylas_stub_msg_1',
      request_id: 'stub-req',
      data: { id: 'nylas_stub_msg_1' },
    };
  }
  if (!process.env.NYLAS_API_KEY) {
    throw new Error('Missing NYLAS_API_KEY');
  }
  const tenantKey = (_tenantId && String(_tenantId).trim()) || 'default';
  const grantId = await getEffectiveNylasGrantId(tenantKey);
  if (!grantId) {
    throw new Error('Missing Nylas grant (connect Gmail in Settings or set NYLAS_GRANT_ID)');
  }

  const payload = {
    to: normalizeRecipients(to),
    subject: subject || '',
    body: body || '',
    isPlaintext: !/<[a-z][\s\S]*>/i.test(body || ''),
  };
  if (threadId) {
    payload.threadId = threadId;
  }

  return nylas.messages.send(grantId, payload);
}

module.exports = { sendEmail };
