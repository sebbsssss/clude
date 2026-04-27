// MemoryPack v0.2 — Portable Agent Memory Format
//
// On-disk shape defined in docs/memorypack.md. Keep this file in
// lockstep with the spec — readers MUST ignore unknown fields, so
// extensions are forward-safe.

export const MEMORYPACK_VERSION = '0.2';

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

  // ── v0.2 additions ──

  /**
   * On-disk packaging format. Absence implies "directory" for backward
   * compatibility with v0.1 packs.
   */
  pack_format?: 'directory' | 'tarball';

  /**
   * Pack-level encryption envelope. When present, the listed scope is
   * encrypted with the declared algorithm. Records carry their own
   * `nonce` for record-scope encryption.
   */
  encryption?: {
    algorithm: 'xsalsa20-poly1305';
    /** How nonces are generated. v0.2 only supports per-record-random. */
    nonce_strategy: 'per-record-random';
    /** Key derivation. v0.2 ships keys out of band — no on-pack KDF. */
    key_derivation: 'none';
    /**
     * What the encryption envelope covers.
     *  - `records`        — only `record.content` is ciphertext.
     *  - `records+blobs`  — record.content AND blob bytes/index metadata.
     *
     * Readers MUST refuse to surface plaintext from a scope they do not
     * have keys for. Producers SHOULD prefer `records+blobs` for any
     * pack that contains attachments.
     */
    scope: 'records' | 'records+blobs';
  };

  /** Number of attachments declared in blobs/index.jsonl. */
  blobs_count?: number;
}

/**
 * records.jsonl — one MemoryPackRecord per line.
 *
 * Minimal shape readers MUST handle: id, created_at, kind, content,
 * tags, importance, source. Everything else is optional.
 */
export interface MemoryPackRecord {
  id: string;
  created_at: string;
  kind: 'episodic' | 'semantic' | 'procedural' | 'relational' | string;
  content: string;
  tags: string[];
  importance: number;
  source: string;

  // ── Optional / extended ──
  summary?: string;
  embedding?: number[];
  embedding_model?: string;
  metadata?: Record<string, unknown>;
  access_count?: number;
  last_accessed_at?: string;
  parent_ids?: string[];
  compacted_from?: string[];

  /**
   * sha256 reference to a binary attachment in `blobs/sha256/<hex>`.
   * v0.2: readers MUST cross-check that the referenced blob exists in
   * the pack and (when an index is present) that its bytes hash to the
   * declared value.
   */
  blob_ref?: string;

  // ── v0.2 encryption fields ──

  /**
   * True when `content` is base64 ciphertext rather than plaintext. Set
   * by writers when pack-level encryption is enabled. Readers MUST
   * preserve this flag through any minimal-shape projection so
   * downstream consumers can refuse to surface ciphertext as text.
   */
  encrypted?: boolean;
  /** Base64 nonce paired with `content` ciphertext. */
  nonce?: string;
}

/**
 * Minimal projection of MemoryPackRecord — the shape spec-compliant
 * readers MUST handle even when they don't recognise `record_schema`.
 *
 * Keeps `encrypted` so consumers can detect ciphertext-without-keys
 * without inspecting the full record (or `result.warnings`).
 */
export type MemoryPackMinimalRecord = Pick<
  MemoryPackRecord,
  | 'id'
  | 'created_at'
  | 'kind'
  | 'content'
  | 'tags'
  | 'importance'
  | 'source'
  | 'encrypted'
>;

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

/**
 * blobs/index.jsonl — one entry per attached blob.
 *
 * `byte_size` and `content_type` are over the *stored* bytes (which may
 * be ciphertext when encryption.scope = 'records+blobs'). `nonce` is
 * present only when the entry is encrypted.
 */
export interface MemoryPackBlobIndex {
  hash: string; // sha256:hex of stored bytes
  byte_size: number;
  content_type?: string;
  filename?: string;
  encrypted?: boolean;
  nonce?: string;
}
