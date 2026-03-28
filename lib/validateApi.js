const { STATUS, TRACK } = require('./constants');

const ALLOWED_STATUS = new Set(Object.values(STATUS));
const ALLOWED_TRACK = new Set(Object.values(TRACK));

const ALLOWED_SETTINGS_KEYS = new Set([
  'autoSendHighConfidence',
  'alwaysFlagDiscountRequests',
  'ragOnlyMode',
  'feedbackLoopLearning',
  'learnedMemoryDrafts',
  'learnedMemoryClassification',
]);

const DISPLAY_MODEL_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const EMAIL_MAX = 1024;
const PROVIDER_MAX = 64;

function parsePositiveInt(v, max) {
  const n = parseInt(v, 10);
  if (Number.isNaN(n) || n < 1) return null;
  return Math.min(n, max);
}

function validateEmailListQuery(status, track) {
  if (status != null && status !== '' && !ALLOWED_STATUS.has(String(status))) {
    return { error: 'Invalid status filter' };
  }
  if (track != null && track !== '' && !ALLOWED_TRACK.has(String(track))) {
    return { error: 'Invalid track filter' };
  }
  return null;
}

function sanitizeSettingsPatch(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const out = {};
  for (const k of Object.keys(raw)) {
    if (ALLOWED_SETTINGS_KEYS.has(k) && typeof raw[k] === 'boolean') {
      out[k] = raw[k];
    }
  }
  return out;
}

function validateSettingsPut(body) {
  const patch = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const out = {};

  if (Object.prototype.hasOwnProperty.call(patch, 'businessEmail')) {
    const s = String(patch.businessEmail).trim();
    if (s.length > EMAIL_MAX) {
      return { error: 'businessEmail too long' };
    }
    out.businessEmail = s || null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'provider')) {
    const s = String(patch.provider).trim();
    if (s.length > PROVIDER_MAX) {
      return { error: 'provider too long' };
    }
    out.provider = s || null;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'displayModel')) {
    const s = String(patch.displayModel).trim();
    if (!DISPLAY_MODEL_RE.test(s)) {
      return { error: 'Invalid displayModel' };
    }
    out.displayModel = s;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'autoSendThreshold')) {
    const n = Number(patch.autoSendThreshold);
    if (Number.isNaN(n) || n < 0.5 || n > 1) {
      return { error: 'autoSendThreshold must be between 0.5 and 1' };
    }
    out.autoSendThreshold = n;
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'settings')) {
    out.settings = sanitizeSettingsPatch(patch.settings);
  }

  return { value: out };
}

module.exports = {
  parsePositiveInt,
  validateEmailListQuery,
  validateSettingsPut,
  sanitizeSettingsPatch,
  ALLOWED_STATUS,
  ALLOWED_TRACK,
};
