/**
 * Deterministic memory content hashing.
 *
 * Given a memory's canonical fields, produce a sha256 digest that is stable
 * across reads and writes. The hash is what goes on-chain (as a compressed
 * NFT's content commitment) and is what verifiers recompute when checking
 * a memory's authenticity off-chain.
 *
 * Stability properties:
 *   - Field ordering in the input object is irrelevant (keys sorted alphabetically).
 *   - Tag ordering is irrelevant (tags sorted + deduplicated).
 *   - Trailing / leading whitespace on string fields is trimmed.
 *   - Unicode forms are NFC-normalised so `café` (precomposed) and `café`
 *     (decomposed e + combining acute) produce the same hash.
 *
 * Excluded from the hash (mutable / storage-only):
 *   - id, hash_id, embedding, ts_summary
 *   - access_count, decay_factor, last_accessed
 *   - solana_signature, cnft_*, tokenization_status, tokenized_at
 *   - importance (mutable via reflection / dream cycle)
 *
 * The `algorithm` field is bound into the canonical form so future schema
 * revisions can advance the version string and still verify legacy hashes.
 */

import { createHash } from 'node:crypto';

export const HASH_ALGORITHM = 'memory-hash-v1' as const;

export type MemoryType =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'self_model'
  | 'introspective';

export interface CanonicalMemoryInput {
  /** Free-text body of the memory. Trimmed + NFC-normalised before hashing. */
  content: string;
  /** Typed tier in the Cortex memory model. */
  memory_type: MemoryType;
  /** Solana pubkey of the owner; null if bot-owned. */
  owner_wallet: string | null;
  /** Creation timestamp, ISO-8601 with Z suffix. */
  created_at: string;
  /** Free-text tags. Deduplicated and sorted before hashing. */
  tags: string[];
  /** Trigger that produced this memory ('mention', 'chat', 'consolidation', etc.). */
  source: string | null;
  /** Associated user identifier (X user id, agent id, etc.). */
  related_user: string | null;
  /** Associated wallet address. */
  related_wallet: string | null;
}

/** Recursive JSON serialiser with alphabetically-sorted object keys. */
function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const pairs = keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]));
    return '{' + pairs.join(',') + '}';
  }
  throw new Error(`stableStringify: unsupported value of type ${typeof value}`);
}

function normaliseString(s: string): string {
  return s.normalize('NFC').trim();
}

function normaliseNullable(s: string | null): string | null {
  return s === null ? null : normaliseString(s);
}

function normaliseTags(tags: string[]): string[] {
  const trimmed = tags.map(normaliseString).filter((t) => t.length > 0);
  return Array.from(new Set(trimmed)).sort();
}

/**
 * Build the canonical JSON string that gets fed to sha256. Useful for
 * debugging hash mismatches across implementations.
 */
export function canonicaliseMemory(input: CanonicalMemoryInput): string {
  const normalised = {
    algorithm: HASH_ALGORITHM,
    content: normaliseString(input.content),
    created_at: input.created_at,
    memory_type: input.memory_type,
    owner_wallet: normaliseNullable(input.owner_wallet),
    related_user: normaliseNullable(input.related_user),
    related_wallet: normaliseNullable(input.related_wallet),
    source: normaliseNullable(input.source),
    tags: normaliseTags(input.tags),
  };
  return stableStringify(normalised);
}

/**
 * Compute the canonical content hash for a memory. Returns a 64-char
 * lowercase hex sha256 digest.
 */
export function memoryContentHash(input: CanonicalMemoryInput): string {
  return createHash('sha256').update(canonicaliseMemory(input), 'utf8').digest('hex');
}
