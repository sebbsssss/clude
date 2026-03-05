-- ============================================================
-- MIGRATION 003: Hash-Based IDs + Compaction (Beads-inspired)
--
-- Adds:
-- 1. hash_id column for collision-resistant memory IDs
-- 2. compacted/compacted_into for memory compaction tracking
-- 3. Index for compaction queries
--
-- Run after existing schema is in place.
-- ============================================================

-- Add hash_id column (collision-resistant ID like "clude-a1b2c3d4")
ALTER TABLE memories ADD COLUMN IF NOT EXISTS hash_id TEXT;

-- Add compaction tracking columns
ALTER TABLE memories ADD COLUMN IF NOT EXISTS compacted BOOLEAN DEFAULT FALSE;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS compacted_into TEXT; -- hash_id of summary memory

-- Generate hash_ids for existing memories (backfill)
-- Using md5 of id + created_at for deterministic backfill
UPDATE memories 
SET hash_id = 'clude-' || SUBSTRING(md5(id::text || created_at::text), 1, 8)
WHERE hash_id IS NULL;

-- Make hash_id NOT NULL after backfill
ALTER TABLE memories ALTER COLUMN hash_id SET NOT NULL;

-- Create unique index on hash_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_hash_id ON memories(hash_id);

-- Index for compaction queries (find old, faded, uncompacted episodic memories)
CREATE INDEX IF NOT EXISTS idx_memories_compaction 
ON memories(memory_type, compacted, decay_factor, importance, created_at)
WHERE memory_type = 'episodic' AND compacted = FALSE;

-- Index for looking up what a memory was compacted into
CREATE INDEX IF NOT EXISTS idx_memories_compacted_into ON memories(compacted_into)
WHERE compacted_into IS NOT NULL;

-- Update the dream_logs table to track compaction sessions
-- (The existing session_type column already supports arbitrary types)

-- Add compaction to the session_type documentation comment
COMMENT ON COLUMN dream_logs.session_type IS 
  'Type of dream session: consolidation, reflection, emergence, decay, compaction';
