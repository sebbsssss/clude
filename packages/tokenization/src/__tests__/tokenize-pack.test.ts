import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { FakeMintClient } from '../mint-client';
import { verifyInclusion, inclusionProof } from '../pack-merkle';
import { tokenizePack, type TokenizePackInput } from '../tokenize-pack';

function fakeHash(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

const memories = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    memoryId: 1000 + i,
    contentHash: fakeHash(`mem-${i}`),
  }));

const baseInput = (count = 4): TokenizePackInput => ({
  packId: 'pack-abc',
  authorWallet: 'GsbwXfQGv9pBkj1234567890abcdef1234567890abcdef',
  gateUri: 'https://api.portablememoryprotocol.com/v1/packs/pack-abc/unlock',
  memories: memories(count),
});

describe('tokenizePack', () => {
  let mint: FakeMintClient;
  beforeEach(() => {
    mint = new FakeMintClient();
  });

  it('throws on an empty memory list', async () => {
    await expect(
      tokenizePack({ ...baseInput(), memories: [] }, mint),
    ).rejects.toThrow();
  });

  it('builds a Merkle tree from the member content hashes', async () => {
    const input = baseInput(4);
    const result = await tokenizePack(input, mint);
    expect(result.tree.leaves).toEqual(input.memories.map((m) => m.contentHash));
    expect(result.tree.depth).toBe(2);
  });

  it('commits the Merkle root via the MintClient', async () => {
    const result = await tokenizePack(baseInput(4), mint);
    expect(result.commitment.merkleRoot).toBe(result.tree.root);
    const fetched = await mint.fetchPackCommitment(result.tree.root);
    expect(fetched).toEqual(result.commitment);
  });

  it('returns a patch with all the persistence fields filled', async () => {
    const result = await tokenizePack(baseInput(4), mint);
    expect(result.patch.merkle_root).toBe(result.tree.root);
    expect(result.patch.pack_token_address).toBe(result.commitment.packTokenAddress);
    expect(result.patch.pack_token_tx_sig).toBe(result.commitment.txSig);
    expect(result.patch.memory_count).toBe(4);
    expect(result.patch.tokenized_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.patch.published_at).toBe(result.patch.tokenized_at);
  });

  it('returns content rows for memory_pack_contents in order', async () => {
    const input = baseInput(5);
    const result = await tokenizePack(input, mint);
    expect(result.contentRows).toHaveLength(5);
    result.contentRows.forEach((row, i) => {
      expect(row.memory_id).toBe(input.memories[i]!.memoryId);
      expect(row.leaf_index).toBe(i);
      expect(row.content_hash).toBe(input.memories[i]!.contentHash);
    });
  });

  it('produces inclusion proofs that verify against the committed root', async () => {
    const result = await tokenizePack(baseInput(8), mint);
    for (let i = 0; i < 8; i++) {
      const proof = inclusionProof(result.tree, i);
      expect(verifyInclusion(result.tree.root, proof)).toBe(true);
    }
  });

  it('handles odd member counts (Merkle tree balances correctly)', async () => {
    const result = await tokenizePack(baseInput(7), mint);
    for (let i = 0; i < 7; i++) {
      const proof = inclusionProof(result.tree, i);
      expect(verifyInclusion(result.tree.root, proof)).toBe(true);
    }
  });

  it('scales to 100 members', async () => {
    const result = await tokenizePack(baseInput(100), mint);
    expect(result.tree.depth).toBe(7);
    expect(result.contentRows).toHaveLength(100);
    // Spot-check a few leaves
    for (const i of [0, 17, 49, 99]) {
      const proof = inclusionProof(result.tree, i);
      expect(verifyInclusion(result.tree.root, proof)).toBe(true);
    }
  });

  it('different membership produces different merkle roots', async () => {
    const a = await tokenizePack(baseInput(4), mint);
    const b = await tokenizePack(
      { ...baseInput(4), memories: memories(4).reverse() },
      mint,
    );
    expect(a.tree.root).not.toBe(b.tree.root);
  });
});
