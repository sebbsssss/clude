-- Migration 005: Importance re-scoring RPC
-- Memories retrieved often become more important (rehearsal effect)

CREATE OR REPLACE FUNCTION boost_memory_importance(
  memory_id BIGINT,
  boost_amount DOUBLE PRECISION DEFAULT 0.02,
  max_importance DOUBLE PRECISION DEFAULT 1.0
)
RETURNS VOID AS $$
BEGIN
  UPDATE memories
  SET importance = LEAST(importance + boost_amount, max_importance)
  WHERE id = memory_id;
END;
$$ LANGUAGE plpgsql;
