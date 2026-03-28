#!/usr/bin/env node
/**
 * Re-applies db/seed.sql (idempotent inserts) so demo rows appear without wiping the DB.
 */
require('dotenv').config();
const { applySqlFile } = require('./sqlApply');
const { hasDatabase } = require('../db/connection');

async function main() {
  if (!hasDatabase()) {
    console.error('DATABASE_URL is not set (use pglite for embedded Postgres).');
    process.exit(1);
  }
  await applySqlFile('db/seed.sql');
  console.log('Applied db/seed.sql');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
