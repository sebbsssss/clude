-- Migration 016: Fold importance boosting into batch_boost_memory_access
-- Eliminates the separate boost_memory_importance RPC call per recall.
-- Now accepts per-ID importance boost amounts and does everything in one UPDATE.

CREATE OR REPLACE FUNCTION batch_boost_memory_access(
  memory_ids BIGINT[],
  importance_boosts DOUBLE PRECISION[] DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF importance_boosts IS NOT NULL AND array_length(importance_boosts, 1) = array_length(memory_ids, 1) THEN
    -- Per-ID importance boost via unnest join
    UPDATE memories m
    SET access_count = m.access_count + 1,
        last_accessed = NOW(),
        decay_factor = LEAST(1.0, m.decay_factor + 0.1),
        importance = LEAST(1.0, m.importance + v.boost)
    FROM unnest(memory_ids, importance_boosts) AS v(id, boost)
    WHERE m.id = v.id;
  ELSE
    -- Backwards-compatible: no importance boost
    UPDATE memories
    SET access_count = access_count + 1,
        last_accessed = NOW(),
        decay_factor = LEAST(1.0, decay_factor + 0.1)
    WHERE id = ANY(memory_ids);
  END IF;
END;
$$;
