// MemoryPack v0.1 — Portable Agent Memory Format
//
// This is the on-disk shape defined in docs/memorypack.md. Keep this
// file in lockstep with the spec: if you change a field here, update
// the spec. Readers MUST ignore unknown fields so extensions are
// forward-safe.

export const MEMORYPACK_VERSION = '0.1';

/**
 * manifest.json — top-level descriptor for a pack.
 */
export interface MemoryPackManifest {
  memorypack_version: string;
  producer: {
    name: string;
    version: string;
    agent_id?: string;
    did?: string;
    public_key?: string; // base58
  };
  created_at: string; // RFC3339
  record_count: number;
  record_schema: string; // free-form, producer-defined
  signature_algorithm?: 'ed25519';
  anchor_chain?: string; // e.g. "solana-mainnet"
}

/**
 * records.jsonl — one MemoryPackRecord per line.
 *
 * Minimal shape readers MUST handle: id, created_at, kind, content,
 * tags, importance, source. Everything else is optional and can be
 * ignored by non-recognising readers.
 */
export interface MemoryPackRecord {
  id: string;
  created_at: string;
  kind: 'episodic' | 'semantic' | 'procedural' | 'relational' | string;
  content: string;
  tags: string[];
  importance: number;
  source: string;

  // Optional / extended
  summary?: string;
  embedding?: number[];
  embedding_model?: string;
  metadata?: Record<string, unknown>;
  access_count?: number;
  last_accessed_at?: string;
  parent_ids?: string[];
  compacted_from?: string[];
  blob_ref?: string;
}

/**
 * signatures.jsonl — one detached signature per record hash.
 */
export interface MemoryPackSignature {
  record_hash: string;
  signature: string;
  algorithm: 'ed25519';
  public_key: string;
}

/**
 * anchors.jsonl — on-chain proof per record hash.
 */
export interface MemoryPackAnchor {
  record_hash: string;
  chain: string;
  tx: string;
  slot?: number;
  anchor_format: 'memo-v1';
}
