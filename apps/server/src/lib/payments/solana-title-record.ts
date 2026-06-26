/**
 * solana-title-record — mint a Solana pack title and record it in the off-chain mirror.
 *
 * The Solana-native analog of Base's mintTitleForPack (title-saga.ts). The hard part — making the mint
 * idempotent + double-mint-proof — already lives in the mint client (deterministic address + atomic tx
 * + getAccountInfo guard, solana-title-mint.ts, devnet-verified). So this is a THIN, idempotent
 * orchestration over three steps:
 *
 *   1. loadBinding         — read the pack's content commitment from pmp_artifacts (refuse to bind a
 *                            phantom commitment on-chain).
 *   2. sol.mintTitle       — mint the 1-of-1 to the user's OWN Solana wallet (non-custodial). No
 *                            snapshot, no custodial derivation: unlike Base, the user holds the title
 *                            directly, so there is no Base-address indirection here.
 *   3. record              — upsert the pack_titles mirror (chain-polymorphic via migration 037:
 *                            chain='solana-devnet'|'solana', mint_address, current_owner='the user',
 *                            status='minted') + grant the creator the title_owner entitlement (the
 *                            app-wallet-keyed access cache; the on-chain holder stays the authority).
 *
 * Idempotent under retry AND concurrency: the mint is a no-op once the deterministic title exists
 * (alreadyMinted), the mirror upsert collapses a retry, the mirror INSERT swallows a concurrent PK
 * collision (23505), and the entitlement grant skips an existing active row. Re-exporting the same pack
 * never double-mints and never double-grants.
 *
 * CALLER CONTRACTS the export route / sale path MUST honor (Phase 2 — deliberately NOT enforced here):
 *   - SNAPSHOT ISOLATION: this binds the pack id it is GIVEN. For an encrypted or ever-sellable pack the
 *     caller MUST pass a FROZEN-SNAPSHOT pack id (the Base analog snapshots first — mint-title-on-export.ts
 *     → snapshotPackForTitle), or a later title sale transfers/exposes the creator's LIVE memories. Binding
 *     a live pack id is only safe for a plaintext pack the creator will never sell.
 *   - DEK RE-KEY: minting grants on-chain ownership + the app-wallet entitlement cache only; it writes NO
 *     memory_dek_wraps. An ENCRYPTED pack must NOT be given a Solana title until the export route seals the
 *     DEK to the holder's own Solana wallet, or the holder owns a title they cannot decrypt.
 *   - RECONCILER: there is no Solana backstop yet (reconcile-title-mints.ts is Base-only). A crash AFTER
 *     the on-chain mint but BEFORE the mirror write heals only when the user re-exports; a Solana arm to the
 *     reconciliation poller is required before relying on durable auto-heal.
 *
 * MONEY / IRREVERSIBLE-ASSET CODE. `sol` is injected (getSolanaTitleMintClient) so this is unit-tested
 * with a mocked db + client — no live chain.
 */

import { createChildLogger } from '@clude/shared/core/logger';
import type { SolanaTitleMintClient, TitleBinding } from '../solana-title-mint.js';

const log = createChildLogger('solana-title-record');

/** A minimal Supabase-shaped handle (same structural type the Base title helpers use). */
export interface DbLike {
  from(table: string): any;
}

export interface MintSolanaTitleResult {
  /** The SPL mint address — the title's on-chain id (recorded in pack_titles.mint_address). */
  mintAddress: string;
  /** The mint tx signature, or null when the title already existed (idempotent no-op). */
  txSig: string | null;
  /** True when the deterministic title already existed and the mint was a no-op. */
  alreadyMinted: boolean;
  /** The chain string written to the mirror ('solana-devnet' on devnet, 'solana' on mainnet). */
  chain: 'solana-devnet' | 'solana';
}

interface PmpArtifactRow {
  merkle_root: string | null;
  manifest_hash: string | null;
  record_count: number;
}

/**
 * Mint a Solana 1-of-1 title for `packId` to the user's own wallet and mirror it. Returns the binding +
 * tx. Idempotent. Throws if the pack has no pmp_artifacts commitment (we refuse to bind a phantom).
 *
 * @param db        Supabase client (injected by the caller / export route).
 * @param sol       the SolanaTitleMintClient (getSolanaTitleMintClient()).
 * @param packId    the pack to mint a title for (must be tokenised — have a merkle_root).
 * @param toWallet  the user's OWN Solana wallet (req.verifiedWallet) — the non-custodial title holder.
 */
export async function mintSolanaTitleForPack(
  db: DbLike,
  sol: SolanaTitleMintClient,
  packId: string,
  toWallet: string,
): Promise<MintSolanaTitleResult> {
  const chain: 'solana-devnet' | 'solana' = sol.network === 'devnet' ? 'solana-devnet' : 'solana';

  // 1) Bind to the pack's content commitment (refuse if it's missing).
  const binding = await loadBinding(db, packId);

  // 2) Mint the 1-of-1 to the user (idempotent + double-mint-proof inside the client).
  const mint = await sol.mintTitle(toWallet, binding);

  // 3) Mirror into pack_titles + grant the creator title_owner. Both idempotent.
  await upsertSolanaTitleMirror(db, {
    packId,
    mintAddress: mint.mintAddress,
    owner: toWallet,
    creatorWallet: toWallet,
    mintTx: mint.txSig,
    chain,
  });
  await grantTitleOwner(db, packId, toWallet);

  log.info(
    { packId, mintAddress: mint.mintAddress, chain, alreadyMinted: mint.alreadyMinted },
    'mintSolanaTitleForPack: solana title minted + mirrored to the user wallet',
  );
  return { mintAddress: mint.mintAddress, txSig: mint.txSig, alreadyMinted: mint.alreadyMinted, chain };
}

/** Load + validate the on-chain binding inputs for a pack from pmp_artifacts. */
async function loadBinding(db: DbLike, packId: string): Promise<TitleBinding> {
  const { data: art, error } = await db
    .from('pmp_artifacts')
    .select('merkle_root, manifest_hash, record_count')
    .eq('pack_id', packId)
    .maybeSingle();
  if (error) {
    log.error({ err: error, packId }, 'mintSolanaTitleForPack: artifact lookup failed');
    throw new Error('mintSolanaTitleForPack: failed to load pack binding');
  }
  const a = art as PmpArtifactRow | null;
  if (!a || !a.merkle_root || !a.manifest_hash) {
    throw new Error(
      `mintSolanaTitleForPack: pack ${packId} has no pmp_artifacts binding (merkle_root/manifest_hash) — cannot mint a title`,
    );
  }
  return { packId, merkleRoot: a.merkle_root, manifestHash: a.manifest_hash, memoryCount: a.record_count };
}

/**
 * Upsert the pack_titles mirror to a minted Solana title owned by `owner`. Solana rows leave the
 * Base-only token_id + contract_address NULL (037 made them nullable); mint_address carries the on-chain
 * id. creator_wallet (NOT NULL) is set on INSERT and preserved on UPDATE (the original minter is never
 * overwritten by a later owner on a reconcile).
 */
async function upsertSolanaTitleMirror(
  db: DbLike,
  args: {
    packId: string;
    mintAddress: string;
    owner: string;
    creatorWallet: string;
    mintTx: string | null;
    chain: 'solana-devnet' | 'solana';
  },
): Promise<void> {
  const { data: existing } = await db
    .from('pack_titles')
    .select('pack_id')
    .eq('pack_id', args.packId)
    .maybeSingle();

  const common = {
    mint_address: args.mintAddress,
    chain: args.chain,
    current_owner: args.owner,
    status: 'minted',
    mint_tx: args.mintTx,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await db.from('pack_titles').update(common).eq('pack_id', args.packId);
    if (error) throw new Error('mintSolanaTitleForPack: failed to update title mirror');
  } else {
    const { error } = await db.from('pack_titles').insert({
      pack_id: args.packId,
      creator_wallet: args.creatorWallet,
      ...common,
      created_at: new Date().toISOString(),
    });
    // A concurrent (re-)export may have inserted the row first: pack_id is the PRIMARY KEY, so the
    // collision (23505) is the idempotent no-op — that row is for the SAME pack, mint, and owner (the
    // deterministic mint + the single authenticated caller guarantee it), so there is nothing to fix.
    // Mirrors the entitlement grant below; without it a legitimate double-submit throws a false failure.
    if (error && (error as { code?: string }).code !== '23505') {
      throw new Error('mintSolanaTitleForPack: failed to insert title mirror');
    }
  }
}

/**
 * Grant (or re-activate) the creator's `title_owner` entitlement for the pack. Idempotent: an active
 * grant is left as-is; a lingering revoked row is re-activated; a UNIQUE race is benign. App-wallet
 * keyed (the dashboard reads this), with the Solana payment rail since the creator minted, not bought.
 */
async function grantTitleOwner(db: DbLike, packId: string, holderApp: string): Promise<void> {
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
      if (error) throw new Error('mintSolanaTitleForPack: failed to re-activate creator title_owner entitlement');
    }
    return;
  }

  const { error } = await db.from('pack_entitlements').insert({
    pack_id: packId,
    holder_wallet: holderApp,
    grant_kind: 'title_owner',
    order_id: null, // minted by the creator, not bought — no order
    payment_rail: 'clude_solana',
    status: 'active',
    granted_at: new Date().toISOString(),
  });
  if (error && (error as { code?: string }).code !== '23505') {
    throw new Error('mintSolanaTitleForPack: failed to grant creator title_owner entitlement');
  }
}
