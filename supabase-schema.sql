-- Run this in the Supabase SQL Editor to create all required tables

CREATE TABLE IF NOT EXISTS wallet_links (
  id BIGSERIAL PRIMARY KEY,
  x_handle TEXT UNIQUE NOT NULL,
  x_user_id TEXT UNIQUE NOT NULL,
  wallet_address TEXT NOT NULL,
  verified_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processed_mentions (
  tweet_id TEXT PRIMARY KEY,
  feature TEXT NOT NULL,
  response_tweet_id TEXT,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opinion_commits (
  id BIGSERIAL PRIMARY KEY,
  tweet_id TEXT NOT NULL,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  answer_hash TEXT NOT NULL,
  solana_signature TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER DEFAULT 0,
  window_start TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS price_snapshots (
  id BIGSERIAL PRIMARY KEY,
  price_usd DOUBLE PRECISION NOT NULL,
  volume_24h DOUBLE PRECISION,
  market_cap DOUBLE PRECISION,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_price_snapshots_recorded ON price_snapshots(recorded_at);

-- ============================================================
-- MEMORY SYSTEM: The Cortex
-- Episodic, Semantic, Procedural, and Self-Model memory
-- with hybrid vector + keyword retrieval
-- ============================================================

-- Enable trigram similarity for fuzzy text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Enable pgvector for semantic similarity search
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS memories (
  id BIGSERIAL PRIMARY KEY,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('episodic', 'semantic', 'procedural', 'self_model', 'introspective')),
  content TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags TEXT[] DEFAULT '{}',
  concepts TEXT[] DEFAULT '{}',           -- structured concept ontology labels
  emotional_valence REAL DEFAULT 0,       -- -1 (negative) to 1 (positive)
  importance REAL DEFAULT 0.5,            -- 0 to 1
  access_count INTEGER DEFAULT 0,
  source TEXT,                            -- trigger: mention, market, consolidation, reflection, emergence
  source_id TEXT,                         -- tweet ID, event ID, etc.
  related_user TEXT,                      -- X user ID if relevant
  related_wallet TEXT,                    -- wallet address if relevant
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed TIMESTAMPTZ DEFAULT NOW(),
  decay_factor REAL DEFAULT 1.0,          -- type-specific decay (episodic=0.93, semantic=0.98, procedural=0.97, self_model=0.99)
  evidence_ids BIGINT[] DEFAULT '{}',    -- IDs of memories that support this one (Park et al. 2023)
  solana_signature TEXT,                  -- Solana tx signature if committed on-chain
  embedding vector(1024),                 -- vector embedding for semantic similarity search
  hash_id TEXT,                           -- collision-resistant hash ID (Beads-inspired)
  compacted BOOLEAN DEFAULT FALSE,        -- whether this memory has been compacted
  compacted_into TEXT,                    -- hash_id of the memory this was compacted into
  encrypted BOOLEAN DEFAULT FALSE,        -- whether content is client-side encrypted
  encryption_pubkey TEXT,                 -- Solana pubkey that encrypted this memory
  owner_wallet TEXT                       -- Solana pubkey of the memory owner
);

-- Memory fragments: granular vector decomposition for precision retrieval
-- Each memory is split into semantic fragments (summary, content chunks, tag context)
-- so vector search matches against precise sub-memory content rather than the whole blob.
CREATE TABLE IF NOT EXISTS memory_fragments (
  id BIGSERIAL PRIMARY KEY,
  memory_id BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  fragment_type TEXT NOT NULL,            -- 'summary', 'content_chunk', 'tag_context'
  content TEXT NOT NULL,
  embedding vector(1024),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dream logs: consolidation, reflection, emergence sessions
CREATE TABLE IF NOT EXISTS dream_logs (
  id BIGSERIAL PRIMARY KEY,
  session_type TEXT NOT NULL CHECK (session_type IN ('consolidation', 'reflection', 'emergence', 'compaction', 'decay', 'contradiction_resolution')),
  input_memory_ids BIGINT[] DEFAULT '{}',
  output TEXT NOT NULL,
  new_memories_created BIGINT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for memory retrieval
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_memories_concepts ON memories USING GIN(concepts);
CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);
CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(related_user);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_memories_decay ON memories(decay_factor);
CREATE INDEX IF NOT EXISTS idx_memories_summary_trgm ON memories USING GIN(summary gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_memories_evidence ON memories USING GIN(evidence_ids);
CREATE INDEX IF NOT EXISTS idx_memories_owner ON memories(owner_wallet);

-- Vector similarity indexes (HNSW for fast approximate nearest neighbor)
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_fragments_embedding ON memory_fragments USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_fragments_memory_id ON memory_fragments(memory_id);

CREATE INDEX IF NOT EXISTS idx_dream_logs_type ON dream_logs(session_type);
CREATE INDEX IF NOT EXISTS idx_dream_logs_created ON dream_logs(created_at DESC);

-- ============================================================
-- VECTOR SEARCH FUNCTIONS
-- Used by the hybrid retrieval system in memory.ts
-- ============================================================

-- Semantic search across memory-level embeddings with metadata filtering
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10,
  filter_types text[] DEFAULT NULL,
  filter_user text DEFAULT NULL,
  min_decay float DEFAULT 0.1,
  filter_owner text DEFAULT NULL
)
RETURNS TABLE (id bigint, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT m.id, (1 - (m.embedding <=> query_embedding))::float AS similarity
  FROM memories m
  WHERE m.embedding IS NOT NULL
    AND m.decay_factor >= min_decay
    AND (filter_types IS NULL OR m.memory_type = ANY(filter_types))
    AND (filter_user IS NULL OR m.related_user = filter_user)
    AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
    AND (1 - (m.embedding <=> query_embedding)) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ============================================================
-- MEMORY ASSOCIATION GRAPH
-- Bidirectional, typed, weighted links between memories.
-- Enables multi-hop retrieval, conflict detection, and
-- associative reasoning (A-Mem / MAGMA / SYNAPSE inspired).
-- ============================================================

CREATE TABLE IF NOT EXISTS memory_links (
  id BIGSERIAL PRIMARY KEY,
  source_id BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  target_id BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK (link_type IN (
    'supports',        -- evidence-backed
    'contradicts',     -- conflicting information
    'elaborates',      -- adds detail to existing memory
    'causes',          -- causal chain
    'follows',         -- temporal sequence
    'relates',         -- general semantic association
    'resolves',        -- contradiction resolution outcome
    'happens_before',  -- temporal ordering
    'happens_after',   -- temporal ordering
    'concurrent_with'  -- temporal co-occurrence
  )),
  strength REAL DEFAULT 0.5,
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
  max_results INT DEFAULT 20,
  filter_owner TEXT DEFAULT NULL
)
RETURNS TABLE (
  memory_id BIGINT,
  linked_from BIGINT,
  link_type TEXT,
  strength FLOAT
)
LANGUAGE sql AS $$
  SELECT DISTINCT ON (ml.target_id, ml.link_type)
    ml.target_id AS memory_id,
    ml.source_id AS linked_from,
    ml.link_type,
    ml.strength::float
  FROM memory_links ml
  JOIN memories m ON m.id = ml.target_id
  WHERE ml.source_id = ANY(seed_ids)
    AND ml.target_id != ALL(seed_ids)
    AND ml.strength >= min_strength
    AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
  UNION
  SELECT DISTINCT ON (ml.source_id, ml.link_type)
    ml.source_id AS memory_id,
    ml.target_id AS linked_from,
    ml.link_type,
    ml.strength::float
  FROM memory_links ml
  JOIN memories m ON m.id = ml.source_id
  WHERE ml.target_id = ANY(seed_ids)
    AND ml.source_id != ALL(seed_ids)
    AND ml.strength >= min_strength
    AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
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
  RETURN QUERY
  SELECT g.memory_id, 1 AS hop, g.link_type, g.strength
  FROM get_linked_memories(seed_ids, min_strength, max_results) g;

  SELECT ARRAY_AGG(DISTINCT g.memory_id)
  INTO hop1_ids
  FROM get_linked_memories(seed_ids, min_strength, max_results) g;

  IF hop1_ids IS NOT NULL AND array_length(hop1_ids, 1) > 0 THEN
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

-- Find unresolved contradiction pairs (no 'resolves' link spanning both memories)
CREATE OR REPLACE FUNCTION get_unresolved_contradictions(
  max_pairs INT DEFAULT 3,
  filter_owner TEXT DEFAULT NULL
)
RETURNS TABLE (
  link_id BIGINT,
  source_id BIGINT,
  target_id BIGINT,
  strength FLOAT
)
LANGUAGE sql AS $$
  SELECT
    ml.id AS link_id,
    ml.source_id,
    ml.target_id,
    ml.strength::float
  FROM memory_links ml
  JOIN memories ms ON ms.id = ml.source_id AND ms.decay_factor > 0.1
  JOIN memories mt ON mt.id = ml.target_id AND mt.decay_factor > 0.1
  WHERE ml.link_type = 'contradicts'
    AND (filter_owner IS NULL OR ms.owner_wallet = filter_owner)
    AND (filter_owner IS NULL OR mt.owner_wallet = filter_owner)
    AND NOT EXISTS (
      SELECT 1 FROM memory_links r1
      JOIN memory_links r2 ON r1.source_id = r2.source_id
      WHERE r1.link_type = 'resolves'
        AND r2.link_type = 'resolves'
        AND r1.target_id = ml.source_id
        AND r2.target_id = ml.target_id
    )
  ORDER BY ml.strength DESC, ml.created_at DESC
  LIMIT max_pairs;
$$;

-- Fragment-level semantic search with deduplication to parent memory.
-- Returns the highest similarity fragment per memory, enabling precision
-- matching against individual facts/sentences rather than whole memories.
CREATE OR REPLACE FUNCTION match_memory_fragments(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10,
  filter_owner text DEFAULT NULL
)
RETURNS TABLE (memory_id bigint, max_similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT f.memory_id, MAX((1 - (f.embedding <=> query_embedding))::float) AS max_similarity
  FROM memory_fragments f
  JOIN memories m ON m.id = f.memory_id
  WHERE f.embedding IS NOT NULL
    AND (1 - (f.embedding <=> query_embedding)) > match_threshold
    AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
  GROUP BY f.memory_id
  ORDER BY max_similarity DESC
  LIMIT match_count;
END;
$$;

-- ============================================================
-- AGENT DASHBOARD: Orchestration & Monitoring
-- Multi-agent registry, task management, activity audit log
-- ============================================================

-- Agent registry
CREATE TABLE IF NOT EXISTS dashboard_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type TEXT DEFAULT 'claude_code' CHECK (type IN ('claude_code', 'script', 'webhook', 'clude_bot', 'content', 'research', 'dev', 'testing', 'design_audit', 'customer_journey')),
  status TEXT DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'paused', 'error')),
  description TEXT,
  config JSONB DEFAULT '{}',
  heartbeat_url TEXT,
  heartbeat_interval_ms INTEGER DEFAULT 300000,
  last_heartbeat_at TIMESTAMPTZ,
  budget_monthly_usd NUMERIC(10,2) DEFAULT 0,
  budget_used_usd NUMERIC(10,2) DEFAULT 0,
  budget_reset_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_agents_status ON dashboard_agents(status);
CREATE INDEX IF NOT EXISTS idx_dashboard_agents_type ON dashboard_agents(type);

-- Task/ticket system
CREATE TABLE IF NOT EXISTS dashboard_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES dashboard_agents(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
  parent_task_id UUID REFERENCES dashboard_tasks(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dashboard_tasks_agent ON dashboard_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_tasks_status ON dashboard_tasks(status);
CREATE INDEX IF NOT EXISTS idx_dashboard_tasks_priority ON dashboard_tasks(priority);

-- Immutable activity/audit log
CREATE TABLE IF NOT EXISTS dashboard_activity (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES dashboard_agents(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  cost_usd NUMERIC(10,4) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_activity_agent ON dashboard_activity(agent_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_activity_action ON dashboard_activity(action);
CREATE INDEX IF NOT EXISTS idx_dashboard_activity_created ON dashboard_activity(created_at DESC);
