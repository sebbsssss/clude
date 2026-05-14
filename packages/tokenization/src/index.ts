/**
 * @clude/tokenization — primitives for tokenising agent memories.
 *
 * Reference implementation of the PMP (Portable Memory Protocol) commitment
 * layer. Provides:
 *
 *   - Deterministic content hashing (content-hash)
 *   - Pack Merkle trees with inclusion proofs (pack-merkle, pending)
 *   - Light Protocol cNFT mint wrapper (light-client, pending)
 *   - tokenizeMemory / tokenizePack high-level entry points (pending)
 *   - Public verifier (verify, pending)
 *
 * Currently shipped: content-hash. Other modules land in this same package
 * during the 14-day PMP launch sprint.
 */

export {
  HASH_ALGORITHM,
  canonicaliseMemory,
  memoryContentHash,
  type CanonicalMemoryInput,
  type MemoryType,
} from './content-hash';

export {
  MERKLE_ALGORITHM,
  buildPackTree,
  inclusionProof,
  verifyInclusion,
  type PackTree,
  type MerkleProof,
} from './pack-merkle';

export {
  FakeMintClient,
  type ChainId,
  type MintClient,
  type MemoryCommitment,
  type PackCommitment,
  type CommitMemoryInput,
  type CommitPackInput,
} from './mint-client';

export {
  tokenizeMemory,
  type TokenizeMemoryInput,
  type TokenizeMemoryResult,
  type TokenizeMemoryPatch,
} from './tokenize-memory';

export {
  tokenizePack,
  type TokenizePackInput,
  type TokenizePackMemberInput,
  type TokenizePackResult,
  type TokenizePackPatch,
  type TokenizePackContentRow,
} from './tokenize-pack';

export {
  verifyMemory,
  verifyPackInclusion,
  type VerifyMemoryResult,
  type VerifyMemoryReason,
  type VerifyPackInclusionInput,
  type VerifyPackInclusionResult,
  type VerifyPackInclusionReason,
} from './verify';
