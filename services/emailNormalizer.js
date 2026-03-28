const { convert } = require('html-to-text');

/**
 * Strip common email reply prefixes and quoted thread tails.
 * @param {string} text
 */
function stripQuotedThread(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  for (const line of lines) {
    if (/^>+\s?/.test(line)) continue;
    if (
      /^On .+ wrote:$/i.test(line) ||
      /^Am .+ schrieb.*:$/i.test(line) ||
      /^-----Original Message-----$/i.test(line)
    ) {
      break;
    }
    out.push(line);
  }
  return out.join('\n').trim();
}

/**
 * Convert HTML or messy text to a clean customer message for ML pipelines.
 * @param {string} raw
 * @param {{ subject?: string }} [meta]
 */
function normalizeInboundBody(raw, meta = {}) {
  const input = raw == null ? '' : String(raw);
  let text = input.trim();

  if (/<[a-z][\s\S]*>/i.test(text)) {
    try {
      text = convert(text, {
        wordwrap: 130,
        selectors: [
          { selector: 'a', options: { ignoreHref: true } },
          { selector: 'img', format: 'skip' },
        ],
      });
    } catch {
      text = input.replace(/<[^>]+>/g, ' ');
    }
  }

  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = stripQuotedThread(text);
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  if (!text && meta.subject) {
    text = String(meta.subject).trim();
  }

  return text;
}

module.exports = { normalizeInboundBody, stripQuotedThread };
