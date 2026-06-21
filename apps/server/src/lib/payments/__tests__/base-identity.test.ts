import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { isAddress, getAddress } from 'viem';
import nacl from 'tweetnacl';
import { createCustodialBaseResolver } from '../base-identity.js';

const SEED = 'test-seed-0123456789abcdef'; // ≥ 16 chars
const ALICE = 'AliceSolanaWa11et1111111111111111111111111';
const BOB = 'BobSolanaWa11et22222222222222222222222222222';

describe('base-identity — custodial Base identity derivation', () => {
  it('is DETERMINISTIC: same (wallet, seed) → same address across resolver instances', () => {
    const r1 = createCustodialBaseResolver(SEED);
    const r2 = createCustodialBaseResolver(SEED);
    expect(r1.addressFor(ALICE)).toBe(r2.addressFor(ALICE));
    // and stable across repeated calls
    expect(r1.addressFor(ALICE)).toBe(r1.addressFor(ALICE));
  });

  it('returns a valid CHECKSUMMED Base address', () => {
    const r = createCustodialBaseResolver(SEED);
    const addr = r.addressFor(ALICE);
    expect(isAddress(addr)).toBe(true);
    expect(addr).toBe(getAddress(addr)); // already checksummed
  });

  it('gives DISTINCT addresses to distinct app wallets (buyer ≠ seller on-chain)', () => {
    const r = createCustodialBaseResolver(SEED);
    expect(r.addressFor(ALICE)).not.toBe(r.addressFor(BOB));
  });

  it('changing the seed re-derives a DIFFERENT address for the same wallet', () => {
    const a = createCustodialBaseResolver(SEED).addressFor(ALICE);
    const b = createCustodialBaseResolver('a-completely-different-seed-value').addressFor(ALICE);
    expect(a).not.toBe(b);
  });

  it('the custodied signerKey actually derives the advertised address (server can sign as it)', () => {
    const r = createCustodialBaseResolver(SEED);
    const keys = r.keysFor(ALICE);
    expect(privateKeyToAccount(keys.signerKey).address).toBe(keys.address);
    expect(keys.signerKey).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });

  it('derives a usable 32-byte X25519 keypair (the title_holder DEK recipient)', () => {
    const r = createCustodialBaseResolver(SEED);
    const keys = r.keysFor(ALICE);
    const pub = Buffer.from(keys.x25519PublicKeyB64, 'base64');
    expect(pub.length).toBe(32);
    expect(keys.x25519SecretKey.length).toBe(32);
    // The public key is the genuine nacl pair of the secret (a sealed box to it is openable).
    const reDerived = nacl.box.keyPair.fromSecretKey(keys.x25519SecretKey).publicKey;
    expect(Buffer.from(reDerived).toString('base64')).toBe(keys.x25519PublicKeyB64);
  });

  it('the secp256k1 and X25519 derivations are domain-separated (secret keys differ)', () => {
    const r = createCustodialBaseResolver(SEED);
    const keys = r.keysFor(ALICE);
    // signerKey (secp) bytes must not equal the x25519 secret bytes — distinct domains.
    const secpBytes = Buffer.from(keys.signerKey.slice(2), 'hex');
    expect(Buffer.compare(secpBytes, Buffer.from(keys.x25519SecretKey)) === 0).toBe(false);
  });

  it('is marked custodial (testnet) — the flag a non-custodial Privy-EVM swap would flip', () => {
    expect(createCustodialBaseResolver(SEED).custodial).toBe(true);
  });

  it('rejects an empty app wallet and a too-short seed (fail closed)', () => {
    expect(() => createCustodialBaseResolver('short')).toThrow(/≥ 16|at least|BASE_CUSTODIAL_SEED/);
    const r = createCustodialBaseResolver(SEED);
    expect(() => r.keysFor('')).toThrow(/appWallet is required/);
    expect(() => r.addressFor('   ')).toThrow(/appWallet is required/);
  });
});
