import { describe, it, expect, vi, beforeEach } from 'vitest';
import nacl from 'tweetnacl';
import { generateDek, encryptField, wrapDek, decryptField } from '@clude/shared/core/memory-envelope';

// Mock only encryption-keys (provides loadProviderKeypair) — this keeps the real
// encryption-keys → database → config (X_API_KEY) chain from loading in tests.
const provider = nacl.box.keyPair();
vi.mock('@clude/shared/core/encryption-keys', () => ({
  loadProviderKeypair: () => ({ publicKey: provider.publicKey, secretKey: provider.secretKey }),
}));

import { revokeMemory, redelegateMemory } from '../memory-revoke';

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

describe('redelegateMemory', () => {
  // The revoked, on-disk shape the helper restores: content stays ciphertext, summary/embedding
  // are sealed, provider_delegated=false. The wrap is POSTED by the client (not fetched).
  beforeEach(() => {
    memRow = {
      content: encryptField('the full plaintext content', dek),
      summary_ciphertext: encryptField('a secret summary', dek),
      embedding_ciphertext: encryptField('[0.1,0.2]', dek),
      encrypted: true,
      provider_delegated: false,
    };
  });

  it('validates the posted wrap by decrypt, then restores via redelegate_memory', async () => {
    const w = wrapDek(dek, provider.publicKey);
    const res = await redelegateMemory(makeDb(), 7, { wrapped_dek: w.wrapped, wrap_pubkey: w.wrapPubkey });
    expect(res.redelegated).toBe(true);
    const call = rpcCalls.find(c => c.name === 'redelegate_memory');
    expect(call).toBeTruthy();
    expect(call!.args.p_memory_id).toBe(7);
    expect(call!.args.p_summary).toBe('a secret summary');
    expect(call!.args.p_embedding).toBe('[0.1,0.2]');
    expect(call!.args.p_content).toBe('the full plaintext content');
    expect(call!.args.p_wrapped_dek).toBe(w.wrapped);
    expect(call!.args.p_wrap_pubkey).toBe(w.wrapPubkey);
  });

  it('rejects a wrap of the WRONG dek (unwraps fine, fails the content decrypt)', async () => {
    // Sealed correctly to the provider, so unwrap succeeds — but it carries the wrong DEK,
    // so the content Poly1305 check fails. This is the core validate-by-decrypt guarantee.
    const forged = wrapDek(generateDek(), provider.publicKey);
    const res = await redelegateMemory(makeDb(), 7, { wrapped_dek: forged.wrapped, wrap_pubkey: forged.wrapPubkey });
    expect(res.redelegated).toBe(false);
    expect(res.reason).toBe('invalid_wrap');
    expect(rpcCalls.find(c => c.name === 'redelegate_memory')).toBeFalsy();
  });

  it('rejects a wrap the provider cannot even unwrap', async () => {
    const stranger = nacl.box.keyPair();
    const forged = wrapDek(dek, stranger.publicKey); // sealed to someone else, not the provider
    const res = await redelegateMemory(makeDb(), 7, { wrapped_dek: forged.wrapped, wrap_pubkey: forged.wrapPubkey });
    expect(res.redelegated).toBe(false);
    expect(res.reason).toBe('invalid_wrap');
    expect(rpcCalls.find(c => c.name === 'redelegate_memory')).toBeFalsy();
  });

  it('no-ops a non-encrypted memory', async () => {
    memRow = { ...memRow, encrypted: false };
    const w = wrapDek(dek, provider.publicKey);
    const res = await redelegateMemory(makeDb(), 7, { wrapped_dek: w.wrapped, wrap_pubkey: w.wrapPubkey });
    expect(res.redelegated).toBe(false);
    expect(res.reason).toBe('not_encrypted');
    expect(rpcCalls.find(c => c.name === 'redelegate_memory')).toBeFalsy();
  });

  it('never returns the raw DEK', async () => {
    const w = wrapDek(dek, provider.publicKey);
    const res = await redelegateMemory(makeDb(), 7, { wrapped_dek: w.wrapped, wrap_pubkey: w.wrapPubkey });
    expect(JSON.stringify(res)).not.toContain(Buffer.from(dek).toString('base64'));
  });
});

describe('revoke → re-delegate round trip (real crypto)', () => {
  it('restores summary/embedding/content and re-delegates atomically', async () => {
    // 1. a live encrypted + delegated memory (plaintext summary/embedding, ciphertext content)
    const content = encryptField('full content body', dek);
    memRow = { summary: 'round trip summary', embedding: '[0.3,0.4]', content, encrypted: true, provider_delegated: true };
    const w1 = wrapDek(dek, provider.publicKey);
    wrapRow = { wrapped_dek: w1.wrapped, wrap_pubkey: w1.wrapPubkey };

    // 2. revoke → seals summary/embedding into the RPC args
    const rev = await revokeMemory(makeDb(), 9);
    expect(rev.revoked).toBe(true);
    const revCall = rpcCalls.find(c => c.name === 'revoke_memory')!;

    // 3. simulate the DB applying revoke: plaintext gone, ciphertext stored, delegated=false
    memRow = {
      content,
      summary_ciphertext: revCall.args.p_summary_ct,
      embedding_ciphertext: revCall.args.p_embedding_ct,
      encrypted: true,
      provider_delegated: false,
    };
    rpcCalls = [];

    // 4. client re-wraps the DEK to the provider; server re-delegates
    const w2 = wrapDek(dek, provider.publicKey);
    const red = await redelegateMemory(makeDb(), 9, { wrapped_dek: w2.wrapped, wrap_pubkey: w2.wrapPubkey });
    expect(red.redelegated).toBe(true);

    // 5. restored plaintext matches the originals exactly
    const redCall = rpcCalls.find(c => c.name === 'redelegate_memory')!;
    expect(redCall.args.p_summary).toBe('round trip summary');
    expect(redCall.args.p_embedding).toBe('[0.3,0.4]');
    expect(redCall.args.p_content).toBe('full content body');
  });
});
