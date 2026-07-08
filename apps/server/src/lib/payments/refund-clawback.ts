/**
 * clawbackCopy — COPY-license refund/dispute clawback (§00 M10).
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 2), Task 3
 * (spec line 26 · MINOR 10 line 682 · checklist line 696).
 *
 * MONEY/DATA CODE. This is the inverse of `grantCopy`: it is invoked when an order moves to
 * `refunding`/`refunded` (a Stripe refund or a chargeback/dispute). The §00 M10 correction is
 * the whole reason it exists, verbatim:
 *
 *   "A Stripe-dispute refund must DELETE the cloned `imported_from_pack` rows, else every copy
 *    sale is a free pack via chargeback."
 *
 * So the clawback does two things, both keyed off what `grantCopy` wrote:
 *
 *   1. REVOKE the entitlement — `pack_entitlements` for (pack_id, holder_wallet=buyer,
 *      grant_kind='copy_license') flips status → 'refunded' (with `revoked_at` stamped). After
 *      this the copy unlock gate (`hasActiveCopyEntitlement`) returns false — the buyer can no
 *      longer unlock. This is the access revocation R18 promised but, on its own, would be the
 *      "free pack via chargeback" hole M10 closes.
 *
 *   2. DELETE the cloned memories — every row `grantCopy` cloned into the BUYER's namespace
 *      (owner_wallet = buyer) tagged `imported_from_pack:<pack_id>` for THIS order. The clone
 *      metadata carries BOTH `imported_from_pack` and `source_order_id`, so we delete on the
 *      exact (pack, order) pair: a buyer who later re-bought the SAME pack on a different order
 *      keeps that legitimate copy; only the refunded order's bytes are clawed back.
 *
 * IDEMPOTENT. A dispute webhook can fire more than once and the order-status poller may retry.
 * Re-running clawbackCopy is a no-op: the UPDATE matches an already-'refunded' row (a harmless
 * re-write of the same terminal state) and the DELETE matches zero rows (the clones are already
 * gone). Neither errors nor over-deletes.
 *
 * Owner-scoping: every query is filtered on the buyer's `owner_wallet`/`holder_wallet`. The
 * clawback can only ever touch the refunded buyer's own rows — never another tenant who happens
 * to hold their own copy of the same pack, and never the creator's source memories (those live
 * in the author's namespace and carry no `imported_from_pack` provenance).
 */

import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import type { OrderRow } from './order-orchestrator.js';

const log = createChildLogger('refund-clawback');

/**
 * Unwind a delivered COPY-license order on refund/dispute. Safe to call repeatedly for the same
 * order (idempotent).
 *
 * Matches a `(order: OrderRow) => Promise<void>` clawback hook the order-status poller invokes
 * when an order enters `refunding`/`refunded`. Throws only on a genuine DB failure (so the
 * poller leaves the order recoverable and retries) — never silently half-claws-back, which would
 * leave the buyer either a free copy (delete failed) or a phantom entitlement (revoke failed).
 *
 * Sequencing: REVOKE the entitlement FIRST, then DELETE the clones. If the process dies between
 * the two steps, the buyer is already locked out (gate denies) and the next sweep finishes the
 * delete — the safe failure direction. The reverse order could briefly leave a buyer with no
 * bytes but a still-'active' entitlement, which is never preferable.
 */
export async function clawbackCopy(order: OrderRow): Promise<void> {
  const buyer = order.buyer_wallet;
  if (!buyer) {
    // No namespace to claw back from. A keyless (email-only) order never received a copy clone
    // (grantCopy refuses one), so there is nothing to revoke or delete — but surface loudly
    // rather than silently no-op, so a mis-routed clawback is visible.
    throw new Error(`clawbackCopy: order ${order.order_id} has no buyer_wallet — cannot scope a clawback`);
  }
  const packId = order.pack_id;
  const orderId = order.order_id;
  const db = getDb();

  // 1) REVOKE the entitlement. Scoped to the buyer's own copy_license grant for this pack. We do
  //    NOT pre-check status — flipping an already-'refunded' row back to 'refunded' is a harmless
  //    idempotent re-write, and a single conditional update is race-free. `.select()` lets us log
  //    how many rows actually moved (0 on a re-run / a never-delivered order).
  const nowIso = new Date().toISOString();
  const { data: revoked, error: revErr } = await db
    .from('pack_entitlements')
    .update({ status: 'refunded', revoked_at: nowIso })
    .eq('pack_id', packId)
    .eq('holder_wallet', buyer)
    .eq('grant_kind', 'copy_license')
    .select('id');
  if (revErr) {
    log.error({ err: revErr, orderId, packId }, 'clawbackCopy: entitlement revoke failed');
    throw new Error('clawbackCopy: failed to revoke entitlement');
  }
  const revokedCount = Array.isArray(revoked) ? revoked.length : 0;

  // 2) DELETE the cloned memories from the buyer's brain. Scoped to (owner_wallet=buyer) AND the
  //    exact (pack, order) provenance grantCopy stamped into metadata — so a different order's
  //    clones (e.g. a legitimate re-purchase of the same pack) are never collaterally deleted.
  //    `.contains('metadata', {...})` is JSONB `@>`: both keys must match. Idempotent: a re-run
  //    matches zero rows (already deleted) and is a clean no-op. For an ENCRYPTED clone, the
  //    buyer's per-memory DEK wrap in `memory_dek_wraps` is removed automatically —
  //    `memory_dek_wraps.memory_id REFERENCES memories(id) ON DELETE CASCADE` (migration 021) —
  //    so no separate wrap cleanup is needed and no orphan wrap survives the clawback.
  const { data: deleted, error: delErr } = await db
    .from('memories')
    .delete()
    .eq('owner_wallet', buyer)
    .contains('metadata', { imported_from_pack: packId, source_order_id: orderId })
    .select('id');
  if (delErr) {
    log.error({ err: delErr, orderId, packId }, 'clawbackCopy: cloned-memory delete failed');
    throw new Error('clawbackCopy: failed to delete cloned memories');
  }
  const deletedCount = Array.isArray(deleted) ? deleted.length : 0;

  // 3) FREE the supply unit this order claimed (the inverse of claimSupplyUnit's over-sell guard).
  //    Gate it on deletedCount > 0 so it fires EXACTLY ONCE across all (idempotent) clawback re-runs
  //    for this order: the run that actually deleted this order's clones is the run that releases its
  //    unit; a re-fired dispute / poller retry deletes zero rows and so never double-decrements (which
  //    would corrupt the counter / wrongly re-open a sold-out listing). Best-effort: a failure here
  //    must not block the (already-completed) revoke+delete, so we log and move on rather than throw.
  if (deletedCount > 0) {
    await releaseSupplyUnit(order.listing_id, orderId);
  }

  log.info(
    { orderId, packId, buyer: buyer.slice(0, 8), revokedCount, deletedCount },
    'clawbackCopy: copy clawed back (entitlement refunded + clones deleted)',
  );
}

/** Bounded CAS retries to release a unit (mirrors claimSupplyUnit's contention budget). */
const SUPPLY_RELEASE_MAX_ATTEMPTS = 5;

/**
 * Return one claimed unit to a finite-supply listing on refund: decrement `supply_sold` and, if the
 * listing had been flipped to 'sold_out' by the final claim, restore it to 'listed' so the freed unit
 * is buyable again. A no-op for unlimited listings (supply_total IS NULL → never claimed) and for an
 * order with no listing_id (keyless/legacy).
 *
 * Atomic via the same optimistic compare-and-swap claimSupplyUnit uses (PostgREST cannot decrement a
 * column in place without an RPC): read supply_sold = N → UPDATE … SET supply_sold = N-1 [, status =
 * 'listed' if it was 'sold_out'] WHERE listing_id = ? AND supply_sold = N. A concurrent claim/release
 * that moved the counter off N loses the CAS and retries against the fresh value, so the decrement can
 * never race-corrupt the count. Floored at 0 — a never-claimed listing is left untouched.
 */
export async function releaseSupplyUnit(listingId: string | null, orderId: string): Promise<void> {
  if (!listingId) return; // keyless / legacy order carries no listing to credit back
  const db = getDb();
  for (let attempt = 0; attempt < SUPPLY_RELEASE_MAX_ATTEMPTS; attempt++) {
    const { data: row, error: readErr } = await db
      .from('pack_listings')
      .select('supply_total, supply_sold, status')
      .eq('listing_id', listingId)
      .limit(1)
      .maybeSingle();
    if (readErr) {
      log.warn({ err: readErr, orderId, listingId }, 'releaseSupplyUnit: listing read failed (skipping)');
      return;
    }
    const listing = row as { supply_total: number | null; supply_sold: number; status: string } | null;
    if (!listing) return; // listing gone — nothing to credit back
    if (listing.supply_total === null) return; // unlimited listing was never claimed against
    const sold = typeof listing.supply_sold === 'number' ? listing.supply_sold : 0;
    if (sold <= 0) return; // nothing to release (already at floor)

    const next = sold - 1;
    const patch: Record<string, unknown> = { supply_sold: next };
    // Un-flip a sold-out listing: the freed unit makes it buyable again.
    if (listing.status === 'sold_out') patch.status = 'listed';

    const { data: updated, error: updErr } = await db
      .from('pack_listings')
      .update(patch)
      .eq('listing_id', listingId)
      .eq('supply_sold', sold) // CAS: only release against the value we just read
      .select('listing_id');
    if (updErr) {
      log.warn({ err: updErr, orderId, listingId }, 'releaseSupplyUnit: supply release update failed (skipping)');
      return;
    }
    if (Array.isArray(updated) && updated.length > 0) {
      log.info({ orderId, listingId, supplySold: next }, 'releaseSupplyUnit: freed one unit on refund');
      return;
    }
    // Lost the CAS (a concurrent claim/release moved supply_sold) — retry against the fresh value.
  }
  log.warn({ orderId, listingId }, 'releaseSupplyUnit: conceded after max CAS attempts (contention)');
}
