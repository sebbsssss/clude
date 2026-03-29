-- Experiment 8: PostgreSQL Full-Text Search (BM25-like ranking)
-- Replaces ilike-based keyword search with tsvector/tsquery.
-- Benefits: stemming, TF-IDF ranking, no substring false positives.
--
-- Safe to run: adds column + index + function. No data loss.

-- Add tsvector column (auto-generated from summary + content)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'memories' AND column_name = 'ts_summary'
  ) THEN
    ALTER TABLE memories ADD COLUMN ts_summary tsvector
      GENERATED ALWAYS AS (
        setweight(to_tsvector('english', COALESCE(summary, '')), 'A') ||
        setweight(to_tsvector('english', COALESCE(LEFT(content, 2000), '')), 'B')
      ) STORED;

    CREATE INDEX IF NOT EXISTS idx_memories_ts_summary ON memories USING GIN (ts_summary);
    COMMENT ON COLUMN memories.ts_summary IS 'Auto-generated tsvector for BM25-like full-text search (Exp 8)';
  END IF;
END;
$$;

-- BM25-ranked search RPC
CREATE OR REPLACE FUNCTION bm25_search_memories(
  search_query text,
  match_count int DEFAULT 20,
  min_decay float DEFAULT 0.1,
  filter_owner text DEFAULT NULL,
  filter_types text[] DEFAULT NULL,
  filter_tags text[] DEFAULT NULL
)
RETURNS TABLE (id bigint, rank float)
LANGUAGE plpgsql AS $$
DECLARE
  tsquery_val tsquery;
BEGIN
  -- Convert natural language to tsquery (handles stemming + boolean operators)
  tsquery_val := plainto_tsquery('english', search_query);

  -- Return empty if query produces no valid tsquery
  IF tsquery_val IS NULL OR tsquery_val = ''::tsquery THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT m.id, ts_rank_cd(m.ts_summary, tsquery_val, 32)::float AS rank
  FROM memories m
  WHERE m.ts_summary @@ tsquery_val
    AND m.decay_factor >= min_decay
    AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
    AND (filter_types IS NULL OR m.memory_type = ANY(filter_types))
    AND (filter_tags IS NULL OR m.tags && filter_tags)
  ORDER BY rank DESC
  LIMIT match_count;
END;
$$;
