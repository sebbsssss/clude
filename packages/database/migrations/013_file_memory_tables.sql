-- File Memory Pipeline: llm_outputs table
-- Tracks LLM processing of uploaded files before nodes are stored as memories.
-- Nodes are stored directly in the existing `memories` table with source='file-upload'.
-- Run this on Supabase Dashboard SQL editor

BEGIN;

-- ── llm_outputs ───────────────────────────────────────────────────
-- Each row = one chunk of a document that was analyzed by the LLM.
-- After processing, extracted nodes are inserted into `memories`.
CREATE TABLE IF NOT EXISTS llm_outputs (
  id                 BIGSERIAL PRIMARY KEY,
  batch_id           UUID NOT NULL DEFAULT gen_random_uuid(),
  document_title         TEXT NOT NULL,
  chunk_index        INT4 NOT NULL DEFAULT 0,
  raw_response       TEXT NOT NULL,
  parsed_node_count INT4 DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  owner_wallet       TEXT,
  file_name          TEXT,            -- original uploaded file name
  file_path          TEXT,            -- supabase storage path
  file_size_bytes    BIGINT,
  status             TEXT NOT NULL DEFAULT 'processing'
                       CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  error_message      TEXT             -- failure reason if status='failed'
);

CREATE INDEX IF NOT EXISTS idx_llm_outputs_batch ON llm_outputs (batch_id);
CREATE INDEX IF NOT EXISTS idx_llm_outputs_owner ON llm_outputs (owner_wallet);
CREATE INDEX IF NOT EXISTS idx_llm_outputs_status ON llm_outputs (status);

COMMIT;
