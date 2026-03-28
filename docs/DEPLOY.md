# Production deployment

## Quick local prep (Windows/macOS/Linux)

With Docker Desktop installed:

```bash
npm run setup:proceed
```

This generates **`INBOXPILOT_API_SECRET`**, starts **`docker compose` Postgres**, sets **`DATABASE_URL`**, and runs **`db:setup`** + **`db:migrate`**. If Docker is missing, it only updates the API secret and leaves **`DATABASE_URL`** as-is (e.g. `pglite`).

## 1. PostgreSQL (not PGlite)

Provision Postgres 14+ (managed or self-hosted). With the repo’s Docker Postgres:

```bash
docker compose up -d postgres
```

Use a connection string that matches your user, password, host, port, and database name, for example:

```env
DATABASE_URL=postgresql://inboxpilot:inboxpilot_dev@localhost:54329/inboxpilot
```

For TLS to a managed provider:

```env
DATABASE_SSL=true
```

## 2. Schema and migrations

Initial load (empty database):

```bash
npm run db:setup
```

Or apply `db/schema.sql` and `db/seed.sql` with `psql` (see README).

For every deploy after that, apply incremental SQL:

```bash
npm run db:migrate
```

Applied files are tracked in the `schema_migrations` table.

## 3. API secret

Generate a strong secret (32 random bytes):

```bash
npm run gen:api-secret
```

Set it in the host environment (never commit real values):

```env
NODE_ENV=production
INBOXPILOT_API_SECRET=<paste generated value>
```

Clients must send `x-inboxpilot-key: <secret>` or `Authorization: Bearer <secret>` on `/api/*` routes (webhooks are excluded). The dashboard UI uses **session cookies** after login (`/api/auth`); the secret is for scripts, mobile, or server-to-server calls.

Optional **automation only** (default off in production): `INBOXPILOT_MACHINE_KEY` + header `x-inboxpilot-machine-key`, gated by `ALLOW_MACHINE_API_KEY=true` when `NODE_ENV=production` (see `middleware/sessionAuth.js`).

## 4. Nylas (live email)

In the Nylas dashboard:

1. Create an application and note **API key** and **grant ID** for the connected mailbox.
2. Configure a **webhook** pointing at `https://<your-api-host>/api/webhook` with a signing secret.

Set:

```env
NYLAS_API_KEY=...
NYLAS_GRANT_ID=...
NYLAS_WEBHOOK_SECRET=...
```

## 5. Public URL, CORS, and proxy

Set the browser-facing origin (HTTPS in production):

```env
APP_BASE_URL=https://app.example.com
```

If the UI calls the API from additional origins, list them (comma-separated):

```env
CORS_ORIGINS=https://admin.example.com,https://staging.example.com
```

Behind nginx, Render, Fly, etc., enable Express “trust proxy” so rate limits and client IP are correct:

```env
TRUST_PROXY=true
```

Terminate TLS at the reverse proxy; the Node process can listen on HTTP internally.

## 6. OpenAI and optional flags

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o
OPENAI_DRAFT_MODEL=gpt-4o
OPENAI_CLASSIFY_MODEL=gpt-4o
```

Optional:

```env
PORT=3042
AUTO_SEND_FROM_WEBHOOK=false
AUTO_SEND_THRESHOLD=0.90
```

## 7. Build and run

```bash
npm ci
npm run build
NODE_ENV=production node server.js
```

Use a process manager (systemd, PM2, container orchestrator) and restart on failure.

## 8. Smoke checks

- `GET /health` — process up.
- `GET /ready` — database, OpenAI, and Nylas env presence (live checks may still fail if keys are invalid).

## 9. Launch checklist

- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL` is Postgres (not `pglite`)
- [ ] `npm run db:migrate` applied on production DB
- [ ] `INBOXPILOT_API_SECRET` set (24+ characters; use `npm run gen:api-secret`)
- [ ] `NYLAS_*` and webhook URL verified with a test event
- [ ] `APP_BASE_URL` matches your HTTPS UI origin; `CORS_ORIGINS` if split domains
- [ ] `TRUST_PROXY=true` if behind a reverse proxy
- [ ] Rotate any API keys that were ever exposed in chat or logs
