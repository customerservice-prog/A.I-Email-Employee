# InboxPilot launch checklist

Use this with your hosting provider’s secret manager. Never commit real credentials.

## Before first production deploy

1. **Database** — Postgres only in production (`DATABASE_URL`). Run `npm run db:prepare` on a fresh DB, then `npm run db:migrate` on every release.
2. **API secret** — `INBOXPILOT_API_SECRET` (see `npm run gen:api-secret`). Required in production; clients send `x-inboxpilot-key` or `Authorization: Bearer`. For the Vite/React UI, set `VITE_INBOXPILOT_API_SECRET` to the **same** value at build time (`client/.env.production.local` or your CI env).
3. **HTTPS** — Set `APP_BASE_URL` to your public API URL, `COOKIE_SECURE=true`, and `TRUST_PROXY=true` if TLS terminates at a proxy.
4. **Sessions** — Dashboard auth uses the `inboxpilot_session` cookie; CORS must allow your UI origin (`CORS_ORIGINS` if needed).
5. **Nylas** — `NYLAS_API_KEY`, `NYLAS_WEBHOOK_SECRET`, per-tenant grants via Connect (`NYLAS_CLIENT_ID`, callback `…/api/auth/nylas/callback`). Webhook URL: `https://<api-host>/api/webhook`.
6. **Multi-tenant webhooks** — Set `WEBHOOK_DENY_UNKNOWN_GRANT=true` when each customer has their own grant. Every tenant row must have `nylas_grant_id` set or their events are skipped (by design).
7. **OpenAI** — `OPENAI_API_KEY`; tune `AUTO_SEND_THRESHOLD` and keep `AUTO_SEND_FROM_WEBHOOK=false` until KB and auto-send are verified.
8. **Password reset email** — Set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` so `POST /api/auth/forgot-password` can send links. Without SMTP, production still returns a generic success message (no account enumeration); operators must use other recovery paths.
9. **Observability** — Optional `SENTRY_DSN`. Server logs structured events (webhook, classify, send, errors).

## Automated tests (CI)

```bash
npm run test:all
```

## Manual tests you still must run

- Two real accounts: different KBs, different inboxes, confirm **no** shared emails, KB files, or settings.
- Live inbound/outbound mail, threading, and **no duplicate sends** on webhook retries.
- DNS: SPF/DKIM for your sending domain.
- Forgot-password flow with SMTP enabled (inbox receives link; link completes reset).

## Operational notes

- **Machine API key** (`INBOXPILOT_MACHINE_KEY`) is for automation only; blocked in production unless `ALLOW_MACHINE_API_KEY=true`.
- **Backups** — Enable Postgres backups at the provider; this app does not replace them.
