-- 022: Lexical index reconciliation for memory encryption-at-rest (Plan 2).
-- See docs/pmp/memory-encryption-design.md §9 + §11. Order is load-bearing:
-- content stays covered by >=1 lexical column at every instant.

-- (1) content_tokens column (app-maintained; NOT generated) + GIN index.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS content_tokens tsvector;
CREATE INDEX IF NOT EXISTS idx_memories_content_tokens ON memories USING GIN(content_tokens);

-- (2) RPC to populate content_tokens from a transient plaintext arg (never stored as a column).
--     setweight 'B' mirrors the old combined ts_summary weighting (summary 'A' > content 'B').
CREATE OR REPLACE FUNCTION set_memory_content_tokens(p_memory_id bigint, p_text text)
RETURNS void LANGUAGE sql AS $$
  UPDATE memories
  SET content_tokens = CASE
        WHEN p_text IS NULL OR p_text = '' THEN NULL
        ELSE setweight(to_tsvector('english', p_text), 'B')
      END
  WHERE id = p_memory_id;
$$;

-- (3) Backfill content_tokens from EXISTING plaintext content (before ts_summary loses content).
--     Skip legacy-encrypted rows (content is ciphertext there). A single UPDATE is fine for the
--     current corpus size; page it if the table is very large.
UPDATE memories
SET content_tokens = setweight(to_tsvector('english', content), 'B')
WHERE encrypted IS NOT TRUE AND content IS NOT NULL AND content <> '';

-- (4) Dual-column BM25: match/rank over ts_summary OR content_tokens.
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
  tsquery_val := plainto_tsquery('english', search_query);
  IF tsquery_val IS NULL OR tsquery_val = ''::tsquery THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT m.id,
    (ts_rank_cd(COALESCE(m.ts_summary, ''::tsvector), tsquery_val, 32)
     + ts_rank_cd(COALESCE(m.content_tokens, ''::tsvector), tsquery_val, 32))::float AS rank
  FROM memories m
  WHERE (m.ts_summary @@ tsquery_val OR m.content_tokens @@ tsquery_val)
    AND m.decay_factor >= min_decay
    AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
    AND (filter_types IS NULL OR m.memory_type = ANY(filter_types))
    AND (filter_tags IS NULL OR m.tags && filter_tags)
  ORDER BY rank DESC
  LIMIT match_count;
END;
$$;

-- (5) Repurpose ts_summary to summary-only. A generation expression can't be altered in place,
--     so drop & re-add (rewrites the column; its index is dropped with it and re-created).
--     Safe now: content is already covered by content_tokens (step 3). On revoke, clearing
--     `summary` auto-empties this column (design §2/§7) — we never clear the generated column itself.
ALTER TABLE memories DROP COLUMN IF EXISTS ts_summary;
ALTER TABLE memories ADD COLUMN ts_summary tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', COALESCE(summary, '')), 'A')
) STORED;
CREATE INDEX IF NOT EXISTS idx_memories_ts_summary ON memories USING GIN(ts_summary);
