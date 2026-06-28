/**
 * Owner-held envelope encryption primitives (PMP memory encryption-at-rest).
 *
 * Pure crypto — no DB, env, or logging. See docs/pmp/memory-encryption-design.md.
 *
 *   content/field  → nacl.secretbox(XSalsa20-Poly1305) under a per-memory DEK
 *   DEK            → sealed box (nacl.box, X25519, ephemeral sender) per recipient
 *   owner key      → HKDF-SHA256(wallet signature) → nacl.box keypair
 *
 * Distinct from the legacy symmetric scheme in encryption.ts (HKDF info differs).
 */
import nacl from 'tweetnacl';
import { hkdf, hkdfSync } from 'crypto';
import { promisify } from 'util';
import {
  HKDF_SALT,
  HKDF_INFO,
  VERIFIER_HKDF_INFO,
  VERIFIER_CONSTANT,
} from './owner-key-constants.js';

const hkdfAsync = promisify(hkdf);

export const NONCE_LENGTH = nacl.secretbox.nonceLength; // 24

/** Generate a fresh 32-byte Data Encryption Key. */
export function generateDek(): Uint8Array {
  return nacl.randomBytes(nacl.secretbox.keyLength); // 32
}

/** Encrypt a UTF-8 string under a DEK. Returns base64(nonce[24] || ciphertext). */
export function encryptField(plaintext: string, dek: Uint8Array): string {
  const nonce = nacl.randomBytes(NONCE_LENGTH);
  const message = new TextEncoder().encode(plaintext);
  const ct = nacl.secretbox(message, nonce, dek);
  const combined = new Uint8Array(NONCE_LENGTH + ct.length);
  combined.set(nonce, 0);
  combined.set(ct, NONCE_LENGTH);
  return Buffer.from(combined).toString('base64');
}

/** Decrypt base64(nonce[24] || ciphertext). Returns plaintext or null (never throws). */
export function decryptField(encrypted: string, dek: Uint8Array): string | null {
  try {
    const combined = Buffer.from(encrypted, 'base64');
    if (combined.length < NONCE_LENGTH + 1) return null;
    const nonce = combined.subarray(0, NONCE_LENGTH);
    const ct = combined.subarray(NONCE_LENGTH);
    const pt = nacl.secretbox.open(ct, nonce, dek);
    if (!pt) return null;
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}

const BOX_NONCE_LENGTH = nacl.box.nonceLength; // 24

export interface WrappedDek {
  wrapped: string; // base64(nonce[24] || box(dek))
  wrapPubkey: string; // base64(ephemeral sender public key)
}

/**
 * Seal a DEK to a recipient's X25519 public key using an ephemeral sender keypair
 * (anonymous sealed box). The ephemeral public key is returned so the recipient
 * can open it; the ephemeral secret key is discarded.
 */
export function wrapDek(dek: Uint8Array, recipientPubkey: Uint8Array): WrappedDek {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(BOX_NONCE_LENGTH);
  const boxed = nacl.box(dek, nonce, recipientPubkey, ephemeral.secretKey);
  const combined = new Uint8Array(BOX_NONCE_LENGTH + boxed.length);
  combined.set(nonce, 0);
  combined.set(boxed, BOX_NONCE_LENGTH);
  return {
    wrapped: Buffer.from(combined).toString('base64'),
    wrapPubkey: Buffer.from(ephemeral.publicKey).toString('base64'),
  };
}

/** Open a sealed DEK with the recipient's secret key. Returns the DEK or null. */
export function unwrapDek(
  wrapped: string,
  wrapPubkey: string,
  recipientSecretKey: Uint8Array
): Uint8Array | null {
  try {
    const combined = Buffer.from(wrapped, 'base64');
    if (combined.length < BOX_NONCE_LENGTH + 1) return null;
    const nonce = combined.subarray(0, BOX_NONCE_LENGTH);
    const boxed = combined.subarray(BOX_NONCE_LENGTH);
    const ephemeralPub = Buffer.from(wrapPubkey, 'base64');
    if (ephemeralPub.length !== nacl.box.publicKeyLength) return null;
    const out = nacl.box.open(boxed, nonce, ephemeralPub, recipientSecretKey);
    return out ?? null;
  } catch {
    return null;
  }
}

// HKDF_SALT / HKDF_INFO / VERIFIER_HKDF_INFO / VERIFIER_CONSTANT are imported from
// ./owner-key-constants (single source of truth, shared byte-for-byte with the browser decrypt
// + the browser owner-key registration that mints a verifier this same constant gates).

/**
 * Derive an X25519 box keypair from a wallet signature (sign-to-derive, spec §4.1).
 * Determinism is load-bearing — see the verifier-token guard. The 64-byte ed25519
 * signature is the HKDF input keying material.
 */
export async function deriveOwnerEncryptionKeypair(
  signature: Uint8Array
): Promise<nacl.BoxKeyPair> {
  const seed = await hkdfAsync('sha256', signature, HKDF_SALT, HKDF_INFO, 32);
  return nacl.box.keyPair.fromSecretKey(new Uint8Array(seed as ArrayBuffer));
}

/**
 * Derive a DEDICATED secretbox key for the public verifier ciphertext (opsec L1).
 * The verifier_ct is public (encryption_keys row + every .pmp header), so it must
 * NOT be encrypted under the raw X25519 box secret that also protects DEKs —
 * cross-primitive key reuse. HKDF domain-separates it under VERIFIER_HKDF_INFO.
 */
function deriveVerifierKey(derivedSecretKey: Uint8Array): Uint8Array {
  return new Uint8Array(
    hkdfSync('sha256', derivedSecretKey, HKDF_SALT, VERIFIER_HKDF_INFO, 32) as ArrayBuffer
  );
}

/** Encrypt the known verifier constant under the dedicated verifier key (stored as verifier_ct). */
export function makeVerifierCiphertext(derivedSecretKey: Uint8Array): string {
  return encryptField(VERIFIER_CONSTANT, deriveVerifierKey(derivedSecretKey));
}

/** True iff the stored verifier decrypts to the constant under this session's derived verifier key. */
export function checkVerifier(verifierCt: string, derivedSecretKey: Uint8Array): boolean {
  return decryptField(verifierCt, deriveVerifierKey(derivedSecretKey)) === VERIFIER_CONSTANT;
}

