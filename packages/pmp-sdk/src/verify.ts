/**
 * Standalone verifier helpers.
 *
 * The PmpClient.verify() method calls a provider's /verify endpoint, which
 * recomputes the hash + does the chain lookup server-side. These helpers
 * provide a *client-side* recompute so a caller can independently verify
 * a Memory blob without trusting the provider's recompute.
 *
 * Useful for:
 *   - Caching: verify once, store result, skip future round-trips.
 *   - Air-gapped audit: confirm a memory matches its attestation offline.
 *   - Cross-provider checks: same memory under two providers should hash the same.
 */

import { memoryContentHash, type CanonicalMemoryInput } from '@clude/tokenization';
import type { Memory } from './types';

export interface ClientSideVerifyResult {
  /** Memory's recomputed content hash. */
  recomputedHash: string;
  /** The hash claimed by the attestation, if attached. */
  attestedHash: string | null;
  /** True iff attestedHash exists and matches recomputedHash. */
  hashesMatch: boolean;
}

/**
 * Recompute the canonical content hash for a Memory and compare it to the
 * hash claimed by its attestation.
 *
 * Returns hashesMatch=false if no attestation is attached OR if the hashes
 * differ. The caller decides whether that's a hard fail.
 *
 * Note: this does NOT verify the on-chain side — it only checks that the
 * provider's claimed hash matches what the canonical algorithm produces for
 * the memory's content. Combine with an on-chain RPC lookup (or the
 * server-side /verify endpoint) for full trustless verification.
 */
export function verifyMemoryHashClientSide(memory: Memory): ClientSideVerifyResult {
  // Map Memory wire fields → CanonicalMemoryInput. Fields not on the wire
  // (source, related_user, related_wallet) default to null — this matches
  // how the reference server constructs the canonical input on read paths.
  const canonical: CanonicalMemoryInput = {
    content: memory.content,
    memory_type: memory.type,
    owner_wallet: memory.owner,
    created_at: memory.created_at,
    tags: memory.tags ?? [],
    source: null,
    related_user: null,
    related_wallet: null,
  };
  const recomputedHash = memoryContentHash(canonical);
  const attestedHash = memory.attestation?.content_hash ?? null;
  return {
    recomputedHash,
    attestedHash,
    hashesMatch: attestedHash !== null && attestedHash === recomputedHash,
  };
}
