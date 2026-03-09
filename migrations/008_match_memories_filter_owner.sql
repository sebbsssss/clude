-- ============================================================
-- MIGRATION 008: Add filter_owner to match_memories RPC
-- Enables multi-agent memory isolation (each agent gets its own namespace)
-- Backward compatible: filter_owner defaults to NULL (no filter)
-- ============================================================

CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10,
  filter_types text[] DEFAULT NULL,
  filter_user text DEFAULT NULL,
  min_decay float DEFAULT 0.1,
  filter_owner text DEFAULT NULL
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
    AND (1 - (m.embedding <=> query_embedding)) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
