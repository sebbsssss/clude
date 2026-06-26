/**
 * Durable delivery dispatcher — the §00 M6 order→delivery state machine.
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 1), Task 3 (spec §00 M6).
 *
 * MONEY CODE. The headline correction of the whole spec (§00 M6): delivery is driven off
 * ORDER STATE + a poller/worker, NEVER an in-process event. A crash between the Stripe
 * webhook-ack and delivery must never lose a paid-for pack. This module is the two halves
 * of that guarantee — mirroring the proven topup.routes.ts idiom (intent + UNIQUE dedupe +
 * a poller fallback that reconciles off persisted state):
 *
 *   markOrderPaid(rail, railEvent)
 *     The webhook side. Called AFTER the rail signature is verified (StripeRail.verifyWebhook
 *     → parseEvent, Task 2). It:
 *       1. inserts a marketplace_payment_events row keyed on UNIQUE(rail, rail_event_id).
 *          A replayed webhook hits 23505 → we return a no-op. The webhook handler still
 *          answers 200 (the event is already recorded), so Stripe stops retrying. This is
 *          the at-most-once guarantee (Risk R6).
 *       2. conditionally advances the order to status='paid' — ONLY from a pre-paid state
 *          (created / awaiting_payment). A late or out-of-order event never drags a
 *          delivered/settled order backward. It writes the status and returns; it does NOT
 *          run delivery. Delivery is the worker's job and the worker reads ORDER STATE.
 *
 *   dispatchPendingDeliveries(deliver)
 *     The worker side (the poller). It:
 *       1. selects orders the delivery saga still owns — status IN ('paid','delivering').
 *          'paid' = freshly captured; 'delivering' = a sweep that was claimed but crashed
 *          before finishing (the recoverable state). Both are picked up.
 *       2. for each, CLAIMS it paid→delivering with a conditional update guarded by
 *          .eq('status','paid') (the supply-race idiom, Risk R8) so two sweeps can't both
 *          run delivery for the same order. (Already-'delivering' rows are resumed directly.)
 *       3. runs the INJECTED deliver(order) callback — the actual memory clone +
 *          entitlement grant is Part B chunk 2; here it's injected so the state machine is
 *          testable in isolation.
 *       4. on success, transitions delivering→delivered (sets delivered_at). On throw, the
 *          order is LEFT at 'delivering' (recoverable) — never 'delivered', never lost — and
 *          a later sweep re-runs deliver() to completion. One order failing never aborts the
 *          others in the sweep.
 *
 * Owner-scoping note: marketplace_orders is a two-party table (buyer + seller), a deliberate
 * documented departure from single-owner scoping (design §2). This worker is server-internal
 * (no per-caller request) and reconciles the table globally; nothing here is returned to a
 * client. The payment-events table is likewise never returned un-scoped.
 *
 * Concurrency assumption (chunk 1): a SINGLE sweeper instance runs the worker. The
 * paid→delivering claim already serialises the common fresh-order case across overlapping
 * sweeps; hardening the resume of 'delivering' rows against multiple concurrent workers
 * (a claim heartbeat / lease) is deferred — call out when horizontal-scaling the worker.
 */

import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import { assertTransition, type OrderStatus, type OrderRow } from './order-orchestrator.js';
import type { ParsedRailEvent } from './payment-rail.js';

const log = createChildLogger('delivery-dispatcher');

/** Rail identifier, matching marketplace_orders.rail / PaymentRail.name. */
export type Rail = 'stripe' | 'solana' | 'base';

/** Statuses a paid order may legally be advanced FROM into 'paid'. */
const PRE_PAID_STATES: readonly OrderStatus[] = ['created', 'awaiting_payment'];

/** Statuses the delivery saga still owns and the worker must (re)process. */
const DELIVERABLE_STATES: readonly OrderStatus[] = ['paid', 'delivering'];

/** How many paid/delivering orders one sweep drains at most (keeps a sweep bounded). */
const DEFAULT_SWEEP_LIMIT = 100;

/** Result of markOrderPaid — lets the webhook handler answer 200 in every branch. */
export interface MarkPaidResult {
  /** true → this call advanced the order to 'paid'. */
  applied: boolean;
  /** true → the rail event was a duplicate (UNIQUE(rail, rail_event_id)); no-op, return 200. */
  deduped: boolean;
  /** The order id the event resolved to. */
  orderId: string;
}

/**
 * The delivery callback the worker injects. Receives the CLAIMED order (already in
 * 'delivering'). It must perform the actual pack delivery (clone memories into the buyer's
 * namespace + insert pack_entitlements — Part B chunk 2) idempotently: the worker may call it
 * again for the same order after a crash, so a second call on an already-delivered order must
 * be a safe no-op. Throwing leaves the order recoverable for the next sweep.
 */
export type DeliverFn = (order: OrderRow) => Promise<void>;

/** Summary of one sweep, for logging + the route/cron caller. */
export interface DispatchSummary {
  /** Orders that reached 'delivered' this sweep. */
  delivered: number;
  /** Orders whose deliver() threw — left recoverable at 'delivering'. */
  failed: number;
  /** Orders examined (claimed or resumed) this sweep. */
  examined: number;
}

/**
 * Idempotently record a verified rail event and advance its order to 'paid'.
 *
 * MUST be called only with an ALREADY-VERIFIED event (rail signature checked upstream).
 * Does NOT run delivery (M6: state-only). Returns a result that always lets the caller
 * answer 200 — a duplicate or an irrelevant event is a successful no-op, not an error.
 *
 * @param rail       the rail this event came from (marketplace_orders.rail).
 * @param railEvent  the normalised, verified event (from PaymentRail.parseEvent).
 */
export async function markOrderPaid(
  rail: Rail,
  railEvent: ParsedRailEvent,
): Promise<MarkPaidResult> {
  const { rail_event_id, type, order_id, status } = railEvent;

  // A verified event that should drive an order MUST resolve to one. order_id is read from
  // provider-trusted data only (e.g. PaymentIntent metadata) — never client input.
  if (!order_id) {
    throw new Error(`markOrderPaid: verified ${rail} event ${rail_event_id} carries no order_id`);
  }

  const db = getDb();

  // 1) Dedupe insert FIRST. UNIQUE(rail, rail_event_id) makes a webhook replay a no-op.
  //    We record every event (even irrelevant/late ones) for audit; the unique index is the
  //    replay guard. `new_status` captures the status this event WOULD drive the order to.
  const { error: evErr } = await db.from('marketplace_payment_events').insert({
    order_id,
    rail,
    kind: type,
    rail_event_id,
    new_status: status,
    payload: railEvent as unknown as Record<string, unknown>,
  });

  if (evErr) {
    if ((evErr as { code?: string }).code === '23505') {
      // Already processed this exact event — at-most-once. No second advance.
      log.info({ rail, railEventId: rail_event_id, orderId: order_id }, 'markOrderPaid: duplicate event, no-op');
      return { applied: false, deduped: true, orderId: order_id };
    }
    log.error({ err: evErr, rail, railEventId: rail_event_id }, 'markOrderPaid: event insert failed');
    throw new Error('failed to record payment event');
  }

  // 2) Only 'paid'-driving events advance the order. Everything else is recorded-only.
  if (status !== 'paid') {
    log.info({ rail, railEventId: rail_event_id, orderId: order_id, type }, 'markOrderPaid: non-paid event, recorded only');
    return { applied: false, deduped: false, orderId: order_id };
  }

  // 3) Conditional advance to 'paid'. Guarded by .in('status', PRE_PAID_STATES) so:
  //    - a late/out-of-order succeeded event can NEVER move a delivered/settled/refunding
  //      order backward (the filter matches no row → 0 affected);
  //    - a redelivered-but-not-deduped path (shouldn't happen given step 1, but defence in
  //      depth) is a no-op once the order already left the pre-paid states.
  const { data: advanced, error: updErr } = await db
    .from('marketplace_orders')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('order_id', order_id)
    .in('status', PRE_PAID_STATES as string[])
    .select('order_id');

  if (updErr) {
    log.error({ err: updErr, orderId: order_id }, 'markOrderPaid: order advance failed');
    throw new Error('failed to advance order to paid');
  }

  const applied = Array.isArray(advanced) && advanced.length > 0;
  if (!applied) {
    // Order wasn't in a pre-paid state — already paid/delivered/etc. Idempotent no-op.
    log.info({ orderId: order_id }, 'markOrderPaid: order not in a pre-paid state, no advance (idempotent)');
  } else {
    log.info({ orderId: order_id }, 'markOrderPaid: order advanced to paid');
  }
  return { applied, deduped: false, orderId: order_id };
}

/**
 * Atomically claim a single 'paid' order into 'delivering'. Returns true iff THIS call won
 * the claim (the conditional update matched the still-'paid' row). A concurrent sweep that
 * lost the race gets false. The transition legality is asserted in-process as a tripwire.
 */
async function claimForDelivery(orderId: string): Promise<boolean> {
  assertTransition('paid', 'delivering'); // tripwire: this edge must be legal in the DAG.
  const db = getDb();
  const { data, error } = await db
    .from('marketplace_orders')
    .update({ status: 'delivering' })
    .eq('order_id', orderId)
    .eq('status', 'paid') // supply-race guard: only the row still in 'paid' is claimed.
    .select('order_id');
  if (error) {
    log.error({ err: error, orderId }, 'claimForDelivery: claim update failed');
    throw new Error('failed to claim order for delivery');
  }
  return Array.isArray(data) && data.length > 0;
}

/** Mark a claimed ('delivering') order delivered. Asserts the edge as a tripwire. */
async function markDelivered(orderId: string): Promise<void> {
  assertTransition('delivering', 'delivered'); // tripwire.
  const db = getDb();
  const { error } = await db
    .from('marketplace_orders')
    .update({ status: 'delivered', delivered_at: new Date().toISOString() })
    .eq('order_id', orderId)
    .eq('status', 'delivering'); // only complete an order we actually hold.
  if (error) {
    log.error({ err: error, orderId }, 'markDelivered: completion update failed');
    throw new Error('failed to mark order delivered');
  }
}

/**
 * One sweep of the durable delivery worker (the poller). Finds every order the delivery saga
 * still owns (status IN paid/delivering), drives each to 'delivered' via the injected
 * deliver() callback, and is safe to re-run on any schedule.
 *
 * Crash safety: if deliver() throws (or the process dies mid-delivery), the order is left at
 * 'delivering' — recoverable — and the NEXT sweep re-runs deliver() to completion. A paid
 * order can therefore never be silently lost: it is always reachable from a future sweep.
 * One order's failure never aborts the rest of the sweep.
 *
 * @param deliver  the delivery callback (memory clone + entitlement grant; chunk 2). MUST be
 *                 idempotent — it may be re-invoked for the same order after a crash.
 * @param limit    max orders to drain this sweep (default 100).
 */
export async function dispatchPendingDeliveries(
  deliver: DeliverFn,
  limit: number = DEFAULT_SWEEP_LIMIT,
): Promise<DispatchSummary> {
  const db = getDb();

  // Pull the orders the delivery saga owns. 'paid' = fresh; 'delivering' = a prior sweep that
  // crashed mid-delivery (the recoverable state). Ordered oldest-first so the longest-waiting
  // buyer is served first; bounded by `limit`.
  const { data, error } = await db
    .from('marketplace_orders')
    .select('*')
    .in('status', DELIVERABLE_STATES as string[])
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    log.error({ err: error }, 'dispatchPendingDeliveries: failed to load pending orders');
    throw new Error('failed to load pending deliveries');
  }

  // COPY dispatcher: NEVER touch a TITLE order. A title sale moves the 1-of-1 NFT seller→buyer via
  // its own saga (executeTitleSale); cloning it (grantCopy) would mint the buyer a plaintext-
  // equivalent copy of a 1-of-1 AND mark the order 'delivered', defeating the title model (the
  // adversarial backtest flagged this CRITICAL). Only 'copy' (and legacy NULL = pre-title copies)
  // are swept here; a separate title sweeper owns title orders.
  const orders = ((data as OrderRow[] | null) ?? []).filter((o) => o.listing_kind !== 'title');
  const summary: DispatchSummary = { delivered: 0, failed: 0, examined: 0 };

  for (const order of orders) {
    summary.examined += 1;

    // Claim fresh 'paid' orders into 'delivering'. An order already in 'delivering' is a
    // crash-recovery resume — we proceed to re-run deliver() for it directly. (If a claim on
    // a 'paid' order returns false, a concurrent sweep took it — skip; it's that sweep's.)
    try {
      if (order.status === 'paid') {
        const won = await claimForDelivery(order.order_id);
        if (!won) {
          log.info({ orderId: order.order_id }, 'dispatch: lost claim race, skipping');
          continue;
        }
      }
    } catch (err) {
      // A claim write failure leaves the order exactly where it was (still 'paid') — fully
      // recoverable next sweep. Count it as a failure and move on; don't abort the sweep.
      summary.failed += 1;
      log.error({ err, orderId: order.order_id }, 'dispatch: claim failed, order left recoverable');
      continue;
    }

    // Run the injected delivery. On ANY throw, the order stays at 'delivering' (recoverable):
    // we do NOT roll it back to 'paid' and we do NOT advance it to 'delivered'. The next sweep
    // re-picks it (DELIVERABLE_STATES includes 'delivering') and re-runs deliver().
    try {
      await deliver({ ...order, status: 'delivering' });
    } catch (err) {
      summary.failed += 1;
      log.error(
        { err, orderId: order.order_id },
        'dispatch: deliver() threw, order left recoverable at delivering',
      );
      continue;
    }

    // Delivery succeeded — complete the order. A failure to write 'delivered' here also leaves
    // it recoverable at 'delivering' (deliver() is idempotent, so the re-run is safe).
    try {
      await markDelivered(order.order_id);
      summary.delivered += 1;
      log.info({ orderId: order.order_id }, 'dispatch: order delivered');
    } catch (err) {
      summary.failed += 1;
      log.error({ err, orderId: order.order_id }, 'dispatch: delivered but completion write failed (recoverable)');
    }
  }

  if (summary.examined > 0) {
    log.info(summary, 'dispatchPendingDeliveries: sweep complete');
  }
  return summary;
}
