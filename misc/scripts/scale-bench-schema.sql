-- ============================================================================
-- Scale-retrieval benchmark: ISOLATED table + RPCs.
--
-- Fully separate from the production `memories` table so seeding millions of
-- Solana fact rows never touches the 211K real production memories or their
-- shared HNSW index. Cleanup = DROP TABLE (one line, Phase 5).
--
-- Mirrors only the columns hybrid recall reads: embedding (vector 1024),
-- content_tokens (tsvector BM25), owner_wallet (scoping), content/summary,
-- decay_factor. No encryption/links/fragments — this is a retrieval stress test.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.memories_scale_bench (
  id            bigserial PRIMARY KEY,
  owner_wallet  text NOT NULL,
  source_ref    text,              -- the distinct fact key (block:NNN / tx:sig / account:pk)
  category      text,
  content       text NOT NULL,
  summary       text NOT NULL,
  gold          text,              -- ground-truth answer (for grading)
  embedding     vector(1024),
  content_tokens tsvector,
  decay_factor  double precision DEFAULT 1.0,
  created_at    timestamptz DEFAULT now()
);

-- Scoping + dedup
CREATE INDEX IF NOT EXISTS idx_scale_owner ON public.memories_scale_bench (owner_wallet);
CREATE UNIQUE INDEX IF NOT EXISTS uq_scale_owner_ref ON public.memories_scale_bench (owner_wallet, source_ref);
-- BM25 lexical
CREATE INDEX IF NOT EXISTS idx_scale_content_tokens ON public.memories_scale_bench USING GIN (content_tokens);
-- HNSW vector (its OWN index, never shared with prod). Build AFTER bulk load for speed.
-- CREATE INDEX idx_scale_embedding ON public.memories_scale_bench USING hnsw (embedding vector_cosine_ops);

-- Vector recall over the bench table (clone of match_memories, FROM the bench table).
CREATE OR REPLACE FUNCTION public.scale_match(
  query_embedding vector,
  match_threshold double precision DEFAULT 0.15,
  match_count int DEFAULT 10,
  filter_owner text DEFAULT NULL
)
RETURNS TABLE (id bigint, similarity double precision)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, (1 - (m.embedding <=> query_embedding))::float AS similarity
  FROM public.memories_scale_bench m
  WHERE m.embedding IS NOT NULL
    AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
    AND (1 - (m.embedding <=> query_embedding)) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- BM25 lexical recall over the bench table (clone of bm25_search_memories, content_tokens only).
CREATE OR REPLACE FUNCTION public.scale_bm25(
  search_query text,
  match_count int DEFAULT 20,
  filter_owner text DEFAULT NULL
)
RETURNS TABLE (id bigint, rank double precision)
LANGUAGE plpgsql AS $$
DECLARE tsquery_val tsquery;
BEGIN
  tsquery_val := plainto_tsquery('english', search_query);
  IF tsquery_val IS NULL OR tsquery_val = ''::tsquery THEN RETURN; END IF;
  RETURN QUERY
  SELECT m.id, ts_rank_cd(COALESCE(m.content_tokens, ''::tsvector), tsquery_val, 32)::float AS rank
  FROM public.memories_scale_bench m
  WHERE m.content_tokens @@ tsquery_val
    AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
  ORDER BY rank DESC
  LIMIT match_count;
END;
$$;

-- Populate content_tokens for a bench row (clone of set_memory_content_tokens).
CREATE OR REPLACE FUNCTION public.scale_set_tokens(p_id bigint, p_text text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.memories_scale_bench
  SET content_tokens = setweight(to_tsvector('english', LEFT(COALESCE(p_text,''), 2000)), 'B')
  WHERE id = p_id;
END;
$$;
