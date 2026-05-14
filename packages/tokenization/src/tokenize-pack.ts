/**
 * tokenizePack — commit a Pack's Merkle root on-chain and return everything
 * the caller needs to persist + serve future inclusion proofs.
 *
 * Inputs are memory IDs paired with their (already-computed) content hashes.
 * tokenizePack does NOT recompute hashes — that's the canonical-form contract
 * of content-hash, and recomputing here would risk drift if the canonical form
 * ever changes.
 */

import { buildPackTree, type PackTree } from './pack-merkle';
import type { MintClient, PackCommitment } from './mint-client';

export interface TokenizePackMemberInput {
  memoryId: number;
  contentHash: string;
}

export interface TokenizePackInput {
  /** External-facing pack id (e.g. 'pack-abcd'). */
  packId: string;
  /** Solana pubkey of the Pack author. */
  authorWallet: string;
  /** Optional off-chain URI for the token gate. */
  gateUri: string | null;
  /** Members of the Pack, in the order they should appear in the Merkle tree. */
  memories: TokenizePackMemberInput[];
}

export interface TokenizePackPatch {
  merkle_root: string;
  pack_token_address: string;
  pack_token_tx_sig: string;
  memory_count: number;
  tokenized_at: string;
  published_at: string;
}

export interface TokenizePackContentRow {
  memory_id: number;
  leaf_index: number;
  content_hash: string;
}

export interface TokenizePackResult {
  /** The Merkle tree (kept for proof generation; persist root + leaves at minimum). */
  tree: PackTree;
  /** On-chain commitment receipt. */
  commitment: PackCommitment;
  /** Fields the caller should write to `memory_packs`. */
  patch: TokenizePackPatch;
  /** Rows the caller should insert into `memory_pack_contents`. */
  contentRows: TokenizePackContentRow[];
}

export async function tokenizePack(
  input: TokenizePackInput,
  mint: MintClient,
): Promise<TokenizePackResult> {
  if (input.memories.length === 0) {
    throw new Error('tokenizePack: a pack must contain at least one memory');
  }

  const leafHashes = input.memories.map((m) => m.contentHash);
  const tree = buildPackTree(leafHashes);

  const commitment = await mint.commitPackRoot({
    packId: input.packId,
    merkleRoot: tree.root,
    authorWallet: input.authorWallet,
    memoryCount: input.memories.length,
    gateUri: input.gateUri,
  });

  const now = new Date().toISOString();
  const patch: TokenizePackPatch = {
    merkle_root: tree.root,
    pack_token_address: commitment.packTokenAddress,
    pack_token_tx_sig: commitment.txSig,
    memory_count: input.memories.length,
    tokenized_at: now,
    published_at: now,
  };

  const contentRows: TokenizePackContentRow[] = input.memories.map((m, i) => ({
    memory_id: m.memoryId,
    leaf_index: i,
    content_hash: m.contentHash,
  }));

  return { tree, commitment, patch, contentRows };
}
