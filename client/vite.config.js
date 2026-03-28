import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

/**
 * Read a simple KEY=value from repo-root .env (dev convenience; Vite does not load parent .env by default).
 */
function peekEnvVar(envPath, key) {
  try {
    const raw = fs.readFileSync(envPath, 'utf8');
    const re = new RegExp(`^${key}\\s*=\\s*([^#\\r\\n]+)`, 'm');
    const m = raw.match(re);
    if (!m) return '';
    return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    return '';
  }
}

export default defineConfig(() => {
  const rootEnv = path.join(repoRoot, '.env');
  const port = peekEnvVar(rootEnv, 'PORT') || '3001';
  const proxyTarget =
    peekEnvVar(rootEnv, 'VITE_API_PROXY_TARGET') || `http://127.0.0.1:${port}`;

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': { target: proxyTarget, changeOrigin: true },
        '/health': { target: proxyTarget, changeOrigin: true },
        '/ready': { target: proxyTarget, changeOrigin: true },
      },
    },
  };
});
