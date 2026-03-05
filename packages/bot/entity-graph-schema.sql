-- ============================================================
-- ENTITY-CENTRIC KNOWLEDGE GRAPH
-- Extends memory system with explicit entity tracking
-- Run after supabase-schema.sql
-- ============================================================

-- Entities: People, projects, concepts, tokens, etc.
CREATE TABLE IF NOT EXISTS entities (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN (
    'person', 'project', 'concept', 'token', 'wallet', 'location', 'event'
  )),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,  -- lowercase, for deduplication
  aliases TEXT[] DEFAULT '{}',
  description TEXT,
  metadata JSONB DEFAULT '{}',
  mention_count INTEGER DEFAULT 1,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  embedding vector(1024)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_normalized ON entities(normalized_name, entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_mentions ON entities(mention_count DESC);
CREATE INDEX IF NOT EXISTS idx_entities_aliases ON entities USING GIN(aliases);
CREATE INDEX IF NOT EXISTS idx_entities_embedding ON entities USING hnsw (embedding vector_cosine_ops);

-- Entity mentions: Links entities to memories
CREATE TABLE IF NOT EXISTS entity_mentions (
  id BIGSERIAL PRIMARY KEY,
  entity_id BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  memory_id BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  context TEXT,           -- snippet around the mention
  salience REAL DEFAULT 0.5,  -- 0-1, how central is this entity
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(entity_id, memory_id)
);

CREATE INDEX IF NOT EXISTS idx_mentions_entity ON entity_mentions(entity_id);
CREATE INDEX IF NOT EXISTS idx_mentions_memory ON entity_mentions(memory_id);
CREATE INDEX IF NOT EXISTS idx_mentions_salience ON entity_mentions(salience DESC);

-- Entity relations: Links between entities
CREATE TABLE IF NOT EXISTS entity_relations (
  id BIGSERIAL PRIMARY KEY,
  source_entity_id BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_entity_id BIGINT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,  -- 'knows', 'created', 'owns', 'part_of', 'related_to'
  strength REAL DEFAULT 0.5,
  evidence_memory_ids BIGINT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(source_entity_id, target_entity_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_relations_source ON entity_relations(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON entity_relations(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_relations_type ON entity_relations(relation_type);

-- Vector search for entities
CREATE OR REPLACE FUNCTION match_entities(
  query_embedding vector(1024),
  match_threshold float DEFAULT 0.3,
  match_count int DEFAULT 10,
  filter_types text[] DEFAULT NULL
)
RETURNS TABLE (id bigint, similarity float)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  SELECT e.id, (1 - (e.embedding <=> query_embedding))::float AS similarity
  FROM entities e
  WHERE e.embedding IS NOT NULL
    AND (filter_types IS NULL OR e.entity_type = ANY(filter_types))
    AND (1 - (e.embedding <=> query_embedding)) > match_threshold
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- Get entity co-occurrence graph (entities that appear together in memories)
CREATE OR REPLACE FUNCTION get_entity_cooccurrence(
  entity_id BIGINT,
  min_cooccurrence INT DEFAULT 2,
  max_results INT DEFAULT 20
)
RETURNS TABLE (
  related_entity_id BIGINT,
  cooccurrence_count BIGINT,
  avg_salience FLOAT
)
LANGUAGE sql AS $$
  SELECT 
    em2.entity_id AS related_entity_id,
    COUNT(*) AS cooccurrence_count,
    AVG(em2.salience)::float AS avg_salience
  FROM entity_mentions em1
  JOIN entity_mentions em2 ON em1.memory_id = em2.memory_id
  WHERE em1.entity_id = get_entity_cooccurrence.entity_id
    AND em2.entity_id != get_entity_cooccurrence.entity_id
  GROUP BY em2.entity_id
  HAVING COUNT(*) >= min_cooccurrence
  ORDER BY COUNT(*) DESC, AVG(em2.salience) DESC
  LIMIT max_results;
$$;

-- Get full knowledge graph around an entity (2-hop)
CREATE OR REPLACE FUNCTION get_entity_neighborhood(
  seed_entity_id BIGINT,
  max_entities INT DEFAULT 30,
  max_memories INT DEFAULT 20
)
RETURNS TABLE (
  node_type TEXT,
  node_id BIGINT,
  node_label TEXT,
  edge_type TEXT,
  edge_weight FLOAT
)
LANGUAGE plpgsql AS $$
BEGIN
  -- Return the seed entity
  RETURN QUERY
  SELECT 'entity'::TEXT, e.id, e.name, NULL::TEXT, NULL::FLOAT
  FROM entities e WHERE e.id = seed_entity_id;

  -- Return related entities (via relations)
  RETURN QUERY
  SELECT 'entity'::TEXT, e.id, e.name, er.relation_type, er.strength::float
  FROM entity_relations er
  JOIN entities e ON e.id = er.target_entity_id
  WHERE er.source_entity_id = seed_entity_id
  LIMIT max_entities / 2;

  RETURN QUERY
  SELECT 'entity'::TEXT, e.id, e.name, er.relation_type, er.strength::float
  FROM entity_relations er
  JOIN entities e ON e.id = er.source_entity_id
  WHERE er.target_entity_id = seed_entity_id
  LIMIT max_entities / 2;

  -- Return co-occurring entities
  RETURN QUERY
  SELECT 'entity'::TEXT, co.related_entity_id, e.name, 'co-occurs'::TEXT, co.avg_salience
  FROM get_entity_cooccurrence(seed_entity_id, 1, max_entities) co
  JOIN entities e ON e.id = co.related_entity_id
  LIMIT max_entities;

  -- Return memories mentioning this entity
  RETURN QUERY
  SELECT 
    ('memory-' || m.memory_type)::TEXT, 
    m.id, 
    LEFT(m.summary, 60), 
    'mentioned_in'::TEXT, 
    em.salience::float
  FROM entity_mentions em
  JOIN memories m ON m.id = em.memory_id
  WHERE em.entity_id = seed_entity_id
  ORDER BY em.salience DESC, m.importance DESC
  LIMIT max_memories;
END;
$$;
