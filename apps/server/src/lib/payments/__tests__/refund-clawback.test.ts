/**
 * clawbackCopy — COPY-license refund/dispute clawback (§00 M10).
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 2), Task 3
 * (spec line 26 / MINOR 10 line 682 / line 696: "delete cloned rows on refund; otherwise every
 * copy sale is a free pack via dispute").
 *
 * MONEY/DATA CODE. When an order goes to refunding/refunded (a Stripe refund or chargeback),
 * `grantCopy`'s delivery must be UNWOUND so the buyer is not left a free copy:
 *
 *   1. REVOKE the entitlement — the pack_entitlements row for (pack, buyer, copy_license) flips
 *      status 'active' → 'refunded'. After this the copy unlock gate (hasActiveCopyEntitlement)
 *      MUST return false — the buyer can no longer unlock the pack.
 *
 *   2. DELETE the cloned memories — every row `grantCopy` wrote into the BUYER's namespace
 *      (owner_wallet = buyer) tagged imported_from_pack:<pack_id> for THIS order is deleted from
 *      the buyer's brain. A chargeback must not leave the buyer the bytes they no longer paid for.
 *
 *   3. IDEMPOTENT. A dispute webhook can fire more than once; re-running clawbackCopy is a no-op
 *      (no error, no over-delete) — the entitlement is already 'refunded' and the clones are
 *      already gone.
 *
 * getDb is mocked (table-routed in-memory Supabase, the same idiom as grant-copy.test.ts /
 * delivery-dispatcher.test.ts), extended here with .delete() + .update() support so the clawback's
 * writes are exercised against a real-shaped fake. No real DB.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── Table-routed Supabase mock ──────────────────────────────────────────────
// Surface used by clawbackCopy + hasActiveCopyEntitlement:
//   .update(patch).eq(c,v).eq(c,v)                  — entitlement revoke (awaited → { data, error })
//   .update(patch).eq(c,v).eq(c,v).select(cols)     — same, returns affected rows
//   .delete().eq(c,v).contains(c,obj)               — clone delete (awaited → { data, error })
//   .select(cols).eq(c,v)…limit().maybeSingle()     — entitlement gate read
//   .insert(row)                                    — (seeding helper only)
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const opLog: Array<{ table: string; op: 'update' | 'delete'; count: number }> = [];

function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  opLog.length = 0;
}
function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}

type Filter = (row: Row) => boolean;

function makeChain(table: string) {
  const filters: Filter[] = [];
  let pendingInsert: Row[] | null = null;
  let pendingUpdate: Row | null = null;
  let pendingDelete = false;
  let settled = false;

  const matched = (): Row[] => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));

  const exec = (): { data: any; error: any } => {
    if (settled) return { data: null, error: null };
    settled = true;

    if (pendingInsert) {
      const arr = tables[table] ?? (tables[table] = []);
      const written = pendingInsert.map((r) => ({ ...r }));
      for (const r of written) arr.push(r);
      return { data: written, error: null };
    }

    if (pendingUpdate) {
      const hits = matched();
      for (const row of hits) Object.assign(row, pendingUpdate);
      opLog.push({ table, op: 'update', count: hits.length });
      return { data: hits.map((r) => ({ ...r })), error: null };
    }

    if (pendingDelete) {
      const arr = tables[table] ?? (tables[table] = []);
      const survivors: Row[] = [];
      const removed: Row[] = [];
      for (const row of arr) (filters.every((f) => f(row)) ? removed : survivors).push(row);
      tables[table] = survivors;
      opLog.push({ table, op: 'delete', count: removed.length });
      return { data: removed.map((r) => ({ ...r })), error: null };
    }

    return { data: matched().map((r) => ({ ...r })), error: null };
  };

  const chain: Record<string, any> = {};
  Object.assign(chain, {
    select: (_cols?: string) => chain,
    eq: (col: string, val: any) => {
      filters.push((row) => row[col] === val);
      return chain;
    },
    in: (col: string, vals: any[]) => {
      filters.push((row) => vals.includes(row[col]));
      return chain;
    },
    // JSONB containment: every key in `obj` must be present + equal in the row's column value.
    contains: (col: string, obj: Record<string, any>) => {
      filters.push((row) => {
        const val = row[col];
        if (val == null || typeof val !== 'object') return false;
        return Object.entries(obj).every(([k, v]) => (val as Record<string, any>)[k] === v);
      });
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    insert: (row: Row | Row[]) => {
      pendingInsert = Array.isArray(row) ? row : [row];
      return chain;
    },
    update: (patch: Row) => {
      pendingUpdate = patch;
      return chain;
    },
    delete: () => {
      pendingDelete = true;
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
    then: (resolve: (v: any) => any, reject?: (e: any) => any) =>
      Promise.resolve(exec()).then(resolve, reject),
  });
  return chain;
}

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({ from: (table: string) => makeChain(table) }),
}));

import { clawbackCopy } from '../refund-clawback.js';
import { hasActiveCopyEntitlement } from '../entitlement-gate.js';
import type { OrderRow } from '../order-orchestrator.js';

const BUYER = 'BuYeRwallet2222222222222222222222222222222';
const SELLER = 'SeLLeRwallet333333333333333333333333333333';
const PACK = 'pack-deadbeef';
const ORDER_ID = 'ord-aabbccdd';

/** A refunding copy order for PACK, bought by BUYER. */
function order(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    order_id: ORDER_ID,
    pack_id: PACK,
    listing_id: 'lst-1234',
    listing_kind: 'copy',
    buyer_wallet: BUYER,
    buyer_account_id: null,
    seller_wallet: SELLER,
    rail: 'stripe',
    currency: 'usd',
    amount: '9.99',
    fee_amount: '0',
    payout_amount: '0',
    status: 'refunding',
    rail_ref: 'pi_1',
    rail_tx: null,
    client_token: 'ct-1',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    metadata: {},
    ...overrides,
  };
}

/**
 * Seed the post-delivery state grantCopy leaves: `cloneCount` cloned memories in the BUYER's
 * namespace (tagged + metadata-stamped with imported_from_pack + source_order_id), plus an
 * ACTIVE copy_license entitlement for (pack, buyer).
 */
function seedDeliveredCopy(cloneCount = 3, orderId = ORDER_ID) {
  for (let i = 0; i < cloneCount; i++) {
    seed('memories', [
      {
        id: 1000 + i,
        memory_type: 'semantic',
        content: `member ${i} content`,
        summary: `member ${i}`,
        tags: [`topic${i}`, `imported_from_pack:${PACK}`],
        concepts: [],
        importance: 0.6,
        source: `imported_from_pack:${PACK}`,
        owner_wallet: BUYER,
        encrypted: false,
        metadata: { imported_from_pack: PACK, source_order_id: orderId },
        created_at: new Date().toISOString(),
      },
    ]);
  }
  seed('pack_entitlements', [
    {
      id: 1,
      pack_id: PACK,
      holder_wallet: BUYER,
      grant_kind: 'copy_license',
      status: 'active',
      order_id: orderId,
      delivered_copy: true,
    },
  ]);
}

beforeEach(() => {
  resetDb();
});

describe('clawbackCopy — revoke entitlement + delete cloned rows (§00 M10)', () => {
  it('flips the copy_license entitlement to refunded', async () => {
    seedDeliveredCopy(3);

    await clawbackCopy(order());

    const ents = tables.pack_entitlements ?? [];
    expect(ents).toHaveLength(1);
    expect(ents[0].status).toBe('refunded');
    // The revoke is timestamped.
    expect(ents[0].revoked_at).toBeTruthy();
  });

  it('deletes the cloned imported_from_pack memories from the buyer brain', async () => {
    seedDeliveredCopy(3);

    await clawbackCopy(order());

    // Every clone tagged imported_from_pack:<pack> for this order is gone.
    const buyerClones = (tables.memories ?? []).filter(
      (m) => m.owner_wallet === BUYER && m.metadata?.imported_from_pack === PACK,
    );
    expect(buyerClones).toHaveLength(0);
  });

  it('after clawback, the copy unlock gate denies (hasActiveCopyEntitlement → false)', async () => {
    seedDeliveredCopy(2);
    // Sanity: the gate sees the buyer as entitled BEFORE the clawback.
    expect(await hasActiveCopyEntitlement(PACK, BUYER)).toBe(true);

    await clawbackCopy(order());

    // After: the entitlement is 'refunded', so the gate fails closed.
    expect(await hasActiveCopyEntitlement(PACK, BUYER)).toBe(false);
  });

  it('only deletes THIS order/pack clones — leaves the buyer other packs and other tenants alone', async () => {
    seedDeliveredCopy(2); // the refunded pack's 2 clones

    // A *different* pack the buyer legitimately still owns (must survive).
    seed('memories', [
      {
        id: 2000,
        content: 'other pack memory',
        owner_wallet: BUYER,
        tags: ['imported_from_pack:pack-other'],
        metadata: { imported_from_pack: 'pack-other', source_order_id: 'ord-other' },
        created_at: new Date().toISOString(),
      },
    ]);
    // A native (non-imported) buyer memory (must survive).
    seed('memories', [
      { id: 2001, content: 'native thought', owner_wallet: BUYER, tags: [], metadata: {}, created_at: new Date().toISOString() },
    ]);
    // ANOTHER tenant who happens to hold a clone of the SAME pack from their own order (must survive —
    // owner-scoping: clawback is scoped to THIS order's buyer only).
    seed('memories', [
      {
        id: 3000,
        content: 'someone elses copy',
        owner_wallet: SELLER,
        tags: [`imported_from_pack:${PACK}`],
        metadata: { imported_from_pack: PACK, source_order_id: 'ord-someone-else' },
        created_at: new Date().toISOString(),
      },
    ]);

    await clawbackCopy(order());

    const remaining = tables.memories ?? [];
    // The 2 refunded-pack clones for THIS buyer are gone; the other 3 rows survive.
    expect(remaining.map((m) => m.id).sort()).toEqual([2000, 2001, 3000]);
  });
});

describe('clawbackCopy — idempotent (a dispute webhook can fire twice)', () => {
  it('re-running is a no-op: still refunded, still no clones, no error, no over-delete', async () => {
    seedDeliveredCopy(3);

    await clawbackCopy(order());
    // The second invocation must not throw and must not touch any more rows.
    const deletesAfterFirst = opLog.filter((o) => o.op === 'delete').reduce((n, o) => n + o.count, 0);
    await clawbackCopy(order());

    const ents = tables.pack_entitlements ?? [];
    expect(ents).toHaveLength(1);
    expect(ents[0].status).toBe('refunded');
    expect((tables.memories ?? []).filter((m) => m.owner_wallet === BUYER)).toHaveLength(0);

    // The second run deleted ZERO additional rows (clones already gone).
    const deletesTotal = opLog.filter((o) => o.op === 'delete').reduce((n, o) => n + o.count, 0);
    expect(deletesTotal).toBe(deletesAfterFirst);
    expect(await hasActiveCopyEntitlement(PACK, BUYER)).toBe(false);
  });

  it('clawing back an order with no clones and no entitlement still succeeds (nothing to undo)', async () => {
    // No seedDeliveredCopy: delivery never happened (or already clawed). Must not throw.
    await expect(clawbackCopy(order())).resolves.toBeUndefined();
    expect(tables.pack_entitlements ?? []).toHaveLength(0);
    expect(tables.memories ?? []).toHaveLength(0);
  });
});

describe('clawbackCopy — guards', () => {
  it('throws if the order has no buyer_wallet (cannot scope a clawback)', async () => {
    await expect(clawbackCopy(order({ buyer_wallet: null }))).rejects.toThrow(/buyer/i);
  });
});
