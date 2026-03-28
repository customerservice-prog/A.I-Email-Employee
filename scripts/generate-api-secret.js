#!/usr/bin/env node
/**
 * Prints a URL-safe random secret for INBOXPILOT_API_SECRET (32 bytes → ~43 chars base64url).
 */
const crypto = require('node:crypto');

const secret = crypto.randomBytes(32).toString('base64url');
process.stdout.write(`${secret}\n`);
process.stderr.write(
  '\nAdd to your host secrets / .env (production):\n' +
    `INBOXPILOT_API_SECRET=${secret}\n\n` +
    'Send on API requests: header x-inboxpilot-key or Authorization: Bearer <secret>\n'
);
