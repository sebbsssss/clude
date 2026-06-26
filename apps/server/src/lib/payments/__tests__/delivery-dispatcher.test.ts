/**
 * Durable delivery dispatcher — the §00 M6 order→delivery state machine.
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 1), Task 3 (spec §00 M6, mirrors
 * topup.routes.ts intent + UNIQUE dedupe + poller).
 *
 * MONEY CODE. This suite pins the four non-negotiable M6 contract points — the ones that
 * stop a crash between webhook-ack and delivery from silently losing a paid-for pack:
 *
 *   1. IDEMPOTENT markOrderPaid. A replayed webhook (same rail + rail_event_id) is a
 *      no-op: the dedupe insert hits 23505, the order is NOT advanced a second time, and
 *      no second payment-event row is written. The first call drives awaiting_payment→paid
 *      exactly once.
 *
 *   2. STATE-DRIVEN dispatch. dispatchPendingDeliveries finds orders in status='paid',
 *      claims each to 'delivering', runs the injected deliver(order), and drives it to
 *      'delivered'. Delivery is read off ORDER STATE, never an in-process event.
 *
 *   3. CRASH-SAFE. If deliver() throws, the order is left RECOVERABLE (it stays
 *      'delivering', never lost, never 'delivered'); a later sweep re-runs deliver() and
 *      completes it. A crash mid-delivery can only ever leave a paid order at 'paid' or
 *      'delivering' for the next sweep.
 *
 *   4. NEVER INLINE. markOrderPaid does NOT call deliver — not once, not ever. Delivery is
 *      exclusively the worker's job, gated on persisted order state.
 *
 * getDb is fully mocked (table-routed in-memory Supabase, same idiom as
 * order-orchestrator.test.ts). No real DB, no Stripe, no network. deliver() is an injected
 * callback so the state machine is tested in isolation from the actual memory-clone (chunk 2).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── Table-routed Supabase mock (extends the order-orchestrator.test.ts idiom with the
//    surface the dispatcher needs: conditional update + .select() returning affected rows,
//    and a (rail, rail_event_id) UNIQUE on marketplace_payment_events). ──
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const insertCalls: Array<{ table: string; rows: Row[] }> = [];
const updateCalls: Array<{ table: string; patch: Row }> = [];

// ── Fault-injection hooks (all consumed/cleared in resetDb) ──
/** Next marketplace_payment_events insert returns this error (the dedupe-write failure path). */
let failEventInsertWith: { code?: string; message: string } | null = null;
/** The markOrderPaid status-advance UPDATE ({status:'paid'}) returns this error. */
let failOrderUpdateWith: { code?: string; message: string } | null = null;
/** The pending-orders SELECT on marketplace_orders returns this error. */
let failLoadOrders: { code?: string; message: string } | null = null;
/**
 * Simulate a lost claim race: right before the claim UPDATE ({status:'delivering'} guarded by
 * .eq('status','paid')) runs for this order_id, flip the row to 'delivering' so the claim matches
 * ZERO rows (a concurrent sweep won). Consumed on first use.
 */
let claimRaceSteal: string | null = null;
/** The claim UPDATE ({status:'delivering'}) for this order_id returns an error (claim-write blip). */
let failClaimUpdateFor: string | null = null;

function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  insertCalls.length = 0;
  updateCalls.length = 0;
  failEventInsertWith = null;
  failOrderUpdateWith = null;
  failLoadOrders = null;
  claimRaceSteal = null;
  failClaimUpdateFor = null;
}
function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}

/** A filter predicate: equality (.eq) or set-membership (.in). */
type Filter = (row: Row) => boolean;

/**
 * A tiny chainable query builder covering the exact surface the dispatcher uses:
 *   .select().in(...).order().limit()            — read paid/delivering orders
 *   .insert(row)                                 — payment-event dedupe insert
 *   .update(patch).eq(...).in(...).select(...)   — conditional advance/claim, returns affected
 *
 * Deferred execution: filters (.eq / .in) and the pending insert/update accumulate lazily and
 * run EXACTLY ONCE at the terminal — awaiting the builder (`then`), or .single()/.maybeSingle().
 * `.select()` is a chainable no-op (it only names columns); it never executes on its own. This
 * mirrors the supabase-js builder closely enough for the money path:
 *   - insert enforces the relevant UNIQUE constraint (returns a Postgres 23505 like Supabase);
 *   - update applies the patch ONLY to rows matching every filter — so a claim guarded by
 *     .eq('status','paid') is a no-op once the row left 'paid' (supply-race idiom, Risk R8),
 *     and returns the affected rows so the caller can count them.
 */
function makeChain(table: string) {
  const filters: Filter[] = [];
  let pendingInsert: Row[] | null = null;
  let pendingPatch: Row | null = null;
  let settled = false;

  const matched = (): Row[] => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));

  const settleInsert = (): { data: any; error: any } => {
    const rows = pendingInsert!;
    const arr = tables[table] ?? (tables[table] = []);
    // Injected generic event-insert failure (consumed once) — exercises the non-23505 error path.
    if (table === 'marketplace_payment_events' && failEventInsertWith) {
      const err = failEventInsertWith;
      failEventInsertWith = null;
      return { data: null, error: err };
    }
    // Simulate uq_pay_events_dedup: UNIQUE(rail, rail_event_id) WHERE rail_event_id NOT NULL.
    if (table === 'marketplace_payment_events') {
      for (const row of rows) {
        if (
          row.rail_event_id != null &&
          arr.some((x) => x.rail === row.rail && x.rail_event_id === row.rail_event_id)
        ) {
          return {
            data: null,
            error: { code: '23505', message: 'duplicate key value violates uq_pay_events_dedup' },
          };
        }
      }
    }
    for (const row of rows) arr.push({ ...row });
    insertCalls.push({ table, rows: rows.map((r) => ({ ...r })) });
    return { data: rows.map((r) => ({ ...r })), error: null };
  };

  const settleUpdate = (): { data: any; error: any } => {
    const patch = pendingPatch!;
    if (table === 'marketplace_orders') {
      // The markOrderPaid status advance ({status:'paid'}) — injected failure path.
      if (patch.status === 'paid' && failOrderUpdateWith) {
        const err = failOrderUpdateWith;
        failOrderUpdateWith = null;
        return { data: null, error: err };
      }
      // The claim ({status:'delivering'}, guarded by .eq('status','paid')). The current `filters`
      // include that .eq guard + the .eq('order_id', id), so `matched()` identifies the one order
      // this claim targets.
      if (patch.status === 'delivering') {
        const claimTarget = matched()[0];
        // Injected claim-write failure for one specific order (others in the sweep proceed normally).
        if (failClaimUpdateFor && claimTarget && claimTarget.order_id === failClaimUpdateFor) {
          failClaimUpdateFor = null;
          return { data: null, error: { code: '40001', message: 'claim write failed' } };
        }
        // Lost-claim-race injection: flip the target row out of 'paid' BEFORE the guard is applied,
        // so the .eq('status','paid') claim matches zero rows (a concurrent sweep already won).
        if (claimRaceSteal) {
          const stolen = (tables[table] ?? []).find((r) => r.order_id === claimRaceSteal && r.status === 'paid');
          if (stolen) {
            stolen.status = 'delivering';
            claimRaceSteal = null;
          }
        }
      }
    }
    const hits = matched();
    for (const row of hits) Object.assign(row, patch);
    updateCalls.push({ table, patch: { ...patch } });
    return { data: hits.map((r) => ({ ...r })), error: null };
  };

  // Resolve the accumulated operation once. Insert/update mutate; a bare read returns matches.
  const exec = (): { data: any; error: any } => {
    if (settled) return { data: null, error: null };
    settled = true;
    if (pendingInsert) return settleInsert();
    if (pendingPatch) return settleUpdate();
    // Injected pending-orders LOAD failure (a bare SELECT on the orders table), consumed once.
    if (table === 'marketplace_orders' && failLoadOrders) {
      const err = failLoadOrders;
      failLoadOrders = null;
      return { data: null, error: err };
    }
    return { data: matched().map((r) => ({ ...r })), error: null };
  };

  const chain: Record<string, any> = {};
  Object.assign(chain, {
    // .select() only names returned columns — chainable, never executes on its own.
    select: (_cols?: string) => chain,
    eq: (col: string, val: any) => {
      filters.push((row) => row[col] === val);
      return chain;
    },
    in: (col: string, vals: any[]) => {
      filters.push((row) => vals.includes(row[col]));
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    insert: (row: Row | Row[]) => {
      pendingInsert = Array.isArray(row) ? row : [row];
      return chain;
    },
    update: (patch: Row) => {
      pendingPatch = patch;
      return chain;
    },
    maybeSingle: async () => {
      const r = exec();
      const arr = Array.isArray(r.data) ? r.data : r.data == null ? [] : [r.data];
      return { data: arr[0] ?? null, error: r.error };
    },
    single: async () => {
      const r = exec();
      const arr = Array.isArray(r.data) ? r.data : r.data == null ? [] : [r.data];
      return { data: arr[0] ?? null, error: r.error };
    },
    // Awaiting the builder (`await db.from(...).update(...).eq(...).select(...)`) executes it.
    then: (resolve: (v: any) => any, reject?: (e: any) => any) =>
      Promise.resolve(exec()).then(resolve, reject),
  });
  return chain;
}

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({ from: (table: string) => makeChain(table) }),
}));

import {
  markOrderPaid,
  dispatchPendingDeliveries,
  type DeliverFn,
} from '../delivery-dispatcher.js';
import type { ParsedRailEvent } from '../payment-rail.js';

const BUYER = 'BuYeRwallet1111111111111111111111111111111';
const SELLER = 'SeLLeRwallet222222222222222222222222222222';

/** Seed an order row directly in a chosen status. */
function seedOrder(overrides: Row = {}): Row {
  const row: Row = {
    order_id: 'ord-aabbccdd',
    pack_id: 'pmp-abc123',
    listing_id: 'lst-deadbeef',
    listing_kind: 'copy',
    buyer_wallet: BUYER,
    buyer_account_id: null,
    seller_wallet: SELLER,
    rail: 'stripe',
    currency: 'usd',
    amount: '9.99',
    fee_amount: '0',
    payout_amount: '0',
    status: 'awaiting_payment',
    rail_ref: 'pi_123',
    rail_tx: null,
    client_token: 'ct-fixed-001',
    created_at: new Date().toISOString(),
    paid_at: null,
    delivered_at: null,
    settled_at: null,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    metadata: {},
    ...overrides,
  };
  seed('marketplace_orders', [row]);
  return row;
}

function paidEvent(overrides: Partial<ParsedRailEvent> = {}): ParsedRailEvent {
  return {
    rail_event_id: 'evt_paid_001',
    type: 'payment_intent.succeeded',
    order_id: 'ord-aabbccdd',
    status: 'paid',
    ...overrides,
  };
}

beforeEach(() => {
  resetDb();
});

describe('markOrderPaid — idempotent, state-only (M6 contract 1 + 4)', () => {
  it('drives awaiting_payment → paid and records exactly one payment-event row', async () => {
    seedOrder({ status: 'awaiting_payment' });

    const res = await markOrderPaid('stripe', paidEvent());

    expect(res.applied).toBe(true);
    expect(tables.marketplace_orders![0].status).toBe('paid');
    expect(tables.marketplace_orders![0].paid_at).toBeTruthy();
    // Exactly one event row, carrying the dedupe key.
    const events = tables.marketplace_payment_events ?? [];
    expect(events).toHaveLength(1);
    expect(events[0].rail).toBe('stripe');
    expect(events[0].rail_event_id).toBe('evt_paid_001');
    expect(events[0].new_status).toBe('paid');
  });

  it('a REPLAYED webhook (same rail + rail_event_id) is a no-op: order not double-advanced, no 2nd event', async () => {
    seedOrder({ status: 'awaiting_payment' });

    const first = await markOrderPaid('stripe', paidEvent());
    expect(first.applied).toBe(true);

    // Replay the identical event.
    const replay = await markOrderPaid('stripe', paidEvent());
    expect(replay.applied).toBe(false);
    expect(replay.deduped).toBe(true);

    // The order advanced to paid exactly once; the event log has exactly one row.
    expect(tables.marketplace_orders![0].status).toBe('paid');
    expect((tables.marketplace_payment_events ?? []).length).toBe(1);
  });

  it('NEVER triggers delivery inline — markOrderPaid leaves the order at paid, not delivered', async () => {
    seedOrder({ status: 'awaiting_payment' });

    await markOrderPaid('stripe', paidEvent());

    // No transition past 'paid' happened in the webhook path. Delivery is the worker's job.
    expect(tables.marketplace_orders![0].status).toBe('paid');
    expect(tables.marketplace_orders![0].delivered_at).toBeNull();
    // Nothing was written to entitlements/access here (that is delivery, chunk 2).
    expect(tables.pack_entitlements ?? []).toHaveLength(0);
  });

  it('ignores an event whose order is already past paid (no backward move), still deduped-recorded', async () => {
    // Order already delivered; a late-arriving succeeded event must not drag it back to paid.
    seedOrder({ status: 'delivered', paid_at: new Date().toISOString() });

    const res = await markOrderPaid('stripe', paidEvent({ rail_event_id: 'evt_late_002' }));

    expect(res.applied).toBe(false);
    expect(tables.marketplace_orders![0].status).toBe('delivered');
    // The event is still logged for audit (dedupe row present).
    expect((tables.marketplace_payment_events ?? []).length).toBe(1);
  });

  it('ignores a non-paid event (status=null/refunding) — only succeeded drives paid', async () => {
    seedOrder({ status: 'awaiting_payment' });

    const res = await markOrderPaid('stripe', paidEvent({ status: null, type: 'payment_intent.created', rail_event_id: 'evt_created_003' }));

    expect(res.applied).toBe(false);
    expect(tables.marketplace_orders![0].status).toBe('awaiting_payment');
  });

  it('throws on a paid event with no order_id (a verified event must resolve an order)', async () => {
    await expect(
      markOrderPaid('stripe', paidEvent({ order_id: null })),
    ).rejects.toThrow(/order_id/i);
  });

  it('a generic (non-23505) event-insert failure throws so the webhook 500s and Stripe retries', async () => {
    seedOrder({ status: 'awaiting_payment' });
    // The dedupe insert fails with an opaque DB error (NOT the 23505 replay). markOrderPaid must
    // throw — the webhook handler turns that into a 500 so Stripe re-delivers (the event was never
    // recorded, so the retry is safe + correct, not a lost payment).
    failEventInsertWith = { code: '53300', message: 'too many connections' };
    await expect(markOrderPaid('stripe', paidEvent())).rejects.toThrow(/record payment event/i);
    // The order was NOT advanced (the failure was before the status write).
    expect(tables.marketplace_orders![0].status).toBe('awaiting_payment');
  });

  it('throws if the order STATUS advance errors (after the event was recorded) so Stripe retries', async () => {
    seedOrder({ status: 'awaiting_payment' });
    // The dedupe insert succeeds, but the conditional status UPDATE errors. markOrderPaid must throw
    // → webhook 500 → Stripe retries; the recorded event makes the retry an idempotent no-op on the
    // event row, and the (now-committed) advance completes on the retry.
    failOrderUpdateWith = { code: '40001', message: 'serialization failure' };
    await expect(markOrderPaid('stripe', paidEvent())).rejects.toThrow(/advance order to paid/i);
  });
});

describe('dispatchPendingDeliveries — state-driven worker (M6 contract 2)', () => {
  it('SKIPS a paid TITLE order — the copy sweep never clones it (left for the title saga)', async () => {
    seedOrder({ order_id: 'ord-title', status: 'paid', paid_at: new Date().toISOString(), listing_kind: 'title' });
    const deliver = vi.fn<DeliverFn>(async () => {});

    const summary = await dispatchPendingDeliveries(deliver);

    expect(deliver).not.toHaveBeenCalled();
    expect(summary.examined).toBe(0); // filtered out before examination
    expect(summary.delivered).toBe(0);
    // Untouched — still 'paid', never claimed to 'delivering'.
    expect(tables.marketplace_orders!.find((r) => r.order_id === 'ord-title')!.status).toBe('paid');
  });

  it('picks up a paid order, claims it to delivering, runs deliver(), drives it to delivered', async () => {
    const order = seedOrder({ status: 'paid', paid_at: new Date().toISOString() });
    const seen: string[] = [];
    const deliver: DeliverFn = async (o) => {
      seen.push(o.order_id);
      // At the moment deliver runs, the order must already be CLAIMED (delivering) — never
      // still 'paid' (that would let a concurrent sweep double-deliver).
      expect(tables.marketplace_orders![0].status).toBe('delivering');
    };

    const summary = await dispatchPendingDeliveries(deliver);

    expect(seen).toEqual([order.order_id]);
    expect(summary.delivered).toBe(1);
    expect(summary.failed).toBe(0);
    expect(tables.marketplace_orders![0].status).toBe('delivered');
    expect(tables.marketplace_orders![0].delivered_at).toBeTruthy();
  });

  it('is idempotent across sweeps: a delivered order is not re-delivered on the next run', async () => {
    seedOrder({ status: 'paid', paid_at: new Date().toISOString() });
    const deliver = vi.fn<DeliverFn>(async () => {});

    await dispatchPendingDeliveries(deliver);
    expect(deliver).toHaveBeenCalledTimes(1);

    // Second sweep: nothing is in 'paid' anymore → deliver is not called again.
    await dispatchPendingDeliveries(deliver);
    expect(deliver).toHaveBeenCalledTimes(1);
    expect(tables.marketplace_orders![0].status).toBe('delivered');
  });

  it('does nothing when no orders are paid', async () => {
    seedOrder({ status: 'awaiting_payment' });
    const deliver = vi.fn<DeliverFn>(async () => {});

    const summary = await dispatchPendingDeliveries(deliver);

    expect(deliver).not.toHaveBeenCalled();
    expect(summary.delivered).toBe(0);
  });
});

describe('dispatchPendingDeliveries — crash safety (M6 contract 3)', () => {
  it('if deliver() throws, the order stays RECOVERABLE (delivering, not delivered, not lost)', async () => {
    seedOrder({ status: 'paid', paid_at: new Date().toISOString() });
    const boom: DeliverFn = async () => {
      throw new Error('clone failed mid-flight (simulated crash)');
    };

    const summary = await dispatchPendingDeliveries(boom);

    expect(summary.delivered).toBe(0);
    expect(summary.failed).toBe(1);
    // The order was claimed but delivery did not finish → it is left at 'delivering'
    // (recoverable), NEVER 'delivered', and the row is NOT gone.
    expect(tables.marketplace_orders![0].status).toBe('delivering');
    expect(tables.marketplace_orders![0].delivered_at).toBeNull();
  });

  it('a later sweep COMPLETES a stuck delivery: re-run with a working deliver() reaches delivered', async () => {
    seedOrder({ status: 'paid', paid_at: new Date().toISOString() });

    // First sweep: deliver throws → order stranded at 'delivering'.
    await dispatchPendingDeliveries(async () => {
      throw new Error('transient failure');
    });
    expect(tables.marketplace_orders![0].status).toBe('delivering');

    // Recovery sweep: deliver succeeds → order completes. The worker must re-pick orders
    // stuck in 'delivering' (the recoverable state after a crash), not only fresh 'paid' ones.
    let called = 0;
    const summary = await dispatchPendingDeliveries(async () => {
      called += 1;
    });

    expect(called).toBe(1);
    expect(summary.delivered).toBe(1);
    expect(tables.marketplace_orders![0].status).toBe('delivered');
  });

  it('one failing delivery does not abort the others in the same sweep', async () => {
    seedOrder({ order_id: 'ord-good-1', status: 'paid', client_token: 'ct-1', paid_at: new Date().toISOString() });
    seedOrder({ order_id: 'ord-bad-2', status: 'paid', client_token: 'ct-2', paid_at: new Date().toISOString() });

    const summary = await dispatchPendingDeliveries(async (o) => {
      if (o.order_id === 'ord-bad-2') throw new Error('this one fails');
    });

    expect(summary.delivered).toBe(1);
    expect(summary.failed).toBe(1);
    const byId = Object.fromEntries(tables.marketplace_orders!.map((o) => [o.order_id, o.status]));
    expect(byId['ord-good-1']).toBe('delivered');
    expect(byId['ord-bad-2']).toBe('delivering'); // recoverable
  });

  it('LOST claim race: a concurrent sweep already moved the row out of paid → deliver() is NOT called', async () => {
    // Two sweeps see the same fresh 'paid' order. This sweep's claim update matches ZERO rows because
    // a concurrent sweep already flipped it paid→delivering (the .eq("status","paid") guard, Risk R8).
    // The loser must SKIP — never run deliver() for an order it does not own (no double-delivery).
    const order = seedOrder({ status: 'paid', paid_at: new Date().toISOString() });
    // Simulate the concurrent winner: the row is no longer 'paid' by the time our claim update runs.
    claimRaceSteal = order.order_id;
    const deliver = vi.fn<DeliverFn>(async () => {});

    const summary = await dispatchPendingDeliveries(deliver);

    expect(deliver).not.toHaveBeenCalled();
    expect(summary.delivered).toBe(0);
    // The row was examined but skipped — it stays where the concurrent sweep left it ('delivering').
    expect(summary.examined).toBe(1);
    expect(tables.marketplace_orders![0].status).toBe('delivering');
  });

  it('a CLAIM write failure leaves the order recoverable (still paid) and does not abort the sweep', async () => {
    seedOrder({ order_id: 'ord-claimfail', status: 'paid', client_token: 'ct-a', paid_at: new Date().toISOString() });
    seedOrder({ order_id: 'ord-ok', status: 'paid', client_token: 'ct-b', paid_at: new Date().toISOString() });
    // The claim UPDATE for the first order errors (a transient DB blip on the claim write). The order
    // must be left exactly as it was ('paid' — fully recoverable next sweep), counted as failed, and
    // the OTHER order in the same sweep must still be delivered (one failure never aborts the batch).
    failClaimUpdateFor = 'ord-claimfail';
    const summary = await dispatchPendingDeliveries(async () => {});

    expect(summary.failed).toBe(1);
    expect(summary.delivered).toBe(1);
    const byId = Object.fromEntries(tables.marketplace_orders!.map((o) => [o.order_id, o.status]));
    expect(byId['ord-claimfail']).toBe('paid'); // untouched → recoverable
    expect(byId['ord-ok']).toBe('delivered');
  });

  it('a failed pending-orders LOAD throws (the sweep cannot silently treat a DB error as "nothing to do")', async () => {
    seedOrder({ status: 'paid', paid_at: new Date().toISOString() });
    // The initial SELECT of paid/delivering orders errors. dispatchPendingDeliveries must throw rather
    // than return an empty summary — a load error is NOT "no work"; the poller swallows + retries it.
    failLoadOrders = { code: '08006', message: 'connection failure' };
    await expect(dispatchPendingDeliveries(async () => {})).rejects.toThrow(/load pending deliveries/i);
  });
});
