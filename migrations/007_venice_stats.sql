-- Persist Venice usage stats across restarts
CREATE TABLE IF NOT EXISTS venice_stats (
  id INTEGER PRIMARY KEY DEFAULT 1,
  total_inference_calls INTEGER DEFAULT 0,
  total_tokens_processed BIGINT DEFAULT 0,
  calls_by_function JSONB DEFAULT '{}',
  last_call_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT single_row CHECK (id = 1)
);

-- Seed the row
INSERT INTO venice_stats (id) VALUES (1) ON CONFLICT DO NOTHING;
