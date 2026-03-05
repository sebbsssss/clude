/**
 * Client-side encryption for memory content.
 *
 * Per-user key derivation from Solana Ed25519 keypairs:
 *   secretKey (64 bytes) → first 32 bytes (seed)
 *     → HKDF-SHA256(seed, salt="clude-cortex-v1", info="memory-encryption")
 *     → 32-byte symmetric key
 *     → nacl.secretbox (XSalsa20-Poly1305)
 *
 * Only the `content` field is encrypted. Summary, tags, concepts, embeddings,
 * and all metadata stay plaintext for search and scoring.
 */

import nacl from 'tweetnacl';
import { hkdf } from 'crypto';
import { promisify } from 'util';
import { createChildLogger } from './logger';

const log = createChildLogger('encryption');

const hkdfAsync = promisify(hkdf);

const HKDF_SALT = 'clude-cortex-v1';
const HKDF_INFO = 'memory-encryption';
const NONCE_LENGTH = nacl.secretbox.nonceLength; // 24 bytes

let encryptionKey: Uint8Array | null = null;
let encryptionPubkey: string | null = null;

/**
 * Derive a symmetric encryption key from a Solana Ed25519 secret key.
 * Stores the key and associated public key for the session.
 */
export async function configureEncryption(solanaSecretKey: Uint8Array): Promise<void> {
  if (solanaSecretKey.length !== 64) {
    throw new Error('Encryption requires a 64-byte Ed25519 secret key');
  }

  // First 32 bytes = seed (same as nacl.sign.keyPair.fromSeed uses)
  const seed = solanaSecretKey.slice(0, 32);

  // Derive 32-byte symmetric key via HKDF-SHA256
  const derived = await hkdfAsync('sha256', seed, HKDF_SALT, HKDF_INFO, 32);
  encryptionKey = new Uint8Array(derived as ArrayBuffer);

  // Extract public key for tagging encrypted memories
  const keypair = nacl.sign.keyPair.fromSecretKey(solanaSecretKey);
  encryptionPubkey = Buffer.from(keypair.publicKey).toString('base64');

  log.info({ pubkey: encryptionPubkey.slice(0, 12) + '...' }, 'Encryption configured');
}

/**
 * Check if encryption is active for this session.
 */
export function isEncryptionEnabled(): boolean {
  return encryptionKey !== null;
}

/**
 * Get the public key string of the active encryption key.
 */
export function getEncryptionPubkey(): string | null {
  return encryptionPubkey;
}

/**
 * Encrypt plaintext content.
 * Returns base64(nonce[24] || ciphertext).
 */
export function encryptContent(plaintext: string): string {
  if (!encryptionKey) {
    throw new Error('Encryption not configured. Call configureEncryption() first.');
  }

  const nonce = nacl.randomBytes(NONCE_LENGTH);
  const messageBytes = new TextEncoder().encode(plaintext);
  const ciphertext = nacl.secretbox(messageBytes, nonce, encryptionKey);

  // Concatenate nonce + ciphertext
  const combined = new Uint8Array(NONCE_LENGTH + ciphertext.length);
  combined.set(nonce, 0);
  combined.set(ciphertext, NONCE_LENGTH);

  return Buffer.from(combined).toString('base64');
}

/**
 * Decrypt encrypted content.
 * Input: base64(nonce[24] || ciphertext).
 * Returns plaintext or null if decryption fails.
 */
export function decryptContent(encrypted: string): string | null {
  if (!encryptionKey) {
    return null;
  }

  try {
    const combined = Buffer.from(encrypted, 'base64');
    if (combined.length < NONCE_LENGTH + 1) {
      return null;
    }

    const nonce = combined.subarray(0, NONCE_LENGTH);
    const ciphertext = combined.subarray(NONCE_LENGTH);
    const plaintext = nacl.secretbox.open(ciphertext, nonce, encryptionKey);

    if (!plaintext) {
      return null; // Wrong key or corrupted data
    }

    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

/**
 * In-place decrypt memory content for a batch of memories.
 * Skips memories that are:
 *   - Not encrypted (encrypted !== true)
 *   - Encrypted by a different pubkey (logs warning, leaves content as-is)
 *   - Undecryptable (wrong key, corrupted — leaves content as-is)
 */
export function decryptMemoryBatch<T extends { content: string; encrypted?: boolean; encryption_pubkey?: string | null }>(
  memories: T[]
): T[] {
  if (!encryptionKey || !encryptionPubkey) return memories;

  for (const mem of memories) {
    if (!mem.encrypted) continue;

    // Check pubkey match — skip if encrypted by different user
    if (mem.encryption_pubkey && mem.encryption_pubkey !== encryptionPubkey) {
      log.debug({ memPubkey: mem.encryption_pubkey?.slice(0, 12) }, 'Skipping memory encrypted by different key');
      continue;
    }

    const decrypted = decryptContent(mem.content);
    if (decrypted !== null) {
      mem.content = decrypted;
    } else {
      log.warn('Failed to decrypt memory content — wrong key or corrupted data');
    }
  }

  return memories;
}
