/**
 * Server-driven revoke (PMP §7). Uses the provider DEK one last time to seal
 * summary+embedding, then destroys the provider wrap (via the atomic revoke_memory
 * RPC). After this the server cannot read the memory. No owner key needed.
 * Never logs or returns the DEK.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { unwrapDek, encryptField } from '@clude/shared/core/memory-envelope';
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
