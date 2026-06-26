/**
 * Unit tests for the sealed-safe pack-preview helper.
 *
 * Tradeable Memory Packs — Slice 1, Part A, Task 5.
 *
 * `pack-preview.ts` is a pure module (no DB, no I/O) extracted from the inline
 * preview + verify logic in `pmp-packs.routes.ts`. These tests pin:
 *   - the selective-disclosure shape (full `leaves[]` + N `revealed[]` + counts),
 *   - inclusion proofs that verify against the committed Merkle root,
 *   - the root-rebuild safety check (rebuilt root must equal committed root),
 *   - the §00 MAJOR-5 hardening: for `content_category='personal'` the per-leaf
 *     plaintext `leaf_hash` MUST be omitted (no guess-confirmation oracle),
 *   - `verifyPackCommitment` verified / drift / no-contents paths.
 */
import { describe, expect, it } from 'vitest';
import { buildPackTree, verifyInclusion, type MerkleProof } from '@clude/tokenization';
import { createHash } from 'node:crypto';
import {
  buildPackPreview,
  verifyPackCommitment,
  type PreviewPack,
  type PreviewMember,
  type PreviewMemoryBody,
} from '../pack-preview.js';

function fakeHash(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

const leafHashes = Array.from({ length: 4 }, (_, i) => fakeHash(`leaf-${i}`));
const tree = buildPackTree(leafHashes);

function members(): PreviewMember[] {
  return leafHashes.map((h, i) => ({ memory_id: 100 + i, leaf_index: i, content_hash: h }));
}

function knowledgePack(overrides: Partial<PreviewPack> = {}): PreviewPack {
  return {
    pack_id: 'pack-p',
    name: 'P',
    version: '1.0.0',
    author_wallet: 'wallet-1',
    memory_count: 4,
    merkle_root: tree.root,
    pack_token_address: 'memo:tx-p',
    content_category: 'knowledge',
    ...overrides,
  };
}

function memoriesById(): Map<number, PreviewMemoryBody> {
  const m = new Map<number, PreviewMemoryBody>();
  m.set(100, {
    id: 100,
    hash_id: 'mem-0',
    memory_type: 'episodic',
    content: 'content of 0',
    owner_wallet: 'wallet-1',
    created_at: '2026-05-13T12:00:00Z',
    tags: ['t'],
  });
  return m;
}

describe('buildPackPreview', () => {
  it('rebuilds the tree, reveals N leaves with verifiable inclusion proofs, and counts the rest', () => {
    const result = buildPackPreview(knowledgePack(), members(), memoriesById(), { count: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.merkleRoot).toBe(tree.root);
    expect(result.revealed_count).toBe(1);
    expect(result.unrevealed_count).toBe(3);
    expect(result.revealed).toHaveLength(1);

    const r = result.revealed[0]!;
    expect(r.content_hash).toBe(leafHashes[0]);
    expect(r.leaf_index).toBe(0);
    expect(r.memory).not.toBeNull();
    expect(r.memory?.id).toBe('mem-0');
    expect(r.memory?.content).toBe('content of 0');

    // The returned proof must verify against the committed on-chain root.
    expect(r.proof).not.toBeNull();
    const rp = r.proof!;
    const proof = {
      leaf: rp.leaf,
      leafIndex: rp.leaf_index,
      siblings: rp.siblings,
      algorithm: rp.algorithm,
    } as MerkleProof;
    expect(verifyInclusion(tree.root, proof)).toBe(true);
  });

  it('clamps the revealed count to the number of members', () => {
    const result = buildPackPreview(knowledgePack(), members(), new Map(), { count: 99999 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revealed_count).toBe(4);
    expect(result.unrevealed_count).toBe(0);
  });

  it('returns memory:null for a revealed leaf whose body was not provided', () => {
    const result = buildPackPreview(knowledgePack(), members(), new Map(), { count: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.revealed[0]!.memory).toBeNull();
    // ...but the content_hash + proof are still present.
    expect(result.revealed[0]!.content_hash).toBe(leafHashes[0]);
    expect(result.revealed[0]!.proof).not.toBeNull();
    expect(result.revealed[0]!.proof!.leaf).toBe(leafHashes[0]);
  });

  it('fails closed when the rebuilt root does not match the committed root', () => {
    const tampered = members().map((m, i) => ({ ...m, content_hash: fakeHash(`tampered-${i}`) }));
    const result = buildPackPreview(knowledgePack(), tampered, new Map(), { count: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('root_mismatch');
  });

  it('returns no_contents when there are no members', () => {
    const result = buildPackPreview(knowledgePack({ memory_count: 0 }), [], new Map(), { count: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no_contents');
  });

  // ── §00 MAJOR-5: personal-pack plaintext leaf-hash oracle suppression ──

  it('exposes a full per-leaf `leaves[]` array with `leaf_hash` for non-personal packs', () => {
    const result = buildPackPreview(knowledgePack(), members(), new Map(), { count: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leaves).toHaveLength(4);
    for (let i = 0; i < result.leaves.length; i++) {
      expect(result.leaves[i]!.leaf_index).toBe(i);
      expect(result.leaves[i]!.leaf_hash).toBe(leafHashes[i]);
    }
  });

  it('OMITS the per-leaf plaintext `leaf_hash` for personal packs (guess-confirmation oracle)', () => {
    const result = buildPackPreview(
      knowledgePack({ content_category: 'personal' }),
      members(),
      memoriesById(),
      { count: 1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leaves).toHaveLength(4);
    for (let i = 0; i < result.leaves.length; i++) {
      expect(result.leaves[i]!.leaf_index).toBe(i);
      expect(result.leaves[i]!.leaf_hash).toBeUndefined();
    }
  });

  it('also suppresses the plaintext content_hash on revealed entries for personal packs', () => {
    const result = buildPackPreview(
      knowledgePack({ content_category: 'personal' }),
      members(),
      memoriesById(),
      { count: 1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The Merkle root still anchors provenance, but no plaintext leaf hash leaks.
    expect(result.revealed[0]!.content_hash).toBeUndefined();
    expect(result.revealed[0]!.proof).toBeNull();
  });

  it('passes the leaf_hash through for an explicitly null category (legacy, fail-open to disclosure)', () => {
    // The legacy /v1/packs/:id/preview route has no category; null/undefined must
    // behave exactly as before (full disclosure) so the 27 characterization tests stay green.
    const result = buildPackPreview(
      knowledgePack({ content_category: null }),
      members(),
      new Map(),
      { count: 1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.leaves[0]!.leaf_hash).toBe(leafHashes[0]);
    expect(result.revealed[0]!.content_hash).toBe(leafHashes[0]);
  });
});

describe('verifyPackCommitment', () => {
  const vLeaves = Array.from({ length: 5 }, (_, i) => fakeHash(`v-${i}`));
  const vTree = buildPackTree(vLeaves);

  function verifyMembers(hashes: string[]): PreviewMember[] {
    return hashes.map((h, i) => ({ memory_id: 200 + i, leaf_index: i, content_hash: h }));
  }

  it('returns verified when the rebuilt root matches and the count agrees', () => {
    const out = verifyPackCommitment(
      { merkle_root: vTree.root, memory_count: 5 },
      verifyMembers(vLeaves),
    );
    expect(out.verified).toBe(true);
    expect(out.reason).toBe('verified');
    expect(out.recomputedRoot).toBe(vTree.root);
    expect(out.committedRoot).toBe(vTree.root);
  });

  it('returns drift_detected when leaves were tampered', () => {
    const out = verifyPackCommitment(
      { merkle_root: vTree.root, memory_count: 5 },
      verifyMembers(vLeaves.map((_, i) => fakeHash(`tampered-${i}`))),
    );
    expect(out.verified).toBe(false);
    expect(out.reason).toBe('drift_detected');
  });

  it('returns drift_detected when the count disagrees even if the root rebuilds', () => {
    // Same leaves rebuild the same root, but memory_count claims more than exist.
    const out = verifyPackCommitment(
      { merkle_root: vTree.root, memory_count: 99 },
      verifyMembers(vLeaves),
    );
    expect(out.verified).toBe(false);
    expect(out.reason).toBe('drift_detected');
  });

  it('returns no_contents when there are no members', () => {
    const out = verifyPackCommitment({ merkle_root: vTree.root, memory_count: 5 }, []);
    expect(out.verified).toBe(false);
    expect(out.reason).toBe('no_contents');
    expect(out.recomputedRoot).toBeNull();
  });
});
