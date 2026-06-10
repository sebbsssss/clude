-- 028: Restore vector search in recallMemories — add filter_tags to match_memories.
--
-- ROOT CAUSE (found via the HaluMem benchmark, 2026-06): recallMemories() passes a `filter_tags`
-- argument to match_memories (packages/brain/src/memory/memory.ts ~line 904), but NO deployed
-- match_memories overload ever had that parameter. PostgREST therefore could not resolve the call,
-- the vector-search RPC errored on EVERY recall, the error was swallowed by the surrounding
-- try/catch, and recall silently fell back to KEYWORD-ONLY (vectorAssisted:false on every query).
-- Net effect in production: the semantic/vector phase of recall has been disabled. Keyword/BM25
-- recall (e.g. the exact-fact Solana test) was unaffected; semantic recall (finding memories by
-- meaning) was off. Proven: recallMemories' exact param set -> "Could not find the function
-- match_memories(filter_owner, filter_tags, ...)"; the same call without filter_tags returns rows
-- at 0.93 similarity.
--
-- FIX: deploy ONE match_memories that includes filter_tags (optional; behavior-identical when
-- NULL, which is the common case) and DROP the two old overloads so every caller resolves to a
-- single unambiguous function (the link-creation call sites pass 4-arg subsets and would otherwise
-- be ambiguous between the 7-arg and 8-arg forms).
--
-- Safe: additive optional filter; identical results when filter_tags IS NULL. Atomic in one txn.

BEGIN;

CREATE OR REPLACE FUNCTION public.match_memories(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 10,
  filter_types text[] DEFAULT NULL::text[],
  filter_user text DEFAULT NULL::text,
  min_decay double precision DEFAULT 0.1,
  filter_owner text DEFAULT NULL::text,
  filter_tags text[] DEFAULT NULL::text[]
)
RETURNS TABLE(id bigint, similarity double precision)
LANGUAGE plpgsql AS $function$
BEGIN
  RETURN QUERY
  SELECT m.id, (1 - (m.embedding <=> query_embedding))::float AS similarity
  FROM memories m
  WHERE m.embedding IS NOT NULL
    AND m.decay_factor >= min_decay
    AND (filter_types IS NULL OR m.memory_type = ANY(filter_types))
    AND (filter_user IS NULL OR m.related_user = filter_user)
    AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
    AND (filter_tags IS NULL OR m.tags && filter_tags)
    AND (1 - (m.embedding <=> query_embedding)) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$function$;

-- Remove the two old overloads (no filter_tags) so the superset above is unambiguous.
DROP FUNCTION IF EXISTS public.match_memories(vector,double precision,integer,text[],text,double precision);
DROP FUNCTION IF EXISTS public.match_memories(vector,double precision,integer,text[],text,double precision,text);

GRANT EXECUTE ON FUNCTION public.match_memories(vector,double precision,integer,text[],text,double precision,text,text[])
  TO anon, authenticated, service_role;

COMMIT;
