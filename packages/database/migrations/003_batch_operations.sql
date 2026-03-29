-- ============================================================
-- MIGRATION: Batch DB Operations
-- Replaces N+1 query patterns with efficient batch RPCs
-- Safe to run on existing databases (CREATE OR REPLACE)
-- ============================================================

-- Batch memory access tracking: single UPDATE for all accessed memories
-- Replaces N×2 queries (SELECT + UPDATE per ID) with 1 query
CREATE OR REPLACE FUNCTION batch_boost_memory_access(memory_ids BIGINT[])
RETURNS void
LANGUAGE sql AS $$
  UPDATE memories
  SET access_count = access_count + 1,
      last_accessed = NOW(),
      decay_factor = LEAST(1.0, decay_factor + 0.1)
  WHERE id = ANY(memory_ids);
$$;

-- Batch memory decay: single UPDATE per memory type
-- Replaces N individual UPDATEs with 4 (one per type)
CREATE OR REPLACE FUNCTION batch_decay_memories(
  decay_type TEXT,
  decay_rate FLOAT,
  min_decay FLOAT,
  cutoff TIMESTAMPTZ
)
RETURNS INTEGER
LANGUAGE plpgsql AS $$
DECLARE affected INTEGER;
BEGIN
  UPDATE memories
  SET decay_factor = GREATEST(min_decay, decay_factor * decay_rate)
  WHERE memory_type = decay_type
    AND last_accessed < cutoff
    AND decay_factor > min_decay;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;
