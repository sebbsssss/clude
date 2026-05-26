import { describe, it, expect, vi, beforeEach } from 'vitest';
import nacl from 'tweetnacl';

// Bot wallet: a fixed ed25519 keypair so signing is deterministic in tests.
const botSign = nacl.sign.keyPair.fromSeed(new Uint8Array(32).fill(3));
vi.mock('@clude/shared/core/solana-client', () => ({
  getBotWallet: () => ({ secretKey: botSign.secretKey, publicKey: { toBase58: () => 'BOT' } }),
}));
// Mock the DB accessor so importing the REAL encryption-keys (via orig() below)
// doesn't pull in database.ts → config.ts, which throws "Missing X_API_KEY" in tests.
vi.mock('@clude/shared/core/database', () => ({ getDb: () => ({}) }));
// Registry: keep the real loadProviderKeypair/providerPublicKeyBase64 (env-driven),
// override only the owner lookup.
const getOwnerEncryptionKey = vi.fn();
vi.mock('@clude/shared/core/encryption-keys', async (orig) => ({
  ...(await orig<any>()),
  getOwnerEncryptionKey: (...a: any[]) => getOwnerEncryptionKey(...a),
}));

import {
  isMemoryEncryptionEnabled,
  getBotOwnerKeypair,
  encryptForStorage,
  __resetForTests,
} from '../memory-encryption';
import { decryptField, unwrapDek } from '@clude/shared/core/memory-envelope';

const providerKp = nacl.box.keyPair();
beforeEach(() => {
  vi.clearAllMocks();
  __resetForTests();
  delete process.env.PMP_ENCRYPTION_ENABLED;
  process.env.PMP_PROVIDER_ENC_SECRET = Buffer.from(providerKp.secretKey).toString('base64');
});

describe('gating', () => {
  it('disabled when PMP_ENCRYPTION_ENABLED is not "true"', () => {
    expect(isMemoryEncryptionEnabled()).toBe(false);
  });
  it('disabled when provider key missing even if flag on', () => {
    process.env.PMP_ENCRYPTION_ENABLED = 'true';
    delete process.env.PMP_PROVIDER_ENC_SECRET;
    expect(isMemoryEncryptionEnabled()).toBe(false);
  });
  it('enabled when flag on and provider key present', () => {
    process.env.PMP_ENCRYPTION_ENABLED = 'true';
    expect(isMemoryEncryptionEnabled()).toBe(true);
  });
});

describe('bot owner keypair', () => {
  it('derives deterministically from the bot wallet signature (X25519, 32-byte)', async () => {
    const a = await getBotOwnerKeypair();
    const b = await getBotOwnerKeypair();
    expect(a).not.toBeNull();
    expect(a!.publicKey.length).toBe(32);
    expect(Buffer.from(a!.publicKey).equals(Buffer.from(b!.publicKey))).toBe(true);
  });
});

describe('encryptForStorage', () => {
  beforeEach(() => { process.env.PMP_ENCRYPTION_ENABLED = 'true'; });

  it('returns null when encryption disabled', async () => {
    process.env.PMP_ENCRYPTION_ENABLED = 'false';
    expect(await encryptForStorage('secret', 'BOT')).toBeNull();
  });

  it('encrypts a null-owner memory to the bot key (the bot owns its own memories — §4.4)', async () => {
    const out = await encryptForStorage('bot memory', null);
    expect(out).not.toBeNull();
    const ownerWrap = out!.wraps.find(w => w.recipient === 'owner')!;
    const botKp = (await getBotOwnerKeypair())!;
    const dek = unwrapDek(ownerWrap.wrapped_dek, ownerWrap.wrap_pubkey, botKp.secretKey);
    expect(decryptField(out!.ciphertext, dek!)).toBe('bot memory');
  });

  it('encrypts for the bot owner + provider; both wraps yield the DEK that decrypts content', async () => {
    const out = await encryptForStorage('top secret memory', 'BOT'); // 'BOT' === bot wallet addr
    expect(out).not.toBeNull();
    const { ciphertext, ownerPubkey, wraps } = out!;
    expect(wraps.map(w => w.recipient).sort()).toEqual(['owner', 'provider']);

    const provWrap = wraps.find(w => w.recipient === 'provider')!;
    const dek = unwrapDek(provWrap.wrapped_dek, provWrap.wrap_pubkey, providerKp.secretKey);
    expect(dek).not.toBeNull();
    expect(decryptField(ciphertext, dek!)).toBe('top secret memory');

    // ciphertext is not the plaintext; DEK never appears in the returned shape
    expect(ciphertext).not.toContain('top secret');
    expect(JSON.stringify(out)).not.toContain(Buffer.from(dek!).toString('base64'));
    const botKp = (await getBotOwnerKeypair())!;
    expect(ownerPubkey).toBe(Buffer.from(botKp.publicKey).toString('base64'));
  });

  it('returns null when a user owner has no published key (§5 step 6)', async () => {
    getOwnerEncryptionKey.mockResolvedValueOnce(null);
    expect(await encryptForStorage('x', 'USER_WALLET_NO_KEY')).toBeNull();
  });

  it('encrypts for a user owner using their registry pubkey', async () => {
    const userKp = nacl.box.keyPair();
    getOwnerEncryptionKey.mockResolvedValueOnce({
      x25519_pubkey: Buffer.from(userKp.publicKey).toString('base64'), verifier_ct: 'x',
    });
    const out = await encryptForStorage('hi', 'USER_WALLET');
    const ownerWrap = out!.wraps.find(w => w.recipient === 'owner')!;
    const dek = unwrapDek(ownerWrap.wrapped_dek, ownerWrap.wrap_pubkey, userKp.secretKey);
    expect(decryptField(out!.ciphertext, dek!)).toBe('hi');
  });
});
