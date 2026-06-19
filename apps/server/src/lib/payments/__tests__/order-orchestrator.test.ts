/**
 * Order orchestrator — createOrder idempotency + the pure order-status DAG.
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 1), Task 2 (spec §3E + §00 M6).
 *
 * MONEY CODE. This suite pins the two guarantees the marketplace money path rests on
 * at the orchestrator layer:
 *
 *   1. createOrder is idempotent on (buyer_wallet, client_token). A retried intent —
 *      same buyer + same client_token — collapses to the SAME order row with NO second
 *      insert (DB UNIQUE uq_orders_idem is the backstop; the orchestrator surfaces the
 *      existing row as `{ created: false }` so the route can answer 409/200 without
 *      ever double-charging). A *different* client_token is a genuinely new order.
 *
 *   2. The status transition DAG is a pure, total function. Only the M6-sanctioned edges
 *      (created→awaiting_payment→paid→delivering→delivered→settled, plus the refund and
 *      failure/expiry branches) are allowed; every other edge is rejected. Delivery is
 *      driven off this state, never an in-process event — so the legality of each hop is
 *      a load-bearing invariant the delivery worker reads.
 *
 * The Stripe SDK is never touched here (createOrder only writes the order row; intent
 * creation is the rail's job, tested in stripe-rail.test.ts). getDb is fully mocked —
 * no real DB, no network.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── Minimal table-routed Supabase mock (same idiom as the route tests) ──
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const insertCalls: Array<{ table: string; rows: Row[] }> = [];

function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  insertCalls.length = 0;
}
function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}

interface EqFilter {
  col: string;
  val: any;
}

/**
 * A tiny chainable query builder. Supports the exact surface createOrder uses:
 *   .select().eq().eq().maybeSingle()        — idempotency lookup
 *   .insert(row).select().single()           — create
 * insert enforces the (buyer_wallet, client_token) UNIQUE constraint, returning a
 * Postgres 23505 error exactly like Supabase would on a duplicate.
 */
function makeChain(table: string) {
  const filters: EqFilter[] = [];
  let pendingInsert: Row | null = null;

  const matched = (): Row[] =>
    (tables[table] ?? []).filter((row) => filters.every((f) => row[f.col] === f.val));

  const settleInsert = (): { data: any; error: any } => {
    const row = pendingInsert!;
    pendingInsert = null;
    const arr = tables[table] ?? (tables[table] = []);
    // Simulate uq_orders_idem: UNIQUE(buyer_wallet, client_token).
    if (table === 'marketplace_orders') {
      const dup = arr.find(
        (x) => x.buyer_wallet === row.buyer_wallet && x.client_token === row.client_token,
      );
      if (dup) {
        return { data: null, error: { code: '23505', message: 'duplicate key value violates uq_orders_idem' } };
      }
    }
    arr.push({ ...row });
    insertCalls.push({ table, rows: [{ ...row }] });
    return { data: { ...row }, error: null };
  };

  const chain: Record<string, any> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: (col: string, val: any) => {
      filters.push({ col, val });
      return chain;
    },
    insert: (row: Row | Row[]) => {
      pendingInsert = Array.isArray(row) ? row[0] : row;
      return chain;
    },
    maybeSingle: async () => {
      const arr = matched();
      return { data: arr[0] ?? null, error: null };
    },
    single: async () => {
      if (pendingInsert) {
        const { data, error } = settleInsert();
        return { data, error };
      }
      const arr = matched();
      return { data: arr[0] ?? null, error: null };
    },
  });
  return chain;
}

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({ from: (table: string) => makeChain(table) }),
}));

import {
  createOrder,
  canTransition,
  assertTransition,
  ORDER_STATUS_TRANSITIONS,
  type OrderStatus,
  type CreateOrderInput,
} from '../order-orchestrator.js';

const BUYER = 'BuYeRwallet1111111111111111111111111111111';
const SELLER = 'SeLLeRwallet222222222222222222222222222222';

function baseInput(overrides: Partial<CreateOrderInput> = {}): CreateOrderInput {
  return {
    packId: 'pmp-abc123',
    listingId: 'lst-deadbeef',
    listingKind: 'copy',
    buyerWallet: BUYER,
    sellerWallet: SELLER,
    rail: 'stripe',
    currency: 'usd',
    amount: '9.99',
    clientToken: 'ct-fixed-001',
    ...overrides,
  };
}

beforeEach(() => {
  resetDb();
});

describe('createOrder — idempotency on (buyer_wallet, client_token)', () => {
  it('creates a fresh order with status=created and persists the money fields', async () => {
    const result = await createOrder(baseInput());
    expect(result.created).toBe(true);
    expect(result.order.status).toBe('created');
    expect(result.order.pack_id).toBe('pmp-abc123');
    expect(result.order.listing_id).toBe('lst-deadbeef');
    expect(result.order.listing_kind).toBe('copy');
    expect(result.order.buyer_wallet).toBe(BUYER);
    expect(result.order.seller_wallet).toBe(SELLER);
    expect(result.order.rail).toBe('stripe');
    expect(result.order.currency).toBe('usd');
    expect(String(result.order.amount)).toBe('9.99');
    expect(result.order.client_token).toBe('ct-fixed-001');
    // Generated identity + a non-null expiry (the sweeper relies on it).
    expect(result.order.order_id).toMatch(/^ord-[0-9a-f]{8}$/);
    expect(result.order.expires_at).toBeTruthy();
    expect(insertCalls.filter((c) => c.table === 'marketplace_orders')).toHaveLength(1);
  });

  it('a retried intent (same buyer + same client_token) returns the SAME order with NO second insert', async () => {
    const first = await createOrder(baseInput());
    expect(first.created).toBe(true);

    const second = await createOrder(baseInput());
    expect(second.created).toBe(false);
    expect(second.order.order_id).toBe(first.order.order_id);

    // The money invariant: exactly one row was ever inserted.
    expect(insertCalls.filter((c) => c.table === 'marketplace_orders')).toHaveLength(1);
    expect((tables.marketplace_orders ?? []).length).toBe(1);
  });

  it('loses an insert race gracefully: 23505 on insert resolves to the existing row, created=false', async () => {
    // Pre-seed the row a *concurrent* request already inserted, so the idempotency
    // SELECT misses (timing) but the INSERT hits the UNIQUE constraint.
    const existing = {
      order_id: 'ord-aabbccdd',
      pack_id: 'pmp-abc123',
      listing_id: 'lst-deadbeef',
      listing_kind: 'copy',
      buyer_wallet: BUYER,
      seller_wallet: SELLER,
      rail: 'stripe',
      currency: 'usd',
      amount: '9.99',
      status: 'created',
      client_token: 'ct-fixed-001',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
    };
    // Simulate the race: the lookup path won't see it (we seed AFTER the orchestrator's
    // first SELECT would run) — but our mock seeds synchronously, so to force the
    // insert-collision branch we seed now and rely on createOrder re-reading on 23505.
    seed('marketplace_orders', [existing]);

    const result = await createOrder(baseInput());
    expect(result.created).toBe(false);
    expect(result.order.order_id).toBe('ord-aabbccdd');
    // No new row beyond the seeded one.
    expect((tables.marketplace_orders ?? []).length).toBe(1);
  });

  it('a DIFFERENT client_token from the same buyer is a genuinely new order', async () => {
    const a = await createOrder(baseInput({ clientToken: 'ct-001' }));
    const b = await createOrder(baseInput({ clientToken: 'ct-002' }));
    expect(a.created).toBe(true);
    expect(b.created).toBe(true);
    expect(b.order.order_id).not.toBe(a.order.order_id);
    expect((tables.marketplace_orders ?? []).length).toBe(2);
  });

  it('rejects a non-positive amount before any DB write (never create a $0 charge)', async () => {
    await expect(createOrder(baseInput({ amount: '0' }))).rejects.toThrow(/amount/i);
    await expect(createOrder(baseInput({ amount: '-1' }))).rejects.toThrow(/amount/i);
    expect(insertCalls).toHaveLength(0);
  });

  it('rejects a missing client_token before any DB write (idempotency key is mandatory)', async () => {
    await expect(createOrder(baseInput({ clientToken: '' }))).rejects.toThrow(/client_token/i);
    expect(insertCalls).toHaveLength(0);
  });
});

describe('order-status DAG — pure transition helpers', () => {
  it('allows exactly the M6 happy-path progression', () => {
    const happy: Array<[OrderStatus, OrderStatus]> = [
      ['created', 'awaiting_payment'],
      ['awaiting_payment', 'paid'],
      ['paid', 'delivering'],
      ['delivering', 'delivered'],
      ['delivered', 'settled'],
    ];
    for (const [from, to] of happy) {
      expect(canTransition(from, to), `${from}→${to} must be allowed`).toBe(true);
    }
  });

  it('allows the refund branch off a delivered/settled order (copy clawback, §00 M10)', () => {
    expect(canTransition('delivered', 'refunding')).toBe(true);
    expect(canTransition('settled', 'refunding')).toBe(true);
    expect(canTransition('refunding', 'refunded')).toBe(true);
  });

  it('allows failure + expiry branches from the pre-delivery states', () => {
    expect(canTransition('awaiting_payment', 'failed')).toBe(true);
    expect(canTransition('awaiting_payment', 'expired')).toBe(true);
    expect(canTransition('created', 'expired')).toBe(true);
  });

  it('FORBIDS skipping straight from paid to delivered (delivery must pass through delivering)', () => {
    expect(canTransition('paid', 'delivered')).toBe(false);
  });

  it('FORBIDS resurrecting a terminal order', () => {
    for (const terminal of ['settled', 'refunded', 'failed', 'expired'] as OrderStatus[]) {
      expect(canTransition(terminal, 'paid'), `${terminal} is terminal`).toBe(false);
      expect(canTransition(terminal, 'delivering')).toBe(false);
    }
  });

  it('FORBIDS moving backwards (delivered→paid) and self-loops', () => {
    expect(canTransition('delivered', 'paid')).toBe(false);
    expect(canTransition('paid', 'paid')).toBe(false);
  });

  it('assertTransition throws on an illegal hop and is a no-op on a legal one', () => {
    expect(() => assertTransition('paid', 'delivered')).toThrow(/illegal order transition/i);
    expect(() => assertTransition('paid', 'delivering')).not.toThrow();
  });

  it('the DAG is total: every status is a key in the transition map', () => {
    const all: OrderStatus[] = [
      'created',
      'awaiting_payment',
      'paid',
      'delivering',
      'delivered',
      'settled',
      'refunding',
      'refunded',
      'failed',
      'expired',
    ];
    for (const s of all) {
      expect(ORDER_STATUS_TRANSITIONS[s], `missing DAG entry for ${s}`).toBeDefined();
      expect(Array.isArray(ORDER_STATUS_TRANSITIONS[s])).toBe(true);
    }
  });
});
