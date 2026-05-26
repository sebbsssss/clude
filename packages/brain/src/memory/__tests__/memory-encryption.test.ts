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
  __resetForTests,
} from '../memory-encryption';

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
