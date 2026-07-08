/**
 * buildOwnerKeyRegistration — browser mints the `{ x25519_pubkey, verifier_ct }` payload that
 * POST /v1/encryption/owner-key persists, sealed so the SERVER's gate accepts it.
 *
 * Like decrypt-pmp.test.ts, these tests run under vitest/Node and so CAN import the SERVER crypto
 * (`@clude/shared/core/memory-envelope`) to prove the browser-minted material is exactly what the
 * server validates. The production helper must NEVER import memory-envelope — only the ASCII
 * constants from owner-key-constants — so it stays browser-bundle-safe.
 *
 * The load-bearing assertion is the VERIFIER-PARITY FIXTURE: for a fixed signature, the server's
 * `checkVerifier(reg.verifier_ct, serverDerivedSecretKey)` returns true — i.e. the browser-minted
 * verifier_ct decrypts to the known constant under the verifier key the SERVER would derive. A byte
 * mismatch in the constant, the HKDF info, or the nonce‖ct framing would make every encrypted
 * export the dashboard registers for fail closed, so it is pinned here.
 */
import { describe, it, expect } from 'vitest';

// SERVER primitives — imported HERE ONLY (the test), to prove the browser-minted payload validates
// against the exact server check + derives the same public key. The production helper must not
// reach for any of these.
import {
  deriveOwnerEncryptionKeypair,
  checkVerifier,
} from '@clude/shared/core/memory-envelope';

import { buildOwnerKeyRegistration } from '@clude/ui';

/** A FIXED, deterministic 64-byte ed25519-shaped signature. */
function fixedSignature(seed = 13): Uint8Array {
  const sig = new Uint8Array(64);
  for (let i = 0; i < 64; i++) sig[i] = (i * seed + 5) & 0xff;
  return sig;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ── 1. VERIFIER PARITY (load-bearing) ───────────────────────────────────────────────────────

describe('buildOwnerKeyRegistration — server accepts the browser-minted verifier', () => {
  it("server's checkVerifier(verifier_ct, serverSecretKey) returns true", async () => {
    const sig = fixedSignature();
    const reg = await buildOwnerKeyRegistration(sig);
    const serverKp = await deriveOwnerEncryptionKeypair(sig);

    // The browser minted verifier_ct; the SERVER's gate must accept it under the secret key the
    // server itself derives from the same signature.
    expect(checkVerifier(reg.verifier_ct, serverKp.secretKey)).toBe(true);
  });

  it('x25519_pubkey equals base64 of the server-derived public key', async () => {
    const sig = fixedSignature();
    const reg = await buildOwnerKeyRegistration(sig);
    const serverKp = await deriveOwnerEncryptionKeypair(sig);

    expect(Array.from(base64ToBytes(reg.x25519_pubkey))).toEqual(Array.from(serverKp.publicKey));
  });
});

// ── 2. WRONG-KEY NEGATIVE — a verifier from one signature must NOT validate under another ─────

describe('buildOwnerKeyRegistration — verifier is bound to the signing key', () => {
  it("a different signature's secret key does NOT pass checkVerifier", async () => {
    const reg = await buildOwnerKeyRegistration(fixedSignature(13));
    const otherKp = await deriveOwnerEncryptionKeypair(fixedSignature(29));
    expect(checkVerifier(reg.verifier_ct, otherKp.secretKey)).toBe(false);
  });
});

// ── 3. SHAPE — both fields are non-empty base64 strings ───────────────────────────────────────

describe('buildOwnerKeyRegistration — payload shape', () => {
  it('returns non-empty base64 x25519_pubkey + verifier_ct', async () => {
    const reg = await buildOwnerKeyRegistration(fixedSignature());
    expect(typeof reg.x25519_pubkey).toBe('string');
    expect(typeof reg.verifier_ct).toBe('string');
    expect(reg.x25519_pubkey.length).toBeGreaterThan(0);
    expect(reg.verifier_ct.length).toBeGreaterThan(0);
    // A registered X25519 public key is 32 bytes.
    expect(base64ToBytes(reg.x25519_pubkey).length).toBe(32);
  });
});
