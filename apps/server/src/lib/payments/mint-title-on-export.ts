/**
 * mint-title-on-export — make a pack EXIST ON BASE at export time (not at list time).
 *
 * Founder model (2026-06-23): exporting a title-intended pack is the moment it becomes an on-chain
 * asset. The three anchors line up at export: the memories' content hashes are already on SOLANA
 * (written at store time), the `.pmp` file is produced by the export, and HERE we mint the 1-of-1
 * BASE title that binds the same Merkle commitment. Listing the pack for sale is a SEPARATE, later
 * action on an already-minted title — pricing never enters this path.
 *
 * This is a thin, idempotent ORCHESTRATION over two already-built + tested primitives:
 *   1. snapshotPackForTitle — freeze a sole-key SNAPSHOT (clone + re-key the DEK to the creator's
 *      custodial Base title_holder) so the creator's LIVE memories are never touched by a later sale.
 *   2. mintTitleForPack     — mint the Base title bound to the snapshot's pmp_artifacts commitment.
 * Then it records the creator as the title_owner (the app-wallet-keyed access cache the dashboard
 * reads; ownerOf on-chain remains the decryption authority).
 *
 * Idempotent end to end: snapshot is deterministic + reused, the mint is a no-op once the title
 * exists (mirror or on-chain), and the entitlement upsert collapses a retry. Safe to call on every
 * (re-)export of the same pack — re-exporting never double-mints.
 *
 * MONEY / IRREVERSIBLE-ASSET CODE. `evm` is the MINTER client (getMinterEvmTitleClient); on Base
 * mainnet that client itself is SEC-1-gated. The caller (the export route) injects db/evm/resolver,
 * so this is unit-testable with no live chain.
 */

import { createChildLogger } from '@clude/shared/core/logger';
import type { EvmTitleClient } from '../evm-title-client.js';
import type { BaseIdentityResolver } from './base-identity.js';
import { snapshotPackForTitle } from './snapshot-pack-for-title.js';
import { mintTitleForPack } from './title-saga.js';

const log = createChildLogger('mint-title-on-export');

/** A minimal Supabase-shaped handle (same structural type the saga + snapshot use). */
export interface DbLike {
  from(table: string): any;
}

export interface ExportTitleResult {
  /** The frozen snapshot pack the title is bound to (NOT the live source pack). */
  snapshotPackId: string;
  /** The on-chain token id (decimal string). */
  tokenId: string;
  /** The mint tx hash, or null when the title already existed (idempotent re-export). */
  mintTx: string | null;
  /** True when the title already existed and this call minted nothing. */
  alreadyMinted: boolean;
  /** The creator's custodial Base address — the title owner + DEK recipient. */
  creatorBase: string;
}

/**
 * Mint a Base title for `sourcePackId` at export time. Returns the title binding + tx. Idempotent.
 *
 * @param db                Supabase client (injected by the export route).
 * @param evm               the MINTER EvmTitleClient (getMinterEvmTitleClient()).
 * @param resolver          the custodial Base-identity resolver (getBaseIdentityResolver()).
 * @param args.sourcePackId      the pack being exported (must be tokenised — have a merkle_root).
 * @param args.creatorAppWallet  the exporting creator's Solana app wallet (req.verifiedWallet).
 */
export async function mintTitleOnExport(
  db: DbLike,
  evm: EvmTitleClient,
  resolver: BaseIdentityResolver,
  args: { sourcePackId: string; creatorAppWallet: string },
): Promise<ExportTitleResult> {
  const { sourcePackId, creatorAppWallet } = args;

  // 1) Freeze the sole-key snapshot (clone + re-key to the creator's Base title identity). Idempotent.
  const snap = await snapshotPackForTitle(db, resolver, sourcePackId, creatorAppWallet);

  // 2) Mint the 1-of-1 Base title bound to the snapshot's commitment. No-op if it already exists.
  const mint = await mintTitleForPack(db, evm, snap.snapshotPackId, snap.creatorBase);

  // 3) Record the creator as title_owner (app-wallet-keyed access cache). ownerOf stays the authority.
  await grantCreatorTitleOwner(db, snap.snapshotPackId, creatorAppWallet);

  log.info(
    {
      sourcePackId,
      snapshotPackId: snap.snapshotPackId,
      tokenId: mint.tokenId.toString(),
      alreadyMinted: mint.alreadyMinted,
      creatorBase: snap.creatorBase.slice(0, 10),
    },
    'mintTitleOnExport: pack now exists on Base (title minted at export)',
  );

  return {
    snapshotPackId: snap.snapshotPackId,
    tokenId: mint.tokenId.toString(),
    mintTx: mint.mintTx,
    alreadyMinted: mint.alreadyMinted,
    creatorBase: snap.creatorBase,
  };
}

/**
 * Grant (or re-activate) the creator's `title_owner` entitlement for the snapshot pack. Idempotent:
 * an active grant is left as-is; a lingering revoked/refunded row (a prior owner who sold then
 * re-minted — not expected at first export, but handled) is re-activated; a UNIQUE race is benign.
 */
async function grantCreatorTitleOwner(db: DbLike, packId: string, holderApp: string): Promise<void> {
  const { data: existing } = await db
    .from('pack_entitlements')
    .select('id, status')
    .eq('pack_id', packId)
    .eq('holder_wallet', holderApp)
    .eq('grant_kind', 'title_owner')
    .maybeSingle();

  if (existing) {
    if ((existing as { status: string }).status !== 'active') {
      const { error } = await db
        .from('pack_entitlements')
        .update({ status: 'active', revoked_at: null })
        .eq('pack_id', packId)
        .eq('holder_wallet', holderApp)
        .eq('grant_kind', 'title_owner');
      if (error) throw new Error('mintTitleOnExport: failed to re-activate creator title_owner entitlement');
    }
    return;
  }

  const { error } = await db.from('pack_entitlements').insert({
    pack_id: packId,
    holder_wallet: holderApp,
    grant_kind: 'title_owner',
    order_id: null, // minted by the creator, not bought — no order
    payment_rail: 'clude_base',
    status: 'active',
    granted_at: new Date().toISOString(),
  });
  if (error && (error as { code?: string }).code !== '23505') {
    throw new Error('mintTitleOnExport: failed to grant creator title_owner entitlement');
  }
}
