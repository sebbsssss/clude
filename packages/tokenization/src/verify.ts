/**
 * Public verifier for PMP.
 *
 * Two surfaces:
 *   - verifyMemory(contentHash, mint): does the on-chain registry know this hash?
 *   - verifyPackInclusion({...}, mint): is this memory provably in this pack?
 *
 * Both are pure-read. No authentication. No side effects. Designed for the
 * public VERIFY endpoint that anyone can hit to check a memory or pack.
 */

import { verifyInclusion, type MerkleProof } from './pack-merkle';
import type { MemoryCommitment, MintClient, PackCommitment } from './mint-client';

export type VerifyMemoryReason = 'verified' | 'not_committed';

export interface VerifyMemoryResult {
  verified: boolean;
  reason: VerifyMemoryReason;
  commitment: MemoryCommitment | null;
}

/**
 * Verify a memory's content hash is committed on-chain.
 *
 * The caller computes the content hash (or trusts the one they fetched);
 * this function looks it up via the MintClient and returns the commitment
 * if found. Verifier returns `verified: true` iff a commitment exists.
 */
export async function verifyMemory(
  contentHash: string,
  mint: MintClient,
): Promise<VerifyMemoryResult> {
  const commitment = await mint.fetchMemoryCommitment(contentHash);
  if (!commitment) {
    return { verified: false, reason: 'not_committed', commitment: null };
  }
  return { verified: true, reason: 'verified', commitment };
}

export type VerifyPackInclusionReason =
  | 'verified'
  | 'pack_not_found'
  | 'merkle_mismatch'
  | 'leaf_mismatch';

export interface VerifyPackInclusionInput {
  /** Either the on-chain merkle root directly (fastest) ... */
  expectedRoot?: string;
  /** ... or a pack token address we look up to fetch the root. */
  packTokenAddress?: string;
  /** Pack metadata commits to merkle_root; we look it up by root or by token. */
  /** The content hash of the memory the caller claims is in the pack. */
  contentHash: string;
  /** Inclusion proof. proof.leaf should equal contentHash for verified=true. */
  proof: MerkleProof;
}

export interface VerifyPackInclusionResult {
  verified: boolean;
  reason: VerifyPackInclusionReason;
  /** The on-chain pack commitment, if we found one. */
  packCommitment: PackCommitment | null;
}

/**
 * Verify a memory is provably included in a pack.
 *
 * The caller provides either `expectedRoot` (already known from on-chain) or
 * `packTokenAddress` (we'll look up the root). One of the two is required.
 */
export async function verifyPackInclusion(
  input: VerifyPackInclusionInput,
  mint: MintClient,
): Promise<VerifyPackInclusionResult> {
  // 1. Leaf-hash sanity: the proof's leaf must equal the claimed content hash.
  if (input.proof.leaf !== input.contentHash) {
    return { verified: false, reason: 'leaf_mismatch', packCommitment: null };
  }

  // 2. Resolve the expected root.
  let expectedRoot: string | undefined = input.expectedRoot;
  let packCommitment: PackCommitment | null = null;

  if (!expectedRoot) {
    if (!input.packTokenAddress) {
      throw new Error(
        'verifyPackInclusion: either expectedRoot or packTokenAddress is required',
      );
    }
    // Look up by token address. The MintClient's fetchPackCommitment is keyed
    // by merkle_root, so we need a different lookup — for v0.1 we accept that
    // the caller passes expectedRoot directly. In production this will be a
    // separate getPackByTokenAddress() call on the chain adapter.
    return { verified: false, reason: 'pack_not_found', packCommitment: null };
  }

  // Try to fetch the commitment as a bonus — not required for verification,
  // but useful for the response payload.
  packCommitment = await mint.fetchPackCommitment(expectedRoot);

  // 3. Run the Merkle check.
  const ok = verifyInclusion(expectedRoot, input.proof);
  if (!ok) {
    return { verified: false, reason: 'merkle_mismatch', packCommitment };
  }

  return { verified: true, reason: 'verified', packCommitment };
}
