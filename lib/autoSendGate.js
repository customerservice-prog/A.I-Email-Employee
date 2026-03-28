const { TRACK, STATUS } = require('./constants');
const { getTenantSettings } = require('../services/tenantSettings');
const { isPlaceholderOrUnsafeDraft } = require('./draftConstants');

/**
 * Flags that must never accompany webhook auto-send, even if track slipped to auto.
 */
const BLOCK_AUTO_FLAGS = new Set([
  'insufficient_context',
  'model_error',
  'malformed_model_output',
  'empty_model_response',
  'parse_error',
  'discount_or_negotiation',
  'refund_or_legal',
  'complaint_escalation',
  'non_standard_safety',
  'prompt_injection_attempt',
]);

/**
 * Webhook auto-send is opt-in so new deployments fail closed until explicitly enabled.
 */
function isWebhookAutoSendEnabled() {
  return String(process.env.AUTO_SEND_FROM_WEBHOOK || '').toLowerCase() === 'true';
}

function hasBlockFlag(flags) {
  if (!Array.isArray(flags)) return false;
  return flags.some((f) => BLOCK_AUTO_FLAGS.has(String(f)));
}

/**
 * @param {object} opts
 * @param {string} opts.tenantId
 * @param {object} opts.classification classifyInboundEmail result
 * @param {string} opts.draftText
 * @param {object} opts.emailRow DB row (pending)
 * @returns {Promise<{ ok: boolean, reason: string }>}
 */
async function evaluateWebhookAutoSend(opts) {
  const { tenantId, classification, draftText, emailRow } = opts;

  if (!isWebhookAutoSendEnabled()) {
    return { ok: false, reason: 'auto_send_webhook_disabled' };
  }

  if (!process.env.NYLAS_API_KEY || !process.env.NYLAS_GRANT_ID) {
    return { ok: false, reason: 'nylas_not_configured' };
  }

  if (!classification || classification.track !== TRACK.AUTO) {
    return { ok: false, reason: 'track_not_auto' };
  }

  if (!emailRow || emailRow.status !== STATUS.PENDING) {
    return { ok: false, reason: 'email_not_pending' };
  }

  const conf = Number(classification.confidence);
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
    return { ok: false, reason: 'invalid_confidence' };
  }

  if (hasBlockFlag(classification.flags)) {
    return { ok: false, reason: 'blocked_flag' };
  }

  if (isPlaceholderOrUnsafeDraft(draftText)) {
    return { ok: false, reason: 'draft_placeholder_or_too_short' };
  }

  const tenant = await getTenantSettings(tenantId);
  if (tenant.settings.autoSendHighConfidence === false) {
    return { ok: false, reason: 'tenant_auto_send_disabled' };
  }

  const threshold = Number(tenant.autoSendThreshold) || 0.9;
  if (conf < threshold) {
    return { ok: false, reason: 'below_threshold' };
  }

  const rowConf = emailRow.confidence != null ? Number(emailRow.confidence) : null;
  if (rowConf != null && Number.isFinite(rowConf) && rowConf < threshold) {
    return { ok: false, reason: 'stored_confidence_below_threshold' };
  }

  return { ok: true, reason: 'ok' };
}

module.exports = {
  evaluateWebhookAutoSend,
  isWebhookAutoSendEnabled,
  BLOCK_AUTO_FLAGS,
};
