-- 029: bound set_memory_content_tokens to LEFT(p_text, 2000) — D1 = Option A (Plan 5 Task 2).
--
-- The prod content_tokens backfill (migration 022, applied 2026-05) used LEFT(content, 2000)
-- for timeout reasons, but the canonical set_memory_content_tokens RPC was unbounded
-- (to_tsvector over the full text). New / re-delegated writes therefore drifted: backfilled
-- rows indexed the first 2000 chars, fresh rows indexed everything.
--
-- Reconcile to LEFT(p_text, 2000) so the canonical builder matches the corpus. Pre-flight A4:
-- avg content length = 948 chars, max = 5000 — so the 2000 bound only clips the rare upper tail,
-- losing BM25 lexemes for content past 2 KB on a small fraction of rows. Accepted trade for
-- avoiding a second 600K-row re-backfill.
--
-- Idempotent CREATE OR REPLACE. No data rewrite — only affects future set_memory_content_tokens
-- calls (storeMemory writes, re-delegate restores).

CREATE OR REPLACE FUNCTION set_memory_content_tokens(p_memory_id bigint, p_text text)
RETURNS void LANGUAGE sql AS $$
  UPDATE memories
  SET content_tokens = CASE
        WHEN p_text IS NULL OR p_text = '' THEN NULL
        ELSE setweight(to_tsvector('english', LEFT(p_text, 2000)), 'B')
      END
  WHERE id = p_memory_id;
$$;
