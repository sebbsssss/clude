-- ============================================================
-- MIGRATION 009: Add filter_owner to fragment + link RPCs
-- Ensures multi-agent memory isolation at the database level
-- ============================================================

-- match_memory_fragments: add owner filter via JOIN to memories table
CREATE OR REPLACE FUNCTION match_memory_fragments(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10,
  filter_owner text DEFAULT NULL
)
RETURNS TABLE (memory_id bigint, max_similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT f.memory_id, MAX((1 - (f.embedding <=> query_embedding))::float) AS max_similarity
  FROM memory_fragments f
  JOIN memories m ON m.id = f.memory_id
  WHERE f.embedding IS NOT NULL
    AND (1 - (f.embedding <=> query_embedding)) > match_threshold
    AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
  GROUP BY f.memory_id
  ORDER BY max_similarity DESC
  LIMIT match_count;
END;
$$;

-- get_linked_memories: add owner filter via JOIN to memories table
CREATE OR REPLACE FUNCTION get_linked_memories(
  seed_ids BIGINT[],
  min_strength FLOAT DEFAULT 0.1,
  max_results INT DEFAULT 20,
  filter_owner TEXT DEFAULT NULL
)
RETURNS TABLE (
  memory_id BIGINT,
  linked_from BIGINT,
  link_type TEXT,
  strength FLOAT
)
LANGUAGE sql AS $$
  -- Outgoing links (source → target)
  SELECT DISTINCT ON (ml.target_id, ml.link_type)
    ml.target_id AS memory_id,
    ml.source_id AS linked_from,
    ml.link_type,
    ml.strength::float
  FROM memory_links ml
  JOIN memories m ON m.id = ml.target_id
  WHERE ml.source_id = ANY(seed_ids)
    AND ml.target_id != ALL(seed_ids)
    AND ml.strength >= min_strength
    AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
  UNION
  -- Incoming links (target ← source)
  SELECT DISTINCT ON (ml.source_id, ml.link_type)
    ml.source_id AS memory_id,
    ml.target_id AS linked_from,
    ml.link_type,
    ml.strength::float
  FROM memory_links ml
  JOIN memories m ON m.id = ml.source_id
  WHERE ml.target_id = ANY(seed_ids)
    AND ml.source_id != ALL(seed_ids)
    AND ml.strength >= min_strength
    AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
  ORDER BY strength DESC
  LIMIT max_results;
$$;
