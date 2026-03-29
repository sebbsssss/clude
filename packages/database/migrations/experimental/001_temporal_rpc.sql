-- Experiment 9: Temporal-aware memory matching RPC
-- Adds date range filtering using COALESCE(event_date, created_at)
-- so memories with explicit event dates are preferred, but all
-- memories fall back to creation time.
--
-- Requires: event_date column on memories table (from benchmark migrations)
-- Safe to run: creates function only, no data changes.

CREATE OR REPLACE FUNCTION match_memories_temporal(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 20,
  start_date timestamptz DEFAULT NULL,
  end_date timestamptz DEFAULT NULL,
  filter_types text[] DEFAULT NULL,
  filter_user text DEFAULT NULL,
  min_decay float DEFAULT 0.1,
  filter_owner text DEFAULT NULL,
  filter_tags text[] DEFAULT NULL
)
RETURNS TABLE (id bigint, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, (1 - (m.embedding <=> query_embedding))::float AS similarity
  FROM memories m
  WHERE m.embedding IS NOT NULL
    AND m.decay_factor >= min_decay
    AND (filter_types IS NULL OR m.memory_type = ANY(filter_types))
    AND (filter_user IS NULL OR m.related_user = filter_user)
    AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
    AND (filter_tags IS NULL OR m.tags && filter_tags)
    AND (1 - (m.embedding <=> query_embedding)) > match_threshold
    -- Temporal filter: use event_date if available, fall back to created_at
    AND (start_date IS NULL OR COALESCE(m.event_date, m.created_at) >= start_date)
    AND (end_date IS NULL OR COALESCE(m.event_date, m.created_at) <= end_date)
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Add event_date column if it doesn't exist (safe idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'event_date'
  ) THEN
    ALTER TABLE memories ADD COLUMN event_date TIMESTAMPTZ DEFAULT NULL;
    CREATE INDEX IF NOT EXISTS idx_memories_event_date ON memories(event_date)
      WHERE event_date IS NOT NULL;
    COMMENT ON COLUMN memories.event_date IS 'Explicit event date extracted from content (temporal indexing)';
  END IF;
END;
$$;

-- Add event_date_precision column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'event_date_precision'
  ) THEN
    ALTER TABLE memories ADD COLUMN event_date_precision TEXT DEFAULT NULL
      CHECK (event_date_precision IN ('day', 'week', 'month', 'year'));
  END IF;
END;
$$;
