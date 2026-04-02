/**
 * Browser-side encryption for BYOK API keys.
 *
 * Uses Web Crypto API (AES-256-GCM) with a symmetric key derived from a
 * deterministic wallet signature. The wallet signs a fixed message
 * ("clude-byok-v1") to produce stable entropy, which is then run through
 * HKDF-SHA256 to derive the encryption key.
 *
 * Format: base64( iv[12] || ciphertext || tag[16] )
 */

const SIGN_MESSAGE = 'clude-byok-v1';
const HKDF_SALT = new TextEncoder().encode('clude-byok-salt');
const HKDF_INFO = new TextEncoder().encode('clude-byok-aes256gcm');
const IV_LENGTH = 12;

/**
 * Derive an AES-256-GCM CryptoKey from raw signature bytes.
 */
async function deriveKey(signatureBytes: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    signatureBytes.buffer as ArrayBuffer,
    'HKDF',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a plaintext string. Returns a base64 blob (iv + ciphertext).
 */
export async function encryptBYOK(plaintext: string, signatureBytes: Uint8Array): Promise<string> {
  const key = await deriveKey(signatureBytes);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const cipher = new Uint8Array(cipherBuf);

  const combined = new Uint8Array(IV_LENGTH + cipher.length);
  combined.set(iv, 0);
  combined.set(cipher, IV_LENGTH);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a base64 blob back to plaintext. Returns null on failure.
 */
export async function decryptBYOK(encrypted: string, signatureBytes: Uint8Array): Promise<string | null> {
  try {
    const key = await deriveKey(signatureBytes);
    const raw = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
    if (raw.length < IV_LENGTH + 1) return null;

    const iv = raw.slice(0, IV_LENGTH);
    const ciphertext = raw.slice(IV_LENGTH);
    const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new TextDecoder().decode(plainBuf);
  } catch {
    return null;
  }
}

/**
 * The fixed message wallets sign to derive BYOK encryption entropy.
 */
export const BYOK_SIGN_MESSAGE = SIGN_MESSAGE;
