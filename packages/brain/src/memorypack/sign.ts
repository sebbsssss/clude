import { createHash } from 'crypto';
import nacl from 'tweetnacl';
// @ts-ignore — bs58 is ESM-only, works at runtime via Node CJS/ESM interop
import * as bs58Module from 'bs58';
const bs58: { encode: (b: Uint8Array) => string; decode: (s: string) => Uint8Array } =
  (bs58Module as any).default || bs58Module;

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
