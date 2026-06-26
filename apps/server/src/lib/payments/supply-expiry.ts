/**
 * supply-expiry — return supply units held by abandoned, unpaid orders.
 *
 * MONEY/INVENTORY CODE. claimSupplyUnit (marketplace-payments.routes.ts) reserves a unit at ORDER
 * CREATION so a single/limited listing can never OVER-deliver. But an order that is never paid would
 * otherwise hold that unit forever (the only other release is refund-on-delivery), so a buyer could
 * grief a single/limited listing into permanent 'sold_out' by creating then abandoning orders — and
 * the seller couldn't even lower the cap to recover (the inflated supply_sold trips the edit guard).
 *
 * This sweep moves pre-paid orders past their `expires_at` to the terminal 'expired' state (a
 * sanctioned created/awaiting_payment → expired edge in the order DAG) and returns their claimed unit
 * to the listing. It is EXACTLY-ONCE: the unit is released only for the sweep that wins the CAS that
 * flips the order out of its observed pre-paid state, so a re-run, a concurrent payment, or two
 * overlapping sweeps can never double-free. releaseSupplyUnit itself is a no-op for unlimited listings
 * (supply_total IS NULL) and floors at 0, so an order whose listing was unlimited frees nothing.
 *
 * Driven from the marketplace delivery poller (same 15s cadence as the M6 delivery backstop).
 */

import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import { releaseSupplyUnit } from './refund-clawback.js';

const log = createChildLogger('supply-expiry');

/** Order states that precede payment and may therefore hold a claimed supply unit. */
const PRE_PAID_STATES = ['created', 'awaiting_payment'] as const;
/** Bound the per-tick work — abandoned orders are rare; a large backlog drains over several ticks. */
const EXPIRY_SWEEP_LIMIT = 100;

/**
 * Expire pre-paid orders past their `expires_at` and release each one's claimed supply unit.
 * Best-effort + crash-safe: a transient failure is logged and retried on the next tick. Returns the
 * count of orders expired this sweep (mainly for tests / observability).
 */
export async function expireStaleSupplyHolds(): Promise<{ expired: number }> {
  const db = getDb();
  const nowIso = new Date().toISOString();

  // Only orders that (a) are still pre-paid, (b) are past expiry, and (c) carry a listing (so they
  // could have claimed a unit). Unlimited-listing orders are included but release nothing (no-op).
  const { data, error } = await db
    .from('marketplace_orders')
    .select('order_id, listing_id, status')
    .in('status', PRE_PAID_STATES as unknown as string[])
    .lt('expires_at', nowIso)
    .not('listing_id', 'is', null)
    .limit(EXPIRY_SWEEP_LIMIT);
  if (error) {
    log.warn({ err: error }, 'expireStaleSupplyHolds: scan failed (will retry next tick)');
    return { expired: 0 };
  }

  const stale = (data ?? []) as Array<{ order_id: string; listing_id: string | null; status: string }>;
  let expired = 0;
  for (const o of stale) {
    // CAS: flip the order out of the EXACT pre-paid state we observed. Only the winner proceeds to
    // release, so the unit is freed exactly once even under concurrent sweeps / a racing payment.
    const { data: claimed, error: updErr } = await db
      .from('marketplace_orders')
      .update({ status: 'expired' })
      .eq('order_id', o.order_id)
      .eq('status', o.status)
      .select('order_id');
    if (updErr) {
      log.warn({ err: updErr, orderId: o.order_id }, 'expireStaleSupplyHolds: expire update failed (skipping)');
      continue;
    }
    if (Array.isArray(claimed) && claimed.length > 0) {
      await releaseSupplyUnit(o.listing_id, o.order_id); // no-op for unlimited listings
      expired++;
    }
  }

  if (expired > 0) {
    log.info({ expired }, 'expireStaleSupplyHolds: freed supply units from abandoned unpaid orders');
  }
  return { expired };
}
