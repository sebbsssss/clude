import { createHash, randomBytes } from 'crypto';
import nacl from 'tweetnacl';
// @ts-ignore — bs58 is ESM-only, works at runtime via Node CJS/ESM interop
import * as bs58Module from 'bs58';
const bs58: { encode: (b: Uint8Array) => string; decode: (s: string) => Uint8Array } =
  (bs58Module as any).default || bs58Module;

// ────────────────────────────────────────────────────────────────────
// Hashing
// ────────────────────────────────────────────────────────────────────

/**
 * sha256 of a record's JSONL line, excluding any trailing newline.
 * Returns the hash prefixed with "sha256:" to match the spec.
 */
export function hashRecordLine(line: string): string {
  const clean = line.replace(/\n$/, '');
  const hex = createHash('sha256').update(clean, 'utf-8').digest('hex');
  return `sha256:${hex}`;
}

/**
 * sha256 of arbitrary bytes (used for blob attachments).
 * Returns the hash prefixed with "sha256:" to match the spec.
 */
export function hashBuffer(buf: Buffer | Uint8Array): string {
  const hex = createHash('sha256').update(buf).digest('hex');
  return `sha256:${hex}`;
}

// ────────────────────────────────────────────────────────────────────
// ed25519 — record signing
// ────────────────────────────────────────────────────────────────────

/**
 * Sign a record hash with an ed25519 secret key.
 * secretKey is the 64-byte Solana Keypair secretKey.
 */
export function signHash(hash: string, secretKey: Uint8Array): string {
  const messageBytes = Buffer.from(hash, 'utf-8');
  const sig = nacl.sign.detached(messageBytes, secretKey);
  return `base58:${bs58.encode(sig)}`;
}

/**
 * Verify a record signature. Returns true iff the signature was
 * produced by the secret key corresponding to publicKey.
 */
export function verifyHash(hash: string, signature: string, publicKey: string): boolean {
  try {
    const messageBytes = Buffer.from(hash, 'utf-8');
    const sigRaw = signature.startsWith('base58:')
      ? signature.slice('base58:'.length)
      : signature;
    const sigBytes = bs58.decode(sigRaw);
    const pkBytes = bs58.decode(publicKey);
    return nacl.sign.detached.verify(messageBytes, sigBytes, pkBytes);
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────
// xsalsa20-poly1305 — pack-level encryption (v0.2)
//
// We use NaCl's `secretbox` primitive: xsalsa20 stream cipher +
// poly1305 MAC. 32-byte key, 24-byte nonce, ciphertext is
// (plaintext.length + 16) bytes. Nonces are random per call — never
// reuse a (key, nonce) pair.
// ────────────────────────────────────────────────────────────────────

/** Required key length for the v0.2 encryption envelope (bytes). */
export const ENCRYPTION_KEY_BYTES = nacl.secretbox.keyLength; // 32

/** Required nonce length for the v0.2 encryption envelope (bytes). */
export const ENCRYPTION_NONCE_BYTES = nacl.secretbox.nonceLength; // 24

/**
 * Generate a fresh random nonce. Must never be reused with the same
 * key — caller is responsible for generating a new one per call.
 */
export function randomNonce(): Uint8Array {
  return new Uint8Array(randomBytes(ENCRYPTION_NONCE_BYTES));
}

/**
 * Encrypt a UTF-8 string with `key`. Returns base64 ciphertext + nonce.
 */
export function encryptString(
  plaintext: string,
  key: Uint8Array,
): { ciphertext: string; nonce: string } {
  if (key.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error(`encryption key must be ${ENCRYPTION_KEY_BYTES} bytes`);
  }
  const nonce = randomNonce();
  const messageBytes = Buffer.from(plaintext, 'utf-8');
  const cipherBytes = nacl.secretbox(messageBytes, nonce, key);
  return {
    ciphertext: Buffer.from(cipherBytes).toString('base64'),
    nonce: Buffer.from(nonce).toString('base64'),
  };
}

/**
 * Decrypt a ciphertext+nonce pair produced by `encryptString`.
 * Throws on MAC failure (which means tampering or wrong key).
 */
export function decryptString(
  ciphertext: string,
  nonce: string,
  key: Uint8Array,
): string {
  if (key.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error(`encryption key must be ${ENCRYPTION_KEY_BYTES} bytes`);
  }
  const cipherBytes = Buffer.from(ciphertext, 'base64');
  const nonceBytes = Buffer.from(nonce, 'base64');
  if (nonceBytes.length !== ENCRYPTION_NONCE_BYTES) {
    throw new Error(`nonce must be ${ENCRYPTION_NONCE_BYTES} bytes (decoded got ${nonceBytes.length})`);
  }
  const plain = nacl.secretbox.open(cipherBytes, nonceBytes, key);
  if (!plain) {
    throw new Error('decryption failed (MAC mismatch — wrong key or tampered ciphertext)');
  }
  return Buffer.from(plain).toString('utf-8');
}

/**
 * Encrypt arbitrary binary data (e.g. blob bytes) with `key`.
 * Returns ciphertext as a Buffer + base64 nonce.
 */
export function encryptBuffer(
  plaintext: Buffer | Uint8Array,
  key: Uint8Array,
): { ciphertext: Buffer; nonce: string } {
  if (key.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error(`encryption key must be ${ENCRYPTION_KEY_BYTES} bytes`);
  }
  const nonce = randomNonce();
  const cipherBytes = nacl.secretbox(plaintext, nonce, key);
  return {
    ciphertext: Buffer.from(cipherBytes),
    nonce: Buffer.from(nonce).toString('base64'),
  };
}

/**
 * Decrypt blob bytes produced by `encryptBuffer`. Throws on MAC
 * failure.
 */
export function decryptBuffer(
  ciphertext: Buffer | Uint8Array,
  nonce: string,
  key: Uint8Array,
): Buffer {
  if (key.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error(`encryption key must be ${ENCRYPTION_KEY_BYTES} bytes`);
  }
  const nonceBytes = Buffer.from(nonce, 'base64');
  if (nonceBytes.length !== ENCRYPTION_NONCE_BYTES) {
    throw new Error(`nonce must be ${ENCRYPTION_NONCE_BYTES} bytes (decoded got ${nonceBytes.length})`);
  }
  const plain = nacl.secretbox.open(ciphertext, nonceBytes, key);
  if (!plain) {
    throw new Error('blob decryption failed (MAC mismatch — wrong key or tampered ciphertext)');
  }
  return Buffer.from(plain);
}
