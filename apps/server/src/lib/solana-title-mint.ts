/**
 * solana-title-mint — the Solana pack-TITLE mint client (the Solana-native ownership layer).
 *
 * PIVOT 2026-06-24: pack ownership is a 1-of-1 Solana NFT held in the USER'S OWN wallet (non-custodial),
 * not a custodial Base ERC-721. This module is the Solana analog of evm-title-client.ts.
 *
 * The title is a standard SPL mint with supply 1 / decimals 0, minted to the user's wallet, then the
 * mint authority is revoked so no second unit can ever exist (a true 1-of-1). OWNERSHIP = whoever holds
 * that single token, which is what fixes the old `holdsPackToken` balance>=1 double-spend by
 * construction (pack-gate.ts:111): a 1-of-1 has exactly one holder, so there is nothing to double-spend.
 *
 * HARD SECURITY BOUNDARIES:
 *   - The mint authority is a DEDICATED keypair (SOLANA_TITLE_MINTER_KEY), NEVER the memo-only bot
 *     wallet (solana-client.ts is explicitly memo+registry only — "reject transfer functionality in
 *     review"). loadTitleMinter refuses if the configured key equals the bot wallet.
 *   - Minting on MAINNET is gated behind ALLOW_SOLANA_MAINNET_TITLES (SEC: a transferable title is
 *     Howey-sensitive on any chain). resolveSolanaTitleEnv throws on an un-gated mainnet. Devnet is free.
 *
 * The binding (merkle_root + manifest_hash) is NOT stored on the bare SPL mint (no room); it is linked
 * by pack_id — the pack's commitment is already on-chain via the `clude-pack` memo (PdaMintClient). A
 * later increment attaches Metaplex Token Metadata (name/symbol/uri) so the title shows as a proper NFT
 * in wallets/marketplaces; the ownership + transfer logic here is unchanged by that.
 *
 * connection + minter are injected by the factory so the env resolver, the minter loader, and the
 * ownership lookup are unit-tested with mocks. The live mint is verified on DEVNET (Phase 0b), the same
 * build-then-devnet-spike pattern the Base client used on Sepolia.
 */

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  AuthorityType,
} from '@solana/spl-token';
import bs58 from 'bs58';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('solana-title-mint');

const DEVNET_RPC = 'https://api.devnet.solana.com';
const MAINNET_RPC = 'https://api.mainnet-beta.solana.com';

// ─────────── env resolver + SEC mainnet gate ───────────

export interface SolanaTitleEnv {
  rpcUrl: string;
  network: 'mainnet-beta' | 'devnet';
}

/**
 * Resolve the Solana title environment, enforcing the SEC mainnet gate. Throws on mainnet-beta unless
 * ALLOW_SOLANA_MAINNET_TITLES === 'true'. Reads process.env (injectable for tests). Mirrors the Base
 * resolveEvmTitleEnv pattern (env-direct, not the throwing central config) so unit tests stay clean.
 */
export function resolveSolanaTitleEnv(env: NodeJS.ProcessEnv = process.env): SolanaTitleEnv {
  const network: 'mainnet-beta' | 'devnet' = env.SOLANA_NETWORK === 'devnet' ? 'devnet' : 'mainnet-beta';
  if (network === 'mainnet-beta' && env.ALLOW_SOLANA_MAINNET_TITLES !== 'true') {
    throw new Error(
      'Solana MAINNET pack titles are gated behind the securities sign-off: set ALLOW_SOLANA_MAINNET_TITLES=true only after SEC review. Use SOLANA_NETWORK=devnet for now.',
    );
  }
  const rpcUrl = env.SOLANA_RPC_URL?.trim() || (network === 'devnet' ? DEVNET_RPC : MAINNET_RPC);
  return { rpcUrl, network };
}

// ─────────── dedicated minter keypair (NEVER the bot wallet) ───────────

function decodeSecret(raw: string): Uint8Array {
  const t = raw.trim();
  return t.startsWith('[') ? Uint8Array.from(JSON.parse(t)) : bs58.decode(t);
}

/**
 * Load the dedicated pack-title mint authority from SOLANA_TITLE_MINTER_KEY (bs58 or JSON array).
 * REFUSES to load if it is unset, or if it equals the memo-only bot wallet (the bot wallet must never
 * gain mint capability). Reads process.env (injectable for tests).
 */
export function loadTitleMinter(env: NodeJS.ProcessEnv = process.env): Keypair {
  const raw = (env.SOLANA_TITLE_MINTER_KEY ?? '').trim();
  if (!raw) {
    throw new Error('SOLANA_TITLE_MINTER_KEY is not set (the dedicated pack-title mint authority)');
  }
  const bot = (env.BOT_WALLET_PRIVATE_KEY ?? '').trim();
  if (bot && raw === bot) {
    throw new Error(
      'SOLANA_TITLE_MINTER_KEY must NOT equal the bot wallet — the bot wallet is memo-only by design and must never hold mint authority',
    );
  }
  let kp: Keypair;
  try {
    kp = Keypair.fromSecretKey(decodeSecret(raw));
  } catch (err) {
    log.error({ err }, 'loadTitleMinter: failed to decode SOLANA_TITLE_MINTER_KEY');
    throw new Error('SOLANA_TITLE_MINTER_KEY is not a valid bs58 / JSON-array secret key');
  }
  return kp;
}

// ─────────── client ───────────

export interface TitleBinding {
  packId: string;
  merkleRoot: string;
  manifestHash: string;
  memoryCount: number;
}

export interface MintTitleResult {
  /** The SPL mint address — the title's on-chain id (tracked in the DB title record). */
  mintAddress: string;
  /** The mint tx signature. */
  txSig: string;
}

export interface SolanaTitleMintClient {
  readonly network: 'mainnet-beta' | 'devnet';
  /** Mint a 1-of-1 title to `toWallet` (the user's OWN address) and revoke mint authority. */
  mintTitle(toWallet: string, binding: TitleBinding): Promise<MintTitleResult>;
  /** The current owner (base58) of the 1-of-1 `mintAddress`, or null if unheld/burned. */
  titleOwner(mintAddress: string): Promise<string | null>;
}

export interface SolanaTitleClientDeps {
  connection: Connection;
  minter: Keypair;
  network: 'mainnet-beta' | 'devnet';
}

export function createSolanaTitleMintClient(deps: SolanaTitleClientDeps): SolanaTitleMintClient {
  const { connection, minter, network } = deps;

  return {
    network,

    async mintTitle(toWallet: string, binding: TitleBinding): Promise<MintTitleResult> {
      const owner = new PublicKey(toWallet); // throws on a malformed address — fail loud

      // 1) Create the mint: decimals 0, mint authority = the dedicated minter, no freeze authority.
      const mint = await createMint(connection, minter, minter.publicKey, null, 0);

      // 2) The recipient's associated token account (created if absent; rent paid by the minter).
      const ata = await getOrCreateAssociatedTokenAccount(connection, minter, mint, owner);

      // 3) Mint exactly ONE unit to the user.
      const txSig = await mintTo(connection, minter, mint, ata.address, minter, 1);

      // 4) Revoke mint authority → supply is permanently 1. A true 1-of-1; nothing more can be minted.
      await setAuthority(connection, minter, mint, minter, AuthorityType.MintTokens, null);

      log.info(
        { mint: mint.toBase58(), to: toWallet.slice(0, 8), packId: binding.packId, network },
        'solana title minted (1-of-1, authority revoked) to the user wallet',
      );
      return { mintAddress: mint.toBase58(), txSig };
    },

    async titleOwner(mintAddress: string): Promise<string | null> {
      const mint = new PublicKey(mintAddress);
      // The 1-of-1's holder = the token account holding the single unit. getTokenLargestAccounts
      // returns holders largest-first; for a 1-of-1 there is at most one with amount 1.
      const largest = await connection.getTokenLargestAccounts(mint);
      const holder = (largest.value ?? []).find((a) => a.uiAmount === 1 || a.amount === '1');
      if (!holder) return null; // unheld / burned
      const acct = await connection.getParsedAccountInfo(holder.address);
      const parsed = acct.value?.data as { parsed?: { info?: { owner?: string } } } | undefined;
      return parsed?.parsed?.info?.owner ?? null;
    },
  };
}

/** Build the production client from env (dedicated minter + gated network). Throws if mis-configured. */
export function getSolanaTitleMintClient(): SolanaTitleMintClient {
  const env = resolveSolanaTitleEnv();
  const minter = loadTitleMinter();
  const connection = new Connection(env.rpcUrl, 'confirmed');
  return createSolanaTitleMintClient({ connection, minter, network: env.network });
}
