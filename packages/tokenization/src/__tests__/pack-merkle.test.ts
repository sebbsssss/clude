import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  MERKLE_ALGORITHM,
  buildPackTree,
  inclusionProof,
  verifyInclusion,
} from '../pack-merkle';

/** Helper: sha256 hex of a string. Used to fabricate plausible leaf hashes for tests. */
function leafOf(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Helper: byte-concat two hex hashes and sha256 them. The reference inner-hash rule. */
function innerHash(left: string, right: string): string {
  return createHash('sha256')
    .update(Buffer.concat([Buffer.from(left, 'hex'), Buffer.from(right, 'hex')]))
    .digest('hex');
}

describe('pack-merkle', () => {
  describe('MERKLE_ALGORITHM', () => {
    it('exports a stable algorithm version string', () => {
      expect(MERKLE_ALGORITHM).toBe('sha256-merkle-v1');
    });
  });

  describe('buildPackTree', () => {
    it('throws on empty leaves', () => {
      expect(() => buildPackTree([])).toThrow();
    });

    it('a single leaf — root equals the leaf', () => {
      const leaf = leafOf('memory-a');
      const tree = buildPackTree([leaf]);
      expect(tree.root).toBe(leaf);
      expect(tree.depth).toBe(0);
      expect(tree.leaves).toEqual([leaf]);
    });

    it('two leaves — root is sha256(L0 || L1)', () => {
      const l0 = leafOf('memory-a');
      const l1 = leafOf('memory-b');
      const tree = buildPackTree([l0, l1]);
      expect(tree.root).toBe(innerHash(l0, l1));
      expect(tree.depth).toBe(1);
    });

    it('three leaves — duplicates last leaf to balance the layer', () => {
      const l0 = leafOf('a');
      const l1 = leafOf('b');
      const l2 = leafOf('c');
      const tree = buildPackTree([l0, l1, l2]);
      const left = innerHash(l0, l1);
      const right = innerHash(l2, l2); // odd: duplicate last
      expect(tree.root).toBe(innerHash(left, right));
      expect(tree.depth).toBe(2);
    });

    it('four leaves — full balanced tree', () => {
      const l = ['a', 'b', 'c', 'd'].map(leafOf);
      const tree = buildPackTree(l);
      const expected = innerHash(innerHash(l[0]!, l[1]!), innerHash(l[2]!, l[3]!));
      expect(tree.root).toBe(expected);
      expect(tree.depth).toBe(2);
    });

    it('100 leaves — produces a stable root', () => {
      const leaves = Array.from({ length: 100 }, (_, i) => leafOf(`m-${i}`));
      const a = buildPackTree(leaves);
      const b = buildPackTree([...leaves]);
      expect(a.root).toBe(b.root);
      // Ceiling-log2 of 100 = 7
      expect(a.depth).toBe(7);
    });

    it('is sensitive — changing one leaf changes the root', () => {
      const leaves = Array.from({ length: 16 }, (_, i) => leafOf(`m-${i}`));
      const before = buildPackTree(leaves).root;
      leaves[7] = leafOf('different');
      const after = buildPackTree(leaves).root;
      expect(before).not.toBe(after);
    });

    it('records the algorithm version', () => {
      const tree = buildPackTree([leafOf('only')]);
      expect(tree.algorithm).toBe('sha256-merkle-v1');
    });
  });

  describe('inclusionProof + verifyInclusion', () => {
    it('proves and verifies every leaf in a 1-leaf tree', () => {
      const leaf = leafOf('solo');
      const tree = buildPackTree([leaf]);
      const proof = inclusionProof(tree, 0);
      expect(proof.siblings).toEqual([]);
      expect(verifyInclusion(tree.root, proof)).toBe(true);
    });

    it('proves and verifies every leaf in a 2-leaf tree', () => {
      const leaves = ['x', 'y'].map(leafOf);
      const tree = buildPackTree(leaves);
      for (let i = 0; i < leaves.length; i++) {
        const proof = inclusionProof(tree, i);
        expect(verifyInclusion(tree.root, proof)).toBe(true);
      }
    });

    it('proves and verifies every leaf in a 3-leaf tree (odd-balanced)', () => {
      const leaves = ['a', 'b', 'c'].map(leafOf);
      const tree = buildPackTree(leaves);
      for (let i = 0; i < leaves.length; i++) {
        const proof = inclusionProof(tree, i);
        expect(verifyInclusion(tree.root, proof)).toBe(true);
      }
    });

    it('proves and verifies every leaf in a 16-leaf tree', () => {
      const leaves = Array.from({ length: 16 }, (_, i) => leafOf(`m-${i}`));
      const tree = buildPackTree(leaves);
      for (let i = 0; i < 16; i++) {
        const proof = inclusionProof(tree, i);
        expect(verifyInclusion(tree.root, proof)).toBe(true);
      }
    });

    it('proves and verifies every leaf in a 100-leaf tree', () => {
      const leaves = Array.from({ length: 100 }, (_, i) => leafOf(`m-${i}`));
      const tree = buildPackTree(leaves);
      for (let i = 0; i < 100; i++) {
        const proof = inclusionProof(tree, i);
        expect(verifyInclusion(tree.root, proof)).toBe(true);
      }
    });

    it('rejects a tampered leaf', () => {
      const leaves = Array.from({ length: 8 }, (_, i) => leafOf(`m-${i}`));
      const tree = buildPackTree(leaves);
      const proof = inclusionProof(tree, 3);
      const tampered = { ...proof, leaf: leafOf('not-the-real-leaf') };
      expect(verifyInclusion(tree.root, tampered)).toBe(false);
    });

    it('rejects a tampered sibling', () => {
      const leaves = Array.from({ length: 8 }, (_, i) => leafOf(`m-${i}`));
      const tree = buildPackTree(leaves);
      const proof = inclusionProof(tree, 3);
      const tampered = {
        ...proof,
        siblings: [...proof.siblings],
      };
      tampered.siblings[0] = leafOf('forged');
      expect(verifyInclusion(tree.root, tampered)).toBe(false);
    });

    it('rejects a wrong leaf index', () => {
      const leaves = Array.from({ length: 8 }, (_, i) => leafOf(`m-${i}`));
      const tree = buildPackTree(leaves);
      const proof = inclusionProof(tree, 3);
      // Same siblings, wrong index — should fail verification
      const wrongIndex = { ...proof, leafIndex: 4 };
      expect(verifyInclusion(tree.root, wrongIndex)).toBe(false);
    });

    it('rejects a wrong root', () => {
      const leaves = Array.from({ length: 8 }, (_, i) => leafOf(`m-${i}`));
      const tree = buildPackTree(leaves);
      const proof = inclusionProof(tree, 3);
      expect(verifyInclusion(leafOf('wrong-root'), proof)).toBe(false);
    });

    it('throws when proving an out-of-range leaf index', () => {
      const tree = buildPackTree([leafOf('a'), leafOf('b')]);
      expect(() => inclusionProof(tree, 5)).toThrow();
      expect(() => inclusionProof(tree, -1)).toThrow();
    });

    it('proof depth equals tree depth', () => {
      const leaves = Array.from({ length: 16 }, (_, i) => leafOf(`m-${i}`));
      const tree = buildPackTree(leaves);
      const proof = inclusionProof(tree, 7);
      expect(proof.siblings.length).toBe(tree.depth);
    });
  });
});
