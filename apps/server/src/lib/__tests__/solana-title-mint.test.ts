/**
 * solana-title-mint — the Solana-native pack TITLE mint client (PIVOT 2026-06-24). MONEY/ASSET CODE.
 *
 * Unit-tests the testable + security-critical surface (the live mint is verified on devnet, Phase 0b,
 * the same build-then-spike pattern the Base client used on Sepolia):
 *   1. SEC mainnet gate — minting on mainnet-beta throws unless ALLOW_SOLANA_MAINNET_TITLES=true.
 *   2. Dedicated minter — loaded from SOLANA_TITLE_MINTER_KEY, REFUSED if it equals the memo-only bot
 *      wallet (solana-client.ts must never gain mint capability).
 *   3. Ownership = the single holder of the 1-of-1 — the model that fixes the old `holdsPackToken`
 *      balance>=1 double-spend by construction.
 */
import { describe, it, expect, vi } from 'vitest';
import { Keypair, SystemProgram } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import bs58 from 'bs58';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  resolveSolanaTitleEnv,
  loadTitleMinter,
  loadTitleMintSeed,
  deriveTitleMintKeypair,
  createSolanaTitleMintClient,
  assertTitleOwner,
} from '../solana-title-mint.js';

describe('resolveSolanaTitleEnv — SEC mainnet gate', () => {
  it('devnet is always allowed', () => {
    expect(resolveSolanaTitleEnv({ SOLANA_NETWORK: 'devnet' } as NodeJS.ProcessEnv)).toEqual({
      network: 'devnet',
      rpcUrl: 'https://api.devnet.solana.com',
    });
  });

  it('mainnet THROWS without the gate', () => {
    expect(() => resolveSolanaTitleEnv({ SOLANA_NETWORK: 'mainnet-beta' } as NodeJS.ProcessEnv)).toThrow(/MAINNET|securities/i);
  });

  it('default network is mainnet, so it is gated by default', () => {
    expect(() => resolveSolanaTitleEnv({} as NodeJS.ProcessEnv)).toThrow(/MAINNET|securities/i);
  });

  it('mainnet allowed once ALLOW_SOLANA_MAINNET_TITLES=true', () => {
    const env = resolveSolanaTitleEnv({ SOLANA_NETWORK: 'mainnet-beta', ALLOW_SOLANA_MAINNET_TITLES: 'true' } as NodeJS.ProcessEnv);
    expect(env).toEqual({ network: 'mainnet-beta', rpcUrl: 'https://api.mainnet-beta.solana.com' });
  });

  it('honors an explicit SOLANA_RPC_URL', () => {
    const env = resolveSolanaTitleEnv({ SOLANA_NETWORK: 'devnet', SOLANA_RPC_URL: 'http://localhost:8899' } as NodeJS.ProcessEnv);
    expect(env.rpcUrl).toBe('http://localhost:8899');
  });
});

describe('loadTitleMinter — dedicated key, never the bot wallet', () => {
  const kp = Keypair.generate();
  const bs58Key = bs58.encode(kp.secretKey);
  const jsonKey = JSON.stringify(Array.from(kp.secretKey));

  it('loads a bs58 secret key to the right pubkey', () => {
    const m = loadTitleMinter({ SOLANA_TITLE_MINTER_KEY: bs58Key } as NodeJS.ProcessEnv);
    expect(m.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it('loads a JSON-array secret key', () => {
    const m = loadTitleMinter({ SOLANA_TITLE_MINTER_KEY: jsonKey } as NodeJS.ProcessEnv);
    expect(m.publicKey.toBase58()).toBe(kp.publicKey.toBase58());
  });

  it('throws when the key is unset', () => {
    expect(() => loadTitleMinter({} as NodeJS.ProcessEnv)).toThrow(/not set/i);
  });

  it('REFUSES to use the bot wallet (the memo-only boundary)', () => {
    expect(() =>
      loadTitleMinter({ SOLANA_TITLE_MINTER_KEY: bs58Key, BOT_WALLET_PRIVATE_KEY: bs58Key } as NodeJS.ProcessEnv),
    ).toThrow(/bot wallet/i);
  });

  it('throws on a malformed key', () => {
    expect(() => loadTitleMinter({ SOLANA_TITLE_MINTER_KEY: 'not-a-valid-key!!!' } as NodeJS.ProcessEnv)).toThrow(/valid/i);
  });
});

describe('titleOwner — the 1-of-1 holder (fixes the balance>=1 double-spend)', () => {
  const minter = Keypair.generate();
  const ownerWallet = Keypair.generate().publicKey.toBase58();
  const tokenAccount = Keypair.generate().publicKey;
  const mintAddr = Keypair.generate().publicKey.toBase58();

  it('resolves the wallet holding the single unit', async () => {
    const connection = {
      getTokenLargestAccounts: vi.fn(async () => ({ value: [{ address: tokenAccount, amount: '1', uiAmount: 1 }] })),
      getParsedAccountInfo: vi.fn(async () => ({ value: { data: { parsed: { info: { owner: ownerWallet } } } } })),
    } as unknown as import('@solana/web3.js').Connection;
    const client = createSolanaTitleMintClient({ connection, minter, network: 'devnet', mintSeed: 'test-seed' });
    expect(await client.titleOwner(mintAddr)).toBe(ownerWallet);
  });

  it('returns null when nothing holds the token (burned / unminted)', async () => {
    const connection = {
      getTokenLargestAccounts: vi.fn(async () => ({ value: [] })),
      getParsedAccountInfo: vi.fn(),
    } as unknown as import('@solana/web3.js').Connection;
    const client = createSolanaTitleMintClient({ connection, minter, network: 'devnet', mintSeed: 'test-seed' });
    expect(await client.titleOwner(mintAddr)).toBeNull();
  });
});

describe('loadTitleMintSeed — required server secret for deterministic addresses', () => {
  it('loads the seed', () => {
    expect(loadTitleMintSeed({ SOLANA_TITLE_MINT_SEED: 's3cr3t' } as NodeJS.ProcessEnv)).toBe('s3cr3t');
  });
  it('throws when unset (a missing seed defeats the double-mint guard)', () => {
    expect(() => loadTitleMintSeed({} as NodeJS.ProcessEnv)).toThrow(/SOLANA_TITLE_MINT_SEED|deterministic/i);
  });
});

describe('deriveTitleMintKeypair — deterministic, double-mint-proof addresses', () => {
  const seed = 'server-secret-seed';
  it('is deterministic: same (packId, seed) → same address (re-derivable after a crash)', () => {
    expect(deriveTitleMintKeypair('clude-pack-abc', seed).publicKey.toBase58()).toBe(
      deriveTitleMintKeypair('clude-pack-abc', seed).publicKey.toBase58(),
    );
  });
  it('different packId → different address', () => {
    expect(deriveTitleMintKeypair('clude-pack-abc', seed).publicKey.toBase58()).not.toBe(
      deriveTitleMintKeypair('clude-pack-xyz', seed).publicKey.toBase58(),
    );
  });
  it('different seed → different address (the secret seed is what keeps it non-public)', () => {
    expect(deriveTitleMintKeypair('clude-pack-abc', seed).publicKey.toBase58()).not.toBe(
      deriveTitleMintKeypair('clude-pack-abc', 'other-seed').publicKey.toBase58(),
    );
  });
});

describe('mintTitle — idempotency guard (the double-mint fix)', () => {
  const minter = Keypair.generate();
  const toWallet = Keypair.generate().publicKey.toBase58();
  const binding = { packId: 'clude-pack-idem', merkleRoot: '0xabc', manifestHash: '0xdef', memoryCount: 3 };

  it('no-op when the deterministic mint already exists: returns alreadyMinted, broadcasts nothing', async () => {
    // getAccountInfo resolving a TOKEN_PROGRAM-owned account ⟺ the atomic mint already landed. The
    // mint path never reaches getMinimumBalanceForRentExemptMint / sendAndConfirmTransaction (absent on
    // this mock) — so a clean return proves the idempotency branch short-circuited before any broadcast.
    const getAccountInfo = vi.fn(async () => ({ owner: TOKEN_PROGRAM_ID }));
    const connection = { getAccountInfo } as unknown as import('@solana/web3.js').Connection;
    const client = createSolanaTitleMintClient({ connection, minter, network: 'devnet', mintSeed: 'seed' });

    const res = await client.mintTitle(toWallet, binding);
    expect(res.alreadyMinted).toBe(true);
    expect(res.txSig).toBeNull();
    expect(res.mintAddress).toBe(deriveTitleMintKeypair(binding.packId, 'seed').publicKey.toBase58());
    expect(getAccountInfo).toHaveBeenCalledOnce();
  });

  it('refuses when something else occupies the address (not a token mint — anomaly / grief)', async () => {
    const getAccountInfo = vi.fn(async () => ({ owner: SystemProgram.programId }));
    const connection = { getAccountInfo } as unknown as import('@solana/web3.js').Connection;
    const client = createSolanaTitleMintClient({ connection, minter, network: 'devnet', mintSeed: 'seed' });

    await expect(client.mintTitle(toWallet, binding)).rejects.toThrow(/not owned by the token program/i);
  });
});

describe('assertTitleOwner — authoritative gate (replaces holdsPackToken balance>=1)', () => {
  const mint = Keypair.generate().publicKey.toBase58();
  const wallet = Keypair.generate().publicKey.toBase58();
  const other = Keypair.generate().publicKey.toBase58();
  const clientWith = (owner: string | null) =>
    ({ network: 'devnet', titleOwner: vi.fn(async () => owner), mintTitle: vi.fn() }) as unknown as ReturnType<typeof createSolanaTitleMintClient>;

  it('TRUE when the wallet holds the 1-of-1', async () => {
    expect(await assertTitleOwner(clientWith(wallet), mint, wallet)).toBe(true);
  });
  it('FALSE when someone else holds it (no double-spend)', async () => {
    expect(await assertTitleOwner(clientWith(other), mint, wallet)).toBe(false);
  });
  it('FALSE when unheld / burned (titleOwner null)', async () => {
    expect(await assertTitleOwner(clientWith(null), mint, wallet)).toBe(false);
  });
});
