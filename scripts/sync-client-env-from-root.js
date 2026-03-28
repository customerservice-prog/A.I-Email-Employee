/**
 * Ensures client/.env.local exists and syncs VITE_INBOXPILOT_API_SECRET from root .env
 * when INBOXPILOT_API_SECRET is set. Preserves an existing .env.local (e.g. Google client id).
 * Does not print secrets.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const examplePath = path.join(root, 'client', '.env.example');
const outPath = path.join(root, 'client', '.env.local');

const example = fs.readFileSync(examplePath, 'utf8');
let base = fs.existsSync(outPath)
  ? fs.readFileSync(outPath, 'utf8')
  : example;

const secret = String(process.env.INBOXPILOT_API_SECRET || '').trim();
if (secret) {
  const line = `VITE_INBOXPILOT_API_SECRET=${secret}`;
  if (/^VITE_INBOXPILOT_API_SECRET=/m.test(base)) {
    base = base.replace(/^VITE_INBOXPILOT_API_SECRET=.*$/m, line);
  } else {
    base = `${base.trimEnd()}\n${line}\n`;
  }
} else if (!fs.existsSync(outPath)) {
  base = example;
}

fs.writeFileSync(outPath, base.endsWith('\n') ? base : `${base}\n`, 'utf8');
console.log(
  `[InboxPilot] Updated ${path.relative(root, outPath)}` +
    (secret ? ' (VITE API secret synced from root .env)' : '')
);
