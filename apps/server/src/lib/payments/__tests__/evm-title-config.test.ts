import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAddress } from 'viem';
import {
  resolveEvmTitleEnv,
  getReadOnlyEvmTitleClient,
  getMinterEvmTitleClient,
  getOwnerSignedEvmTitleClient,
  __resetEvmTitleClientsForTests,
} from '../evm-title-config.js';

const LIVE_CONTRACT = '0xf4ED013433bB79B8EC7C76CCAAbeB64A7B62863a';
// A throwaway secp256k1 key (well-known anvil account #1) — never used on any real chain here.
const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

// Keys we mutate; saved + restored so tests don't leak env.
const ENV_KEYS = ['CLUDE_PACK_TITLE_ADDRESS', 'BASE_RPC_URL', 'BASE_CHAIN_ID', 'BASE_MINTER_KEY', 'ALLOW_BASE_MAINNET'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  __resetEvmTitleClientsForTests();
  process.env.CLUDE_PACK_TITLE_ADDRESS = LIVE_CONTRACT;
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  __resetEvmTitleClientsForTests();
});

describe('resolveEvmTitleEnv', () => {
  it('defaults to Base Sepolia + the public RPC when only the contract is set', () => {
    const env = resolveEvmTitleEnv();
    expect(env.chainId).toBe(84532);
    expect(env.rpcUrl).toBe('https://sepolia.base.org');
    expect(env.contractAddress).toBe(getAddress(LIVE_CONTRACT));
  });

  it('throws when the contract address is missing', () => {
    delete process.env.CLUDE_PACK_TITLE_ADDRESS;
    expect(() => resolveEvmTitleEnv()).toThrow(/CLUDE_PACK_TITLE_ADDRESS is not set/);
  });

  it('throws on a malformed contract address', () => {
    process.env.CLUDE_PACK_TITLE_ADDRESS = '0xnot-an-address';
    expect(() => resolveEvmTitleEnv()).toThrow(/not a valid EVM address/);
  });

  it('rejects a chain id that is neither Base Sepolia nor mainnet', () => {
    process.env.BASE_CHAIN_ID = '1'; // Ethereum mainnet — not allowed
    expect(() => resolveEvmTitleEnv()).toThrow(/BASE_CHAIN_ID must be 84532/);
  });

  it('SEC-1 GATE: refuses Base mainnet (8453) unless ALLOW_BASE_MAINNET=true', () => {
    process.env.BASE_CHAIN_ID = '8453';
    expect(() => resolveEvmTitleEnv()).toThrow(/gated behind SEC-1/);
  });

  it('SEC-1 GATE: permits Base mainnet once ALLOW_BASE_MAINNET=true', () => {
    process.env.BASE_CHAIN_ID = '8453';
    process.env.ALLOW_BASE_MAINNET = 'true';
    expect(resolveEvmTitleEnv().chainId).toBe(8453);
  });
});

describe('client factories', () => {
  it('read-only client exposes the configured contract address and is memoized', () => {
    const c1 = getReadOnlyEvmTitleClient();
    const c2 = getReadOnlyEvmTitleClient();
    expect(c1).toBe(c2); // memoized
    expect(c1.contractAddress).toBe(getAddress(LIVE_CONTRACT));
    // tokenId derivation works without any signer.
    expect(typeof c1.tokenIdFor('pack-x')).toBe('bigint');
  });

  it('minter client throws without BASE_MINTER_KEY, builds with it', () => {
    expect(() => getMinterEvmTitleClient()).toThrow(/BASE_MINTER_KEY is not set/);
    process.env.BASE_MINTER_KEY = TEST_KEY;
    const c = getMinterEvmTitleClient();
    expect(c.contractAddress).toBe(getAddress(LIVE_CONTRACT));
  });

  it('owner-signed client requires a signer key', () => {
    expect(() => getOwnerSignedEvmTitleClient('' as `0x${string}`)).toThrow(/signerKey is required/);
    const c = getOwnerSignedEvmTitleClient(TEST_KEY);
    expect(c.contractAddress).toBe(getAddress(LIVE_CONTRACT));
  });

  it('the SEC-1 gate also blocks building a mainnet client through the factory', () => {
    process.env.BASE_CHAIN_ID = '8453';
    expect(() => getReadOnlyEvmTitleClient()).toThrow(/gated behind SEC-1/);
  });
});
