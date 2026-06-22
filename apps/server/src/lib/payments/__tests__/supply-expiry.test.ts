/**
 * supply-expiry — abandoned-order supply release.
 *
 * Pins the fix for the denial-of-inventory grief: claimSupplyUnit reserves a unit at order CREATION,
 * so a never-paid order would lock a single/limited listing forever. This sweep expires stale pre-paid
 * orders and frees their unit, exactly-once, and is a no-op for unlimited listings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
}
function seed(t: string, rows: Row[]) {
  tables[t] = (tables[t] ?? []).concat(rows.map((r) => ({ ...r })));
}

function makeChain(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  let pendingUpdate: Row | null = null;
  let lim = Infinity;
  let settled = false;
  const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, lim);
  const exec = (): { data: any; error: any } => {
    if (settled) return { data: null, error: null };
    settled = true;
    if (pendingUpdate) {
      const hits = matched();
      for (const r of hits) Object.assign(r, pendingUpdate);
      return { data: hits.map((r) => ({ ...r })), error: null };
    }
    return { data: matched().map((r) => ({ ...r })), error: null };
  };
  const chain: any = {};
  Object.assign(chain, {
    select: () => chain,
    update: (p: Row) => {
      pendingUpdate = p;
      return chain;
    },
    eq: (c: string, v: any) => {
      filters.push((r) => r[c] === v);
      return chain;
    },
    in: (c: string, vs: any[]) => {
      filters.push((r) => vs.includes(r[c]));
      return chain;
    },
    lt: (c: string, v: any) => {
      filters.push((r) => r[c] < v);
      return chain;
    },
    not: (c: string, _op: string, v: any) => {
      filters.push((r) => r[c] != v); // .not(col,'is',null) → col IS NOT NULL
      return chain;
    },
    limit: (n: number) => {
      lim = n;
      return chain;
    },
    maybeSingle: async () => {
      const r = exec();
      const arr = Array.isArray(r.data) ? r.data : [];
      return { data: arr[0] ?? null, error: r.error };
    },
    then: (res: (v: any) => any, rej?: (e: any) => any) => Promise.resolve(exec()).then(res, rej),
  });
  return chain;
}

const db = { from: (t: string) => makeChain(t) } as any;
vi.mock('@clude/shared/core/database', () => ({ getDb: () => db }));

import { expireStaleSupplyHolds } from '../supply-expiry.js';

const PAST = '2000-01-01T00:00:00.000Z';
const FUTURE = '2999-01-01T00:00:00.000Z';

beforeEach(() => resetDb());

describe('expireStaleSupplyHolds', () => {
  it('frees a single-supply unit held by an abandoned, expired order and re-opens the listing', async () => {
    seed('pack_listings', [{ listing_id: 'lst-1', supply_total: 1, supply_sold: 1, status: 'sold_out' }]);
    seed('marketplace_orders', [{ order_id: 'ord-1', listing_id: 'lst-1', status: 'created', expires_at: PAST }]);

    const res = await expireStaleSupplyHolds();

    expect(res.expired).toBe(1);
    expect(tables.marketplace_orders[0].status).toBe('expired');
    const listing = tables.pack_listings[0];
    expect(listing.supply_sold).toBe(0); // unit returned
    expect(listing.status).toBe('listed'); // un-flipped from sold_out → buyable again
  });

  it('is IDEMPOTENT — a second sweep does not double-free (the order is no longer pre-paid)', async () => {
    seed('pack_listings', [{ listing_id: 'lst-1', supply_total: 2, supply_sold: 1, status: 'listed' }]);
    seed('marketplace_orders', [{ order_id: 'ord-1', listing_id: 'lst-1', status: 'created', expires_at: PAST }]);

    await expireStaleSupplyHolds();
    const afterFirst = tables.pack_listings[0].supply_sold;
    const res2 = await expireStaleSupplyHolds();

    expect(afterFirst).toBe(0);
    expect(res2.expired).toBe(0); // already expired — not re-swept
    expect(tables.pack_listings[0].supply_sold).toBe(0); // no double-decrement
  });

  it('leaves a NON-expired pre-paid order (and its unit) untouched', async () => {
    seed('pack_listings', [{ listing_id: 'lst-1', supply_total: 1, supply_sold: 1, status: 'sold_out' }]);
    seed('marketplace_orders', [{ order_id: 'ord-1', listing_id: 'lst-1', status: 'created', expires_at: FUTURE }]);

    const res = await expireStaleSupplyHolds();

    expect(res.expired).toBe(0);
    expect(tables.marketplace_orders[0].status).toBe('created');
    expect(tables.pack_listings[0].supply_sold).toBe(1);
  });

  it('is a no-op against an UNLIMITED listing (supply_total NULL never decrements below the floor)', async () => {
    seed('pack_listings', [{ listing_id: 'lst-u', supply_total: null, supply_sold: 0, status: 'listed' }]);
    seed('marketplace_orders', [{ order_id: 'ord-u', listing_id: 'lst-u', status: 'awaiting_payment', expires_at: PAST }]);

    const res = await expireStaleSupplyHolds();

    // The order still expires (terminal cleanup), but no supply is freed for an unlimited listing.
    expect(res.expired).toBe(1);
    expect(tables.marketplace_orders[0].status).toBe('expired');
    expect(tables.pack_listings[0].supply_sold).toBe(0);
  });
});
