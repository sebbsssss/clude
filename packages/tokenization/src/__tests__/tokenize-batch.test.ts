import { beforeEach, describe, expect, it } from 'vitest';
import { FakeMintClient } from '../mint-client';
import { memoryContentHash, type CanonicalMemoryInput } from '../content-hash';
import { verifyInclusion } from '../pack-merkle';
import { tokenizeMemoryBatch, type TokenizeBatchMemberInput } from '../tokenize-batch';

function member(i: number, overrides: Partial<CanonicalMemoryInput> = {}): TokenizeBatchMemberInput {
  return {
    hashId: `mem-${i}`,
    content: `memory number ${i}`,
    memory_type: 'episodic',
    owner_wallet: i % 2 === 0 ? null : `wallet-${i}`,
    created_at: `2026-05-16T12:0${i % 10}:00.000Z`,
    tags: [`tag-${i}`],
    source: 'chat',
    related_user: null,
    related_wallet: null,
    ...overrides,
  };
}

const batchOf = (n: number) => Array.from({ length: n }, (_, i) => member(i));

describe('tokenizeMemoryBatch', () => {
  let mint: FakeMintClient;

  beforeEach(() => {
    mint = new FakeMintClient();
  });

  it('throws on an empty batch', async () => {
    await expect(tokenizeMemoryBatch('batch-x', [], mint)).rejects.toThrow(/at least one/);
  });

  it('commits exactly one on-chain write for the whole batch', async () => {
    let commitCalls = 0;
    const counting: FakeMintClient = Object.assign(new FakeMintClient(), {
      commitMemoryBatch: async (input: Parameters<FakeMintClient['commitMemoryBatch']>[0]) => {
        commitCalls += 1;
        return {
          chain: 'fake' as const,
          assetId: `batch-asset-${commitCalls}`,
          txSig: `batch-tx-${commitCalls}`,
          merkleRoot: input.merkleRoot,
        };
      },
    });
    await tokenizeMemoryBatch('batch-1', batchOf(50), counting);
    expect(commitCalls).toBe(1);
  });

  it('computes each member content hash with the canonical algorithm', async () => {
    const inputs = batchOf(4);
    const result = await tokenizeMemoryBatch('batch-2', inputs, mint);
    result.members.forEach((m, i) => {
      expect(m.contentHash).toBe(memoryContentHash(inputs[i]!));
      expect(m.hashId).toBe(inputs[i]!.hashId);
      expect(m.leafIndex).toBe(i);
    });
  });

  it('every member proof verifies against the committed batch root', async () => {
    const result = await tokenizeMemoryBatch('batch-3', batchOf(16), mint);
    for (const m of result.members) {
      expect(verifyInclusion(result.batchRoot, m.proof)).toBe(true);
      expect(m.proof.leaf).toBe(m.contentHash);
    }
  });

  it('the committed root matches the rebuilt tree root', async () => {
    const result = await tokenizeMemoryBatch('batch-4', batchOf(8), mint);
    expect(result.commitment.merkleRoot).toBe(result.batchRoot);
    expect(result.tree.root).toBe(result.batchRoot);
    const fetched = await mint.fetchBatchCommitment(result.batchRoot);
    expect(fetched).toEqual(result.commitment);
  });

  it('each member patch carries the batch root and leaf index', async () => {
    const result = await tokenizeMemoryBatch('batch-5', batchOf(5), mint);
    result.members.forEach((m, i) => {
      expect(m.patch.tokenization_status).toBe('minted');
      expect(m.patch.content_hash).toBe(m.contentHash);
      expect(m.patch.cnft_tree).toBe(result.batchRoot); // batch root, not null
      expect(m.patch.cnft_leaf_index).toBe(i);
      expect(m.patch.cnft_address).toBe(result.commitment.assetId);
      expect(m.patch.cnft_tx_sig).toBe(result.commitment.txSig);
      expect(m.patch.tokenized_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  it('handles odd-sized batches (Merkle tree balances correctly)', async () => {
    const result = await tokenizeMemoryBatch('batch-odd', batchOf(7), mint);
    expect(result.members).toHaveLength(7);
    for (const m of result.members) {
      expect(verifyInclusion(result.batchRoot, m.proof)).toBe(true);
    }
  });

  it('handles a single-memory batch', async () => {
    const result = await tokenizeMemoryBatch('batch-one', batchOf(1), mint);
    expect(result.members).toHaveLength(1);
    expect(verifyInclusion(result.batchRoot, result.members[0]!.proof)).toBe(true);
  });

  it('scales to 1000 memories with one commitment', async () => {
    const result = await tokenizeMemoryBatch('batch-big', batchOf(1000), mint);
    expect(result.members).toHaveLength(1000);
    expect(result.tree.depth).toBe(10); // ceil(log2(1000))
    // Spot-check inclusion proofs across the tree.
    for (const i of [0, 1, 499, 500, 999]) {
      expect(verifyInclusion(result.batchRoot, result.members[i]!.proof)).toBe(true);
    }
  });

  it('different batches produce different roots; identical content produces identical roots', async () => {
    const a = await tokenizeMemoryBatch('batch-a', batchOf(4), mint);
    const b = await tokenizeMemoryBatch('batch-b', batchOf(4), mint);
    // Same content (batchOf is deterministic) → same Merkle root, even though
    // the batchId differs. The root is a function of content only.
    expect(a.batchRoot).toBe(b.batchRoot);

    const c = await tokenizeMemoryBatch('batch-c', batchOf(5), mint);
    expect(c.batchRoot).not.toBe(a.batchRoot);
  });

  it('a tampered proof fails verification (negative control)', async () => {
    const result = await tokenizeMemoryBatch('batch-neg', batchOf(8), mint);
    const proof = result.members[2]!.proof;
    const tampered = { ...proof, siblings: proof.siblings.map(() => 'f'.repeat(64)) };
    expect(verifyInclusion(result.batchRoot, tampered)).toBe(false);
  });
});
