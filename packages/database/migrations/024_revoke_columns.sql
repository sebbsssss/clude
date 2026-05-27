-- 024: revoke columns + atomic revoke RPC (PMP encryption §7/§9). Additive.
ALTER TABLE memories ADD COLUMN IF NOT EXISTS summary_ciphertext   TEXT;  -- secretbox(summary) — populated on revoke
ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding_ciphertext TEXT;  -- secretbox(embedding) — populated on revoke

-- Atomic revoke: caller passes the sealed ciphertexts; this clears plaintext + drops the
-- provider wrap in one transaction. summary is NOT NULL → cleared to '' (also empties the
-- generated ts_summary once it is summary-only). embedding/content_tokens → NULL.
CREATE OR REPLACE FUNCTION revoke_memory(p_memory_id bigint, p_summary_ct text, p_embedding_ct text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE memories SET
    summary = '',
    summary_ciphertext = p_summary_ct,
    embedding = NULL,
    embedding_ciphertext = NULLIF(p_embedding_ct, ''),
    content_tokens = NULL,
    provider_delegated = false
  WHERE id = p_memory_id;
  DELETE FROM memory_dek_wraps WHERE memory_id = p_memory_id AND recipient = 'provider';
END;
$$;
