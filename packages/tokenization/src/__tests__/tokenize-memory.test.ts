import { beforeEach, describe, expect, it } from 'vitest';
import { FakeMintClient } from '../mint-client';
import { memoryContentHash, type CanonicalMemoryInput } from '../content-hash';
import { tokenizeMemory, type TokenizeMemoryInput } from '../tokenize-memory';

const baseMemory: TokenizeMemoryInput = {
  hashId: 'mem-abcd1234',
  content: 'The pricing meeting concluded with a per-token model.',
  memory_type: 'episodic',
  owner_wallet: 'GsbwXfQGv9pBkj1234567890abcdef1234567890abcdef',
  created_at: '2026-05-13T12:00:00.000Z',
  tags: ['pricing', 'q3-roadmap'],
  source: 'chat',
  related_user: null,
  related_wallet: null,
};

describe('tokenizeMemory', () => {
  let mint: FakeMintClient;

  beforeEach(() => {
    mint = new FakeMintClient();
  });

  it('computes the canonical content hash before minting', async () => {
    const expected = memoryContentHash(baseMemory);
    const result = await tokenizeMemory(baseMemory, mint);
    expect(result.contentHash).toBe(expected);
  });

  it('persists a memory commitment that round-trips via fetchMemoryCommitment', async () => {
    const result = await tokenizeMemory(baseMemory, mint);
    const fetched = await mint.fetchMemoryCommitment(result.contentHash);
    expect(fetched).not.toBeNull();
    expect(fetched).toEqual(result.commitment);
  });

  it('returns a patch with mint metadata + minted status', async () => {
    const result = await tokenizeMemory(baseMemory, mint);
    expect(result.patch.tokenization_status).toBe('minted');
    expect(result.patch.content_hash).toBe(result.contentHash);
    expect(result.patch.cnft_address).toBe(result.commitment.assetId);
    expect(result.patch.cnft_tx_sig).toBe(result.commitment.txSig);
    expect(result.patch.tokenized_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-8601-ish
  });

  it('is idempotent on identical input — same memory, same commitment', async () => {
    const first = await tokenizeMemory(baseMemory, mint);
    const second = await tokenizeMemory(baseMemory, mint);
    expect(second.contentHash).toBe(first.contentHash);
    expect(second.commitment).toEqual(first.commitment);
  });

  it('forwards owner_wallet to the mint client', async () => {
    let captured: string | null | undefined;
    const captureClient: typeof mint = Object.assign(new FakeMintClient(), {
      commitMemoryHash: async (input: { ownerWallet: string | null }) => {
        captured = input.ownerWallet;
        return {
          chain: 'fake' as const,
          assetId: 'a',
          txSig: 't',
          treeAddress: null,
          leafIndex: null,
        };
      },
    });
    await tokenizeMemory(baseMemory, captureClient);
    expect(captured).toBe(baseMemory.owner_wallet);
  });

  it('handles null owner_wallet (bot-owned memory)', async () => {
    const botMemory: TokenizeMemoryInput = { ...baseMemory, owner_wallet: null };
    const result = await tokenizeMemory(botMemory, mint);
    expect(result.contentHash).toBe(memoryContentHash(botMemory));
    expect(result.patch.cnft_address).toMatch(/^fake-mem-/);
  });

  it('different memories produce different content hashes and commitments', async () => {
    const a = await tokenizeMemory(baseMemory, mint);
    const b = await tokenizeMemory({ ...baseMemory, content: 'different content' }, mint);
    expect(a.contentHash).not.toBe(b.contentHash);
    expect(a.commitment.assetId).not.toBe(b.commitment.assetId);
    expect(a.commitment.txSig).not.toBe(b.commitment.txSig);
  });

  it('propagates errors from the mint client', async () => {
    const failingClient: typeof mint = Object.assign(new FakeMintClient(), {
      commitMemoryHash: async () => {
        throw new Error('RPC unavailable');
      },
    });
    await expect(tokenizeMemory(baseMemory, failingClient)).rejects.toThrow('RPC unavailable');
  });
});
