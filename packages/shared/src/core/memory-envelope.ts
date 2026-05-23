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
