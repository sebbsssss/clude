-- TRACKED, REVIEWABLE COPY of packages/database/migrations/040_vertex_shadow_embeddings.sql.
-- The packages/database/migrations/ directory is gitignored (migrations are hand-applied),
-- so this copy lives under docs/ to travel with the PR and the Cloud SQL rebuild. Apply it
-- by hand (Supabase SQL editor / exec_sql) exactly as the other numbered migrations. Keep
-- the two copies identical.
--
-- ============================================================================
--
-- 040_vertex_shadow_embeddings.sql
-- GCP migration Slice 3b: the SHADOW embedding space for the Voyage -> Vertex cutover.
--
-- Adds a SECOND embedding column (embedding_vertex) + HNSW index on memories and
-- memory_fragments, plus _vertex variants of the recall RPCs that read it. The live
-- Voyage `embedding` column and its RPCs are UNTOUCHED, so recall is unchanged until
-- EMBEDDING_ACTIVE=vertex is flipped. gemini-embedding-001 is MRL-truncated to 1024
-- dims so the column type, HNSW index, and RPC signatures match the Voyage space exactly.
--
-- Rollback: flip EMBEDDING_ACTIVE back to 'voyage' (no schema change needed). The
-- column + functions can be dropped after the Voyage space is fully sunset.

-- 1. Shadow columns (nullable; backfilled by scripts/backfill-vertex-embeddings.ts).
ALTER TABLE memories         ADD COLUMN IF NOT EXISTS embedding_vertex vector(1024);
ALTER TABLE memory_fragments ADD COLUMN IF NOT EXISTS embedding_vertex vector(1024);

-- 2. Shadow HNSW indexes — same params as the Voyage indexes (006_hnsw_index.sql:
--    m=16, ef_construction=128, ef_search=100).
--    IMPORTANT: an HNSW index over an all-NULL column is useless and slows the backfill
--    writes. For a large table, SKIP the two CREATE INDEX statements below and instead
--    run them as CREATE INDEX CONCURRENTLY out-of-band AFTER the backfill completes
--    (see the runbook). They are kept here IF NOT EXISTS for fresh/self-hosted DBs.
CREATE INDEX IF NOT EXISTS memories_embedding_vertex_hnsw_idx
  ON memories USING hnsw (embedding_vertex vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);
CREATE INDEX IF NOT EXISTS memory_fragments_embedding_vertex_hnsw_idx
  ON memory_fragments USING hnsw (embedding_vertex vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);
ALTER INDEX memories_embedding_vertex_hnsw_idx SET (ef_search = 100);
ALTER INDEX memory_fragments_embedding_vertex_hnsw_idx SET (ef_search = 100);

-- 3. _vertex RPC variants. BYTE-IDENTICAL to match_memories / match_memories_temporal /
--    match_memory_fragments except they read embedding_vertex instead of embedding.

CREATE OR REPLACE FUNCTION match_memories_vertex(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10,
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
  SELECT m.id, (1 - (m.embedding_vertex <=> query_embedding))::float AS similarity
  FROM memories m
  WHERE m.embedding_vertex IS NOT NULL
    AND m.decay_factor >= min_decay
    AND (filter_types IS NULL OR m.memory_type = ANY(filter_types))
    AND (filter_user IS NULL OR m.related_user = filter_user)
    AND (
      filter_owner IS NULL
      OR (filter_owner = '__BOT_OWN__' AND m.owner_wallet IS NULL)
      OR m.owner_wallet = filter_owner
    )
    AND (filter_tags IS NULL OR m.tags && filter_tags)
    AND (1 - (m.embedding_vertex <=> query_embedding)) > match_threshold
  ORDER BY m.embedding_vertex <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_memories_temporal_vertex(
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
  SELECT m.id, (1 - (m.embedding_vertex <=> query_embedding))::float AS similarity
  FROM memories m
  WHERE m.embedding_vertex IS NOT NULL
    AND m.decay_factor >= min_decay
    AND (filter_types IS NULL OR m.memory_type = ANY(filter_types))
    AND (filter_user IS NULL OR m.related_user = filter_user)
    AND (
      filter_owner IS NULL
      OR (filter_owner = '__BOT_OWN__' AND m.owner_wallet IS NULL)
      OR m.owner_wallet = filter_owner
    )
    AND (filter_tags IS NULL OR m.tags && filter_tags)
    AND (1 - (m.embedding_vertex <=> query_embedding)) > match_threshold
    AND (start_date IS NULL OR COALESCE(m.event_date, m.created_at) >= start_date)
    AND (end_date IS NULL OR COALESCE(m.event_date, m.created_at) <= end_date)
  ORDER BY m.embedding_vertex <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_memory_fragments_vertex(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10,
  filter_owner text DEFAULT NULL,
  min_decay float DEFAULT 0.0,
  filter_types text[] DEFAULT NULL
)
RETURNS TABLE (memory_id bigint, max_similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT f.memory_id, MAX((1 - (f.embedding_vertex <=> query_embedding))::float) AS max_similarity
  FROM memory_fragments f
  JOIN memories m ON m.id = f.memory_id
  WHERE f.embedding_vertex IS NOT NULL
    AND (1 - (f.embedding_vertex <=> query_embedding)) > match_threshold
    AND m.decay_factor >= min_decay
    AND (filter_types IS NULL OR m.memory_type = ANY(filter_types))
    AND (
      filter_owner IS NULL
      OR (filter_owner = '__BOT_OWN__' AND m.owner_wallet IS NULL)
      OR m.owner_wallet = filter_owner
    )
  GROUP BY f.memory_id
  ORDER BY max_similarity DESC
  LIMIT match_count;
END;
$$;
