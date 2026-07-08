import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  buildPackTree,
  buildPackTreeV2,
  inclusionProofV2,
  verifyInclusionV2,
  MERKLE_ALGORITHM_V2,
} from '../pack-merkle';

/**
 * sha256-merkle-v2 (Memory 3.0 Track B1): CT-style domain separation +
 * odd-tail promotion. The two structural guarantees under test:
 *   1. [A,B] and [A,B,B] commit to DIFFERENT roots (v1's duplicate-last made
 *      them equal — a pack could gain a duplicated record without changing
 *      its on-chain commitment).
 *   2. Leaf nodes and inner nodes live in separate hash domains, so an
 *      inner-node hash can never verify as a leaf.
 * Plus: v1 stays byte-identical (frozen forever for existing packs).
 */

const h = (s: string) => createHash('sha256').update(s).digest('hex');
const A = h('memory-a');
const B = h('memory-b');
const C = h('memory-c');
const D = h('memory-d');
const E = h('memory-e');

describe('buildPackTreeV2', () => {
  it('THE FORGERY REGRESSION: an odd tree and its duplicated-tail twin produce different roots', () => {
    // v1's exact collision shape: [A,B,C] (odd, tail duplicated internally)
    // commits to the SAME root as [A,B,C,C]. v2's promotion closes it.
    expect(buildPackTreeV2([A, B, C]).root).not.toBe(buildPackTreeV2([A, B, C, C]).root);
    expect(buildPackTreeV2([A, B]).root).not.toBe(buildPackTreeV2([A, B, B]).root);
  });

  it('v1 remains vulnerable (documents why v2 exists)', () => {
    // The attack v2 closes: a pack could gain a duplicated final record
    // without changing its v1 on-chain commitment.
    expect(buildPackTree([A, B, C]).root).toBe(buildPackTree([A, B, C, C]).root);
  });

  it('domain separation: a v2 root never equals a raw leaf, even for n=1', () => {
    const one = buildPackTreeV2([A]);
    expect(one.root).not.toBe(A); // root = sha256(0x00 || A), not A itself
    expect(one.depth).toBe(0);
  });

  it('v2 and v1 roots differ for identical leaves (separate domains)', () => {
    const leaves = [A, B, C, D];
    expect(buildPackTreeV2(leaves).root).not.toBe(buildPackTree(leaves).root);
  });

  it('is deterministic and order-sensitive', () => {
    expect(buildPackTreeV2([A, B, C]).root).toBe(buildPackTreeV2([A, B, C]).root);
    expect(buildPackTreeV2([A, B, C]).root).not.toBe(buildPackTreeV2([A, C, B]).root);
  });

  it('throws on empty leaves', () => {
    expect(() => buildPackTreeV2([])).toThrow('at least one leaf');
  });
});

describe('inclusionProofV2 / verifyInclusionV2', () => {
  for (const leaves of [[A], [A, B], [A, B, C], [A, B, C, D], [A, B, C, D, E]]) {
    it(`round-trips every leaf in a ${leaves.length}-leaf tree (odd tails promoted)`, () => {
      const tree = buildPackTreeV2(leaves);
      for (let i = 0; i < leaves.length; i++) {
        const proof = inclusionProofV2(tree, i);
        expect(proof.algorithm).toBe(MERKLE_ALGORITHM_V2);
        expect(proof.treeSize).toBe(leaves.length);
        expect(verifyInclusionV2(tree.root, proof)).toBe(true);
      }
    });
  }

  it('rejects a proof against the wrong root', () => {
    const tree = buildPackTreeV2([A, B, C]);
    const other = buildPackTreeV2([A, B, D]);
    expect(verifyInclusionV2(other.root, inclusionProofV2(tree, 0))).toBe(false);
  });

  it('rejects a tampered leaf', () => {
    const tree = buildPackTreeV2([A, B, C, D]);
    const proof = inclusionProofV2(tree, 2);
    expect(verifyInclusionV2(tree.root, { ...proof, leaf: E })).toBe(false);
  });

  it('rejects a tampered path step', () => {
    const tree = buildPackTreeV2([A, B, C, D]);
    const proof = inclusionProofV2(tree, 1);
    const forged = { ...proof, path: proof.path.map((p, i) => (i === 0 ? { ...p, hash: E } : p)) };
    expect(verifyInclusionV2(tree.root, forged)).toBe(false);
  });

  it('rejects an inner node replayed as a leaf (domain separation)', () => {
    const tree = buildPackTreeV2([A, B, C, D]);
    // levels[1][0] is a real inner node; claiming it as a leaf must fail even
    // with a structurally-plausible path.
    const inner = tree.levels[1]![0]!;
    const proof = inclusionProofV2(tree, 0);
    expect(verifyInclusionV2(tree.root, { ...proof, leaf: inner, path: proof.path.slice(1) })).toBe(false);
  });

  it('throws on out-of-range leafIndex', () => {
    const tree = buildPackTreeV2([A, B]);
    expect(() => inclusionProofV2(tree, 2)).toThrow('out of range');
    expect(() => inclusionProofV2(tree, -1)).toThrow('out of range');
  });
});
