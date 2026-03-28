/**
 * Plain-text email body hardening: strip tags and obvious script/data URLs.
 * Does not guarantee HTML safety if you later send HTML mail — use a MIME-specific sanitizer then.
 */
function sanitizePlainTextEmailBody(text) {
  let s = String(text ?? '');
  s = s.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  s = s.replace(/<\/?[a-z][^>]*>/gi, '');
  s = s.replace(/javascript:\s*/gi, '');
  s = s.replace(/data:\s*text\/html/gi, 'data_blocked:text/html');
  s = s.replace(/\0/g, '');
  if (s.length > 200_000) {
    s = `${s.slice(0, 200_000)}\n\n[truncated for safety]`;
  }
  return s.trim();
}

module.exports = { sanitizePlainTextEmailBody };
