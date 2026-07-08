// MemoryPack v0.2 — Portable Agent Memory Format
//
// On-disk shape defined in docs/memorypack.md. Keep this file in
// lockstep with the spec — readers MUST ignore unknown fields, so
// extensions are forward-safe.

export const MEMORYPACK_VERSION = '0.2';

/**
 * Owner-sealed encryption header — `manifest.encryption.owner`.
 *
 * Written once per pack when `key_derivation === 'owner-sealed'`. Carries
 * everything a single holder needs to recover the pack-level DEK (and prove
 * key ownership) from the FILE ALONE — no server round-trip on import. The
 * pack DEK is sealed exactly once to the holder's registered X25519 public
 * key; individual records are ciphertext (`encrypted: true`) under that DEK
 * with the nonce embedded inside each `content` ciphertext (so records carry
 * NO separate `nonce` for owner-sealed packs).
 *
 * Field names are a hard cross-component contract: the producer
 * (`encryptRecordsForHolder`) emits this exact shape and the browser decrypt
 * reads these exact keys. Keep all three in lockstep.
 */
export interface OwnerEncryptionHeader {
  /** The wallet this pack was sealed for (the holder / recipient). */
  recipient_wallet: string;
  /** base64 X25519 public key the DEK was sealed to (the holder's registered key). */
  recipient_pubkey: string;
  /** Copied verbatim from the holder's key row — lets the browser verify its derived key. */
  verifier_ct: string;
  /** base64(nonce ‖ box(DEK)) — the sealed pack DEK. */
  dek_wrap: string;
  /** base64 ephemeral sender X25519 pubkey for the sealed box. */
  wrap_pubkey: string;
}

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
    /**
     * Key derivation.
     *  - `none`         — keys shipped out of band; no on-pack KDF (v0.2).
     *  - `owner-sealed` — the pack DEK is sealed to a single holder's key
     *                     and carried in `owner`; the browser recovers it
     *                     from the file alone (no server round-trip).
     */
    key_derivation: 'none' | 'owner-sealed';
    /**
     * What the encryption envelope covers.
     *  - `records`        — only `record.content` is ciphertext.
     *  - `records+blobs`  — record.content AND blob bytes/index metadata.
     *
     * Readers MUST refuse to surface plaintext from a scope they do not
     * have keys for. Producers SHOULD prefer `records+blobs` for any
     * pack that contains attachments. Owner-sealed packs are always
     * `records`.
     */
    scope: 'records' | 'records+blobs';
    /**
     * Present only when `key_derivation === 'owner-sealed'`. The once-per-pack
     * header a holder uses to recover the pack DEK from the file alone. Typed
     * (not opaque) because the browser decrypt reads its fields directly.
     */
    owner?: OwnerEncryptionHeader;
  };

  /** Number of attachments declared in blobs/index.jsonl. */
  blobs_count?: number;

  /**
   * Optional PMP-artifact identity block. A generic extension slot the
   * higher-level `.pmp` artifact layer writes to bind pack-level identity
   * (e.g. `merkle_root`, title, license) into the manifest so the artifact
   * is SELF-VERIFIABLE: a reader can recompute the pack Merkle root and
   * compare it to `pmp.merkle_root` without trusting any server. The format
   * library treats it as opaque pass-through — producers define the shape.
   */
  pmp?: Record<string, unknown>;
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
 * revocations.jsonl — one signed revocation per revoked record (v0.3).
 *
 * Soft-delete protocol. Records in records.jsonl remain signed and
 * chain-anchored — you can't "delete" them without breaking the audit
 * trail. A revocation is a separate signed assertion that says: "as of
 * `revoked_at`, the producer no longer attests to this record's
 * content." Application layers decide whether to surface revoked
 * content as `[redacted]`, omit it entirely, or display with a flag.
 *
 * Canonical signed payload (UTF-8): `revoke:v1:<record_hash>:<revoked_at>`
 *
 * Forward-only: revocations cannot be revoked. If a producer changes
 * their mind, they should re-issue the record in a new pack.
 *
 * Verification: same ed25519 + bs58 envelope as record signatures, so
 * the same producer keypair signs both. The reader rejects revocations
 * whose signature doesn't verify.
 */
export interface MemoryPackRevocation {
  /** sha256:<hex> of the record being revoked. */
  record_hash: string;
  /** RFC3339 timestamp; included in the signed payload. */
  revoked_at: string;
  /** Free-form, optional. Common values: 'user-erasure', 'pii-leak', 'correction'. */
  reason?: string;
  signature: string;
  algorithm: 'ed25519';
  public_key: string;
}

/**
 * revocation_anchors.jsonl — chain-anchored proof that a revocation
 * was committed at a specific block height (v0.6).
 *
 * Soft-delete primitive (revocations.jsonl) is signed by the producer,
 * but the producer can self-attest any `revoked_at` they want. A
 * chain anchor pins the timestamp to a Solana transaction whose memo
 * carries the canonical `revoke:v1:sha256:<record_hex>:<revoked_at>`.
 *
 * Verifiers fetch the tx, parse the SPL Memo, exact-match the payload,
 * and check that the producer signed the tx. The block timestamp then
 * gives a tamper-evident lower bound on when the revocation could have
 * been committed.
 *
 * Optional. A revocation without a chain anchor is still valid — just
 * less verifiable on timing.
 */
export interface MemoryPackRevocationAnchor {
  /** sha256:<hex> of the record. */
  record_hash: string;
  /** RFC3339 timestamp from the corresponding revocations.jsonl entry. */
  revoked_at: string;
  chain: string;
  tx: string;
  slot?: number;
  anchor_format: 'memo-revoke-v1';
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
