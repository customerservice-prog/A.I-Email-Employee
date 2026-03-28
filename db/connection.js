const path = require('path');
const fs = require('fs');

function usePglite() {
  const u = (process.env.DATABASE_URL || '').trim().toLowerCase();
  return u === 'pglite' || u.startsWith('pglite://');
}

/** PGlite + WASM file I/O often fails under synced folders (e.g. OneDrive Desktop); use a local app-data path on Windows. */
function defaultPgliteDataDir() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'inboxpilot-pglite');
  }
  return path.join(__dirname, '.pglite-data');
}

function hasDatabase() {
  const u = (process.env.DATABASE_URL || '').trim();
  return u.length > 0;
}

function normalizeResult(r) {
  if (!r) return r;
  const rowsLen = Array.isArray(r.rows) ? r.rows.length : 0;
  let rowCount = typeof r.rowCount === 'number' ? r.rowCount : undefined;
  // PGlite sometimes reports rowCount 0 on SELECTs that returned rows; prefer rows.length.
  if (rowsLen > 0 && rowCount !== rowsLen) {
    rowCount = rowsLen;
  } else if (rowCount === undefined) {
    rowCount =
      typeof r.affectedRows === 'number' ? r.affectedRows : rowsLen;
  }
  return { ...r, rowCount };
}

let initPromise = null;
let activePool = null;

async function migrateIfNeededPglite(db) {
  const check = await db.query(
    `SELECT 1 AS x FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'tenants' LIMIT 1`
  );
  if (check.rows && check.rows.length > 0) return;
  const root = path.join(__dirname, '..');
  await db.exec(fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(root, 'db/seed.sql'), 'utf8'));
  console.log('Database: applied schema + seed (PGlite)');
}

async function buildPool() {
  if (usePglite()) {
    const { PGlite } = require('@electric-sql/pglite');
    const dataDir = process.env.PGLITE_DATA_DIR || defaultPgliteDataDir();
    const db = await PGlite.create(dataDir);
    await migrateIfNeededPglite(db);
    return {
      _pglite: db,
      query: async (text, params) =>
        normalizeResult(await db.query(text, params)),
    };
  }
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    const pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DATABASE_SSL === 'true'
          ? { rejectUnauthorized: false }
          : undefined,
    });
    return {
      _pgPool: pgPool,
      query: (text, params) => pgPool.query(text, params),
    };
  }
  return null;
}

async function ensureReady() {
  if (!hasDatabase()) {
    activePool = null;
    return null;
  }
  if (!initPromise) {
    initPromise = (async () => {
      activePool = await buildPool();
    })();
  }
  await initPromise;
  return activePool;
}

/**
 * Run a SQL script that may contain multiple statements (schema migrations).
 * PGlite uses exec(); PostgreSQL uses a one-shot pool query (may require psql for complex scripts).
 */
async function execSqlScript(sql) {
  await ensureReady();
  if (!activePool) {
    throw new Error('Database not configured');
  }
  if (activePool._pglite) {
    await activePool._pglite.exec(sql);
    return;
  }
  await activePool._pgPool.query(sql);
}

const pool = {
  query: async (text, params) => {
    await ensureReady();
    if (!activePool) {
      throw new Error('Database not configured');
    }
    return activePool.query(text, params);
  },
};

module.exports = { pool, ensureReady, hasDatabase, usePglite, execSqlScript };
