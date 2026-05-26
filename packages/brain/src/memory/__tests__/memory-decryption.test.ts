import { describe, it, expect, vi, beforeEach } from 'vitest';
import nacl from 'tweetnacl';
import { generateDek, encryptField, wrapDek } from '@clude/shared/core/memory-envelope';

// Provider keypair fixture + DB/provider-key mocks (avoid config.ts X_API_KEY load).
const provider = nacl.box.keyPair();
const wrapsRows: any[] = [];
vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({
    // Chain MUST match the impl exactly: select → eq('recipient') → in('memory_id').
    from: () => ({ select: () => ({ eq: () => ({ in: () => ({ data: wrapsRows, error: null }) }) }) }),
  }),
}));
vi.mock('@clude/shared/core/encryption-keys', () => ({
  loadProviderKeypair: () => ({ publicKey: provider.publicKey, secretKey: provider.secretKey }),
}));
// Legacy batch decrypt: identity passthrough (legacy key not configured in tests).
vi.mock('@clude/shared/core/encryption', () => ({ decryptMemoryBatch: (m: any[]) => m }));

import { decryptMemories } from '../memory-decryption';

function makeEnvelopeRow(id: number, plaintext: string) {
  const dek = generateDek();
  const ciphertext = encryptField(plaintext, dek);
  const w = wrapDek(dek, provider.publicKey);
  wrapsRows.push({ memory_id: id, wrapped_dek: w.wrapped, wrap_pubkey: w.wrapPubkey });
  return { id, content: ciphertext, encrypted: true };
}

beforeEach(() => { wrapsRows.length = 0; vi.clearAllMocks(); });

describe('decryptMemories', () => {
  it('passes plaintext rows through untouched', async () => {
    const rows = [{ id: 1, content: 'hello', encrypted: false }];
    expect((await decryptMemories(rows))[0].content).toBe('hello');
  });

  it('decrypts an envelope memory via the provider wrap', async () => {
    const row = makeEnvelopeRow(7, 'secret memory');
    const out = await decryptMemories([row]);
    expect(out[0].content).toBe('secret memory');
  });

  it('leaves a revoked/no-wrap encrypted row as ciphertext (no throw)', async () => {
    const row = { id: 9, content: 'CIPHERTEXTBYTES', encrypted: true }; // no wrap row pushed
    const out = await decryptMemories([row]);
    expect(out[0].content).toBe('CIPHERTEXTBYTES'); // unchanged, did not throw
  });

  it('never logs/returns the raw wrap field name in a way that leaks the DEK', async () => {
    const row = makeEnvelopeRow(3, 'top secret');
    const out = await decryptMemories([row]);
    expect(JSON.stringify(out)).not.toContain('wrapped_dek');
  });
});
