/**
 * If client/dist is missing, run `npm run build` so /login and other SPA routes work
 * when only the API process is started (no stale dashboard fallback).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const indexHtml = path.join(__dirname, '..', 'client', 'dist', 'index.html');
if (fs.existsSync(indexHtml)) {
  process.exit(0);
}

console.log(
  '[InboxPilot] client/dist missing — building the dashboard (npm run build)...'
);
const root = path.join(__dirname, '..');
const r = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  cwd: root,
  shell: true,
});
process.exit(r.status === null ? 1 : r.status);
