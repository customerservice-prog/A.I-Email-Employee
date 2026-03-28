const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../db/connection');

const KB_ROOT = path.join(__dirname, '..', 'kb');
const UPLOADS_ROOT = path.join(KB_ROOT, 'uploads');

function sanitizeFilename(name) {
  const base = path.basename(name || 'upload');
  return base.replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function ensureTenantUploadDir(tenantId) {
  const dir = path.join(UPLOADS_ROOT, tenantId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * @param {string} text
 * @param {number} [maxLen]
 */
function chunkText(text, maxLen = 720) {
  const t = (text || '').trim();
  if (!t) return [];
  const parts = [];
  const paras = t.split(/\n\n+/);
  let cur = '';
  for (const p of paras) {
    const piece = cur ? `${cur}\n\n${p}` : p;
    if (piece.length <= maxLen) {
      cur = piece;
    } else {
      if (cur) parts.push(cur.trim());
      if (p.length > maxLen) {
        for (let i = 0; i < p.length; i += maxLen) {
          parts.push(p.slice(i, i + maxLen).trim());
        }
        cur = '';
      } else {
        cur = p;
      }
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.filter(Boolean);
}

/**
 * @param {Buffer} buffer
 * @param {string} [mimetype]
 * @param {string} [originalname]
 */
async function extractTextFromBuffer(buffer, mimetype, originalname) {
  const ext = path.extname(originalname || '').toLowerCase();
  if (ext === '.pdf' || mimetype === 'application/pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      return (data.text || '').trim();
    } catch (e) {
      throw new Error(`PDF parse failed: ${e.message}`);
    }
  }
  const textLikeExt = ['.txt', '.csv', '.md'].includes(ext);
  const mime = (mimetype || '').toLowerCase();
  const textLikeMime =
    mime.startsWith('text/') ||
    mime === 'application/csv' ||
    mime === 'text/csv' ||
    mime === 'text/markdown';

  if (textLikeExt && (textLikeMime || !mime || mime === 'application/octet-stream')) {
    return buffer.toString('utf8');
  }

  throw new Error(
    'Unsupported or disallowed file type (allowed: PDF, CSV, TXT, MD)'
  );
}

/**
 * Strip server paths from API responses (defense in depth).
 */
function toPublicKbFile(row) {
  if (!row) return row;
  const { stored_path: _sp, ...rest } = row;
  return rest;
}

async function replaceChunksForFile(tenantId, kbFileId, chunks) {
  if (!pool) return;
  await pool.query(`DELETE FROM kb_chunks WHERE kb_file_id = $1`, [kbFileId]);
  for (let i = 0; i < chunks.length; i++) {
    await pool.query(
      `INSERT INTO kb_chunks (tenant_id, kb_file_id, chunk_index, content)
       VALUES ($1, $2, $3, $4)`,
      [tenantId, kbFileId, i, chunks[i]]
    );
  }
  await pool.query(
    `UPDATE kb_files SET chunk_count = $2 WHERE id = $1`,
    [kbFileId, chunks.length]
  );
}

/**
 * @param {import('multer').File} file
 * @param {string} tenantId
 */
async function uploadKBFile(file, tenantId) {
  if (!pool) {
    throw new Error('Database not configured');
  }
  if (!file || !file.buffer) {
    throw new Error('No file uploaded');
  }

  const filename = sanitizeFilename(file.originalname);
  const dir = await ensureTenantUploadDir(tenantId);
  const storedPath = path.join(dir, filename);
  await fs.writeFile(storedPath, file.buffer);

  const ins = await pool.query(
    `INSERT INTO kb_files (
        tenant_id, filename, stored_path, mime_type, file_size_bytes,
        chunk_count, source, processing_status
      )
      VALUES ($1, $2, $3, $4, $5, 0, 'upload', 'processing')
      RETURNING *`,
    [
      tenantId,
      filename,
      storedPath,
      file.mimetype || null,
      file.buffer.length,
    ]
  );
  const row = ins.rows[0];

  try {
    const extracted = await extractTextFromBuffer(
      file.buffer,
      file.mimetype,
      file.originalname
    );
    const chunks = chunkText(extracted);
    await replaceChunksForFile(tenantId, row.id, chunks);
    await pool.query(
      `UPDATE kb_files SET processing_status = 'ready', chunk_count = $2 WHERE id = $1`,
      [row.id, chunks.length]
    );
  } catch (e) {
    await pool.query(
      `UPDATE kb_files SET processing_status = 'failed', chunk_count = 0 WHERE id = $1`,
      [row.id]
    );
    throw e;
  }

  const updated = await pool.query(`SELECT * FROM kb_files WHERE id = $1`, [
    row.id,
  ]);
  return updated.rows[0];
}

async function listKBFilesForTenant(tenantId) {
  if (!pool) {
    return [];
  }
  try {
    const result = await pool.query(
      `SELECT id, tenant_id, filename, stored_path, mime_type, file_size_bytes,
              chunk_count, source, processing_status, created_at
       FROM kb_files
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId]
    );
    return result.rows;
  } catch {
    return [];
  }
}

async function readFileIfText(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.txt', '.csv', '.md'].includes(ext)) {
    return null;
  }
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function readSharedKbFromDisk() {
  const chunks = [];
  try {
    const names = await fs.readdir(KB_ROOT);
    for (const name of names) {
      if (!name.endsWith('.txt') && !name.endsWith('.csv')) continue;
      const full = path.join(KB_ROOT, name);
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      const text = await readFileIfText(full);
      if (text) {
        chunks.push(`--- ${name} ---\n${text}`);
      }
    }
  } catch {
    // kb root missing
  }
  return chunks.join('\n\n').trim();
}

async function readTenantUploadsFromDisk(tenantId) {
  const chunks = [];
  const tenantDir = path.join(UPLOADS_ROOT, tenantId);
  try {
    const uploaded = await fs.readdir(tenantDir);
    for (const name of uploaded) {
      const full = path.join(tenantDir, name);
      const stat = await fs.stat(full);
      if (!stat.isFile()) continue;
      const text = await readFileIfText(full);
      if (text) {
        chunks.push(`--- upload:${name} ---\n${text}`);
      }
    }
  } catch {
    // no uploads
  }
  return chunks.join('\n\n').trim();
}

async function readKnowledgeFromDatabaseRows(tenantId) {
  const rows = await listKBFilesForTenant(tenantId);
  if (!rows.length) {
    return '';
  }
  const chunks = [];
  for (const row of rows) {
    const text = await readFileIfText(row.stored_path);
    if (text) {
      chunks.push(`--- ${row.filename} ---\n${text}`);
    }
  }
  return chunks.join('\n\n').trim();
}

async function getKnowledgeChunksText(tenantId) {
  if (!pool) return '';
  const r = await pool.query(
    `SELECT content FROM kb_chunks
     WHERE tenant_id = $1
     ORDER BY kb_file_id, chunk_index`,
    [tenantId]
  );
  return r.rows.map((x) => x.content).join('\n\n---\n\n');
}

/**
 * Concatenated KB for classification / RAG: DB chunks first, then file bodies, then /kb disk.
 */
async function getKnowledgeBase(tenantId) {
  let fromChunks = '';
  try {
    fromChunks = (await getKnowledgeChunksText(tenantId)).trim();
  } catch {
    fromChunks = '';
  }
  if (fromChunks) {
    return fromChunks;
  }

  let fromDb = '';
  try {
    fromDb = await readKnowledgeFromDatabaseRows(tenantId);
  } catch {
    fromDb = '';
  }

  if (fromDb.trim()) {
    return fromDb.trim();
  }

  const shared = await readSharedKbFromDisk();
  const uploads = await readTenantUploadsFromDisk(tenantId);
  return [shared, uploads].filter(Boolean).join('\n\n').trim();
}

/**
 * Chunks for one file as Q&A-style pairs (first line = label, rest = body).
 * @param {string} tenantId
 * @param {number} fileId
 */
async function getKnowledgeFilePreview(tenantId, fileId) {
  if (!pool) {
    throw new Error('Database not configured');
  }
  const f = await pool.query(
    `SELECT * FROM kb_files WHERE id = $1 AND tenant_id = $2`,
    [fileId, tenantId]
  );
  if (f.rowCount === 0) {
    return null;
  }
  const c = await pool.query(
    `SELECT chunk_index, content FROM kb_chunks
     WHERE kb_file_id = $1 AND tenant_id = $2
     ORDER BY chunk_index`,
    [fileId, tenantId]
  );
  const qa = c.rows.map((row) => {
    const lines = String(row.content).split('\n');
    const head = lines[0]?.trim() || `Entry ${row.chunk_index + 1}`;
    const rest = lines.slice(1).join('\n').trim() || row.content;
    return {
      chunkIndex: row.chunk_index,
      question: head,
      answer: rest,
    };
  });
  return { file: toPublicKbFile(f.rows[0]), entries: qa };
}

async function getKnowledgeContextForTenant(tenantId) {
  return getKnowledgeBase(tenantId);
}

module.exports = {
  uploadKBFile,
  listKBFilesForTenant,
  getKnowledgeBase,
  getKnowledgeContextForTenant,
  getKnowledgeFilePreview,
  chunkText,
  toPublicKbFile,
  UPLOADS_ROOT,
};
