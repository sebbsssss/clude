/**
 * LightMintClient — v0.2 MintClient backed by Light Protocol ZK Compression.
 *
 * STATUS: structural scaffold. Implements the interface and lays out the
 * Light Protocol integration step-by-step; the actual SDK calls are marked
 * with TODO blocks so a follow-up commit (once Helius Photon creds are
 * wired) can complete it without rearchitecting.
 *
 * Why a scaffold vs full implementation now:
 *   1. End-to-end verification needs an active Photon RPC + funded keypair;
 *      cannot be tested from a stateless session.
 *   2. Installing @lightprotocol/stateless.js + @lightprotocol/compressed-token
 *      pulls heavy transitive deps; better to land alongside the engineer
 *      running it for the first time.
 *   3. PdaMintClient covers v0.1 launch; LightMintClient swaps in via env flag
 *      when ready (MINT_CLIENT=light). The protocol layer (routes, tokenize*,
 *      verify) does NOT change.
 *
 * To complete this file, an engineer with Helius creds runs:
 *
 *   pnpm --filter @clude/server add @lightprotocol/stateless.js \
 *     @lightprotocol/compressed-token
 *
 * then fills in the TODO blocks below. Each block is < 20 lines of SDK calls.
 *
 * Reference architecture:
 *   - One shared compressed mint per provider (the "PMP memory mint"),
 *     initialised once via initialiseSharedMint().
 *   - Each memory = one compressed token, minted to a deterministic recipient
 *     derived from the memory's hash_id. The recipient PDA carries the
 *     content_hash in a small data field.
 *   - Reads use Photon's getCompressedAccount RPC keyed by the recipient PDA.
 *
 * This keeps cost at ~$0.0001/mint while preserving 1-to-1 memory ↔ asset
 * identity for the protocol layer.
 */

import type {
  ChainId,
  MintClient,
  CommitMemoryInput,
  CommitPackInput,
  MemoryCommitment,
  PackCommitment,
} from '@clude/tokenization';
import { writeMemo } from '@clude/shared/core/solana-client';
import { MEMO_MAX_LENGTH } from '@clude/shared/utils/constants';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('light-mint-client');

export interface LightMintClientConfig {
  /** Helius RPC (mainnet or devnet) — `https://mainnet.helius-rpc.com/?api-key=...` */
  rpcEndpoint: string;
  /**
   * Photon endpoint (Light Protocol's compressed-state RPC). Often the same
   * Helius URL works; sometimes a dedicated Photon URL is needed.
   */
  photonEndpoint: string;
  /**
   * Base58-encoded keypair (or `[u8; 64]` JSON array string) of the wallet that
   * pays for mints + signs Light Protocol transactions.
   */
  payerSecretKey: string;
  /**
   * Address of the shared compressed mint. If null/undefined, the client will
   * lazily initialise one on first use via initialiseSharedMint().
   */
  sharedMintAddress?: string;
}

export class LightMintClient implements MintClient {
  readonly chain: ChainId = 'solana';
  private sharedMintAddress: string | null;

  constructor(private readonly cfg: LightMintClientConfig) {
    this.sharedMintAddress = cfg.sharedMintAddress ?? null;
    log.info(
      {
        rpc: cfg.rpcEndpoint.split('?')[0],
        photon: cfg.photonEndpoint.split('?')[0],
        sharedMint: cfg.sharedMintAddress ?? '<lazy>',
      },
      'LightMintClient configured (scaffold)',
    );
  }

  /**
   * One-time setup: create the shared compressed mint that all memories of
   * this provider get minted into. Should be run once per provider during
   * bootstrap and the resulting address recorded in config.
   *
   * TODO(light-1):
   *   1. Construct a Rpc using createRpc(rpcEndpoint, photonEndpoint).
   *   2. Generate or load the mint keypair.
   *   3. Call CompressedTokenProgram.createMint with the payer + mint authority.
   *   4. Confirm the transaction.
   *   5. Persist the mint address (return it; caller writes to cnft_trees).
   */
  async initialiseSharedMint(): Promise<string> {
    throw new Error(
      'LightMintClient.initialiseSharedMint: not yet implemented — see TODO(light-1)',
    );
  }

  /**
   * Commit a memory's content hash by minting one compressed token to a
   * deterministic recipient PDA derived from the memory's hash_id. The
   * compressed account's data field carries the content_hash.
   *
   * TODO(light-2):
   *   1. Ensure sharedMintAddress is initialised (or call initialiseSharedMint).
   *   2. Derive the recipient address from input.memoryHashId (deterministic).
   *   3. Encode the data blob: { content_hash_bytes, memory_hash_id_bytes }.
   *   4. Call CompressedTokenProgram.mintTo with:
   *        - mint = sharedMintAddress
   *        - destination = recipient PDA
   *        - amount = 1n
   *        - data = the encoded blob
   *   5. sendAndConfirm via the payer.
   *   6. Return { chain: 'solana', assetId: recipientPDA, txSig, treeAddress, leafIndex }.
   *      `treeAddress` is the Light Protocol state tree the account landed in;
   *      `leafIndex` is its index within that tree (Photon RPC returns both
   *      via getCompressedAccount).
   */
  async commitMemoryHash(input: CommitMemoryInput): Promise<MemoryCommitment> {
    log.warn(
      { contentHash: input.contentHash.slice(0, 16), hashId: input.memoryHashId },
      'LightMintClient.commitMemoryHash: scaffold called — falling through to memo write',
    );
    // Fallback path: write the hash + memory_id via the SPL Memo program so
    // calls during the scaffold phase still produce a verifiable on-chain
    // receipt. This is slower and lacks the per-memory NFT semantics, but it
    // is not silently broken.
    const memo = `clude-mem | v2 | ${input.contentHash}`;
    if (memo.length > MEMO_MAX_LENGTH) {
      throw new Error('LightMintClient fallback: memo exceeds MEMO_MAX_LENGTH');
    }
    const txSig = await writeMemo(memo);
    if (!txSig) {
      throw new Error('LightMintClient fallback: writeMemo returned null');
    }
    return {
      chain: 'solana',
      assetId: `memo:${txSig}`,
      txSig,
      treeAddress: null,
      leafIndex: null,
    };
  }

  /**
   * Pack tokenisation via Light Protocol's compressed NFT primitives is a
   * v0.2 concern. v0.1 ships Pack root commitments via the memo program;
   * see PdaMintClient.commitPackRoot.
   *
   * TODO(light-3): when v0.2 pack-token marketplace lands, mint a transferable
   * cNFT (Bubblegum-compatible or Light Protocol compressed token with
   * `frozen=false`) whose metadata URI points to the Pack manifest +
   * Merkle root.
   */
  async commitPackRoot(_input: CommitPackInput): Promise<PackCommitment> {
    throw new Error(
      'LightMintClient.commitPackRoot: deferred to v0.2 — use PdaMintClient for now',
    );
  }

  /**
   * Look up a memory commitment by its content hash via Photon's
   * getCompressedAccountsByOwner or a custom indexer keyed off content_hash.
   *
   * TODO(light-4):
   *   1. Query Photon for compressed accounts owned by the shared mint whose
   *      data field starts with `input.contentHash`.
   *   2. Return the first matching account's { txSig, leafIndex, treeAddress }.
   *
   * Fallback (for scaffold and resilience): if Photon lookup fails or returns
   * empty, fall through to the DB by content_hash. This matches the PdaMintClient
   * behaviour and keeps verify endpoints fast.
   */
  async fetchMemoryCommitment(contentHash: string): Promise<MemoryCommitment | null> {
    log.debug({ contentHash: contentHash.slice(0, 16) }, 'LightMintClient.fetchMemoryCommitment: scaffold — DB lookup not yet wired');
    return null;
  }

  /**
   * Pack commitments via Light Protocol are v0.2 work. For now, callers should
   * use PdaMintClient.fetchPackCommitment which queries memory_packs in Supabase.
   */
  async fetchPackCommitment(_merkleRoot: string): Promise<PackCommitment | null> {
    return null;
  }
}

/**
 * Resolve which MintClient implementation to use based on env.
 *
 *   MINT_CLIENT=pda     (default, v0.1)
 *   MINT_CLIENT=light   (v0.2, requires HELIUS_RPC_URL + HELIUS_PHOTON_URL + BOT_WALLET_PRIVATE_KEY)
 *
 * Importing this helper means callers don't need to know which implementation
 * is active; they just request a MintClient and get one.
 */
export function shouldUseLightProtocol(): boolean {
  return (process.env.MINT_CLIENT ?? 'pda').toLowerCase() === 'light';
}

export function buildLightConfigFromEnv(): LightMintClientConfig | null {
  const rpcEndpoint = process.env.HELIUS_RPC_URL ?? process.env.SOLANA_RPC_URL;
  const photonEndpoint = process.env.HELIUS_PHOTON_URL ?? rpcEndpoint;
  const payerSecretKey = process.env.BOT_WALLET_PRIVATE_KEY;

  if (!rpcEndpoint || !photonEndpoint || !payerSecretKey) {
    return null;
  }
  return {
    rpcEndpoint,
    photonEndpoint,
    payerSecretKey,
    sharedMintAddress: process.env.PMP_SHARED_MINT ?? undefined,
  };
}
