-- Entities table: knowledge graph nodes
CREATE TABLE IF NOT EXISTS entities (
  id SERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('person', 'project', 'concept', 'token', 'wallet', 'location', 'event')),
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  aliases TEXT[] DEFAULT '{}',
  description TEXT,
  metadata JSONB DEFAULT '{}',
  mention_count INTEGER DEFAULT 1,
  first_seen TIMESTAMPTZ DEFAULT NOW(),
  last_seen TIMESTAMPTZ DEFAULT NOW(),
  embedding VECTOR(1024)
);

-- Unique on normalized name to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_entities_normalized_name ON entities (normalized_name);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities (entity_type);
CREATE INDEX IF NOT EXISTS idx_entities_mention_count ON entities (mention_count DESC);

-- Entity mentions: links entities to memories
CREATE TABLE IF NOT EXISTS entity_mentions (
  id SERIAL PRIMARY KEY,
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  memory_id INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  context TEXT,
  salience REAL DEFAULT 0.5,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_mentions_unique ON entity_mentions (entity_id, memory_id);
CREATE INDEX IF NOT EXISTS idx_entity_mentions_entity ON entity_mentions (entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_mentions_memory ON entity_mentions (memory_id);

-- Entity relations: edges between entities
CREATE TABLE IF NOT EXISTS entity_relations (
  id SERIAL PRIMARY KEY,
  source_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  strength REAL DEFAULT 0.5,
  evidence_memory_ids INTEGER[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entity_relations_source ON entity_relations (source_entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_relations_target ON entity_relations (target_entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_relations_unique ON entity_relations (source_entity_id, target_entity_id, relation_type);

-- Unique constraint on source_id to prevent duplicate tweet memories
-- (partial index: only applies where source_id is not null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_source_id_unique
  ON memories (source_id) WHERE source_id IS NOT NULL;

-- Vector similarity search function for entities
CREATE OR REPLACE FUNCTION match_entities(
  query_embedding VECTOR(1024),
  match_threshold FLOAT DEFAULT 0.3,
  match_count INT DEFAULT 10,
  filter_types TEXT[] DEFAULT NULL
)
RETURNS TABLE (
  id INT,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    1 - (e.embedding <=> query_embedding) AS similarity
  FROM entities e
  WHERE e.embedding IS NOT NULL
    AND 1 - (e.embedding <=> query_embedding) > match_threshold
    AND (filter_types IS NULL OR e.entity_type = ANY(filter_types))
  ORDER BY e.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
