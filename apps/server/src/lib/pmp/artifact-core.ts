/**
 * artifact-core — the pure, IO-free computation of a PMP artifact's on-chain binding
 * (merkle_root + manifest_hash + the `pmp` identity block).
 *
 * This is the CANONICAL home for that computation. It is byte-for-byte the same derivation the
 * export route (pmp-artifacts.routes.ts `writeRegisterRespond`) performs — extracted here so the
 * title SNAPSHOT path (snapshot-pack-for-title.ts) produces an identical binding without importing
 * an Express route or duplicating the hash. The route still carries its own copy for now; a
 * follow-up consolidates it onto this module once its (network-heavy) route tests can be run
 * cleanly in this worktree. The merkle_root itself is computed from PUBLIC @clude/tokenization
 * primitives in BOTH places, so it can never drift; only the manifest_hash derivation lives here.
 *
 * No DB, no filesystem, no .pmp write — just hashing. Trivially unit-testable.
 */

import { createHash } from 'node:crypto';
import { buildPackTree, type MemoryType } from '@clude/tokenization';
import { MEMORYPACK_VERSION, type MemoryPackManifest } from '@clude/memorypack';

export const PMP_FORMAT_VERSION = '0.8';
export const LEAF_HASH_ALGORITHM = 'memory-hash-v1';
export const MERKLE_ALGORITHM = 'sha256-merkle-v1';
export const RECORD_SCHEMA = 'clude-memory-v1';

const MEMORY_TYPE_VALUES: readonly MemoryType[] = [
  'episodic',
  'semantic',
  'procedural',
  'self_model',
  'introspective',
];
const VALID_MEMORY_TYPES = new Set<MemoryType>(MEMORY_TYPE_VALUES);

/** Coerce a stored memory_type string to a valid tier, defaulting to 'semantic' (mirrors the route). */
export function recordMemoryType(kind: string): MemoryType {
  return VALID_MEMORY_TYPES.has(kind as MemoryType) ? (kind as MemoryType) : 'semantic';
}

// ─────────── Canonicalisation (matches pmp-artifacts.routes.ts stableStringify) ───────────
// Alphabetical object keys, JSON scalar encoding, undefined keys dropped. The manifest_hash is
// sha256 over the canonical manifest JSON with `pmp.manifest_sig` removed (spec §4.1).

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const pairs = keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k]));
    return '{' + pairs.join(',') + '}';
  }
  throw new Error(`stableStringify: unsupported value of type ${typeof value}`);
}

/**
 * Compute the artifact's `manifest_hash`: sha256 (bare lowercase hex, NO 0x prefix — the stored
 * form every pmp_artifacts row uses) over the canonical manifest JSON with `pmp.manifest_sig`
 * stripped. Deterministic for identical pack content.
 */
export function computeManifestHash(manifest: MemoryPackManifest): string {
  const clone = JSON.parse(JSON.stringify(manifest)) as Record<string, unknown>;
  const pmp = clone.pmp as Record<string, unknown> | undefined;
  if (pmp && 'manifest_sig' in pmp) delete pmp.manifest_sig;
  return createHash('sha256').update(stableStringify(clone), 'utf8').digest('hex');
}

export interface ArtifactBindingOpts {
  title: string;
  description: string | null;
  licenseType: 'copy' | 'title';
  contentSource: 'personal' | 'knowledge' | 'agent' | null;
  /** The creator/owner wallet (provenance + creator_pubkey). For a title snapshot, the Base addr. */
  owner: string;
}

export interface ArtifactBinding {
  /** sha256-merkle-v1 root over the leaves (bare hex). */
  merkleRoot: string;
  /** sha256 of the canonical manifest, sig stripped (bare hex). */
  manifestHash: string;
  /** The embedded `pmp` identity block (what a written .pmp would carry + what manifest_hash covers). */
  pmpIdentity: Record<string, unknown>;
  recordCount: number;
}

/**
 * Compute an artifact's binding from its ordered leaf hashes + descriptor. The leaves ARE the pack's
 * per-member content hashes (memoryContentHash output, in tree order); record_count == leaves.length.
 * Identical to the export route's derivation so a title-snapshot artifact and a hypothetical export of
 * the same content yield the same merkle_root + manifest_hash.
 */
export function computeArtifactBinding(leaves: string[], opts: ArtifactBindingOpts): ArtifactBinding {
  const tree = buildPackTree(leaves);
  const recordCount = leaves.length;

  // The `pmp` identity block — carries NO per-export id and excludes the wall-clock created_at, so
  // two builds of the same content yield the same merkle_root + manifest_hash (the dedup collision).
  const pmpIdentity: Record<string, unknown> = {
    pmp_version: PMP_FORMAT_VERSION,
    title: opts.title,
    description: opts.description,
    license_type: opts.licenseType,
    content_source: opts.contentSource,
    record_count: recordCount,
    leaf_hash_algorithm: LEAF_HASH_ALGORITHM,
    merkle_algorithm: MERKLE_ALGORITHM,
    merkle_root: tree.root,
    creator_pubkey: opts.owner,
  };

  const manifestForHash: MemoryPackManifest = {
    memorypack_version: MEMORYPACK_VERSION,
    producer: { name: 'clude-server', version: MEMORYPACK_VERSION, public_key: opts.owner },
    created_at: '', // excluded from identity — stable across builds
    record_count: recordCount,
    record_schema: RECORD_SCHEMA,
    pmp: pmpIdentity,
  };

  return {
    merkleRoot: tree.root,
    manifestHash: computeManifestHash(manifestForHash),
    pmpIdentity,
    recordCount,
  };
}
