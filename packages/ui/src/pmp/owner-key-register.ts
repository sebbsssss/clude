/**
 * owner-key-register — browser-side minting of the owner-key REGISTRATION payload.
 *
 * Encryption-by-default means `/v1/pmp/export` fails closed (422 `holder_key_unregistered`) until
 * the owner has registered their X25519 PUBLIC key + a verifier ciphertext. This module produces
 * exactly that payload, entirely client-side, from a wallet signature over `OWNER_SIGN_MESSAGE`:
 *
 *   x25519_pubkey = base64(deriveOwnerKeypairBrowser(sig).publicKey)
 *   verifier_ct   = base64(nonce ‖ secretbox(VERIFIER_CONSTANT, nonce, verifierKey))
 *     where verifierKey = HKDF-SHA256(boxSecret, salt=HKDF_SALT, info=VERIFIER_HKDF_INFO) → 32B
 *
 * This is the SAME verifier construction the server's `makeVerifierCiphertext` writes and the SAME
 * verifier gate `decryptPmp` opens — so the server's `checkVerifier` (decryptField → ===
 * VERIFIER_CONSTANT) accepts what we mint. The owner's private key never leaves the browser; only
 * the public key + the (public) verifier ciphertext are POSTed. The server binds the registration
 * to the PROVEN wallet, never to anything in this payload.
 *
 * ── Browser-bundle safety (HARD RULE) ───────────────────────────────────────────────────────
 * Like decrypt-pmp.ts, this module MUST NOT import `@clude/shared/core/memory-envelope` (Node
 * `crypto`). Every op is tweetnacl + Web Crypto; the ONLY thing from `@clude/shared` is the set of
 * dependency-free ASCII constants. Parity with the server is pinned by owner-key-register.test.ts.
 *
 * NEVER log/persist the signature, the derived secret key, or the verifier key.
 */
import nacl from 'tweetnacl';
import { VERIFIER_CONSTANT, VERIFIER_HKDF_INFO, HKDF_SALT } from '@clude/shared/core/owner-key-constants';
import { deriveOwnerKeypairBrowser } from './decrypt-pmp';

const NONCE_LENGTH = nacl.secretbox.nonceLength; // 24

/** Encode bytes as standard base64 via `btoa` (browser-native; no Buffer). */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary);
}

/**
 * HKDF-SHA256 → `length`-byte key. `salt`/`info` are ASCII constants whose TextEncoder bytes match
 * Node's UTF-8 encoding, so this derives byte-identically to the server's `deriveVerifierKey`.
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
 * The registration payload POST /v1/encryption/owner-key persists. Both fields are PUBLIC material
 * (the public key, and a verifier ciphertext that proves a candidate key matches — neither reveals
 * the secret key).
 */
export interface OwnerKeyRegistration {
  /** base64 of the 32-byte X25519 public key DEKs get sealed to. */
  x25519_pubkey: string;
  /** base64(nonce ‖ secretbox(VERIFIER_CONSTANT)) under the derived verifier key. */
  verifier_ct: string;
}

/**
 * Build the owner-key registration payload from a 64-byte wallet signature over the fixed
 * `OWNER_SIGN_MESSAGE`. Derives the box keypair, takes its public key, and seals the known verifier
 * constant under the dedicated (domain-separated) verifier key — exactly what the server validates.
 *
 * The derived secret key + verifier key live only for the duration of this call; nothing is logged
 * or returned but the two PUBLIC fields.
 *
 * @param signature the owner's 64-byte wallet signature over `OWNER_SIGN_MESSAGE`.
 */
export async function buildOwnerKeyRegistration(signature: Uint8Array): Promise<OwnerKeyRegistration> {
  const keypair = await deriveOwnerKeypairBrowser(signature);

  // Verifier key: HKDF over the box SECRET key, domain-separated under VERIFIER_HKDF_INFO — the same
  // derivation the decrypt verifier gate uses, so the server accepts the ciphertext we mint.
  const verifierKey = await hkdf(keypair.secretKey, HKDF_SALT, VERIFIER_HKDF_INFO, 32);

  // Seal the known constant: base64(nonce[24] ‖ secretbox_ct) — the same nonce‖ct framing
  // `encryptField` writes, so the server's `decryptField` (then === VERIFIER_CONSTANT) opens it.
  const nonce = nacl.randomBytes(NONCE_LENGTH);
  const message = new TextEncoder().encode(VERIFIER_CONSTANT);
  const ct = nacl.secretbox(message, nonce, verifierKey);
  const combined = new Uint8Array(NONCE_LENGTH + ct.length);
  combined.set(nonce, 0);
  combined.set(ct, NONCE_LENGTH);

  return {
    x25519_pubkey: bytesToBase64(keypair.publicKey),
    verifier_ct: bytesToBase64(combined),
  };
}
