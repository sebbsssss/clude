-- ============================================================
-- MIGRATION: Memory System Vector Upgrade
-- Adds pgvector, concept ontology, granular decomposition
-- Safe to run on existing databases (idempotent)
-- ============================================================

-- 1. Enable extensions
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add new columns to memories table (skip if already present)
ALTER TABLE memories ADD COLUMN IF NOT EXISTS concepts TEXT[] DEFAULT '{}';
ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- 3. Memory fragments table for granular vector decomposition
CREATE TABLE IF NOT EXISTS memory_fragments (
  id BIGSERIAL PRIMARY KEY,
  memory_id BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  fragment_type TEXT NOT NULL,            -- 'summary', 'content_chunk', 'tag_context'
  content TEXT NOT NULL,
  embedding vector(1024),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Dream logs table (may already exist)
CREATE TABLE IF NOT EXISTS dream_logs (
  id BIGSERIAL PRIMARY KEY,
  session_type TEXT NOT NULL CHECK (session_type IN ('consolidation', 'reflection', 'emergence')),
  input_memory_ids BIGINT[] DEFAULT '{}',
  output TEXT NOT NULL,
  new_memories_created BIGINT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. New indexes
CREATE INDEX IF NOT EXISTS idx_memories_concepts ON memories USING GIN(concepts);
CREATE INDEX IF NOT EXISTS idx_memories_summary_trgm ON memories USING GIN(summary gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_memories_evidence ON memories USING GIN(evidence_ids);

-- Vector similarity indexes (HNSW for fast approximate nearest neighbor)
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_fragments_embedding ON memory_fragments USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_fragments_memory_id ON memory_fragments(memory_id);

-- Existing indexes (safe to re-run)
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(related_user);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_decay ON memories(decay_factor);
CREATE INDEX IF NOT EXISTS idx_dream_logs_type ON dream_logs(session_type);
CREATE INDEX IF NOT EXISTS idx_dream_logs_created ON dream_logs(created_at DESC);

-- 6. Vector search RPC functions
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10,
  filter_types text[] DEFAULT NULL,
  filter_user text DEFAULT NULL,
  min_decay float DEFAULT 0.1
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
    AND (1 - (m.embedding <=> query_embedding)) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

CREATE OR REPLACE FUNCTION match_memory_fragments(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10
)
RETURNS TABLE (memory_id bigint, max_similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT f.memory_id, MAX((1 - (f.embedding <=> query_embedding))::float) AS max_similarity
  FROM memory_fragments f
  WHERE f.embedding IS NOT NULL
    AND (1 - (f.embedding <=> query_embedding)) > match_threshold
  GROUP BY f.memory_id
  ORDER BY max_similarity DESC
  LIMIT match_count;
END;
$$;
