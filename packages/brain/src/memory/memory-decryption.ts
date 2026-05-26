/**
 * Envelope-aware batch decryption for recall + VERIFY (PMP §6/§8).
 * Plaintext rows pass through; envelope rows decrypt via the provider DEK wrap;
 * legacy rows fall back to the legacy session-key decryptor; revoked rows (no
 * provider wrap) stay ciphertext. Never throws on a bad row; never logs the DEK.
 */
import { getDb } from '@clude/shared/core/database';
import { unwrapDek, decryptField } from '@clude/shared/core/memory-envelope';
import { loadProviderKeypair } from '@clude/shared/core/encryption-keys';
import { decryptMemoryBatch as legacyDecryptBatch } from '@clude/shared/core/encryption';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('memory-decryption');

interface DecryptableRow { id: number; content: string; encrypted?: boolean }

async function fetchProviderWraps(
  ids: number[],
): Promise<Map<number, { wrapped_dek: string; wrap_pubkey: string }>> {
  const map = new Map<number, { wrapped_dek: string; wrap_pubkey: string }>();
  if (ids.length === 0) return map;
  const { data, error } = await getDb()
    .from('memory_dek_wraps')
    .select('memory_id, wrapped_dek, wrap_pubkey')
    .eq('recipient', 'provider')
    .in('memory_id', ids);
  if (error || !data) return map;
  for (const r of data as Array<{ memory_id: number; wrapped_dek: string; wrap_pubkey: string }>) {
    map.set(r.memory_id, { wrapped_dek: r.wrapped_dek, wrap_pubkey: r.wrap_pubkey });
  }
  return map;
}

/** Decrypt a batch in place (returns the same array, content decrypted where possible). */
export async function decryptMemories<T extends DecryptableRow>(memories: T[]): Promise<T[]> {
  if (!memories || memories.length === 0) return memories;
  const encryptedRows = memories.filter(m => m.encrypted === true);
  if (encryptedRows.length === 0) return memories;

  let providerSecret: Uint8Array | null = null;
  try {
    providerSecret = loadProviderKeypair().secretKey;
  } catch {
    providerSecret = null;
  }

  const wraps = providerSecret
    ? await fetchProviderWraps(encryptedRows.map(m => m.id))
    : new Map<number, { wrapped_dek: string; wrap_pubkey: string }>();
  const legacyRows: T[] = [];

  for (const mem of encryptedRows) {
    const wrap = wraps.get(mem.id);
    if (providerSecret && wrap) {
      const dek = unwrapDek(wrap.wrapped_dek, wrap.wrap_pubkey, providerSecret);
      const plain = dek ? decryptField(mem.content, dek) : null;
      if (plain !== null) {
        mem.content = plain;
        continue;
      }
      log.debug({ id: mem.id }, 'Envelope decrypt failed — leaving ciphertext');
      continue; // revoked or corrupt; leave ciphertext
    }
    // No provider wrap → maybe a legacy-symmetric memory.
    legacyRows.push(mem);
  }

  if (legacyRows.length > 0) legacyDecryptBatch(legacyRows); // in-place; no-ops without legacy key
  return memories;
}

/** Single-memory content decrypt for VERIFY. Returns plaintext or null (undecryptable/revoked). */
export async function decryptOneContent(row: {
  id: number;
  content: string;
  encrypted?: boolean;
}): Promise<string | null> {
  if (row.encrypted !== true) return row.content;
  const [out] = await decryptMemories([{ ...row }]);
  // If content is unchanged after a decrypt attempt on an encrypted row, we couldn't decrypt it.
  return out.content !== row.content ? out.content : null;
}
