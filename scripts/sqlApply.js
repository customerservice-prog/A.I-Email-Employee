const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  usePglite,
  execSqlScript,
  pool,
  ensureReady,
} = require('../db/connection');

/**
 * Apply a single .sql file using the most reliable method available.
 * - PGlite: full-script exec (handles DO $$ blocks).
 * - PostgreSQL: prefers `psql -f` so multi-statement scripts and PL/pgSQL always work;
 *   falls back to pool.query when psql is missing or fails (may error on some scripts).
 *
 * @param {string} relFromRepoRoot e.g. 'db/schema.sql'
 * @returns {Promise<{ method: string }>}
 */
async function applySqlFile(relFromRepoRoot) {
  const full = path.resolve(__dirname, '..', relFromRepoRoot);
  if (!fs.existsSync(full)) {
    throw new Error(`SQL file not found: ${full}`);
  }
  const sql = fs.readFileSync(full, 'utf8');

  await ensureReady();

  if (usePglite()) {
    await execSqlScript(sql);
    return { method: 'pglite_exec' };
  }

  const dbUrl = process.env.DATABASE_URL;
  const skipPsql =
    String(process.env.SQL_APPLY_SKIP_PSQL || '').toLowerCase() === 'true';

  if (!skipPsql && dbUrl) {
    const ps = tryPsql(dbUrl, full);
    if (ps.ok) {
      return { method: 'psql' };
    }
    console.warn(
      `[sqlApply] psql failed or unavailable (${ps.stderr}); falling back to pg pool (multi-statement scripts may fail).`
    );
  }

  await pool.query(sql);
  return { method: 'pg_pool_query' };
}

/**
 * @param {string} databaseUrl
 * @param {string} absoluteSqlPath
 */
function tryPsql(databaseUrl, absoluteSqlPath) {
  const psql = process.env.PSQL_PATH || 'psql';
  const r = spawnSync(
    psql,
    [databaseUrl, '-v', 'ON_ERROR_STOP=1', '-f', absoluteSqlPath],
    {
      encoding: 'utf8',
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  if (r.status !== 0) {
    const stderr =
      (r.stderr && String(r.stderr)) ||
      (r.error && r.error.message) ||
      `exit ${r.status}`;
    return { ok: false, stderr };
  }
  return { ok: true };
}

module.exports = { applySqlFile, tryPsql };
