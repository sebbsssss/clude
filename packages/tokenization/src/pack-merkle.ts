/**
 * Pack Merkle trees with inclusion proofs.
 *
 * A Memory Pack commits to its constituent memories via a single Merkle
 * root, recorded in the Pack token's on-chain metadata. Any party can
 * later prove that a specific memory is in the Pack — without revealing
 * the other memories — by serving its Merkle inclusion proof.
 *
 * Construction (sha256-merkle-v1):
 *   - Leaves are caller-provided hex hashes (typically content_hash from
 *     content-hash.ts). They are NOT re-hashed at the leaf level.
 *   - Inner node = sha256(byteConcat(left, right)) where left/right are
 *     hex-decoded then concatenated raw.
 *   - Odd-count layers duplicate the last node before pairing.
 *
 * Security note: this construction is vulnerable to the leaf-vs-inner
 * confusion attack in the abstract (an inner-node hash could be claimed
 * as a leaf). For Pack commitments we mitigate this two ways:
 *   1. The Pack metadata records `memory_count` separately on-chain, so a
 *      verifier can refuse proofs whose claimed leaf index would imply a
 *      different tree size.
 *   2. Leaves are content_hash values which themselves are sha256 of a
 *      JSON canonical form bound to the algorithm string 'memory-hash-v1'.
 *      A forged "inner-node-as-leaf" preimage would have to also be a
 *      valid canonicalised memory, which is statistically impossible.
 *
 * v0.2 will introduce CT-style domain separators (0x00 prefix for leaves,
 * 0x01 prefix for inner nodes). Not in v0.1 for spec simplicity.
 */

import { createHash } from 'node:crypto';

export const MERKLE_ALGORITHM = 'sha256-merkle-v1' as const;

export interface PackTree {
  root: string;
  leaves: string[];
  depth: number;
  algorithm: typeof MERKLE_ALGORITHM;
  /** Internal: all level hashes, level 0 = leaves, level depth = [root]. */
  levels: string[][];
}

export interface MerkleProof {
  leaf: string;
  leafIndex: number;
  siblings: string[];
  algorithm: typeof MERKLE_ALGORITHM;
}

function hashPair(left: string, right: string): string {
  const buf = Buffer.concat([Buffer.from(left, 'hex'), Buffer.from(right, 'hex')]);
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Build a Pack Merkle tree from leaf hashes.
 *
 * @throws if `leafHashes` is empty.
 */
export function buildPackTree(leafHashes: string[]): PackTree {
  if (leafHashes.length === 0) {
    throw new Error('buildPackTree: at least one leaf required');
  }

  const levels: string[][] = [[...leafHashes]];
  let current = leafHashes;
  let depth = 0;

  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = i + 1 < current.length ? current[i + 1]! : left; // duplicate last on odd
      next.push(hashPair(left, right));
    }
    levels.push(next);
    current = next;
    depth += 1;
  }

  return {
    root: current[0]!,
    leaves: [...leafHashes],
    depth,
    algorithm: MERKLE_ALGORITHM,
    levels,
  };
}

/**
 * Produce a Merkle inclusion proof for the leaf at `leafIndex`.
 *
 * @throws if `leafIndex` is out of range.
 */
export function inclusionProof(tree: PackTree, leafIndex: number): MerkleProof {
  if (leafIndex < 0 || leafIndex >= tree.leaves.length) {
    throw new Error(
      `inclusionProof: leafIndex ${leafIndex} out of range (0..${tree.leaves.length - 1})`,
    );
  }

  const siblings: string[] = [];
  let index = leafIndex;

  for (let level = 0; level < tree.depth; level++) {
    const layer = tree.levels[level]!;
    const isRightChild = index % 2 === 1;
    const siblingIndex = isRightChild ? index - 1 : index + 1;
    // If the sibling would be out of range, this node was duplicated → sibling is self.
    const sibling = siblingIndex < layer.length ? layer[siblingIndex]! : layer[index]!;
    siblings.push(sibling);
    index = Math.floor(index / 2);
  }

  return {
    leaf: tree.leaves[leafIndex]!,
    leafIndex,
    siblings,
    algorithm: MERKLE_ALGORITHM,
  };
}

/**
 * Verify a Merkle inclusion proof against a claimed root.
 *
 * Returns true iff hashing the leaf up the sibling chain (using the
 * leafIndex bits to decide left/right at each level) reproduces the root.
 */
export function verifyInclusion(root: string, proof: MerkleProof): boolean {
  let current = proof.leaf;
  let index = proof.leafIndex;

  for (const sibling of proof.siblings) {
    const isRightChild = index % 2 === 1;
    current = isRightChild ? hashPair(sibling, current) : hashPair(current, sibling);
    index = Math.floor(index / 2);
  }

  return current === root;
}
