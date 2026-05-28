/**
 * Server-driven revoke + re-delegate (PMP §7).
 *
 * revoke: use the provider DEK one last time to seal summary+embedding, then destroy
 *   the provider wrap (atomic revoke_memory RPC). After this the server cannot read it.
 *   No owner key needed.
 * redelegate: the inverse. The owner client re-wraps the DEK to the provider and posts it;
 *   the server validates the wrap by decrypting the stored ciphertext with it (only the
 *   correct DEK authenticates), unseals summary/embedding, and restores via redelegate_memory.
 *
 * Never logs or returns the DEK.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { unwrapDek, encryptField, decryptField } from '@clude/shared/core/memory-envelope';
import { loadProviderKeypair } from '@clude/shared/core/encryption-keys';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('memory-revoke');

export interface RevokeResult {
  revoked: boolean;
  reason?: string;
}

export async function revokeMemory(db: SupabaseClient, memoryId: number): Promise<RevokeResult> {
  const { data: mem } = await db
    .from('memories')
    .select('summary, embedding, encrypted, provider_delegated')
    .eq('id', memoryId)
    .maybeSingle();
  if (!mem || mem.encrypted !== true || mem.provider_delegated === false) {
    return { revoked: false, reason: 'not_delegated' };
  }

  const { data: wrap } = await db
    .from('memory_dek_wraps')
    .select('wrapped_dek, wrap_pubkey')
    .eq('memory_id', memoryId)
    .eq('recipient', 'provider')
    .maybeSingle();
  if (!wrap) return { revoked: false, reason: 'no_provider_wrap' };

  let providerSecret: Uint8Array;
  try {
    providerSecret = loadProviderKeypair().secretKey;
  } catch {
    return { revoked: false, reason: 'no_provider_key' };
  }

  const dek = unwrapDek(wrap.wrapped_dek, wrap.wrap_pubkey, providerSecret);
  if (!dek) return { revoked: false, reason: 'unwrap_failed' };

  // Seal under the DEK before destroying it. The RPC then clears the plaintext.
  const summaryCt = encryptField(String(mem.summary ?? ''), dek);
  const embeddingCt = mem.embedding != null ? encryptField(String(mem.embedding), dek) : '';

  const { error } = await db.rpc('revoke_memory', {
    p_memory_id: memoryId,
    p_summary_ct: summaryCt,
    p_embedding_ct: embeddingCt,
  });
  if (error) {
    log.error({ memoryId, error: error.message }, 'revoke_memory RPC failed');
    return { revoked: false, reason: 'rpc_failed' };
  }
  log.info({ memoryId }, 'Memory revoked — provider access destroyed');
  return { revoked: true };
}

export interface RedelegateResult {
  redelegated: boolean;
  reason?: string;
}

/**
 * Restore the provider's access to a previously-revoked memory. The owner client unwraps the
 * DEK with its own key and re-wraps it to the provider, posting `{ wrapped_dek, wrap_pubkey }`.
 *
 * Security crux — validate-by-decrypt: we unwrap the posted wrap with the provider secret to get
 * a candidate DEK, then decrypt the memory's stored content ciphertext with it. Poly1305 only
 * authenticates if the wrap carries the *correct* per-memory DEK — which only someone able to
 * unwrap the owner wrap (the owner) can produce. A wrap of any other key fails the decrypt → reject.
 */
export async function redelegateMemory(
  db: SupabaseClient,
  memoryId: number,
  providerWrap: { wrapped_dek: string; wrap_pubkey: string },
): Promise<RedelegateResult> {
  const { data: mem } = await db
    .from('memories')
    .select('content, summary_ciphertext, embedding_ciphertext, encrypted')
    .eq('id', memoryId)
    .maybeSingle();
  if (!mem || mem.encrypted !== true) return { redelegated: false, reason: 'not_encrypted' };

  let providerSecret: Uint8Array;
  try {
    providerSecret = loadProviderKeypair().secretKey;
  } catch {
    return { redelegated: false, reason: 'no_provider_key' };
  }

  // Validate-by-decrypt: the posted wrap must yield the DEK that decrypts this memory's content.
  const dek = unwrapDek(providerWrap.wrapped_dek, providerWrap.wrap_pubkey, providerSecret);
  if (!dek) return { redelegated: false, reason: 'invalid_wrap' };
  const content = decryptField(String(mem.content ?? ''), dek);
  if (content === null) return { redelegated: false, reason: 'invalid_wrap' };

  // Unseal summary/embedding under the (now-validated) DEK. '' when there was none to seal.
  const summary = mem.summary_ciphertext ? decryptField(mem.summary_ciphertext, dek) : '';
  const embedding = mem.embedding_ciphertext ? decryptField(mem.embedding_ciphertext, dek) : '';

  const { error } = await db.rpc('redelegate_memory', {
    p_memory_id: memoryId,
    p_summary: summary ?? '',
    p_embedding: embedding ?? '',
    p_content: content,
    p_wrapped_dek: providerWrap.wrapped_dek,
    p_wrap_pubkey: providerWrap.wrap_pubkey,
  });
  if (error) {
    log.error({ memoryId, error: error.message }, 'redelegate_memory RPC failed');
    return { redelegated: false, reason: 'rpc_failed' };
  }
  log.info({ memoryId }, 'Memory re-delegated — provider access restored');
  return { redelegated: true };
}
