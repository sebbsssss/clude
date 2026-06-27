/**
 * decrypt-pmp — zero-knowledge, browser-side owner decrypt of an encrypted `.pmp`.
 *
 * This is the ONE place an owner-sealed pack's content is ever in the clear, and it runs
 * entirely client-side: the owner's wallet signs a fixed message, the signature derives an
 * X25519 keypair, and that keypair unwraps the pack DEK + opens every record. The server never
 * sees the signature, the derived key, the DEK, or any plaintext.
 *
 * ── Browser-bundle safety (HARD RULE) ──────────────────────────────────────────────────────
 * This module MUST NOT import `@clude/shared/core/memory-envelope` (it imports Node `crypto`,
 * which poisons the bundle). Every crypto op is implemented INLINE against `tweetnacl` +
 * Web Crypto (`crypto.subtle`). The ONLY thing imported from `@clude/shared` is the set of
 * dependency-free ASCII string constants in `owner-key-constants`, so the salt/info bytes match
 * the server byte-for-byte. The parity is pinned by decrypt-pmp.test.ts (PARITY FIXTURE).
 *
 * ── Server contract this mirrors (keep in lockstep) ─────────────────────────────────────────
 *   - deriveOwnerEncryptionKeypair: HKDF-SHA256(signature, salt=HKDF_SALT, info=HKDF_INFO) → 32
 *     bytes → nacl.box.keyPair.fromSecretKey.  (memory-envelope.ts)
 *   - verifier_ct: encryptField(const, deriveVerifierKey(boxSecret)) where the verifier key is
 *     HKDF-SHA256(boxSecret, salt=HKDF_SALT, info=VERIFIER_HKDF_INFO) → 32 bytes.
 *   - dek_wrap / wrap_pubkey: wrapDek(dek, recipientPub) = base64(nonce[24] ‖ box(dek)) +
 *     base64(ephemeralPub).  Opened with nacl.box.open(boxCt, nonce, ephemeralPub, boxSecret).
 *   - per-record content / tags: encryptField(plaintext, dek) = base64(nonce[24] ‖ secretbox_ct).
 *     Tags are the WHOLE array JSON-encoded into a single ciphertext element; empty tags stay [].
 *   - leaf hash: memoryContentHash (sha256 of an algorithm-bound canonical JSON) and the pack
 *     merkle root (sha256-merkle-v1). @clude/tokenization implements these but imports Node
 *     `crypto`, so they are REIMPLEMENTED here against Web Crypto (see leafHashForRecord /
 *     computeMerkleRoot) — the embedded plaintext leaf is authoritative and we compare to it.
 *
 * Fail-closed: any failed open (verifier, DEK unwrap, or ANY record) throws — never returns
 * partial plaintext. NEVER log the signature, derived key, DEK, ciphertext, or plaintext.
 */
import nacl from 'tweetnacl';
import {
  HKDF_SALT,
  HKDF_INFO,
  VERIFIER_HKDF_INFO,
} from '@clude/shared/core/owner-key-constants';

const NONCE_LENGTH = nacl.secretbox.nonceLength; // 24
const BOX_NONCE_LENGTH = nacl.box.nonceLength; // 24

const LEAF_HASH_ALGORITHM = 'memory-hash-v1';

// ── base64 ↔ bytes (browser-native; no Buffer) ──────────────────────────────────────────────

/** Decode a standard base64 string to bytes via `atob`. Throws on malformed input. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ── HKDF (Web Crypto) — byte-identical to the server's Node hkdf for ASCII salt/info ─────────

/**
 * HKDF-SHA256 → `length`-byte key. `salt`/`info` are ASCII constants; TextEncoder yields the
 * same bytes Node UTF-8-encodes internally, so this matches deriveOwnerEncryptionKeypair /
 * deriveVerifierKey exactly (proven by the parity fixture).
 */
async function hkdf(ikm: Uint8Array, salt: string, info: string, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(salt),
      info: new TextEncoder().encode(info),
    },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

/**
 * Derive the X25519 box keypair from a 64-byte wallet signature, byte-identical to the server's
 * `deriveOwnerEncryptionKeypair`. The signature is the HKDF input keying material.
 */
export async function deriveOwnerKeypairBrowser(signature: Uint8Array): Promise<nacl.BoxKeyPair> {
  const seed = await hkdf(signature, HKDF_SALT, HKDF_INFO, 32);
  return nacl.box.keyPair.fromSecretKey(seed);
}

/** Derive the dedicated secretbox verifier key from the box SECRET key (domain-separated). */
async function deriveVerifierKeyBrowser(boxSecretKey: Uint8Array): Promise<Uint8Array> {
  return hkdf(boxSecretKey, HKDF_SALT, VERIFIER_HKDF_INFO, 32);
}

// ── secretbox / box opens over base64(nonce ‖ ct) ────────────────────────────────────────────

/** Open base64(nonce[24] ‖ secretbox_ct) under `key`. Returns plaintext bytes or null. */
function openSecretbox(encoded: string, key: Uint8Array): Uint8Array | null {
  let combined: Uint8Array;
  try {
    combined = base64ToBytes(encoded);
  } catch {
    return null;
  }
  if (combined.length < NONCE_LENGTH + 1) return null;
  const nonce = combined.subarray(0, NONCE_LENGTH);
  const ct = combined.subarray(NONCE_LENGTH);
  return nacl.secretbox.open(ct, nonce, key);
}

// ── leaf hash + merkle (Web Crypto reimplementation of @clude/tokenization) ──────────────────

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) hex += bytes[i]!.toString(16).padStart(2, '0');
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/** Recursive JSON serialiser with alphabetically-sorted object keys (mirrors the server). */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
  }
  throw new Error(`stableStringify: unsupported value of type ${typeof value}`);
}

const VALID_MEMORY_TYPES = new Set([
  'episodic',
  'semantic',
  'procedural',
  'self_model',
  'introspective',
]);

function normaliseString(s: string): string {
  return s.normalize('NFC').trim();
}
function normaliseNullable(s: string | null): string | null {
  return s === null ? null : normaliseString(s);
}

/**
 * Compute the canonical content hash for a DECRYPTED record, identical to the server's
 * memoryContentHash over the leaf input. The leaf is bound to the AUTHOR's wallet (carried in
 * metadata.owner_wallet); related_user/related_wallet come from metadata too. This is the value
 * we compare to the record's declared metadata.leaf_hash.
 */
async function leafHashForRecord(rec: DecryptedRecord): Promise<string> {
  const meta = (rec.metadata ?? {}) as Record<string, unknown>;
  const kind = String(rec.kind ?? '');
  const memoryType = VALID_MEMORY_TYPES.has(kind) ? kind : 'semantic';
  const tags = Array.isArray(rec.tags) ? rec.tags : [];
  const canonical = {
    algorithm: LEAF_HASH_ALGORITHM,
    content: normaliseString(rec.content),
    created_at: rec.created_at,
    memory_type: memoryType,
    owner_wallet: typeof meta.owner_wallet === 'string' ? normaliseString(meta.owner_wallet) : null,
    related_user: typeof meta.related_user === 'string' ? normaliseString(meta.related_user) : null,
    related_wallet:
      typeof meta.related_wallet === 'string' ? normaliseString(meta.related_wallet) : null,
    source: typeof rec.source === 'string' ? normaliseNullable(rec.source) : null,
    tags: Array.from(new Set(tags.map(normaliseString).filter((t) => t.length > 0))).sort(),
  };
  return sha256Hex(new TextEncoder().encode(stableStringify(canonical)));
}

/** sha256(hexDecode(left) ‖ hexDecode(right)) → hex — the sha256-merkle-v1 inner node. */
async function hashPair(left: string, right: string): Promise<string> {
  const a = hexToBytes(left);
  const b = hexToBytes(right);
  const buf = new Uint8Array(a.length + b.length);
  buf.set(a, 0);
  buf.set(b, a.length);
  return sha256Hex(buf);
}

/** Build the pack merkle root over ordered leaf hashes (duplicate-last on odd count). */
async function computeMerkleRoot(leaves: string[]): Promise<string> {
  if (leaves.length === 0) throw new Error('decryptPmp: cannot build merkle root over zero leaves');
  let current = [...leaves];
  while (current.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i]!;
      const right = i + 1 < current.length ? current[i + 1]! : left;
      next.push(await hashPair(left, right));
    }
    current = next;
  }
  return current[0]!;
}

// ── Public types ─────────────────────────────────────────────────────────────────────────────

/** The owner-sealed encryption header carried in `manifest.encryption.owner`. */
export interface OwnerEncryptionHeader {
  recipient_wallet: string;
  recipient_pubkey: string;
  verifier_ct: string;
  dek_wrap: string;
  wrap_pubkey: string;
}

/** The subset of the `.pmp` manifest this decrypt needs. Readers ignore unknown fields. */
export interface PmpManifestForDecrypt {
  encryption?: {
    key_derivation?: string;
    owner?: OwnerEncryptionHeader;
  };
  pmp?: {
    merkle_root?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/** A ciphertext `.pmp` record (as written by the server's encrypt path). */
export interface EncryptedRecord {
  id: string;
  created_at: string;
  kind: string;
  /** base64(nonce ‖ secretbox(content)). */
  content: string;
  /** Either [] (no tags) or a single-element array of base64(nonce ‖ secretbox(JSON tags)). */
  tags: string[];
  importance: number;
  source: string;
  encrypted?: boolean;
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

/** A decrypted record — plaintext content + tags, ciphertext marker cleared. */
export interface DecryptedRecord {
  id: string;
  created_at: string;
  kind: string;
  content: string;
  tags: string[];
  importance: number;
  source: string;
  encrypted: false;
  metadata?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface DecryptPmpResult {
  records: DecryptedRecord[];
  /**
   * True iff every decrypted record's recomputed leaf hash matches its declared
   * metadata.leaf_hash AND those leaves rebuild to manifest.pmp.merkle_root. A decrypt that
   * succeeds cryptographically but fails integrity returns verified=false (does not throw).
   */
  verified: boolean;
}

// ── Decrypt ──────────────────────────────────────────────────────────────────────────────────

/**
 * Decrypt an owner-sealed `.pmp` entirely client-side and return the plaintext records plus an
 * integrity verdict. Throws (fail-closed, no partial plaintext) when:
 *   - the manifest is not owner-sealed / missing the owner header;
 *   - the verifier gate fails (WRONG WALLET — checked BEFORE any record is touched);
 *   - the DEK unwrap fails;
 *   - ANY record's content/tags fail to open.
 *
 * @param manifest  the parsed `.pmp` manifest (needs `encryption.owner` + `pmp.merkle_root`).
 * @param records   the ciphertext records array.
 * @param signature the owner's 64-byte wallet signature over the fixed sign-message.
 */
export async function decryptPmp(
  manifest: PmpManifestForDecrypt,
  records: EncryptedRecord[],
  signature: Uint8Array,
): Promise<DecryptPmpResult> {
  const owner = manifest.encryption?.owner;
  if (!owner) {
    throw new Error('decryptPmp: manifest is not owner-sealed (missing encryption.owner header)');
  }

  // Derive the box keypair from the signature.
  const keypair = await deriveOwnerKeypairBrowser(signature);

  // ── 1. VERIFIER GATE — run BEFORE touching any record. ────────────────────────────────────
  // Opening verifier_ct under the derived verifier key proves this signature owns the pack. A
  // null open means WRONG WALLET → throw immediately, with no record decryption attempted.
  const verifierKey = await deriveVerifierKeyBrowser(keypair.secretKey);
  const verifierPlain = openSecretbox(owner.verifier_ct, verifierKey);
  if (!verifierPlain) {
    throw new Error('decryptPmp: wrong wallet — verifier check failed (cannot decrypt this pack)');
  }

  // ── 2. UNWRAP THE PACK DEK. ────────────────────────────────────────────────────────────────
  const dek = unwrapPackDek(owner, keypair.secretKey);
  if (!dek) {
    throw new Error('decryptPmp: failed to unwrap pack DEK (wrong key or corrupt header)');
  }

  // ── 3. DECRYPT EACH RECORD (fail closed on ANY null open). ────────────────────────────────
  const decrypted: DecryptedRecord[] = records.map((rec, idx) => decryptRecord(rec, idx, dek));

  // ── 4. INTEGRITY: recompute each leaf, confirm it matches the declared leaf_hash, and that
  //       the leaves rebuild to manifest.pmp.merkle_root. verified=false on any mismatch. ─────
  const verified = await verifyIntegrity(decrypted, manifest.pmp?.merkle_root);

  return { records: decrypted, verified };
}

/** Split dek_wrap (base64 nonce ‖ box(dek)) + wrap_pubkey and open with the box secret. */
function unwrapPackDek(owner: OwnerEncryptionHeader, boxSecretKey: Uint8Array): Uint8Array | null {
  let combined: Uint8Array;
  let ephemeralPub: Uint8Array;
  try {
    combined = base64ToBytes(owner.dek_wrap);
    ephemeralPub = base64ToBytes(owner.wrap_pubkey);
  } catch {
    return null;
  }
  if (combined.length < BOX_NONCE_LENGTH + 1) return null;
  if (ephemeralPub.length !== nacl.box.publicKeyLength) return null;
  const nonce = combined.subarray(0, BOX_NONCE_LENGTH);
  const boxed = combined.subarray(BOX_NONCE_LENGTH);
  return nacl.box.open(boxed, nonce, ephemeralPub, boxSecretKey);
}

/** Decrypt one record's content + tags under the DEK. Throws (fail closed) on any null open. */
function decryptRecord(rec: EncryptedRecord, idx: number, dek: Uint8Array): DecryptedRecord {
  const contentBytes = openSecretbox(rec.content, dek);
  if (!contentBytes) {
    throw new Error(`decryptPmp: failed to decrypt record content at index ${idx} (fail closed)`);
  }
  const content = new TextDecoder().decode(contentBytes);

  // Tags: [] stays []; a single ciphertext element decrypts to the original JSON array.
  let tags: string[] = [];
  if (Array.isArray(rec.tags) && rec.tags.length > 0) {
    const tagBytes = openSecretbox(rec.tags[0]!, dek);
    if (!tagBytes) {
      throw new Error(`decryptPmp: failed to decrypt record tags at index ${idx} (fail closed)`);
    }
    const parsed = JSON.parse(new TextDecoder().decode(tagBytes)) as unknown;
    tags = Array.isArray(parsed) ? (parsed as string[]) : [];
  }

  return { ...rec, content, tags, encrypted: false };
}

/**
 * Recompute each decrypted record's leaf hash, compare to its declared metadata.leaf_hash, then
 * rebuild the merkle root and compare to the manifest's. Returns false on ANY mismatch (or when
 * the manifest declares no root). Never throws on a mismatch (the decrypt itself already
 * succeeded) — surfaces the verdict instead.
 */
async function verifyIntegrity(
  records: DecryptedRecord[],
  declaredRoot: string | undefined,
): Promise<boolean> {
  if (!declaredRoot || records.length === 0) return false;
  const leaves: string[] = [];
  for (const rec of records) {
    const declared = (rec.metadata as Record<string, unknown> | undefined)?.leaf_hash;
    const recomputed = await leafHashForRecord(rec);
    if (typeof declared !== 'string' || declared !== recomputed) return false;
    leaves.push(recomputed);
  }
  const root = await computeMerkleRoot(leaves);
  return root === declaredRoot;
}
