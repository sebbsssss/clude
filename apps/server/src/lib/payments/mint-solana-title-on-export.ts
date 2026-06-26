/**
 * mint-solana-title-on-export — make a pack EXIST as a Solana title at EXPORT (the non-custodial path).
 *
 * The Solana-native analog of mint-title-on-export.ts (Base). At export, a title-intended pack becomes an
 * on-chain asset: the memories' content hashes are already on Solana (store time), the `.pmp` is produced
 * by the export, and HERE we freeze a non-custodial SNAPSHOT and mint the 1-of-1 Solana title bound to
 * the same Merkle commitment — to the user's OWN wallet. Listing for sale is a SEPARATE later action.
 *
 * A thin, idempotent ORCHESTRATION over two devnet/unit-verified primitives:
 *   1. snapshotPackForTitleSolana — freeze a recall-isolated snapshot, sealing the DEK to the creator's
 *      OWN Solana key (so the creator's LIVE memories are never touched by a later sale).
 *   2. mintSolanaTitleForPack     — mint the 1-of-1 Solana title bound to the snapshot's commitment, to
 *      the user's wallet, and record the pack_titles mirror + the title_owner entitlement.
 *
 * Idempotent end to end: the snapshot is deterministic + reused, the mint is a no-op once the
 * deterministic title exists, and the mirror/entitlement upserts collapse a retry. Safe to call on every
 * (re-)export — re-exporting never double-mints. MONEY / IRREVERSIBLE-ASSET CODE; db + sol are injected
 * so this is unit-tested with mocks, no live chain.
 */

import { createChildLogger } from '@clude/shared/core/logger';
import type { SolanaTitleMintClient } from '../solana-title-mint.js';
import { snapshotPackForTitleSolana } from './snapshot-pack-for-title-solana.js';
import { mintSolanaTitleForPack } from './solana-title-record.js';

const log = createChildLogger('mint-solana-title-on-export');

export interface DbLike {
  from(table: string): any;
}

export interface ExportSolanaTitleResult {
  /** The frozen snapshot pack the title is bound to (NOT the live source pack). */
  snapshotPackId: string;
  /** The SPL mint address of the 1-of-1 title. */
  mintAddress: string;
  /** The mint tx signature, or null when the title already existed (idempotent re-export). */
  txSig: string | null;
  /** True when the title already existed and this call minted nothing. */
  alreadyMinted: boolean;
  /** 'solana-devnet' on devnet, 'solana' on mainnet. */
  chain: 'solana-devnet' | 'solana';
}

/**
 * Mint a Solana title for `sourcePackId` at export time, to the creator's OWN wallet. Returns the title
 * binding + tx. Idempotent.
 *
 * @param db                Supabase client (injected by the export route).
 * @param sol               the SolanaTitleMintClient (getSolanaTitleMintClient()).
 * @param args.sourcePackId      the pack being exported (must be tokenised — have a merkle_root).
 * @param args.creatorWallet     the exporting creator's Solana app wallet (req.verifiedWallet).
 */
export async function mintSolanaTitleOnExport(
  db: DbLike,
  sol: SolanaTitleMintClient,
  args: { sourcePackId: string; creatorWallet: string },
): Promise<ExportSolanaTitleResult> {
  const { sourcePackId, creatorWallet } = args;

  // 1) Freeze the non-custodial snapshot (clone + seal the DEK to the creator's own key). Idempotent.
  const snap = await snapshotPackForTitleSolana(db, sourcePackId, creatorWallet);

  // 2) Mint the 1-of-1 Solana title bound to the SNAPSHOT's commitment, to the creator's own wallet.
  //    No-op if it already exists (deterministic address + atomic mint guard inside the client).
  const mint = await mintSolanaTitleForPack(db, sol, snap.snapshotPackId, creatorWallet);

  log.info(
    { sourcePackId, snapshotPackId: snap.snapshotPackId, mintAddress: mint.mintAddress, alreadyMinted: mint.alreadyMinted, chain: mint.chain },
    'mintSolanaTitleOnExport: pack now exists as a Solana title (minted at export, non-custodial)',
  );

  return {
    snapshotPackId: snap.snapshotPackId,
    mintAddress: mint.mintAddress,
    txSig: mint.txSig,
    alreadyMinted: mint.alreadyMinted,
    chain: mint.chain,
  };
}
