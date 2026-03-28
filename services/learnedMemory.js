const crypto = require('node:crypto');
const { pool } = require('../db/connection');
const { tokenize, scoreChunk } = require('./knowledgeRetrieval');

const MAX_SCAN = 350;

function memoryGloballyDisabled() {
  return String(process.env.INBOXPILOT_LEARNED_MEMORY || '').trim() === '0';
}

function chunkIdsKey(ids) {
  if (!ids || ids.length === 0) return '__empty__';
  return [...ids]
    .map((n) => String(n))
    .sort((a, b) => Number(a) - Number(b))
    .join(',');
}

function buildSignature(subject, body) {
  const s = `${String(subject || '').trim()}\n${String(body || '').trim()}`;
  return s.slice(0, 8000);
}

function signatureHash(tenantId, chunkKey, signature) {
  return crypto
    .createHash('sha256')
    .update(`${tenantId}\0${chunkKey}\0${signature}`, 'utf8')
    .digest('hex');
}

function thresholdsForRow(source) {
  const minScore = parseInt(process.env.INBOXPILOT_MEMORY_MIN_SCORE || '10', 10);
  const minRatio = parseFloat(process.env.INBOXPILOT_MEMORY_MIN_RATIO || '0.32');
  const humanExtra = parseInt(
    process.env.INBOXPILOT_MEMORY_HUMAN_MIN_SCORE_EXTRA || '4',
    10
  );
  const abs = source === 'human_send' ? minScore + humanExtra : minScore;
  return { minScore: abs, minRatio };
}

function passesThreshold(score, uniqueLen, source) {
  if (uniqueLen < 5) return false;
  const { minScore, minRatio } = thresholdsForRow(source);
  if (score < minScore) return false;
  if (score / uniqueLen < minRatio) return false;
  return true;
}

/**
 * @param {string} tenantId
 * @param {string} subject
 * @param {string} body
 * @param {number[]} chunkIds
 * @param {{ regenerate?: boolean }} opts
 * @returns {Promise<{ draft: string, rowId: number } | null>}
 */
async function findLearnedDraft(tenantId, subject, body, chunkIds, opts = {}) {
  if (memoryGloballyDisabled() || !pool || opts.regenerate) return null;

  const signature = buildSignature(subject, body);
  const haystack = `${subject || ''}\n${body || ''}`;
  const emailTokens = [...new Set(tokenize(haystack))].slice(0, 80);
  const chunkKey = chunkIdsKey(chunkIds);

  let rows;
  try {
    const r = await pool.query(
      `SELECT id, signature_text, draft_body, source
       FROM learned_reply_memory
       WHERE tenant_id = $1 AND (chunk_ids_key = $2 OR source = 'human_send')
       ORDER BY last_used_at DESC NULLS LAST, hit_count DESC
       LIMIT $3`,
      [tenantId, chunkKey, MAX_SCAN]
    );
    rows = r.rows;
  } catch {
    return null;
  }

  let best = null;
  for (const row of rows) {
    const score = scoreChunk(emailTokens, row.signature_text);
    if (!passesThreshold(score, emailTokens.length, row.source)) continue;
    if (!best || score > best.score) {
      best = {
        score,
        id: row.id,
        draft: row.draft_body,
        source: row.source,
      };
    }
  }

  if (!best) return null;

  try {
    await pool.query(
      `UPDATE learned_reply_memory
       SET hit_count = hit_count + 1, last_used_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [best.id]
    );
  } catch {
    /* ignore */
  }

  return { draft: best.draft, rowId: best.id };
}

/**
 * @param {string} tenantId
 * @param {string} subject
 * @param {string} body
 * @param {number[]} chunkIds
 * @param {string} draftBody
 * @param {'openai' | 'human_send'} source
 */
async function saveLearnedDraft(
  tenantId,
  subject,
  body,
  chunkIds,
  draftBody,
  source = 'openai'
) {
  if (memoryGloballyDisabled() || !pool) return;
  const signature = buildSignature(subject, body);
  const chunkKey =
    source === 'human_send' ? 'human_send' : chunkIdsKey(chunkIds);
  const hash = signatureHash(tenantId, chunkKey, signature);
  const text = String(draftBody || '').trim();
  if (!text) return;

  try {
    await pool.query(
      `INSERT INTO learned_reply_memory (
         tenant_id, signature_hash, signature_text, chunk_ids_key, draft_body, source, hit_count, last_used_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 0, NOW(), NOW())
       ON CONFLICT (tenant_id, signature_hash, chunk_ids_key)
       DO UPDATE SET
         draft_body = EXCLUDED.draft_body,
         signature_text = EXCLUDED.signature_text,
         source = EXCLUDED.source,
         updated_at = NOW()`,
      [tenantId, hash, signature, chunkKey, text, source]
    );
  } catch {
    /* table may not exist until migrate */
  }
}

/**
 * @param {string} tenantId
 * @param {string} subject
 * @param {string} body
 * @param {number[]} chunkIds
 * @returns {Promise<object | null>} scored classification fields (no track yet)
 */
async function findLearnedClassification(tenantId, subject, body, chunkIds) {
  if (memoryGloballyDisabled() || !pool) return null;

  const signature = buildSignature(subject, body);
  const haystack = `${subject || ''}\n${body || ''}`;
  const emailTokens = [...new Set(tokenize(haystack))].slice(0, 80);
  const chunkKey = chunkIdsKey(chunkIds);

  let rows;
  try {
    const r = await pool.query(
      `SELECT id, signature_text, confidence, flags, reasoning
       FROM learned_classification_memory
       WHERE tenant_id = $1 AND chunk_ids_key = $2
       ORDER BY last_used_at DESC NULLS LAST, hit_count DESC
       LIMIT $3`,
      [tenantId, chunkKey, MAX_SCAN]
    );
    rows = r.rows;
  } catch {
    return null;
  }

  let best = null;
  for (const row of rows) {
    const score = scoreChunk(emailTokens, row.signature_text);
    if (!passesThreshold(score, emailTokens.length, 'openai')) continue;
    if (!best || score > best.score) {
      best = {
        score,
        id: row.id,
        confidence: Number(row.confidence),
        flags: Array.isArray(row.flags) ? row.flags : [],
        reasoning: row.reasoning || '',
      };
    }
  }

  if (!best) return null;

  try {
    await pool.query(
      `UPDATE learned_classification_memory
       SET hit_count = hit_count + 1, last_used_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [best.id]
    );
  } catch {
    /* ignore */
  }

  return {
    confidence: best.confidence,
    flags: best.flags.map(String),
    reasoning: best.reasoning,
    malformed: false,
  };
}

/**
 * @param {string} tenantId
 * @param {string} subject
 * @param {string} body
 * @param {number[]} chunkIds
 * @param {object} scored normalizeClassification output shape
 */
async function saveLearnedClassification(
  tenantId,
  subject,
  body,
  chunkIds,
  scored
) {
  if (memoryGloballyDisabled() || !pool) return;
  if (!scored || scored.malformed) return;

  const signature = buildSignature(subject, body);
  const chunkKey = chunkIdsKey(chunkIds);
  const hash = signatureHash(tenantId, chunkKey, signature);

  try {
    await pool.query(
      `INSERT INTO learned_classification_memory (
         tenant_id, signature_hash, signature_text, chunk_ids_key,
         confidence, flags, reasoning, hit_count, last_used_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, 0, NOW(), NOW())
       ON CONFLICT (tenant_id, signature_hash, chunk_ids_key)
       DO UPDATE SET
         confidence = EXCLUDED.confidence,
         flags = EXCLUDED.flags,
         reasoning = EXCLUDED.reasoning,
         signature_text = EXCLUDED.signature_text,
         updated_at = NOW()`,
      [
        tenantId,
        hash,
        signature,
        chunkKey,
        scored.confidence,
        JSON.stringify(scored.flags || []),
        (scored.reasoning || '').slice(0, 500),
      ]
    );
  } catch {
    /* ignore */
  }
}

module.exports = {
  chunkIdsKey,
  buildSignature,
  findLearnedDraft,
  saveLearnedDraft,
  findLearnedClassification,
  saveLearnedClassification,
  memoryGloballyDisabled,
};
