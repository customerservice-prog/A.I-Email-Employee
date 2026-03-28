/** Shown when the model returns nothing — must never be auto-sent as a real reply. */
const FALLBACK_DRAFT_BODY =
  'Thanks for your message — our team will follow up shortly with the details.';

const MIN_AUTO_SEND_DRAFT_CHARS = 48;

function normalizeDraftForCompare(s) {
  return String(s || '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function isPlaceholderOrUnsafeDraft(text) {
  const t = String(text || '').trim();
  if (t.length < MIN_AUTO_SEND_DRAFT_CHARS) return true;
  if (normalizeDraftForCompare(t) === normalizeDraftForCompare(FALLBACK_DRAFT_BODY)) {
    return true;
  }
  return false;
}

module.exports = {
  FALLBACK_DRAFT_BODY,
  MIN_AUTO_SEND_DRAFT_CHARS,
  isPlaceholderOrUnsafeDraft,
};
