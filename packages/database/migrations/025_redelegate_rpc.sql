-- 025: atomic re-delegate RPC (PMP encryption §7). The inverse of revoke_memory.
-- Restores a revoked memory: plaintext summary/embedding back, content_tokens rebuilt,
-- ciphertext cols cleared, provider_delegated=true, provider wrap (re-)inserted.
-- Caller passes the *decrypted* plaintext (it holds the validated DEK); plaintext is a
-- transient RPC arg, never stored beyond the columns it populates.
CREATE OR REPLACE FUNCTION redelegate_memory(
  p_memory_id   bigint,
  p_summary     text,
  p_embedding   text,   -- pgvector string form (e.g. '[0.1,0.2]'), or '' for none
  p_content     text,   -- decrypted plaintext content, for content_tokens (transient, not stored)
  p_wrapped_dek text,
  p_wrap_pubkey text
)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE memories SET
    summary = p_summary,
    summary_ciphertext = NULL,
    embedding = NULLIF(p_embedding, '')::vector,
    embedding_ciphertext = NULL,
    provider_delegated = true
  WHERE id = p_memory_id;
  -- Rebuild content_tokens via the canonical builder (single source of truth — auto-matches
  -- whatever bound set_memory_content_tokens uses; no re-implementation / drift).
  PERFORM set_memory_content_tokens(p_memory_id, p_content);
  INSERT INTO memory_dek_wraps (memory_id, recipient, wrapped_dek, wrap_pubkey)
  VALUES (p_memory_id, 'provider', p_wrapped_dek, p_wrap_pubkey)
  ON CONFLICT (memory_id, recipient) DO UPDATE
    SET wrapped_dek = EXCLUDED.wrapped_dek, wrap_pubkey = EXCLUDED.wrap_pubkey;
END;
$$;
