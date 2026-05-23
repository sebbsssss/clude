import { describe, it, expect } from 'vitest';
import nacl from 'tweetnacl';
import {
  generateDek,
  encryptField,
  decryptField,
  NONCE_LENGTH,
  wrapDek,
  unwrapDek,
  deriveOwnerEncryptionKeypair,
  makeVerifierCiphertext,
  checkVerifier,
} from '../memory-envelope';

describe('DEK + field encryption', () => {
  it('generateDek returns 32 random bytes', () => {
    const a = generateDek();
    const b = generateDek();
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false); // random
  });

  it('encrypt → decrypt round-trips', () => {
    const dek = generateDek();
    const pt = 'a secret memory with emoji 🧠 and unicode café';
    const ct = encryptField(pt, dek);
    expect(decryptField(ct, dek)).toBe(pt);
  });

  it('uses an independent random nonce per call (no reuse)', () => {
    const dek = generateDek();
    const c1 = encryptField('same plaintext', dek);
    const c2 = encryptField('same plaintext', dek);
    expect(c1).not.toBe(c2); // different nonce ⇒ different ciphertext
    // nonce is the first NONCE_LENGTH bytes; assert they differ
    const n1 = Buffer.from(c1, 'base64').subarray(0, NONCE_LENGTH);
    const n2 = Buffer.from(c2, 'base64').subarray(0, NONCE_LENGTH);
    expect(n1.equals(n2)).toBe(false);
  });

  it('decrypt with the wrong key returns null', () => {
    const ct = encryptField('hello', generateDek());
    expect(decryptField(ct, generateDek())).toBeNull();
  });

  it('decrypt of tampered ciphertext returns null', () => {
    const dek = generateDek();
    const ct = encryptField('hello', dek);
    const raw = Buffer.from(ct, 'base64');
    raw[raw.length - 1] ^= 0xff; // flip a bit in the ciphertext
    expect(decryptField(raw.toString('base64'), dek)).toBeNull();
  });

  it('decrypt of garbage returns null (never throws)', () => {
    expect(decryptField('not-base64-@@@', generateDek())).toBeNull();
    expect(decryptField('', generateDek())).toBeNull();
  });
});

describe('DEK wrap / unwrap (sealed box)', () => {
  it('wraps to a recipient pubkey and the recipient can unwrap', () => {
    const recipient = nacl.box.keyPair();
    const dek = generateDek();
    const { wrapped, wrapPubkey } = wrapDek(dek, recipient.publicKey);
    const out = unwrapDek(wrapped, wrapPubkey, recipient.secretKey);
    expect(out).not.toBeNull();
    expect(Buffer.from(out!).equals(Buffer.from(dek))).toBe(true);
  });

  it('wrapPubkey is the EPHEMERAL sender pubkey, not the recipient', () => {
    const recipient = nacl.box.keyPair();
    const { wrapPubkey } = wrapDek(generateDek(), recipient.publicKey);
    expect(wrapPubkey).not.toBe(Buffer.from(recipient.publicKey).toString('base64'));
  });

  it('a different recipient secret cannot unwrap', () => {
    const recipient = nacl.box.keyPair();
    const attacker = nacl.box.keyPair();
    const { wrapped, wrapPubkey } = wrapDek(generateDek(), recipient.publicKey);
    expect(unwrapDek(wrapped, wrapPubkey, attacker.secretKey)).toBeNull();
  });

  it('two wraps of the same DEK differ (fresh ephemeral key each time)', () => {
    const recipient = nacl.box.keyPair();
    const dek = generateDek();
    const a = wrapDek(dek, recipient.publicKey);
    const b = wrapDek(dek, recipient.publicKey);
    expect(a.wrapped).not.toBe(b.wrapped);
    expect(a.wrapPubkey).not.toBe(b.wrapPubkey);
  });

  it('unwrap of garbage returns null (never throws)', () => {
    const recipient = nacl.box.keyPair();
    expect(unwrapDek('@@@', 'also-bad', recipient.secretKey)).toBeNull();
  });
});

describe('owner key derivation + verifier token', () => {
  // 64-byte fake ed25519 signature (deterministic input)
  const sigA = new Uint8Array(64).fill(7);
  const sigB = new Uint8Array(64).fill(9);

  it('derives deterministically from the same signature', async () => {
    const k1 = await deriveOwnerEncryptionKeypair(sigA);
    const k2 = await deriveOwnerEncryptionKeypair(sigA);
    expect(Buffer.from(k1.publicKey).toString('base64'))
      .toBe(Buffer.from(k2.publicKey).toString('base64'));
    expect(k1.publicKey.length).toBe(32);
    expect(k1.secretKey.length).toBe(32);
  });

  it('different signatures derive different keys', async () => {
    const k1 = await deriveOwnerEncryptionKeypair(sigA);
    const k2 = await deriveOwnerEncryptionKeypair(sigB);
    expect(Buffer.from(k1.publicKey).equals(Buffer.from(k2.publicKey))).toBe(false);
  });

  it('verifier round-trips for the same key', async () => {
    const k = await deriveOwnerEncryptionKeypair(sigA);
    const ct = makeVerifierCiphertext(k.secretKey);
    expect(checkVerifier(ct, k.secretKey)).toBe(true);
  });

  it('verifier FAILS for a key derived from a different (non-deterministic) signature', async () => {
    const good = await deriveOwnerEncryptionKeypair(sigA);
    const drift = await deriveOwnerEncryptionKeypair(sigB); // simulates a signer that added entropy
    const ct = makeVerifierCiphertext(good.secretKey);
    expect(checkVerifier(ct, drift.secretKey)).toBe(false);
  });
});
