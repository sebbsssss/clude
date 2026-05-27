import { describe, it, expect, vi, beforeEach } from 'vitest';
import nacl from 'tweetnacl';
import { generateDek, encryptField, wrapDek, decryptField } from '@clude/shared/core/memory-envelope';

// Mock only encryption-keys (provides loadProviderKeypair) — this keeps the real
// encryption-keys → database → config (X_API_KEY) chain from loading in tests.
const provider = nacl.box.keyPair();
vi.mock('@clude/shared/core/encryption-keys', () => ({
  loadProviderKeypair: () => ({ publicKey: provider.publicKey, secretKey: provider.secretKey }),
}));

import { revokeMemory } from '../memory-revoke';

let memRow: any;
let wrapRow: any;
let rpcCalls: Array<{ name: string; args: any }>;
let dek: Uint8Array;

// db is passed as a param to revokeMemory; per-table chain matches the impl's queries:
//   memories:         select().eq().maybeSingle()
//   memory_dek_wraps: select().eq().eq().maybeSingle()
function makeDb() {
  return {
    from: (table: string) =>
      table === 'memory_dek_wraps'
        ? { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: wrapRow, error: null }) }) }) }) }
        : { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: memRow, error: null }) }) }) },
    rpc: async (name: string, args: any) => { rpcCalls.push({ name, args }); return { error: null }; },
  } as any;
}

beforeEach(() => {
  rpcCalls = [];
  dek = generateDek();
  const w = wrapDek(dek, provider.publicKey);
  memRow = { summary: 'a secret summary', embedding: '[0.1,0.2]', encrypted: true, provider_delegated: true };
  wrapRow = { wrapped_dek: w.wrapped, wrap_pubkey: w.wrapPubkey };
});

describe('revokeMemory', () => {
  it('seals summary+embedding under the provider DEK and calls revoke_memory', async () => {
    const res = await revokeMemory(makeDb(), 7);
    expect(res.revoked).toBe(true);
    const call = rpcCalls.find(c => c.name === 'revoke_memory');
    expect(call).toBeTruthy();
    expect(call!.args.p_memory_id).toBe(7);
    expect(decryptField(call!.args.p_summary_ct, dek)).toBe('a secret summary');
    expect(decryptField(call!.args.p_embedding_ct, dek)).toBe('[0.1,0.2]');
  });

  it('no-ops a memory that is not delegated (already revoked / never encrypted)', async () => {
    memRow = { ...memRow, provider_delegated: false };
    const res = await revokeMemory(makeDb(), 7);
    expect(res.revoked).toBe(false);
    expect(rpcCalls.find(c => c.name === 'revoke_memory')).toBeFalsy();
  });

  it('returns no_provider_wrap when there is no provider wrap', async () => {
    wrapRow = null;
    const res = await revokeMemory(makeDb(), 7);
    expect(res.revoked).toBe(false);
    expect(res.reason).toBe('no_provider_wrap');
  });

  it('never returns the raw DEK', async () => {
    const res = await revokeMemory(makeDb(), 7);
    expect(JSON.stringify(res)).not.toContain(Buffer.from(dek).toString('base64'));
  });
});
