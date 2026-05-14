/**
 * tokenizeMemory — high-level entry point for committing a memory on-chain.
 *
 * Composes content-hash + MintClient. The caller is responsible for
 * persisting the resulting patch back to the memory row in the database;
 * this function is intentionally side-effect-free with respect to the DB.
 *
 * Skip logic (benchmark sources, killswitch) is the caller's responsibility.
 * If you reach this function, we mint.
 */

import {
  type CanonicalMemoryInput,
  memoryContentHash,
} from './content-hash';
import type { MemoryCommitment, MintClient } from './mint-client';

export interface TokenizeMemoryInput extends CanonicalMemoryInput {
  /** External-facing memory id (e.g. 'mem-abcd1234'). */
  hashId: string;
}

export interface TokenizeMemoryPatch {
  content_hash: string;
  cnft_address: string;
  cnft_tree: string | null;
  cnft_leaf_index: number | null;
  cnft_tx_sig: string;
  tokenization_status: 'minted';
  tokenized_at: string;
}

export interface TokenizeMemoryResult {
  contentHash: string;
  commitment: MemoryCommitment;
  /** Fields the caller should patch onto the memory row. */
  patch: TokenizeMemoryPatch;
}

/**
 * Compute the canonical content hash and commit it on-chain.
 *
 * @param input  The memory's canonical fields plus its external hash id.
 * @param mint   The MintClient implementation to commit through.
 * @returns      The content hash, the on-chain commitment receipt, and a
 *               patch to apply to the memory row.
 */
export async function tokenizeMemory(
  input: TokenizeMemoryInput,
  mint: MintClient,
): Promise<TokenizeMemoryResult> {
  const contentHash = memoryContentHash(input);

  const commitment = await mint.commitMemoryHash({
    contentHash,
    memoryHashId: input.hashId,
    ownerWallet: input.owner_wallet,
  });

  const patch: TokenizeMemoryPatch = {
    content_hash: contentHash,
    cnft_address: commitment.assetId,
    cnft_tree: commitment.treeAddress,
    cnft_leaf_index: commitment.leafIndex,
    cnft_tx_sig: commitment.txSig,
    tokenization_status: 'minted',
    tokenized_at: new Date().toISOString(),
  };

  return { contentHash, commitment, patch };
}
