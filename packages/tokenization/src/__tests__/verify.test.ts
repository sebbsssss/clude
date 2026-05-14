import { beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { FakeMintClient } from '../mint-client';
import { buildPackTree, inclusionProof } from '../pack-merkle';
import { tokenizeMemory } from '../tokenize-memory';
import { tokenizePack } from '../tokenize-pack';
import { verifyMemory, verifyPackInclusion } from '../verify';
import type { CanonicalMemoryInput } from '../content-hash';

function fakeHash(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

const memoryFields: CanonicalMemoryInput = {
  content: 'remember: ship PMP by May 25',
  memory_type: 'episodic',
  owner_wallet: null,
  created_at: '2026-05-13T12:00:00.000Z',
  tags: ['pmp', 'launch'],
  source: 'chat',
  related_user: null,
  related_wallet: null,
};

describe('verifyMemory', () => {
  let mint: FakeMintClient;
  beforeEach(() => {
    mint = new FakeMintClient();
  });

  it('returns verified=true after a memory has been tokenised', async () => {
    const tokenised = await tokenizeMemory({ ...memoryFields, hashId: 'mem-1' }, mint);
    const result = await verifyMemory(tokenised.contentHash, mint);
    expect(result.verified).toBe(true);
    expect(result.reason).toBe('verified');
    expect(result.commitment).toEqual(tokenised.commitment);
  });

  it('returns verified=false / not-committed for an unknown hash', async () => {
    const result = await verifyMemory(fakeHash('never-stored'), mint);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('not_committed');
    expect(result.commitment).toBeNull();
  });
});

describe('verifyPackInclusion', () => {
  let mint: FakeMintClient;
  beforeEach(() => {
    mint = new FakeMintClient();
  });

  it('verifies a memory is in a pack given a valid inclusion proof', async () => {
    const memories = Array.from({ length: 8 }, (_, i) => ({
      memoryId: 1000 + i,
      contentHash: fakeHash(`mem-${i}`),
    }));
    const pack = await tokenizePack(
      {
        packId: 'pack-1',
        authorWallet: 'wallet-1',
        gateUri: null,
        memories,
      },
      mint,
    );

    const proof = inclusionProof(pack.tree, 3);
    const result = await verifyPackInclusion(
      {
        expectedRoot: pack.tree.root,
        contentHash: memories[3]!.contentHash,
        proof,
      },
      mint,
    );
    expect(result.verified).toBe(true);
    expect(result.reason).toBe('verified');
    expect(result.packCommitment).not.toBeNull();
  });

  it('rejects when proof.leaf does not match the claimed content hash', async () => {
    const memories = Array.from({ length: 4 }, (_, i) => ({
      memoryId: 100 + i,
      contentHash: fakeHash(`m-${i}`),
    }));
    const pack = await tokenizePack(
      {
        packId: 'pack-2',
        authorWallet: 'wallet-1',
        gateUri: null,
        memories,
      },
      mint,
    );
    const proof = inclusionProof(pack.tree, 0);
    const result = await verifyPackInclusion(
      {
        expectedRoot: pack.tree.root,
        contentHash: fakeHash('different-hash'),
        proof,
      },
      mint,
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('leaf_mismatch');
  });

  it('rejects when the Merkle proof is forged', async () => {
    const memories = Array.from({ length: 4 }, (_, i) => ({
      memoryId: 200 + i,
      contentHash: fakeHash(`f-${i}`),
    }));
    const pack = await tokenizePack(
      {
        packId: 'pack-3',
        authorWallet: 'wallet-1',
        gateUri: null,
        memories,
      },
      mint,
    );
    const proof = inclusionProof(pack.tree, 1);
    const tampered = {
      ...proof,
      siblings: proof.siblings.map(() => fakeHash('forged')),
    };
    const result = await verifyPackInclusion(
      {
        expectedRoot: pack.tree.root,
        contentHash: memories[1]!.contentHash,
        proof: tampered,
      },
      mint,
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('merkle_mismatch');
  });

  it('rejects when the expected root is wrong', async () => {
    const memories = Array.from({ length: 4 }, (_, i) => ({
      memoryId: 300 + i,
      contentHash: fakeHash(`w-${i}`),
    }));
    const pack = await tokenizePack(
      {
        packId: 'pack-4',
        authorWallet: 'wallet-1',
        gateUri: null,
        memories,
      },
      mint,
    );
    const proof = inclusionProof(pack.tree, 2);
    const result = await verifyPackInclusion(
      {
        expectedRoot: fakeHash('wrong-root'),
        contentHash: memories[2]!.contentHash,
        proof,
      },
      mint,
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('merkle_mismatch');
  });

  it('throws when neither expectedRoot nor packTokenAddress is provided', async () => {
    const memories = [
      { memoryId: 1, contentHash: fakeHash('only') },
    ];
    const tree = buildPackTree(memories.map((m) => m.contentHash));
    const proof = inclusionProof(tree, 0);
    await expect(
      verifyPackInclusion(
        {
          contentHash: memories[0]!.contentHash,
          proof,
        },
        mint,
      ),
    ).rejects.toThrow(/expectedRoot or packTokenAddress/);
  });

  it('returns pack-not-found when only packTokenAddress is provided (root lookup not yet supported)', async () => {
    // v0.1 MintClient only supports fetch-by-root. Callers should pre-resolve the
    // root from the chain adapter and pass it in expectedRoot. A pure-token-address
    // path is reserved for v0.2 when the chain adapter grows fetchPackByTokenAddress.
    const memories = [{ memoryId: 1, contentHash: fakeHash('only') }];
    const tree = buildPackTree(memories.map((m) => m.contentHash));
    const proof = inclusionProof(tree, 0);
    const result = await verifyPackInclusion(
      {
        packTokenAddress: 'some-pack-token',
        contentHash: memories[0]!.contentHash,
        proof,
      },
      mint,
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toBe('pack_not_found');
  });
});
