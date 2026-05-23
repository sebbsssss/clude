import { describe, it, expect } from 'vitest';
import {
  generateDek,
  encryptField,
  decryptField,
  NONCE_LENGTH,
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
