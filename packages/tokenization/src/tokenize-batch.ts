/**
 * tokenizeMemoryBatch — commit many memories with a single on-chain write.
 *
 * The single-memory `tokenizeMemory()` does one chain write per memory. For a
 * backfill over a large corpus that's one transaction per memory — slow and,
 * at scale, expensive. `tokenizeMemoryBatch()` instead:
 *
 *   1. Computes each memory's canonical content hash.
 *   2. Builds one Merkle tree over the whole batch.
 *   3. Commits ONE root on-chain (one `commitMemoryBatch` call).
 *   4. Returns a per-memory inclusion proof + a row patch for each.
 *
 * A 100,000-memory backfill becomes ~100 transactions (batches of 1,000)
 * instead of 100,000.
 *
 * Verification model: a batched memory's row stores `cnft_tree` = the batch
 * Merkle root and `cnft_leaf_index` = its position. To VERIFY it, recompute
 * the content hash, fetch the batch's on-chain-committed root, and check the
 * inclusion proof. The caller is responsible for persisting either the proof
 * itself or the batch's ordered leaf set (so proofs can be regenerated).
 *
 * This module is pure with respect to the database — like tokenize-memory and
 * tokenize-pack, it returns patches; it does not write them.
 */

import { memoryContentHash, type CanonicalMemoryInput } from './content-hash';
import { buildPackTree, inclusionProof, type MerkleProof, type PackTree } from './pack-merkle';
import type { TokenizeMemoryPatch } from './tokenize-memory';
import type { BatchCommitment, MintClient } from './mint-client';

export interface TokenizeBatchMemberInput extends CanonicalMemoryInput {
  /** External-facing memory id (e.g. 'mem-abcd1234'). */
  hashId: string;
}

export interface TokenizeBatchMemberResult {
  /** Echoed from the input. */
  hashId: string;
  /** sha256 of the memory's canonical content. */
  contentHash: string;
  /** Position of this memory in the batch Merkle tree. */
  leafIndex: number;
  /** Inclusion proof for this memory against the batch root. */
  proof: MerkleProof;
  /** Fields the caller should patch onto the memory row. */
  patch: TokenizeMemoryPatch;
}

export interface TokenizeBatchResult {
  /** Echoed from the input. */
  batchId: string;
  /** The Merkle root committed for the whole batch. */
  batchRoot: string;
  /** On-chain commitment receipt for the batch. */
  commitment: BatchCommitment;
  /** The Merkle tree — keep it if you'd rather regenerate proofs than store them. */
  tree: PackTree;
  /** Per-memory results, in batch (leaf-index) order. */
  members: TokenizeBatchMemberResult[];
}

/**
 * Tokenise a batch of memories with one on-chain commitment.
 *
 * @param batchId  Stable id for this batch (used in the on-chain commitment).
 * @param inputs   The memories to tokenise. Order is preserved as leaf order.
 * @param mint     The MintClient to commit through.
 */
export async function tokenizeMemoryBatch(
  batchId: string,
  inputs: TokenizeBatchMemberInput[],
  mint: MintClient,
): Promise<TokenizeBatchResult> {
  if (inputs.length === 0) {
    throw new Error('tokenizeMemoryBatch: a batch must contain at least one memory');
  }

  // 1. Canonical hash for every memory, in order.
  const contentHashes = inputs.map((input) => memoryContentHash(input));

  // 2. One Merkle tree over the whole batch.
  const tree = buildPackTree(contentHashes);

  // 3. One on-chain commitment for the root.
  const commitment = await mint.commitMemoryBatch({
    batchId,
    merkleRoot: tree.root,
    memoryCount: inputs.length,
  });

  // 4. Per-memory proof + row patch.
  const tokenizedAt = new Date().toISOString();
  const members: TokenizeBatchMemberResult[] = inputs.map((input, i) => {
    const contentHash = contentHashes[i]!;
    const proof = inclusionProof(tree, i);
    const patch: TokenizeMemoryPatch = {
      content_hash: contentHash,
      cnft_address: commitment.assetId,
      cnft_tree: tree.root, // the batch root — non-null for batched memories
      cnft_leaf_index: i,
      cnft_tx_sig: commitment.txSig,
      tokenization_status: 'minted',
      tokenized_at: tokenizedAt,
    };
    return { hashId: input.hashId, contentHash, leafIndex: i, proof, patch };
  });

  return {
    batchId,
    batchRoot: tree.root,
    commitment,
    tree,
    members,
  };
}
