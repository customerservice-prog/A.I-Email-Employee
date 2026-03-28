require('dotenv').config();
const { ensureReady } = require('../db/connection');
const { registerUser, findUserByEmail } = require('../services/authService');

const PASSWORD = process.env.INBOXPILOT_TEST_USERS_PASSWORD || 'TestPass123!';
const COUNT = Math.min(50, Math.max(1, Number(process.env.INBOXPILOT_TEST_USERS_COUNT) || 10));

async function main() {
  await ensureReady();
  const created = [];
  const skipped = [];
  for (let i = 1; i <= COUNT; i += 1) {
    const email = `testuser${i}@inboxpilot.test`;
    const existing = await findUserByEmail(email);
    if (existing) {
      skipped.push(email);
      continue;
    }
    await registerUser({ email, password: PASSWORD });
    created.push(email);
  }
  console.log('[InboxPilot] Test user seed complete.');
  if (created.length) {
    console.log('Created:', created.join(', '));
  }
  if (skipped.length) {
    console.log('Already existed:', skipped.join(', '));
  }
  console.log(`Password for all seeded accounts: ${PASSWORD}`);
  console.log('[InboxPilot] Reference: docs/TEST_ACCOUNTS.md');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
