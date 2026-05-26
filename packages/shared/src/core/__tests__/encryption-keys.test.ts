import { describe, it, expect, vi, beforeEach } from 'vitest';
import nacl from 'tweetnacl';

// Mocks must be defined in a hoisted block: vi.mock is hoisted above the module
// imports, and the mocked './database' factory runs during the import of the
// module-under-test — before plain top-level `const`s would initialize (TDZ).
const { upsertMock, maybeSingleMock, fromMock } = vi.hoisted(() => {
  const upsertMock = vi.fn();
  const maybeSingleMock = vi.fn();
  const fromMock = vi.fn(() => ({
    upsert: upsertMock,
    select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
  }));
  return { upsertMock, maybeSingleMock, fromMock };
});
vi.mock('../database', () => ({ getDb: () => ({ from: fromMock }) }));

import {
  loadProviderKeypair,
  providerPublicKeyBase64,
  getOwnerEncryptionKey,
  publishOwnerEncryptionKey,
  __resetProviderKeypairForTests,
} from '../encryption-keys';

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.PMP_PROVIDER_ENC_SECRET;
  __resetProviderKeypairForTests(); // provider keypair is memoized — reset so "missing env throws" is deterministic, not order-dependent
});

describe('provider keypair', () => {
  it('loads a 32-byte secret from PMP_PROVIDER_ENC_SECRET (base64)', () => {
    const kp = nacl.box.keyPair();
    process.env.PMP_PROVIDER_ENC_SECRET = Buffer.from(kp.secretKey).toString('base64');
    const loaded = loadProviderKeypair();
    expect(Buffer.from(loaded.publicKey).equals(Buffer.from(kp.publicKey))).toBe(true);
    expect(providerPublicKeyBase64()).toBe(Buffer.from(kp.publicKey).toString('base64'));
  });

  it('throws when the env var is missing', () => {
    expect(() => loadProviderKeypair()).toThrow(/PMP_PROVIDER_ENC_SECRET/);
  });

  it('throws when the secret is not 32 bytes', () => {
    process.env.PMP_PROVIDER_ENC_SECRET = Buffer.from('too-short').toString('base64');
    expect(() => loadProviderKeypair()).toThrow(/32 bytes/);
  });
});

describe('registry', () => {
  it('publishOwnerEncryptionKey upserts pubkey + verifier', async () => {
    upsertMock.mockResolvedValue({ error: null });
    await publishOwnerEncryptionKey('WALLET1', 'PUBKEY_B64', 'VERIFIER_B64');
    expect(fromMock).toHaveBeenCalledWith('encryption_keys');
    const arg = upsertMock.mock.calls[0][0];
    expect(arg).toMatchObject({
      owner_wallet: 'WALLET1',
      x25519_pubkey: 'PUBKEY_B64',
      verifier_ct: 'VERIFIER_B64',
    });
  });

  it('getOwnerEncryptionKey returns the row or null', async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: { x25519_pubkey: 'PK', verifier_ct: 'VC' }, error: null,
    });
    expect(await getOwnerEncryptionKey('WALLET1')).toEqual({ x25519_pubkey: 'PK', verifier_ct: 'VC' });

    maybeSingleMock.mockResolvedValueOnce({ data: null, error: null });
    expect(await getOwnerEncryptionKey('NOPE')).toBeNull();
  });

  it('publishOwnerEncryptionKey throws on a Supabase error', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'boom' } });
    await expect(publishOwnerEncryptionKey('W', 'P', 'V')).rejects.toThrow(/boom/);
  });
});
