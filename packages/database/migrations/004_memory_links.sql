-- ============================================================
-- MIGRATION: Memory Association Graph
-- Adds bidirectional, typed, weighted links between memories.
-- Enables multi-hop retrieval, conflict detection, and
-- associative reasoning (A-Mem / MAGMA / SYNAPSE inspired).
-- Safe to run on existing databases (idempotent).
-- ============================================================

-- Memory links: weighted directed edges in the association graph
CREATE TABLE IF NOT EXISTS memory_links (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN (
    'supports',     -- evidence-backed (mirrors evidence_ids)
    'contradicts',  -- conflicting information
    'elaborates',   -- adds detail to existing memory
    'causes',       -- causal chain (X because of Y)
    'follows',      -- temporal sequence (X after Y)
    'relates'       -- general semantic association
  )),
  strength REAL DEFAULT 0.5,          -- 0-1, boosted on co-retrieval (Hebbian)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_id, target_id, link_type)
);

CREATE INDEX IF NOT EXISTS idx_links_source ON memory_links(source_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON memory_links(target_id);
CREATE INDEX IF NOT EXISTS idx_links_type ON memory_links(link_type);
CREATE INDEX IF NOT EXISTS idx_links_strength ON memory_links(strength DESC);

-- 1-hop traversal: get all memories linked to a set of IDs (both directions)
CREATE OR REPLACE FUNCTION get_linked_memories(
  seed_ids BIGINT[],
  min_strength FLOAT DEFAULT 0.1,
  max_results INT DEFAULT 20
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
  WHERE ml.source_id = ANY(seed_ids)
    AND ml.target_id != ALL(seed_ids)
    AND ml.strength >= min_strength
  UNION
  -- Incoming links (target ← source)
  SELECT DISTINCT ON (ml.source_id, ml.link_type)
    ml.source_id AS memory_id,
    ml.target_id AS linked_from,
    ml.link_type,
    ml.strength::float
  FROM memory_links ml
  WHERE ml.target_id = ANY(seed_ids)
    AND ml.source_id != ALL(seed_ids)
    AND ml.strength >= min_strength
  ORDER BY strength DESC
  LIMIT max_results;
$$;

-- 2-hop traversal: from seeds, get connected memories up to depth 2
CREATE OR REPLACE FUNCTION get_memory_graph(
  seed_ids BIGINT[],
  min_strength FLOAT DEFAULT 0.2,
  max_results INT DEFAULT 30
)
RETURNS TABLE (
  memory_id BIGINT,
  hop INT,
  link_type TEXT,
  strength FLOAT
)
LANGUAGE plpgsql AS $$
DECLARE
  hop1_ids BIGINT[];
BEGIN
  -- Hop 1: direct links
  RETURN QUERY
  SELECT g.memory_id, 1 AS hop, g.link_type, g.strength
  FROM get_linked_memories(seed_ids, min_strength, max_results) g;

  -- Collect hop 1 IDs for hop 2
  SELECT ARRAY_AGG(DISTINCT g.memory_id)
  INTO hop1_ids
  FROM get_linked_memories(seed_ids, min_strength, max_results) g;

  IF hop1_ids IS NOT NULL AND array_length(hop1_ids, 1) > 0 THEN
    -- Hop 2: links from hop 1 memories (excluding seeds and hop 1)
    RETURN QUERY
    SELECT g2.memory_id, 2 AS hop, g2.link_type, g2.strength * 0.5 AS strength
    FROM get_linked_memories(hop1_ids, min_strength, max_results / 2) g2
    WHERE g2.memory_id != ALL(seed_ids)
      AND g2.memory_id != ALL(hop1_ids);
  END IF;
END;
$$;

-- Hebbian reinforcement: boost link strength for co-retrieved memories
CREATE OR REPLACE FUNCTION boost_link_strength(
  memory_ids BIGINT[],
  boost_amount FLOAT DEFAULT 0.05
)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE affected INTEGER;
BEGIN
  UPDATE memory_links
  SET strength = LEAST(1.0, strength + boost_amount)
  WHERE source_id = ANY(memory_ids)
    AND target_id = ANY(memory_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
