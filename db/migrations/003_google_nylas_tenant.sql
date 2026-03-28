-- Per-tenant Nylas grant + Google Sign-In users (idempotent)

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nylas_grant_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nylas_connected_email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_nylas_grant_unique
  ON tenants (nylas_grant_id)
  WHERE nylas_grant_id IS NOT NULL;

ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(32) NOT NULL DEFAULT 'password';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub)
  WHERE google_sub IS NOT NULL;
