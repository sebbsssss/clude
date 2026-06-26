/**
 * entitlement-gate — the COPY-license unlock authority.
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 2), Task 2
 * (spec §00 B2 · §1.2 Flow A step 10 · §3 "/unlock gate sees active entitlement" · Risk R3).
 *
 * MONEY/ACCESS CODE. The §00 B2 binding correction is the entire reason this module exists:
 *
 *   "Copy unlock MUST read pack_entitlements and never touch the chain. Two distinct paths;
 *    the balance path is deleted." … "For copy packs, the gate must read pack_entitlements and
 *    must not touch the chain at all. These are two distinct code paths; do not unify them
 *    through holdsPackToken."
 *
 * A fiat (Stripe) buyer holds NO on-chain token (Risk R3) — the only authority for their
 * access is the off-chain `pack_entitlements` row `grantCopy` wrote on delivery
 * (grant_kind='copy_license', status='active'). This module reads exactly that row and
 * nothing else. It imports no Solana client by design: a copy unlock that reached for the
 * chain would be the title double-spend bug.
 *
 * Fail-closed everywhere: no row, the wrong holder/pack, a 'title_owner' grant, a non-active
 * status (the §00 M10 refund/chargeback clawback flips 'active' → 'refunded'), or a DB error
 * all resolve to `false`. We never throw an unlock open and never default-allow.
 *
 * Owner-scoping: the query is filtered on `holder_wallet` (single-owner scoping) — it can only
 * ever observe the caller's own grant, never another tenant's.
 */

import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('entitlement-gate');

/**
 * True iff `holderWallet` holds an ACTIVE `copy_license` entitlement for `packId`.
 *
 * This is the SOLE gate for copy-license unlock (§00 B2). It NEVER consults the chain or a
 * token balance — a paid copy is authorised purely by the `pack_entitlements` row delivery
 * wrote. Fail-closed: any miss, status≠'active', grant_kind≠'copy_license', or DB error → false.
 *
 * @param packId        the pack being unlocked (server-trusted, from the URL).
 * @param holderWallet  the wallet claiming access (already proven to control it via the
 *                       unlock signature upstream — this function does NOT verify the signature).
 */
export async function hasActiveCopyEntitlement(
  packId: string,
  holderWallet: string,
): Promise<boolean> {
  if (!packId || !holderWallet) return false;

  const db = getDb();
  const { data, error } = await db
    .from('pack_entitlements')
    .select('id')
    .eq('pack_id', packId)
    .eq('holder_wallet', holderWallet)
    .eq('grant_kind', 'copy_license')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  if (error) {
    // Fail closed — a read error must DENY, never accidentally grant access.
    log.error(
      { err: error, packId, holder: holderWallet.slice(0, 8) },
      'hasActiveCopyEntitlement: entitlement read failed — denying (fail-closed)',
    );
    return false;
  }

  return data != null;
}
