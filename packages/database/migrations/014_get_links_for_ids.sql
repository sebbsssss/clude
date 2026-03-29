-- RPC function to fetch memory_links where both source and target are in a given ID set.
-- Avoids URL length limits that occur with large .in() filters via PostgREST.

CREATE OR REPLACE FUNCTION get_links_for_ids(ids BIGINT[])
RETURNS TABLE (
  source_id BIGINT,
  target_id BIGINT,
  link_type TEXT,
  strength REAL
)
LANGUAGE sql STABLE
AS $$
  SELECT ml.source_id, ml.target_id, ml.link_type, ml.strength
  FROM memory_links ml
  WHERE ml.source_id = ANY(ids)
    AND ml.target_id = ANY(ids);
$$;
