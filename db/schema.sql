-- InboxPilot production schema + upgrades (idempotent)
-- Run against an empty or existing database.

CREATE TABLE IF NOT EXISTS tenants (
  tenant_key VARCHAR(255) PRIMARY KEY,
  business_email TEXT,
  provider VARCHAR(64),
  display_model VARCHAR(64) NOT NULL DEFAULT 'gpt-4o',
  auto_send_threshold NUMERIC(4, 3) NOT NULL DEFAULT 0.9,
  settings JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS emails (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL DEFAULT 'default',
  external_message_id TEXT,
  thread_id TEXT,
  from_email VARCHAR(1024) NOT NULL,
  to_email VARCHAR(1024) NOT NULL,
  from_display_name TEXT,
  subject TEXT,
  body_raw TEXT,
  body_cleaned TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  track VARCHAR(16) NOT NULL DEFAULT 'review',
  confidence NUMERIC(5, 4),
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  flags JSONB NOT NULL DEFAULT '[]',
  classification_reasoning TEXT,
  draft TEXT,
  draft_previous TEXT,
  final_reply TEXT,
  sent_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_emails_tenant_received ON emails (tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_tenant_status ON emails (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_emails_tenant_track ON emails (tenant_id, track);

CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_tenant_external
  ON emails (tenant_id, external_message_id)
  WHERE external_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS feedback (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL,
  email_id INTEGER REFERENCES emails (id) ON DELETE SET NULL,
  email_subject TEXT,
  original_draft TEXT,
  corrected_draft TEXT,
  editor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_tenant_created ON feedback (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS kb_files (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL,
  filename VARCHAR(512) NOT NULL,
  stored_path TEXT NOT NULL,
  mime_type VARCHAR(255),
  file_size_bytes INTEGER,
  source TEXT NOT NULL DEFAULT 'upload',
  processing_status VARCHAR(24) NOT NULL DEFAULT 'ready',
  chunk_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_files_tenant ON kb_files (tenant_id);

CREATE TABLE IF NOT EXISTS kb_chunks (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL,
  kb_file_id INTEGER NOT NULL REFERENCES kb_files (id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  embeddings_meta JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_tenant ON kb_chunks (tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_file ON kb_chunks (kb_file_id);

CREATE TABLE IF NOT EXISTS send_log (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL,
  email_id INTEGER REFERENCES emails (id) ON DELETE SET NULL,
  nylas_message_id TEXT,
  body_preview TEXT,
  payload_snapshot JSONB,
  provider_response JSONB,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_send_log_tenant_created ON send_log (tenant_id, created_at DESC);

-- Legacy column compatibility
ALTER TABLE emails ADD COLUMN IF NOT EXISTS nylas_message_id VARCHAR(255);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS body TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS external_message_id TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS body_raw TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS body_cleaned TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}';
ALTER TABLE emails ADD COLUMN IF NOT EXISTS draft_previous TEXT;

UPDATE emails SET body_raw = COALESCE(body_raw, body) WHERE body_raw IS NULL;
UPDATE emails SET external_message_id = COALESCE(external_message_id, nylas_message_id)
  WHERE external_message_id IS NULL AND nylas_message_id IS NOT NULL;
UPDATE emails SET received_at = COALESCE(received_at, created_at) WHERE received_at IS NULL;

UPDATE emails SET track = 'auto' WHERE track = 'auto_pilot';
UPDATE emails SET track = 'review' WHERE track = 'human_loop';
UPDATE emails SET status = 'pending' WHERE status = 'pending_review';

ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'upload';
ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS processing_status VARCHAR(24) NOT NULL DEFAULT 'ready';
ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS file_size_bytes INTEGER;
ALTER TABLE kb_files ADD COLUMN IF NOT EXISTS chunk_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE kb_chunks ADD COLUMN IF NOT EXISTS embeddings_meta JSONB NOT NULL DEFAULT '{}';

ALTER TABLE send_log ADD COLUMN IF NOT EXISTS payload_snapshot JSONB;
ALTER TABLE send_log ADD COLUMN IF NOT EXISTS provider_response JSONB;
ALTER TABLE send_log ADD COLUMN IF NOT EXISTS success BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS editor_id TEXT;

DO $$
BEGIN
  ALTER TABLE emails ADD CONSTRAINT emails_track_chk CHECK (track IN ('auto', 'review'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE emails ADD CONSTRAINT emails_status_chk CHECK (status IN ('pending', 'sent', 'escalated', 'failed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE emails ADD CONSTRAINT emails_confidence_chk CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE kb_files ADD CONSTRAINT kb_files_proc_chk CHECK (processing_status IN ('uploaded', 'processing', 'ready', 'failed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE VIEW dashboard_stats AS
SELECT
  e.tenant_id,
  (COALESCE(e.received_at, e.created_at) AT TIME ZONE 'UTC')::date AS day,
  COUNT(*)::integer AS emails_received,
  COUNT(*) FILTER (WHERE e.track = 'auto' AND e.status = 'sent')::integer AS auto_sent,
  COUNT(*) FILTER (WHERE e.status = 'pending')::integer AS pending_review,
  AVG(e.confidence) FILTER (WHERE e.confidence IS NOT NULL)::numeric AS avg_confidence,
  COUNT(*) FILTER (WHERE e.status = 'escalated')::integer AS escalated_count
FROM emails e
GROUP BY e.tenant_id, (COALESCE(e.received_at, e.created_at) AT TIME ZONE 'UTC')::date;

CREATE TABLE IF NOT EXISTS learned_reply_memory (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL,
  signature_hash CHAR(64) NOT NULL,
  signature_text TEXT NOT NULL,
  chunk_ids_key VARCHAR(512) NOT NULL,
  draft_body TEXT NOT NULL,
  source VARCHAR(24) NOT NULL DEFAULT 'openai',
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT learned_reply_memory_source_chk CHECK (source IN ('openai', 'human_send'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learned_reply_unique
  ON learned_reply_memory (tenant_id, signature_hash, chunk_ids_key);

CREATE INDEX IF NOT EXISTS idx_learned_reply_tenant_chunk
  ON learned_reply_memory (tenant_id, chunk_ids_key);

CREATE INDEX IF NOT EXISTS idx_learned_reply_tenant_human
  ON learned_reply_memory (tenant_id, last_used_at DESC)
  WHERE source = 'human_send';

CREATE TABLE IF NOT EXISTS learned_classification_memory (
  id SERIAL PRIMARY KEY,
  tenant_id VARCHAR(255) NOT NULL,
  signature_hash CHAR(64) NOT NULL,
  signature_text TEXT NOT NULL,
  chunk_ids_key VARCHAR(512) NOT NULL,
  confidence NUMERIC(5, 4) NOT NULL,
  flags JSONB NOT NULL DEFAULT '[]',
  reasoning TEXT,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_learned_class_unique
  ON learned_classification_memory (tenant_id, signature_hash, chunk_ids_key);

CREATE INDEX IF NOT EXISTS idx_learned_class_tenant_chunk
  ON learned_classification_memory (tenant_id, chunk_ids_key);

-- ---------------------------------------------------------------------------
-- Accounts (launch: tenant is bound to the authenticated user, not client headers)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  tenant_key VARCHAR(255) NOT NULL REFERENCES tenants (tenant_key) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users (tenant_key);

CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT sessions_token_hash_unique UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pwreset_user ON password_reset_tokens (user_id);
