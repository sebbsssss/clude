-- 026: persist per-message token savings on chat_messages + totals RPC for the
-- public "tokens saved to date" counter (proof-features §6/§7). Additive.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS frontier_tokens INTEGER;  -- full transcript a memoryless agent re-sends this turn (prior turns + this prompt)
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS memories_used   INTEGER;  -- count of recalled memories used this turn (= memory_ids length)
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS tokens_saved    INTEGER;  -- max(0, frontier_tokens - tokens_prompt); NULL on pre-migration (legacy) rows

CREATE INDEX IF NOT EXISTS idx_chat_msg_saved ON chat_messages(created_at) WHERE tokens_saved IS NOT NULL;

-- Totals for the proof counter. measured_* cover rows with tokens_saved populated
-- (post-migration, real); historical_prompt_sum covers legacy rows (tokens_saved IS NULL)
-- for the disclosed hybrid baseline estimate (§7.3). One pass, no per-row fetch.
-- "today" is UTC-based (Supabase session tz = UTC); measured_today resets at 00:00 UTC.
-- Full-table aggregate: callers MUST use a server-side TTL cache (see proof.routes.ts).
-- At very large chat_messages volumes, replace with a materialized rollup.
CREATE OR REPLACE FUNCTION proof_tokens_saved_totals()
RETURNS TABLE(
  measured_saved        bigint,
  measured_today        bigint,
  measured_frontier     bigint,
  historical_prompt_sum bigint,
  n                     bigint
) LANGUAGE sql STABLE AS $$
  SELECT
    COALESCE(SUM(tokens_saved)    FILTER (WHERE tokens_saved IS NOT NULL), 0)::bigint,
    COALESCE(SUM(tokens_saved)    FILTER (WHERE tokens_saved IS NOT NULL AND created_at >= date_trunc('day', now())), 0)::bigint,
    COALESCE(SUM(frontier_tokens) FILTER (WHERE tokens_saved IS NOT NULL), 0)::bigint,
    COALESCE(SUM(tokens_prompt)   FILTER (WHERE tokens_saved IS NULL), 0)::bigint,
    COUNT(*)                      FILTER (WHERE tokens_saved IS NOT NULL)::bigint
  FROM chat_messages;
$$;
