-- Learned reply + classification memory (lexical match + KB chunk fingerprint)

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
