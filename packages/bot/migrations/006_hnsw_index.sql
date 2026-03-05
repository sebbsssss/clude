-- Migration 006: HNSW index for fast approximate nearest neighbor search
-- Expected improvement: vector search from ~200ms to <1ms at 13k vectors
-- Memory: ~50-100MB for 13k vectors at 1024 dims (fits comfortably in Supabase free/pro tier)
-- Build time: ~1-3 min for 13k vectors

-- Drop any existing indexes (may be IVFFlat or old HNSW with suboptimal params)
DROP INDEX IF EXISTS memories_embedding_hnsw_idx;
DROP INDEX IF EXISTS memory_fragments_embedding_hnsw_idx;

-- HNSW index on main memory embeddings
-- m=16: connections per node (default, good for 10k-100k scale)
-- ef_construction=128: build quality (2x improvement over 64, ~95% recall)
-- Using CONCURRENTLY to avoid locking the table during build
CREATE INDEX CONCURRENTLY IF NOT EXISTS memories_embedding_hnsw_idx 
ON memories USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 128);

-- HNSW index on fragment embeddings
CREATE INDEX CONCURRENTLY IF NOT EXISTS memory_fragments_embedding_hnsw_idx 
ON memory_fragments USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 128);

-- Set query-time search depth
-- ef_search=100: good balance of recall (95%+) and speed (<1ms)
-- Can tune per-query with SET LOCAL if needed
ALTER INDEX memories_embedding_hnsw_idx SET (ef_search = 100);
ALTER INDEX memory_fragments_embedding_hnsw_idx SET (ef_search = 100);

-- Performance tip: also set in match_memories RPC or at session level:
-- SET hnsw.ef_search = 100;
