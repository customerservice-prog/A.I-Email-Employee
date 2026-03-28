#!/usr/bin/env node
/**
 * Applies pending SQL files from db/migrations/ in lexical order.
 * Tracks applied files in schema_migrations. Use for incremental production changes
 * after the initial db/schema.sql + db/seed.sql (npm run db:setup).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { applySqlFile } = require('./sqlApply');
const { pool, ensureReady, hasDatabase } = require('../db/connection');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

async function ensureMigrationsTable() {
  await ensureReady();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function main() {
  if (!hasDatabase()) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }

  await ensureMigrationsTable();

  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('No db/migrations directory; nothing to run.');
    return;
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No .sql files in db/migrations; nothing to run.');
    return;
  }

  for (const file of files) {
    const applied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [file]
    );
    if (applied.rowCount > 0) {
      console.log(`Skip (already applied): ${file}`);
      continue;
    }

    const rel = path.join('db', 'migrations', file);
    console.log(`Applying migration: ${file}`);
    const { method } = await applySqlFile(rel);
    console.log(`  via ${method}`);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [
      file,
    ]);
  }

  console.log('Migrations complete.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
