#!/usr/bin/env node
/**
 * Applies db/schema.sql and db/seed.sql using sqlApply (PGlite exec, or psql -f, or pool fallback).
 */
require('dotenv').config();
const { applySqlFile } = require('./sqlApply');
const { hasDatabase } = require('../db/connection');

async function main() {
  if (!hasDatabase()) {
    console.error('DATABASE_URL is not set (use pglite for embedded Postgres).');
    process.exit(1);
  }
  for (const file of ['db/schema.sql', 'db/seed.sql']) {
    const { method } = await applySqlFile(file);
    console.log(`Applied ${file} (${method})`);
  }
  console.log('Database setup complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
