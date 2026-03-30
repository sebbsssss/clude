-- Add chunk_text column to llm_outputs so background processor can claim and process chunks
-- without needing the original file in memory.
ALTER TABLE llm_outputs ADD COLUMN IF NOT EXISTS chunk_text TEXT DEFAULT '';
