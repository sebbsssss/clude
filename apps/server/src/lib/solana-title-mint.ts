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
 * IDEMPOTENT / DOUBLE-MINT-PROOF (the asset-critical property):
 *   - The mint address is DETERMINISTIC — derived from (packId, SOLANA_TITLE_MINT_SEED), the Solana
 *     analog of Base's deterministic tokenId (keccak256(packId)). So it is re-derivable after any crash.
 *   - The mint is ONE ATOMIC transaction (create + init + ATA + mintTo + revoke-authority). All-or-
 *     nothing: there is no partial on-chain state to resume from.
 *   - Therefore "does the deterministic mint account already exist?" answers "was this title already
 *     minted?" with NO database state. A crash after the broadcast, or a duplicate call, re-derives the
 *     same address, sees it exists, and returns an idempotent no-op — it NEVER mints a second 1-of-1.
 *
 * HARD SECURITY BOUNDARIES:
 *   - The mint authority is a DEDICATED keypair (SOLANA_TITLE_MINTER_KEY), NEVER the memo-only bot
 *     wallet (solana-client.ts is explicitly memo+registry only — "reject transfer functionality in
 *     review"). loadTitleMinter refuses if the configured key equals the bot wallet.
 *   - SOLANA_TITLE_MINT_SEED is server-secret so the deterministic mint keypair is NOT publicly
 *     derivable (a public packId alone cannot grief-create the mint account). Set once, never rotate.
 *   - Minting on MAINNET is gated behind ALLOW_SOLANA_MAINNET_TITLES (SEC: a transferable title is
 *     Howey-sensitive on any chain). resolveSolanaTitleEnv throws on an un-gated mainnet. Devnet is free.
 *
 * The binding (merkle_root + manifest_hash) is NOT stored on the bare SPL mint (no room); it is linked
 * by pack_id — the pack's commitment is already on-chain via the `clude-pack` memo (PdaMintClient). A
 * later increment attaches Metaplex Token Metadata (name/symbol/uri) so the title shows as a proper NFT
 * in wallets/marketplaces; the ownership + transfer logic here is unchanged by that.
 *
 * connection + minter + mintSeed are injected by the factory so the env resolver, the minter loader,
 * the keypair derivation, and the ownership lookup are unit-tested with mocks. The live atomic mint is
 * verified on DEVNET (Phase 0b), the same build-then-devnet-spike pattern the Base client used on Sepolia.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  AuthorityType,
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMint2Instruction,
  createMintToInstruction,
  createSetAuthorityInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from '@solana/spl-token';
import {
  createCreateMetadataAccountV3Instruction,
  PROGRAM_ID as TOKEN_METADATA_PROGRAM_ID,
} from '@metaplex-foundation/mpl-token-metadata';
import { createHash } from 'node:crypto';
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

// ─────────── deterministic mint keypair (the double-mint guard) ───────────

/**
 * Load the server-secret seed that makes title mint addresses DETERMINISTIC. Required: a missing seed
 * would make every mint address random, defeating the idempotency guard (a crash-after-broadcast retry
 * could mint a SECOND 1-of-1). Set ONCE and never rotate — changing it re-derives every pack to a new
 * address, orphaning existing titles. Reads process.env (injectable for tests).
 */
export function loadTitleMintSeed(env: NodeJS.ProcessEnv = process.env): string {
  const seed = (env.SOLANA_TITLE_MINT_SEED ?? '').trim();
  if (!seed) {
    throw new Error(
      'SOLANA_TITLE_MINT_SEED is not set (the server secret that makes title mint addresses deterministic / double-mint-proof)',
    );
  }
  return seed;
}

/**
 * Derive the DETERMINISTIC mint keypair for a pack. The address is a pure function of (packId, seed),
 * so it is re-derivable after any crash — the Solana analog of Base's deterministic tokenId
 * (keccak256(packId)). Idempotency rests on this: "does this address already exist on-chain?" answers
 * "was this title already minted?" with no DB state. The seed is server-secret so the keypair is NOT
 * publicly derivable (a public packId alone cannot grief-create the mint account).
 */
export function deriveTitleMintKeypair(packId: string, seed: string): Keypair {
  const h = createHash('sha256').update(`clude-pmp-title:v1:${packId}:${seed}`).digest();
  return Keypair.fromSeed(h.subarray(0, 32)); // an Ed25519 seed is 32 bytes
}

// ─────────── client ───────────

export interface TitleBinding {
  packId: string;
  merkleRoot: string;
  manifestHash: string;
  memoryCount: number;
  /** The pack's display name → the NFT's on-chain metadata name (truncated to 32 chars). */
  name?: string;
}

export interface MintTitleResult {
  /** The SPL mint address — the title's on-chain id (tracked in the DB title record). */
  mintAddress: string;
  /** The mint tx signature, or null when the title already existed (idempotent no-op). */
  txSig: string | null;
  /** True when the deterministic mint already existed and this call minted nothing. */
  alreadyMinted: boolean;
}

export interface SolanaTitleMintClient {
  readonly network: 'mainnet-beta' | 'devnet';
  /** Mint a 1-of-1 title to `toWallet` (the user's OWN address) and revoke mint authority. Idempotent. */
  mintTitle(toWallet: string, binding: TitleBinding): Promise<MintTitleResult>;
  /** The current owner (base58) of the 1-of-1 `mintAddress`, or null if unheld/burned. */
  titleOwner(mintAddress: string): Promise<string | null>;
}

export interface SolanaTitleClientDeps {
  connection: Connection;
  minter: Keypair;
  network: 'mainnet-beta' | 'devnet';
  /** Server-secret seed for deterministic mint addresses (loadTitleMintSeed). */
  mintSeed: string;
  /** Base URI for the title's off-chain metadata JSON; the NFT uri is `${base}/${packId}.json`. */
  metadataBaseUri?: string;
}

export function createSolanaTitleMintClient(deps: SolanaTitleClientDeps): SolanaTitleMintClient {
  const { connection, minter, network, mintSeed, metadataBaseUri } = deps;

  return {
    network,

    async mintTitle(toWallet: string, binding: TitleBinding): Promise<MintTitleResult> {
      const owner = new PublicKey(toWallet); // throws on a malformed address — fail loud

      // DETERMINISTIC address (re-derivable after any crash) — the Solana analog of Base's tokenId.
      const mintKp = deriveTitleMintKeypair(binding.packId, mintSeed);
      const mint = mintKp.publicKey;

      // IDEMPOTENCY (the double-mint guard): if the deterministic mint account already exists, the
      // atomic mint below already landed (a crash-after-broadcast resume, or a duplicate call). Never
      // re-mint. Because the mint is ONE atomic tx, an existing account ⟺ a fully-completed 1-of-1.
      const existing = await connection.getAccountInfo(mint);
      if (existing) {
        if (!existing.owner.equals(TOKEN_PROGRAM_ID)) {
          throw new Error(
            `solana title mint ${mint.toBase58()} exists but is not owned by the token program — refusing to proceed`,
          );
        }
        log.info(
          { mint: mint.toBase58(), packId: binding.packId, network },
          'solana title already minted (deterministic address exists on-chain) — idempotent no-op',
        );
        return { mintAddress: mint.toBase58(), txSig: null, alreadyMinted: true };
      }

      // ATOMIC mint — ONE transaction, all-or-nothing, so there is no partial state to resume from:
      //   1) create the mint account (rent-exempt), owned by the token program
      //   2) initialize it: decimals 0, mint authority = the dedicated minter, no freeze authority
      //   3) create the recipient's ATA (rent paid by the minter)
      //   4) mint exactly ONE unit to the user
      //   5) REVOKE mint authority → supply is permanently 1 (a true 1-of-1; nothing more can be minted)
      const rentExempt = await getMinimumBalanceForRentExemptMint(connection);
      const ata = getAssociatedTokenAddressSync(mint, owner);

      // Token Metadata so the title shows as a NAMED NFT in wallets/explorers (name + symbol + uri). It
      // MUST be created while the mint authority is still the minter — i.e. BEFORE the revoke below — so
      // it rides inside the same atomic tx. isMutable:false: the binding is permanent once minted.
      const [metadataPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
        TOKEN_METADATA_PROGRAM_ID,
      );
      const name = (binding.name ?? 'Clude Pack Title').slice(0, 32);
      const base = (metadataBaseUri ?? 'https://clude.io/api/pack-title').replace(/\/+$/, '');
      const uri = `${base}/${binding.packId}.json`.slice(0, 200);
      const metadataIx = createCreateMetadataAccountV3Instruction(
        { metadata: metadataPda, mint, mintAuthority: minter.publicKey, payer: minter.publicKey, updateAuthority: minter.publicKey },
        {
          createMetadataAccountArgsV3: {
            data: { name, symbol: 'CLUDE', uri, sellerFeeBasisPoints: 0, creators: null, collection: null, uses: null },
            isMutable: false,
            collectionDetails: null,
          },
        },
      );

      const tx = new Transaction().add(
        SystemProgram.createAccount({
          fromPubkey: minter.publicKey,
          newAccountPubkey: mint,
          space: MINT_SIZE,
          lamports: rentExempt,
          programId: TOKEN_PROGRAM_ID,
        }),
        createInitializeMint2Instruction(mint, 0, minter.publicKey, null),
        createAssociatedTokenAccountInstruction(minter.publicKey, ata, owner, mint),
        createMintToInstruction(mint, ata, minter.publicKey, 1),
        metadataIx, // named-NFT metadata — created BEFORE the authority revoke
        createSetAuthorityInstruction(mint, minter.publicKey, AuthorityType.MintTokens, null),
      );

      // Signers: the minter (payer + mint authority + ATA-rent payer) and the mint keypair (it must
      // sign createAccount for its own address). One confirmed round-trip — far fewer RPC calls than
      // the prior multi-helper path (which matters under the public devnet RPC's per-method throttle).
      const txSig = await sendAndConfirmTransaction(connection, tx, [minter, mintKp]);

      log.info(
        { mint: mint.toBase58(), to: toWallet.slice(0, 8), packId: binding.packId, network },
        'solana title minted (atomic 1-of-1, authority revoked) to the user wallet',
      );
      return { mintAddress: mint.toBase58(), txSig, alreadyMinted: false };
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

/**
 * Ownership gate: true iff `walletAddress` currently holds the 1-of-1 title `mintAddress`. This is the
 * AUTHORITATIVE ownership check (the on-chain holder of the single unit) — the Solana-native replacement
 * for the buggy `holdsPackToken` balance>=1 gate (pack-gate.ts:111). A 1-of-1 has exactly one holder, so
 * there is nothing to double-spend. Returns false if the title is unheld/burned or held by someone else.
 */
export async function assertTitleOwner(
  client: SolanaTitleMintClient,
  mintAddress: string,
  walletAddress: string,
): Promise<boolean> {
  const owner = await client.titleOwner(mintAddress);
  return owner !== null && owner === walletAddress;
}

let _titleClient: SolanaTitleMintClient | null = null;

/**
 * Build the production client from env (dedicated minter + deterministic seed + gated network), CACHED
 * as a module singleton. The unlock hot path calls this per request; constructing fresh each time would
 * re-decode the minter key + re-allocate a Connection. Only a SUCCESSFUL build is cached — it keeps
 * THROWING (uncached) until SOLANA_TITLE_* env is present, so a deploy that sets the env after boot
 * still succeeds on the next call. Mirrors getDefaultPackOwnershipVerifier (pack-gate.ts).
 */
export function getSolanaTitleMintClient(): SolanaTitleMintClient {
  if (_titleClient) return _titleClient;
  const env = resolveSolanaTitleEnv();
  const minter = loadTitleMinter();
  const mintSeed = loadTitleMintSeed();
  const connection = new Connection(env.rpcUrl, 'confirmed');
  _titleClient = createSolanaTitleMintClient({
    connection,
    minter,
    network: env.network,
    mintSeed,
    metadataBaseUri: process.env.SOLANA_TITLE_METADATA_BASE_URI,
  });
  return _titleClient;
}

/** Test hook — clear the cached title client. */
export function _resetSolanaTitleMintClient(): void {
  _titleClient = null;
}
