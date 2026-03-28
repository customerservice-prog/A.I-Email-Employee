# Seeded test accounts (local / QA)

Run on your machine (uses root `.env` / `DATABASE_URL`):

```bash
npm run db:seed-test-users
```

Default password for **all** accounts below: **`TestPass123!`** (10+ characters; meets validation).

Override batch size or password with env:

- `INBOXPILOT_TEST_USERS_COUNT` — default `10`, max `50`
- `INBOXPILOT_TEST_USERS_PASSWORD` — default `TestPass123!`

| # | Email | Notes |
|---|--------|--------|
| 1 | `testuser1@inboxpilot.test` | First seeded user uses tenant **`default`** if it exists (shared with seed data). |
| 2 | `testuser2@inboxpilot.test` | Own workspace tenant (`t_…`). |
| 3 | `testuser3@inboxpilot.test` | Own workspace tenant. |
| 4 | `testuser4@inboxpilot.test` | Own workspace tenant. |
| 5 | `testuser5@inboxpilot.test` | Own workspace tenant. |
| 6 | `testuser6@inboxpilot.test` | Own workspace tenant. |
| 7 | `testuser7@inboxpilot.test` | Own workspace tenant. |
| 8 | `testuser8@inboxpilot.test` | Own workspace tenant. |
| 9 | `testuser9@inboxpilot.test` | Own workspace tenant. |
| 10 | `testuser10@inboxpilot.test` | Own workspace tenant. |

**Do not** run this against production databases. **Rotate or remove** these users before any real customer data lives in the same DB.

Sign in at `http://localhost:3000/login` (with `npm run dev`). If `INBOXPILOT_API_SECRET` is set, add the same value as `VITE_INBOXPILOT_API_SECRET` in `client/.env.local`.
