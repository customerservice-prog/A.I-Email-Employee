/**
 * Best-effort redaction for log fields that might echo env or provider payloads.
 */
function redactString(s) {
  if (typeof s !== 'string' || !s) return s;
  return s
    .replace(/\bsk-[a-zA-Z0-9]{10,}\b/g, 'sk-***')
    .replace(/\bBearer\s+[a-zA-Z0-9._-]{10,}\b/gi, 'Bearer ***')
    .replace(/postgresql:\/\/[^:\s]+:[^@\s]+@/gi, 'postgresql://***:***@');
}

function redactForLog(value) {
  if (typeof value === 'string') return redactString(value);
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    try {
      return JSON.parse(redactString(JSON.stringify(value)));
    } catch {
      return '[object]';
    }
  }
  return value;
}

module.exports = { redactString, redactForLog };
