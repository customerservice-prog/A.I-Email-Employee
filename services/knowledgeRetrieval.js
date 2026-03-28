const { pool } = require('../db/connection');
const { getKnowledgeBase } = require('./knowledge');

const MAX_CHUNKS = 12;
const MIN_KB_CHARS_FALLBACK_FULL = 8000;
const MIN_KB_CHARS_HARD_FAIL = 80;

const STOP = new Set(
  'the a an and or to of in for on with at by from as is was are be this that it we you your our their them'.split(
    ' '
  )
);

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

/**
 * Lexical overlap score between email text and chunk.
 * @param {string[]} emailTokens
 * @param {string} chunk
 */
function scoreChunk(emailTokens, chunk) {
  const c = chunk.toLowerCase();
  let s = 0;
  const seen = new Set();
  for (const t of emailTokens) {
    if (seen.has(t)) continue;
    if (c.includes(t)) {
      s += 1;
      seen.add(t);
    }
  }
  return s;
}

/**
 * @param {string} tenantId
 * @param {string} emailText
 * @param {string} subject
 */
async function retrieveKnowledgeContext(tenantId, emailText, subject) {
  const haystack = `${subject || ''}\n${emailText || ''}`;
  const emailTokens = tokenize(haystack);
  const unique = [...new Set(emailTokens)].slice(0, 80);

  let chunks = [];
  if (pool) {
    try {
      const r = await pool.query(
        `SELECT c.id, c.content, c.chunk_index, c.kb_file_id
         FROM kb_chunks c
         INNER JOIN kb_files f ON f.id = c.kb_file_id AND f.tenant_id = c.tenant_id
         WHERE c.tenant_id = $1 AND f.processing_status = 'ready'
         ORDER BY c.kb_file_id, c.chunk_index`,
        [tenantId]
      );
      chunks = r.rows.map((row) => ({
        id: row.id,
        content: row.content,
        score: scoreChunk(unique, row.content),
      }));
    } catch {
      chunks = [];
    }
  }

  chunks.sort((a, b) => b.score - a.score);
  const top = chunks.slice(0, MAX_CHUNKS);
  const selectedText = top.map((c) => c.content).join('\n\n---\n\n');
  const bestScore = top[0]?.score ?? 0;

  const fullFallback = await getKnowledgeBase(tenantId);
  const fullLen = (fullFallback || '').length;

  let insufficient = false;
  if (fullLen < MIN_KB_CHARS_HARD_FAIL) {
    insufficient = true;
  }

  const meaningfulQuery = unique.length >= 5;
  if (
    chunks.length > 0 &&
    bestScore === 0 &&
    meaningfulQuery &&
    fullLen < MIN_KB_CHARS_FALLBACK_FULL
  ) {
    insufficient = true;
  }

  let context = selectedText.trim();
  if (!context || fullLen <= MIN_KB_CHARS_FALLBACK_FULL) {
    context = [context, fullFallback].filter(Boolean).join('\n\n--- GLOBAL KB ---\n\n');
  }

  return {
    context: context.trim(),
    chunkIds: top.map((c) => c.id),
    insufficient,
    usedFullCorpusFallback: fullLen <= MIN_KB_CHARS_FALLBACK_FULL,
    bestChunkScore: bestScore,
  };
}

module.exports = { retrieveKnowledgeContext, tokenize, scoreChunk };
