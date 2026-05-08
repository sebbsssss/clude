-- 018_chat_message_attachments.sql
-- Adds optional image attachments array to chat messages.
-- Each entry: { storage_path, mime, width, height, size_bytes }
-- The signed URL is regenerated on read; never persisted.

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS attachments jsonb;

COMMENT ON COLUMN chat_messages.attachments IS
  'Optional array of image attachment metadata. URL is re-signed on every read.';
