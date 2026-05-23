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
