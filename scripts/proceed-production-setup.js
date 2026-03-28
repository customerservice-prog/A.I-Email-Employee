#!/usr/bin/env node
/**
 * Local "proceed" setup: strong API secret; optional Docker Postgres + db:setup/migrate.
 *
 *   npm run setup:proceed
 *   node scripts/proceed-production-setup.js --dry-run
 *   node scripts/proceed-production-setup.js --skip-docker
 *
 * Without Docker: keeps DATABASE_URL (e.g. pglite) and still runs **npm run db:migrate**
 * so schema_migrations apply. Sets ALLOW_LOCALHOST_API_WITHOUT_KEY=true when APP_BASE_URL is localhost.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('node:crypto');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const envPath = path.join(root, '.env');

const DOCKER_DB_URL =
  'postgresql://inboxpilot:inboxpilot_dev@127.0.0.1:54329/inboxpilot';

function runCmd(command, args, extraEnv) {
  const isWin = process.platform === 'win32';
  const cmd = isWin && command === 'npm' ? 'npm.cmd' : command;
  return spawnSync(cmd, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });
}

function parseArgs() {
  const a = process.argv.slice(2);
  return {
    dryRun: a.includes('--dry-run'),
    skipDocker: a.includes('--skip-docker'),
    skipDb: a.includes('--skip-db'),
  };
}

function generateSecret() {
  return crypto.randomBytes(32).toString('base64url');
}

function readEnvMap(text) {
  const m = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match) m.set(match[1], match[2]);
  }
  return m;
}

function mergeEnvFile(originalText, updates) {
  const keysToSet = new Set(Object.keys(updates));
  const lines = originalText.split(/\r?\n/);
  const written = new Set();
  const out = [];

  for (const line of lines) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match && keysToSet.has(match[1])) {
      out.push(`${match[1]}=${updates[match[1]]}`);
      written.add(match[1]);
    } else {
      out.push(line);
    }
  }

  for (const key of Object.keys(updates)) {
    if (!written.has(key)) {
      out.push(`${key}=${updates[key]}`);
    }
  }

  let text = out.join('\n');
  if (!text.endsWith('\n')) text += '\n';
  return text;
}

function runDockerCompose(args) {
  const r = spawnSync('docker', ['compose', ...args], {
    cwd: root,
    stdio: 'ignore',
    env: process.env,
  });
  return r.status === 0;
}

function runNpm(scriptArgs, extraEnv) {
  const r = runCmd('npm', scriptArgs, { ...process.env, ...extraEnv });
  return r.status === 0;
}

const MIN_SECRET_LEN = 24;

async function main() {
  const { dryRun, skipDocker, skipDb } = parseArgs();

  const existingText = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8')
    : '';
  const existing = readEnvMap(existingText);

  const prevSecret = (existing.get('INBOXPILOT_API_SECRET') || '').trim();
  const secret =
    process.env.INBOXPILOT_API_SECRET_GENERATED ||
    (prevSecret.length >= MIN_SECRET_LEN ? prevSecret : generateSecret());

  const appBase = existing.get('APP_BASE_URL') || 'http://localhost:3042';
  const updates = {
    DATABASE_SSL: existing.get('DATABASE_SSL') || 'false',
    APP_BASE_URL: appBase,
  };
  if (
    prevSecret.length < MIN_SECRET_LEN ||
    process.env.INBOXPILOT_API_SECRET_GENERATED
  ) {
    updates.INBOXPILOT_API_SECRET = secret;
  }
  if (
    /localhost|127\.0\.0\.1/i.test(appBase) &&
    existing.get('ALLOW_LOCALHOST_API_WITHOUT_KEY') === undefined
  ) {
    updates.ALLOW_LOCALHOST_API_WITHOUT_KEY = 'true';
  }

  let dockerOk = false;
  if (!skipDocker) {
    dockerOk = runDockerCompose(['up', '-d', 'postgres']);
    if (!dockerOk) {
      console.warn(
        'Docker Compose failed or Docker not installed. Keeping existing DATABASE_URL. Install Docker Desktop, then run this script again.'
      );
    }
  }

  if (dockerOk) {
    updates.DATABASE_URL = DOCKER_DB_URL;
  }

  console.log(
    JSON.stringify({
      msg: 'proceed_production_setup',
      dryRun,
      dockerOk,
      databaseUrlSet: Boolean(updates.DATABASE_URL),
      apiSecretLength: (updates.INBOXPILOT_API_SECRET || prevSecret).length,
    })
  );

  if (dryRun) {
    console.log('\nDry run. Would apply:', Object.keys(updates).join(', '));
    return;
  }

  const merged = mergeEnvFile(existingText || '\n', updates);
  fs.writeFileSync(envPath, merged, 'utf8');
  console.log(`Updated ${path.relative(root, envPath)}`);

  if (!skipDb && dockerOk) {
    const envDb = { DATABASE_URL: DOCKER_DB_URL };
    console.log('Running npm run db:setup …');
    const dbOk = runNpm(['run', 'db:setup'], envDb);
    if (!dbOk) {
      console.warn('db:setup failed.');
    } else {
      console.log('Running npm run db:migrate …');
      runNpm(['run', 'db:migrate'], envDb);
    }
  } else if (!skipDb && !dockerOk) {
    console.log(
      'No Docker — running npm run db:migrate against your .env DATABASE_URL (e.g. pglite) …'
    );
    runNpm(['run', 'db:migrate'], {});
  }

  console.log('\n--- Done ---');
  console.log(
    '• API: on localhost, ALLOW_LOCALHOST_API_WITHOUT_KEY=true skips the secret header; otherwise use x-inboxpilot-key.'
  );
  console.log('• Dashboard: sign in via /api/auth (session cookie).');
  console.log('• Add NYLAS_* keys in .env when ready.');
  console.log('• Hosted production: docs/DEPLOY.md\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
