-- 023: provider_delegated flag on memories (PMP encryption §9, Plan 3 write path). Additive.
-- TRUE while the provider may read (delegated); revoke flips it to FALSE (Plan 4).
ALTER TABLE memories ADD COLUMN IF NOT EXISTS provider_delegated BOOLEAN DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_memories_delegated ON memories(provider_delegated) WHERE encrypted = TRUE;
