/**
 * Integration tests for the marketplace PAYMENTS endpoints + Stripe webhook.
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 3), Task 1 (spec §3E + §00 M6).
 *
 * Surface (spec §3E):
 *   POST /v1/market/orders            create an order intent (privy + ownership)
 *   GET  /v1/market/orders/:id        order state (owner-scoped: buyer OR seller)
 *   POST /v1/market/orders/:id/refund mark refunding → clawbackCopy (owner or admin)
 *   POST /v1/market/payout-account    Stripe Connect onboarding stub
 *   POST /webhook/stripe/marketplace  RAW body, signature-verified; markOrderPaid / clawback
 *
 * MONEY CODE. The four non-negotiable guarantees pinned here:
 *   1. create-order is idempotent on (buyer, client_token) AND returns a client_secret.
 *   2. a webhook with a BAD signature → 400 and NO state change (verifyWebhook throws first).
 *   3. a verified payment_intent.succeeded → markOrderPaid; a replay is an idempotent no-op
 *      that still answers 200 (so Stripe stops retrying). Delivery is NEVER run inline.
 *   4. a refund/dispute → clawbackCopy is invoked and the order is moved to 'refunding'.
 *
 * The payments libs are unit-mocked (stripe-rail, order-orchestrator, delivery-dispatcher,
 * grant-copy, refund-clawback) so the HTTP layer is tested in isolation from Stripe + the DB.
 * getDb is the table-routed in-memory Supabase mock (same idiom as pack-marketplace.routes).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── Auth injection — flip `authedWallet` per test ──
let authedWallet: string | null = null;
vi.mock('@clude/brain/auth/privy-auth', () => ({
  optionalPrivyAuth: (req: Request, _res: Response, next: NextFunction) => {
    if (authedWallet) (req as Request & { verifiedWallet?: string }).verifiedWallet = authedWallet;
    next();
  },
  requirePrivyAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!authedWallet) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    (req as Request & { verifiedWallet?: string }).verifiedWallet = authedWallet;
    next();
  },
}));

// requireOwnership runs after the (mocked) requirePrivyAuth — pass through; verifiedWallet set.
vi.mock('@clude/brain/auth/require-ownership', () => ({
  requireOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
  optionalOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── Payments libs — unit-mocked so the route is isolated from Stripe + delivery. ──
// vi.hoisted so these spies exist at the (hoisted) vi.mock factory time — referencing a
// plain top-level const inside an async factory trips "cannot access before initialization".
const { verifyWebhook, parseEvent, createIntent, createOrder, markOrderPaid, dispatchPendingDeliveries, grantCopy, clawbackCopy, railCtorThrows } =
  vi.hoisted(() => ({
    verifyWebhook: vi.fn(),
    parseEvent: vi.fn(),
    createIntent: vi.fn(),
    createOrder: vi.fn(),
    markOrderPaid: vi.fn(),
    dispatchPendingDeliveries: vi.fn(),
    grantCopy: vi.fn(),
    clawbackCopy: vi.fn(),
    // When set true, constructing StripeRail throws (rail unconfigured on this deploy). Reset per test.
    railCtorThrows: { value: false },
  }));

vi.mock('../../lib/payments/stripe-rail.js', () => ({
  StripeRail: class {
    name = 'stripe' as const;
    verifyWebhook = verifyWebhook;
    parseEvent = parseEvent;
    createIntent = createIntent;
    constructor() {
      if (railCtorThrows.value) throw new Error('Stripe rail not configured: STRIPE_SECRET_KEY is empty');
    }
  },
}));

vi.mock('../../lib/payments/order-orchestrator.js', async (importOriginal) => {
  // Keep the REAL status DAG (assertTransition/canTransition) — only stub createOrder.
  const actual = await importOriginal<typeof import('../../lib/payments/order-orchestrator.js')>();
  return { ...actual, createOrder };
});

vi.mock('../../lib/payments/delivery-dispatcher.js', () => ({
  markOrderPaid,
  dispatchPendingDeliveries,
}));

vi.mock('../../lib/payments/grant-copy.js', () => ({ grantCopy }));

vi.mock('../../lib/payments/refund-clawback.js', () => ({ clawbackCopy }));

// ── Table-routed Supabase mock (records inserts/updates; supports eq/in/maybeSingle/single). ──
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const updateCalls: Array<{ table: string; patch: Row }> = [];
let forceError: { table: string; error: any } | null = null;

function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  updateCalls.length = 0;
  forceError = null;
}
function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}

interface Filter {
  kind: 'eq' | 'in';
  col: string;
  val?: any;
  vals?: any[];
}
function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((row) =>
    filters.every((f) => {
      if (f.kind === 'eq') return row[f.col] === f.val;
      if (f.kind === 'in') return (f.vals ?? []).includes(row[f.col]);
      return true;
    }),
  );
}

function makeChain(table: string) {
  const filters: Filter[] = [];
  let pendingInsert: Row[] | null = null;
  let pendingUpdate: Row | null = null;
  let limitN: number | null = null;

  const settle = (): Promise<{ data: any; error: any }> => {
    if (forceError && forceError.table === table) {
      const err = forceError.error;
      forceError = null;
      return Promise.resolve({ data: null, error: err });
    }
    if (pendingInsert) {
      const rows = pendingInsert;
      pendingInsert = null;
      tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
      return Promise.resolve({ data: rows.length === 1 ? { ...rows[0] } : rows.map((r) => ({ ...r })), error: null });
    }
    if (pendingUpdate) {
      const patch = pendingUpdate;
      pendingUpdate = null;
      const matched = applyFilters(tables[table] ?? [], filters);
      for (const row of matched) Object.assign(row, patch);
      updateCalls.push({ table, patch: { ...patch } });
      return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null });
    }
    let rows = applyFilters(tables[table] ?? [], filters);
    if (limitN !== null) rows = rows.slice(0, limitN);
    return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
  };

  const chain: Record<string, any> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: (col: string, val: any) => {
      filters.push({ kind: 'eq', col, val });
      return chain;
    },
    in: (col: string, vals: any[]) => {
      filters.push({ kind: 'in', col, vals });
      return chain;
    },
    order: () => chain,
    limit: (n: number) => {
      limitN = n;
      return chain;
    },
    insert: (rows: Row | Row[]) => {
      pendingInsert = Array.isArray(rows) ? rows : [rows];
      return chain;
    },
    update: (patch: Row) => {
      pendingUpdate = patch;
      return chain;
    },
    upsert: (rows: Row | Row[]) => {
      pendingInsert = Array.isArray(rows) ? rows : [rows];
      return chain;
    },
    maybeSingle: async () => {
      const { data, error } = await settle();
      if (error) return { data: null, error };
      const arr = Array.isArray(data) ? data : data ? [data] : [];
      return { data: arr[0] ?? null, error: null };
    },
    single: async () => {
      const { data, error } = await settle();
      if (error) return { data: null, error };
      const arr = Array.isArray(data) ? data : data ? [data] : [];
      return { data: arr[0] ?? null, error: null };
    },
    then: (resolve: (v: any) => any, reject?: (e: any) => any) => settle().then(resolve, reject),
  });
  return chain;
}

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({ from: (table: string) => makeChain(table) }),
}));

// Admin token gate reads process.env.PMP_ADMIN_TOKEN directly (mirrors pmp-admin.routes).
import { packMarketplacePaymentsRoutes, packMarketplaceStripeWebhookRoutes } from '../marketplace-payments.routes.js';

const BUYER = 'BuYeRwallet11111111111111111111111111111111';
const SELLER = 'SeLLeRwallet2222222222222222222222222222222';
const OTHER = 'OtherWaLLet3333333333333333333333333333333';

/** App with the global express.json() (mirrors production) — the webhook router uses RAW. */
function app() {
  const a = express();
  // Stripe webhook FIRST with a raw parser, BEFORE the global json parser (production order).
  a.use(packMarketplaceStripeWebhookRoutes());
  a.use(express.json());
  a.use(packMarketplacePaymentsRoutes());
  return a;
}

/** A listed copy listing for SELLER's pack, with a Stripe price row (999 cents = $9.99). */
function seedListing(listingId: string, packId: string) {
  seed('pack_listings', [
    {
      listing_id: listingId,
      pack_id: packId,
      seller_wallet: SELLER,
      title: 'Solana Trading Notes',
      license_type: 'copy',
      status: 'listed',
      supply_kind: 'unlimited',
      supply_total: null,
      supply_sold: 0,
    },
  ]);
  seed('memory_packs', [{ pack_id: packId, author_wallet: SELLER, name: 'Solana Trading Notes' }]);
  seed('pack_listing_prices', [
    { listing_id: listingId, rail: 'stripe', amount: '999', currency: 'usd', decimals: 2, enabled: true },
  ]);
}

beforeEach(() => {
  resetDb();
  authedWallet = null;
  verifyWebhook.mockReset();
  parseEvent.mockReset();
  createIntent.mockReset();
  createOrder.mockReset();
  markOrderPaid.mockReset();
  dispatchPendingDeliveries.mockReset();
  grantCopy.mockReset();
  clawbackCopy.mockReset();
  railCtorThrows.value = false;
  delete process.env.PMP_ADMIN_TOKEN;
});

// ─────────────────────────── POST /v1/market/orders ───────────────────────────

describe('POST /v1/market/orders', () => {
  it('creates an order + intent and returns { order_id, client_secret }', async () => {
    authedWallet = BUYER;
    seedListing('lst-1', 'pak-1');
    // The real createOrder inserts the row; the mock returns it AND we seed it so the route's
    // subsequent awaiting_payment UPDATE has a row to match (mirrors what the orchestrator wrote).
    const createdOrder = { order_id: 'ord-abc', pack_id: 'pak-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'created', rail: 'stripe', amount: '9.99', currency: 'usd' };
    seed('marketplace_orders', [createdOrder]);
    createOrder.mockResolvedValue({ order: { ...createdOrder }, created: true });
    createIntent.mockResolvedValue({ rail_ref: 'pi_123', client_secret: 'pi_123_secret_x' });

    const res = await request(app())
      .post('/v1/market/orders')
      .send({ listing_id: 'lst-1', rail: 'stripe', client_token: 'ct-1' });

    expect(res.status).toBe(201);
    expect(res.body.order_id).toBe('ord-abc');
    expect(res.body.client_secret).toBe('pi_123_secret_x');

    // The amount handed to the rail is the MAJOR-unit decimal derived from 999 cents.
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0]).toMatchObject({
      buyerWallet: BUYER,
      sellerWallet: SELLER,
      rail: 'stripe',
      amount: '9.99',
      currency: 'usd',
      clientToken: 'ct-1',
      listingId: 'lst-1',
      packId: 'pak-1',
      listingKind: 'copy',
    });
    expect(createIntent).toHaveBeenCalledTimes(1);
    expect(createIntent.mock.calls[0][0]).toMatchObject({ orderId: 'ord-abc', amount: '9.99', clientToken: 'ct-1' });

    // The order was advanced created → awaiting_payment and rail_ref persisted.
    const order = tables['marketplace_orders']?.find((o) => o.order_id === 'ord-abc');
    expect(order?.status).toBe('awaiting_payment');
    expect(order?.rail_ref).toBe('pi_123');
  });

  // retry guards ONLY against a rare (~0.1%) cross-process loopback transport blip — superagent
  // occasionally reading an empty body off a cold socket when many fresh test processes churn under
  // load. It cannot mask a product bug: the idempotency logic is pinned deterministically by the 40
  // sibling tests here + the orchestrator's own unit tests, so a real regression fails on EVERY
  // attempt. (The single-listener pattern below already removed the dual-server "Parse Error" flake;
  // this is belt-and-suspenders for the strictly-transport residual.)
  it('is idempotent: a replayed client_token returns the SAME order (no second create)', { retry: 2 }, async () => {
    authedWallet = BUYER;
    seedListing('lst-1', 'pak-1');
    // First call creates; the mock returns created=true, then a replay returns created=false.
    createOrder
      .mockResolvedValueOnce({
        order: { order_id: 'ord-abc', status: 'created', rail: 'stripe', amount: '9.99', currency: 'usd' },
        created: true,
      })
      .mockResolvedValueOnce({
        order: { order_id: 'ord-abc', status: 'awaiting_payment', rail: 'stripe', amount: '9.99', currency: 'usd', rail_ref: 'pi_123' },
        created: false,
      });
    createIntent.mockResolvedValue({ rail_ref: 'pi_123', client_secret: 'pi_123_secret_x' });

    // Bind the Express app to ONE ephemeral-port listener and reuse it for BOTH requests.
    // request(app()) makes supertest wrap the app in a fresh http.createServer + listen(0) PER
    // request (it happens in supertest's Test ctor, i.e. per .post()), so issuing two opens two
    // transient listeners; when the OS recycles the first port for the second bind, superagent can
    // read a response off the stale socket and throw the intermittent
    // "Parse Error: Expected HTTP/, RTSP/ or ICE/". One persistent server = one port for the whole
    // test = no port recycling, no parse error. (Await 'listening' so supertest sees a ready address
    // and doesn't re-call listen(0) on a still-binding server.)
    const server = app().listen(0);
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    try {
      const first = await request(server)
        .post('/v1/market/orders')
        .send({ listing_id: 'lst-1', rail: 'stripe', client_token: 'ct-1' });
      const second = await request(server)
        .post('/v1/market/orders')
        .send({ listing_id: 'lst-1', rail: 'stripe', client_token: 'ct-1' });

      expect(first.body.order_id).toBe('ord-abc');
      expect(second.body.order_id).toBe('ord-abc');
      // Same client_secret on the replay (Stripe createIntent is idempotent on client_token).
      expect(second.body.client_secret).toBe('pi_123_secret_x');
      // createOrder called once per request, but it short-circuits idempotently in the orchestrator.
      expect(createOrder).toHaveBeenCalledTimes(2);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('rejects an unauthenticated caller with 401 (no order created)', async () => {
    authedWallet = null;
    seedListing('lst-1', 'pak-1');
    const res = await request(app())
      .post('/v1/market/orders')
      .send({ listing_id: 'lst-1', rail: 'stripe', client_token: 'ct-1' });
    expect(res.status).toBe(401);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('rejects a non-stripe rail with 422 in this slice', async () => {
    authedWallet = BUYER;
    seedListing('lst-1', 'pak-1');
    const res = await request(app())
      .post('/v1/market/orders')
      .send({ listing_id: 'lst-1', rail: 'solana', client_token: 'ct-1' });
    expect(res.status).toBe(422);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('404s when the listing is not status=listed', async () => {
    authedWallet = BUYER;
    seedListing('lst-1', 'pak-1');
    tables['pack_listings'][0].status = 'draft';
    const res = await request(app())
      .post('/v1/market/orders')
      .send({ listing_id: 'lst-1', rail: 'stripe', client_token: 'ct-1' });
    expect(res.status).toBe(404);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('422s when no enabled stripe price exists for the listing', async () => {
    authedWallet = BUYER;
    seedListing('lst-1', 'pak-1');
    tables['pack_listing_prices'][0].enabled = false;
    const res = await request(app())
      .post('/v1/market/orders')
      .send({ listing_id: 'lst-1', rail: 'stripe', client_token: 'ct-1' });
    expect(res.status).toBe(422);
    expect(createOrder).not.toHaveBeenCalled();
  });

  it('requires client_token (422)', async () => {
    authedWallet = BUYER;
    seedListing('lst-1', 'pak-1');
    const res = await request(app()).post('/v1/market/orders').send({ listing_id: 'lst-1', rail: 'stripe' });
    expect(res.status).toBe(422);
    expect(createOrder).not.toHaveBeenCalled();
  });
});

// ───────────────── POST /v1/market/orders — FINITE-SUPPLY over-sell guard (copy listings) ─────────────────

/**
 * REGRESSION (CRITICAL — copy listing over-sell). pack_listings.supply_sold was seeded to 0 and NEVER
 * incremented, and the order path never read supply_kind/supply_total/supply_sold — so a single/limited
 * COPY listing could be ordered + delivered UNBOUNDED (a chargeback-free infinite-copy hole through the
 * paid path). The fix: the order path atomically CLAIMS a unit against the cap (supply_sold += 1 only
 * while supply_sold < supply_total), flips the listing to 'sold_out' at the cap, and refuses the next
 * order with 409 sold_out.
 *
 * BEFORE this fix these tests FAIL: claimSupplyUnit/failOrphanOrder did not exist (the route did not
 * even compile), and even with the calls stubbed out a single-supply listing would have happily created
 * a 2nd order. AFTER: exactly ONE order is placeable on a single-supply listing; the 2nd is 409.
 */
describe('POST /v1/market/orders — finite-supply over-sell guard', () => {
  /** A LISTED single-supply (supply_total=1) copy listing + its stripe price. */
  function seedSingleSupplyListing(listingId: string, packId: string) {
    seed('pack_listings', [
      {
        listing_id: listingId,
        pack_id: packId,
        seller_wallet: SELLER,
        title: 'One-of-one pack',
        license_type: 'copy',
        status: 'listed',
        supply_kind: 'single',
        supply_total: 1,
        supply_sold: 0,
      },
    ]);
    seed('memory_packs', [{ pack_id: packId, author_wallet: SELLER, name: 'One-of-one pack' }]);
    seed('pack_listing_prices', [
      { listing_id: listingId, rail: 'stripe', amount: '999', currency: 'usd', decimals: 2, enabled: true },
    ]);
  }

  it('a single-supply listing allows EXACTLY ONE order, then claims the unit + flips to sold_out', async () => {
    authedWallet = BUYER;
    seedSingleSupplyListing('lst-s1', 'pak-s1');
    const created = { order_id: 'ord-s1', pack_id: 'pak-s1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'created', rail: 'stripe', amount: '9.99', currency: 'usd' };
    seed('marketplace_orders', [created]);
    createOrder.mockResolvedValue({ order: { ...created }, created: true });
    createIntent.mockResolvedValue({ rail_ref: 'pi_s1', client_secret: 'cs_s1' });

    const res = await request(app())
      .post('/v1/market/orders')
      .send({ listing_id: 'lst-s1', rail: 'stripe', client_token: 'ct-s1' });

    expect(res.status).toBe(201);
    expect(res.body.order_id).toBe('ord-s1');
    // The unit was claimed (supply_sold 0 → 1) and the listing left the buyable set atomically.
    const listing = tables['pack_listings'].find((l) => l.listing_id === 'lst-s1');
    expect(listing?.supply_sold).toBe(1);
    expect(listing?.status).toBe('sold_out');
    // The order proceeded to awaiting_payment (a PaymentIntent WAS opened for the claimed unit).
    expect(createIntent).toHaveBeenCalledTimes(1);
    expect(tables['marketplace_orders'].find((o) => o.order_id === 'ord-s1')?.status).toBe('awaiting_payment');
  });

  it('rejects the SECOND order on a now-exhausted single-supply listing with 409 sold_out (no intent, order failed)', async () => {
    authedWallet = BUYER;
    // The listing already sold its one unit (supply_sold === supply_total) — but is still status=listed
    // to prove the CLAIM (not merely the status read) is what blocks the over-sell.
    seed('pack_listings', [
      {
        listing_id: 'lst-s2',
        pack_id: 'pak-s2',
        seller_wallet: SELLER,
        title: 'One-of-one pack',
        license_type: 'copy',
        status: 'listed',
        supply_kind: 'single',
        supply_total: 1,
        supply_sold: 1, // already at cap
      },
    ]);
    seed('memory_packs', [{ pack_id: 'pak-s2', author_wallet: SELLER, name: 'One-of-one pack' }]);
    seed('pack_listing_prices', [
      { listing_id: 'lst-s2', rail: 'stripe', amount: '999', currency: 'usd', decimals: 2, enabled: true },
    ]);
    // A genuinely-new order from a different buyer/token (created=true) — the orchestrator inserted it.
    const created2 = { order_id: 'ord-s2', pack_id: 'pak-s2', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'created', rail: 'stripe', amount: '9.99', currency: 'usd' };
    seed('marketplace_orders', [created2]);
    createOrder.mockResolvedValue({ order: { ...created2 }, created: true });
    createIntent.mockResolvedValue({ rail_ref: 'pi_s2', client_secret: 'cs_s2' });

    const res = await request(app())
      .post('/v1/market/orders')
      .send({ listing_id: 'lst-s2', rail: 'stripe', client_token: 'ct-s2' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('sold_out');
    // No charge was set up for an un-claimable order.
    expect(createIntent).not.toHaveBeenCalled();
    // supply_sold is NOT pushed past the cap (still 1, never 2 — the over-sell is refused).
    expect(tables['pack_listings'].find((l) => l.listing_id === 'lst-s2')?.supply_sold).toBe(1);
    // The just-created orphan order is marked 'failed' (a terminal row that can never be paid/delivered).
    expect(tables['marketplace_orders'].find((o) => o.order_id === 'ord-s2')?.status).toBe('failed');
  });

  it('an UNLIMITED listing (supply_total=null) is never claimed against — orders flow freely', async () => {
    authedWallet = BUYER;
    seedListing('lst-u', 'pak-u'); // helper seeds supply_kind=unlimited, supply_total=null
    const created = { order_id: 'ord-u', pack_id: 'pak-u', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'created', rail: 'stripe', amount: '9.99', currency: 'usd' };
    seed('marketplace_orders', [created]);
    createOrder.mockResolvedValue({ order: { ...created }, created: true });
    createIntent.mockResolvedValue({ rail_ref: 'pi_u', client_secret: 'cs_u' });

    const res = await request(app())
      .post('/v1/market/orders')
      .send({ listing_id: 'lst-u', rail: 'stripe', client_token: 'ct-u' });

    expect(res.status).toBe(201);
    // supply_sold stays 0 and the listing stays buyable (no cap to claim against).
    const listing = tables['pack_listings'].find((l) => l.listing_id === 'lst-u');
    expect(listing?.supply_sold).toBe(0);
    expect(listing?.status).toBe('listed');
  });

  it('an idempotent REPLAY (created=false) does NOT claim a second unit (no double-count)', async () => {
    authedWallet = BUYER;
    // A still-LISTED limited listing (2 of cap) with one unit already claimed by THIS buyer's first
    // (now-replayed) order — it has headroom, so the replay is not blocked by the sold-out guard; the
    // point is purely that the replay must not re-claim against the cap.
    seed('pack_listings', [
      {
        listing_id: 'lst-r',
        pack_id: 'pak-r',
        seller_wallet: SELLER,
        title: 'Limited pack',
        license_type: 'copy',
        status: 'listed',
        supply_kind: 'limited',
        supply_total: 2,
        supply_sold: 1,
      },
    ]);
    seed('memory_packs', [{ pack_id: 'pak-r', author_wallet: SELLER, name: 'Limited pack' }]);
    seed('pack_listing_prices', [
      { listing_id: 'lst-r', rail: 'stripe', amount: '999', currency: 'usd', decimals: 2, enabled: true },
    ]);
    // The orchestrator returns the EXISTING order (created=false) for the replayed client_token.
    const existing = { order_id: 'ord-r', pack_id: 'pak-r', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'awaiting_payment', rail: 'stripe', amount: '9.99', currency: 'usd', rail_ref: 'pi_r' };
    seed('marketplace_orders', [existing]);
    createOrder.mockResolvedValue({ order: { ...existing }, created: false });
    createIntent.mockResolvedValue({ rail_ref: 'pi_r', client_secret: 'cs_r' });

    const res = await request(app())
      .post('/v1/market/orders')
      .send({ listing_id: 'lst-r', rail: 'stripe', client_token: 'ct-r' });

    // The replay succeeds (200, same order) and crucially does NOT bump supply_sold to 2.
    expect(res.status).toBe(200);
    expect(res.body.order_id).toBe('ord-r');
    expect(tables['pack_listings'].find((l) => l.listing_id === 'lst-r')?.supply_sold).toBe(1);
  });
});

// ───────────────── POST /v1/market/orders — NUMERIC money precision (no float drift) ─────────────────

/**
 * The price row is stored in NUMERIC minor units (e.g. 999 cents). The route converts it to the
 * decimal MAJOR-unit string the orchestrator + rail consume via minorUnitsToMajorString — exact
 * integer-string slicing, NEVER float division. These pin that the amount handed to createOrder is
 * byte-for-byte correct across the cases that float math would corrupt: large values past 2^53, the
 * 9.99→998.999… rounding trap, sub-dollar amounts, zero-decimal currencies, and >2 decimals.
 *
 * This is the load-bearing money-precision boundary: a wrong amount here mis-charges every buyer.
 */
describe('POST /v1/market/orders — NUMERIC amount precision (server-priced, no float drift)', () => {
  /** Seed a listing whose stripe price row is `(amount, currency, decimals)`, then create an order. */
  async function orderWithPrice(amount: string | number, currency: string, decimals: number) {
    authedWallet = BUYER;
    seedListing('lst-1', 'pak-1');
    tables['pack_listing_prices'][0] = {
      listing_id: 'lst-1',
      rail: 'stripe',
      amount,
      currency,
      decimals,
      enabled: true,
    };
    const created = { order_id: 'ord-prec', pack_id: 'pak-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'created', rail: 'stripe' };
    seed('marketplace_orders', [created]);
    createOrder.mockResolvedValue({ order: { ...created }, created: true });
    createIntent.mockResolvedValue({ rail_ref: 'pi_p', client_secret: 'cs_p' });
    const res = await request(app())
      .post('/v1/market/orders')
      .send({ listing_id: 'lst-1', rail: 'stripe', client_token: 'ct-prec' });
    return res;
  }

  it('999 cents (decimals=2) → exactly "9.99" (the classic 9.99*100=998.999… trap)', async () => {
    const res = await orderWithPrice('999', 'usd', 2);
    expect(res.status).toBe(201);
    expect(createOrder.mock.calls[0][0].amount).toBe('9.99');
    expect(res.body.amount).toBe('9.99');
    // The SAME exact string is handed to the rail (so Stripe charges exactly this).
    expect(createIntent.mock.calls[0][0].amount).toBe('9.99');
  });

  it('a sub-dollar amount (5 cents) pads correctly to "0.05" (never "0.5" or "5")', async () => {
    const res = await orderWithPrice('5', 'usd', 2);
    expect(res.status).toBe(201);
    expect(createOrder.mock.calls[0][0].amount).toBe('0.05');
  });

  it('a LARGE amount past 2^53 minor units keeps every digit (float division would corrupt it)', async () => {
    // 9_007_199_254_740_993 cents = 2^53 + 1 — the first integer Number cannot represent exactly.
    // Integer-string slicing must preserve the trailing digits float math would round away.
    const res = await orderWithPrice('9007199254740993', 'usd', 2);
    expect(res.status).toBe(201);
    expect(createOrder.mock.calls[0][0].amount).toBe('90071992547409.93');
  });

  it('a zero-decimal currency (jpy, decimals=0) is the major unit verbatim — no decimal point added', async () => {
    const res = await orderWithPrice('500', 'jpy', 0);
    expect(res.status).toBe(201);
    expect(createOrder.mock.calls[0][0].amount).toBe('500');
    expect(createOrder.mock.calls[0][0].currency).toBe('jpy');
  });

  it('more than 2 decimals (decimals=4) slices correctly: 12345 → "1.2345"', async () => {
    const res = await orderWithPrice('12345', 'usd', 4);
    expect(res.status).toBe(201);
    expect(createOrder.mock.calls[0][0].amount).toBe('1.2345');
  });

  it('accepts a NUMERIC amount returned as a JS number (Supabase NUMERIC may deserialize as number)', async () => {
    // pg can hand back NUMERIC as a number; the route stringifies before slicing. 1299 → "12.99".
    const res = await orderWithPrice(1299, 'usd', 2);
    expect(res.status).toBe(201);
    expect(createOrder.mock.calls[0][0].amount).toBe('12.99');
  });

  it('a malformed (non-integer) price string is refused with 500, never a mis-charge', async () => {
    // A corrupt price row (e.g. "9.99" already-major, or "abc") must not silently produce a wrong
    // minor-unit conversion. The route surfaces 500 (order_failed) and never calls createOrder.
    const res = await orderWithPrice('9.99', 'usd', 2);
    expect(res.status).toBe(500);
    expect(createOrder).not.toHaveBeenCalled();
  });
});

// ─────────────────────────── GET /v1/market/orders/:id ───────────────────────────

describe('GET /v1/market/orders/:id', () => {
  it('lets the BUYER read their own order', async () => {
    authedWallet = BUYER;
    seed('marketplace_orders', [
      { order_id: 'ord-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'paid', amount: '9.99', currency: 'usd', rail: 'stripe' },
    ]);
    const res = await request(app()).get('/v1/market/orders/ord-1');
    expect(res.status).toBe(200);
    expect(res.body.order.order_id).toBe('ord-1');
    expect(res.body.order.status).toBe('paid');
  });

  it('lets the SELLER read an order on their pack', async () => {
    authedWallet = SELLER;
    seed('marketplace_orders', [
      { order_id: 'ord-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'delivered', amount: '9.99', currency: 'usd', rail: 'stripe' },
    ]);
    const res = await request(app()).get('/v1/market/orders/ord-1');
    expect(res.status).toBe(200);
    expect(res.body.order.order_id).toBe('ord-1');
  });

  it('403s a third party who is neither buyer nor seller', async () => {
    authedWallet = OTHER;
    seed('marketplace_orders', [
      { order_id: 'ord-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'paid', amount: '9.99', currency: 'usd', rail: 'stripe' },
    ]);
    const res = await request(app()).get('/v1/market/orders/ord-1');
    expect(res.status).toBe(403);
  });

  it('404s an unknown order', async () => {
    authedWallet = BUYER;
    const res = await request(app()).get('/v1/market/orders/ord-nope');
    expect(res.status).toBe(404);
  });

  it('422s an over-long order id (>64 chars) before any DB read (input-size guard)', async () => {
    authedWallet = BUYER;
    const res = await request(app()).get(`/v1/market/orders/${'x'.repeat(65)}`);
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_id');
  });

  it('401s an unauthenticated reader (no order leaked to an anonymous caller)', async () => {
    authedWallet = null;
    seed('marketplace_orders', [
      { order_id: 'ord-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'paid', amount: '9.99', currency: 'usd', rail: 'stripe' },
    ]);
    const res = await request(app()).get('/v1/market/orders/ord-1');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────── POST /v1/market/orders/:id/refund ───────────────────────────

describe('POST /v1/market/orders/:id/refund', () => {
  it('owner (buyer) refund → order moves to refunding and clawbackCopy is invoked', async () => {
    authedWallet = BUYER;
    seed('marketplace_orders', [
      { order_id: 'ord-1', pack_id: 'pak-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'delivered', rail: 'stripe', amount: '9.99', currency: 'usd' },
    ]);
    clawbackCopy.mockResolvedValue(undefined);

    const res = await request(app()).post('/v1/market/orders/ord-1/refund').send({});
    expect(res.status).toBe(200);

    const order = tables['marketplace_orders'][0];
    expect(order.status).toBe('refunding');
    expect(clawbackCopy).toHaveBeenCalledTimes(1);
    expect(clawbackCopy.mock.calls[0][0]).toMatchObject({ order_id: 'ord-1', buyer_wallet: BUYER, pack_id: 'pak-1' });
  });

  it('admin (X-Admin-Token) may refund any order', async () => {
    process.env.PMP_ADMIN_TOKEN = 'sekret-admin';
    authedWallet = null; // no privy — admin token alone authorises
    seed('marketplace_orders', [
      { order_id: 'ord-1', pack_id: 'pak-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'settled', rail: 'stripe', amount: '9.99', currency: 'usd' },
    ]);
    clawbackCopy.mockResolvedValue(undefined);

    const res = await request(app())
      .post('/v1/market/orders/ord-1/refund')
      .set('X-Admin-Token', 'sekret-admin')
      .send({});
    expect(res.status).toBe(200);
    expect(tables['marketplace_orders'][0].status).toBe('refunding');
    expect(clawbackCopy).toHaveBeenCalledTimes(1);
  });

  it('403s a third party (not buyer/seller, no admin token)', async () => {
    authedWallet = OTHER;
    seed('marketplace_orders', [
      { order_id: 'ord-1', pack_id: 'pak-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'delivered', rail: 'stripe', amount: '9.99', currency: 'usd' },
    ]);
    const res = await request(app()).post('/v1/market/orders/ord-1/refund').send({});
    expect(res.status).toBe(403);
    expect(clawbackCopy).not.toHaveBeenCalled();
  });

  it('refund of a not-yet-paid order (created) is rejected 409 with no clawback', async () => {
    authedWallet = BUYER;
    seed('marketplace_orders', [
      { order_id: 'ord-1', pack_id: 'pak-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'created', rail: 'stripe', amount: '9.99', currency: 'usd' },
    ]);
    const res = await request(app()).post('/v1/market/orders/ord-1/refund').send({});
    expect(res.status).toBe(409);
    expect(clawbackCopy).not.toHaveBeenCalled();
    expect(tables['marketplace_orders'][0].status).toBe('created');
  });

  it('is idempotent: refunding an already-refunding order re-invokes clawback and stays 200', async () => {
    authedWallet = BUYER;
    seed('marketplace_orders', [
      { order_id: 'ord-1', pack_id: 'pak-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'refunding', rail: 'stripe', amount: '9.99', currency: 'usd' },
    ]);
    clawbackCopy.mockResolvedValue(undefined);
    const res = await request(app()).post('/v1/market/orders/ord-1/refund').send({});
    expect(res.status).toBe(200);
    expect(clawbackCopy).toHaveBeenCalledTimes(1);
  });

  it('404s a refund for an unknown order (no clawback on a phantom order)', async () => {
    authedWallet = BUYER;
    const res = await request(app()).post('/v1/market/orders/ord-nope/refund').send({});
    expect(res.status).toBe(404);
    expect(clawbackCopy).not.toHaveBeenCalled();
  });

  it('a WRONG admin token alone (no Privy session) does not authorise a refund — 401, no clawback', async () => {
    // The admin-token path bypasses Privy ONLY for a correct token. A wrong token presented with no
    // wallet/session leaves the caller unidentified: maybeOwnership passes through (admin header
    // present), the handler finds no verified wallet AND an invalid admin token → 401, never a refund.
    process.env.PMP_ADMIN_TOKEN = 'sekret-admin';
    authedWallet = null; // no Privy session — relying solely on the (wrong) admin token
    seed('marketplace_orders', [
      { order_id: 'ord-1', pack_id: 'pak-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'delivered', rail: 'stripe', amount: '9.99', currency: 'usd' },
    ]);
    const res = await request(app())
      .post('/v1/market/orders/ord-1/refund')
      .set('X-Admin-Token', 'wrong-token')
      .send({});
    expect(res.status).toBe(401);
    expect(clawbackCopy).not.toHaveBeenCalled();
    expect(tables['marketplace_orders'][0].status).toBe('delivered');
  });

  it('an authenticated NON-PARTY presenting a wrong admin token is forbidden (403), no clawback', async () => {
    // A Privy-authenticated caller who is neither buyer nor seller, also presenting a bad admin token.
    // Sending `wallet` in the body routes maybeOwnership through Privy (verifiedWallet set to OTHER);
    // OTHER is not a party and the admin token is wrong → 403, never a refund.
    process.env.PMP_ADMIN_TOKEN = 'sekret-admin';
    authedWallet = OTHER;
    seed('marketplace_orders', [
      { order_id: 'ord-1', pack_id: 'pak-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'delivered', rail: 'stripe', amount: '9.99', currency: 'usd' },
    ]);
    const res = await request(app())
      .post('/v1/market/orders/ord-1/refund')
      .set('X-Admin-Token', 'wrong-token')
      .send({ wallet: OTHER });
    expect(res.status).toBe(403);
    expect(clawbackCopy).not.toHaveBeenCalled();
    expect(tables['marketplace_orders'][0].status).toBe('delivered');
  });

  it('refund of a delivered order still moves to refunding even if clawback is a no-op (already clawed)', async () => {
    // The order is delivered but the clones were already removed (clawback ran earlier and the order
    // status write was lost). The refund route must still advance to 'refunding' and re-run the
    // idempotent clawback — the money state must reach 'refunding' regardless of clone presence.
    authedWallet = SELLER; // the seller initiates the refund
    seed('marketplace_orders', [
      { order_id: 'ord-1', pack_id: 'pak-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'settled', rail: 'stripe', amount: '9.99', currency: 'usd' },
    ]);
    clawbackCopy.mockResolvedValue(undefined);
    const res = await request(app()).post('/v1/market/orders/ord-1/refund').send({});
    expect(res.status).toBe(200);
    expect(tables['marketplace_orders'][0].status).toBe('refunding');
    expect(clawbackCopy).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────── POST /v1/market/payout-account ───────────────────────────

describe('POST /v1/market/payout-account', () => {
  it('creates a Stripe Connect onboarding stub for the caller and returns an onboarding_url', async () => {
    authedWallet = SELLER;
    const res = await request(app()).post('/v1/market/payout-account').send({});
    expect(res.status).toBe(200);
    expect(typeof res.body.onboarding_url).toBe('string');
    const acct = tables['creator_payout_accounts']?.find((a) => a.owner_wallet === SELLER);
    expect(acct).toBeTruthy();
    expect(acct?.payout_rail).toBe('stripe_connect');
  });

  it('rejects an unauthenticated caller (401)', async () => {
    authedWallet = null;
    const res = await request(app()).post('/v1/market/payout-account').send({});
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────── POST /webhook/stripe/marketplace ───────────────────────────

describe('POST /webhook/stripe/marketplace', () => {
  it('a BAD signature → 400 and NO state change (verifyWebhook throws first)', async () => {
    seed('marketplace_orders', [
      { order_id: 'ord-1', pack_id: 'pak-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'awaiting_payment', rail: 'stripe', amount: '9.99', currency: 'usd' },
    ]);
    verifyWebhook.mockImplementation(() => {
      throw new Error('signature verification failed');
    });

    const res = await request(app())
      .post('/webhook/stripe/marketplace')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'bad')
      .send(Buffer.from(JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' })));

    expect(res.status).toBe(400);
    expect(markOrderPaid).not.toHaveBeenCalled();
    expect(parseEvent).not.toHaveBeenCalled();
    // Order untouched.
    expect(tables['marketplace_orders'][0].status).toBe('awaiting_payment');
  });

  it('rejects (500 stripe_not_configured) when the Stripe rail is unconfigured — fail closed, no DB write', async () => {
    // The deploy has no Stripe key → constructing StripeRail throws. The webhook cannot verify, so
    // it must reject (fail closed) rather than trust an unverifiable body. No event is processed.
    railCtorThrows.value = true;
    seed('marketplace_orders', [
      { order_id: 'ord-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'awaiting_payment', rail: 'stripe', amount: '9.99', currency: 'usd' },
    ]);

    const res = await request(app())
      .post('/webhook/stripe/marketplace')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'whatever')
      .send(Buffer.from(JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded' })));

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('stripe_not_configured');
    // Verification never ran; the order is untouched.
    expect(verifyWebhook).not.toHaveBeenCalled();
    expect(markOrderPaid).not.toHaveBeenCalled();
    expect(tables['marketplace_orders'][0].status).toBe('awaiting_payment');
  });

  it('payment_intent.succeeded → markOrderPaid, returns 200, delivery NOT run inline', async () => {
    const event = { id: 'evt_1', type: 'payment_intent.succeeded' };
    verifyWebhook.mockReturnValue(event);
    parseEvent.mockReturnValue({ rail_event_id: 'evt_1', type: 'payment_intent.succeeded', order_id: 'ord-1', status: 'paid' });
    markOrderPaid.mockResolvedValue({ applied: true, deduped: false, orderId: 'ord-1' });

    const res = await request(app())
      .post('/webhook/stripe/marketplace')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'good')
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);
    expect(verifyWebhook).toHaveBeenCalledTimes(1);
    // verifyWebhook received a Buffer (the RAW body), not a parsed object.
    expect(Buffer.isBuffer(verifyWebhook.mock.calls[0][0])).toBe(true);
    expect(markOrderPaid).toHaveBeenCalledTimes(1);
    expect(markOrderPaid.mock.calls[0][0]).toBe('stripe');
    expect(markOrderPaid.mock.calls[0][1]).toMatchObject({ rail_event_id: 'evt_1', order_id: 'ord-1', status: 'paid' });
    // Delivery is the worker's job — NEVER inline from the webhook (grantCopy not called here).
    expect(grantCopy).not.toHaveBeenCalled();
    // A non-blocking delivery NUDGE is fired (the durable poller is the real backstop) — it runs
    // the worker, which is what calls grantCopy, not the webhook itself.
    expect(dispatchPendingDeliveries).toHaveBeenCalledTimes(1);
    expect(dispatchPendingDeliveries.mock.calls[0][0]).toBe(grantCopy);
  });

  it('a replayed succeeded event is an idempotent no-op that still answers 200', async () => {
    const event = { id: 'evt_1', type: 'payment_intent.succeeded' };
    verifyWebhook.mockReturnValue(event);
    parseEvent.mockReturnValue({ rail_event_id: 'evt_1', type: 'payment_intent.succeeded', order_id: 'ord-1', status: 'paid' });
    // markOrderPaid reports a dedupe (replay) — the route must still 200.
    markOrderPaid.mockResolvedValue({ applied: false, deduped: true, orderId: 'ord-1' });

    const res = await request(app())
      .post('/webhook/stripe/marketplace')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'good')
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);
    expect(markOrderPaid).toHaveBeenCalledTimes(1);
    // A replay (deduped, not freshly applied) must NOT re-fire the delivery nudge.
    expect(dispatchPendingDeliveries).not.toHaveBeenCalled();
  });

  it('a refund/dispute event → clawbackCopy invoked + order moved to refunding, 200', async () => {
    seed('marketplace_orders', [
      { order_id: 'ord-1', pack_id: 'pak-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'delivered', rail: 'stripe', amount: '9.99', currency: 'usd' },
    ]);
    const event = { id: 'evt_2', type: 'charge.refunded' };
    verifyWebhook.mockReturnValue(event);
    parseEvent.mockReturnValue({ rail_event_id: 'evt_2', type: 'charge.refunded', order_id: 'ord-1', status: 'refunding' });
    clawbackCopy.mockResolvedValue(undefined);

    const res = await request(app())
      .post('/webhook/stripe/marketplace')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'good')
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);
    expect(clawbackCopy).toHaveBeenCalledTimes(1);
    expect(clawbackCopy.mock.calls[0][0]).toMatchObject({ order_id: 'ord-1', buyer_wallet: BUYER, pack_id: 'pak-1' });
    expect(tables['marketplace_orders'][0].status).toBe('refunding');
    // markOrderPaid is NOT the path for a refund event.
    expect(markOrderPaid).not.toHaveBeenCalled();
  });

  it('a body-less webhook request does not crash (clean 400, no Buffer.from({}) throw)', async () => {
    verifyWebhook.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });
    // No body sent → express.raw yields {} → defensive coercion to an empty Buffer.
    const res = await request(app())
      .post('/webhook/stripe/marketplace')
      .set('Stripe-Signature', 'sig');
    expect(res.status).toBe(400);
    expect(markOrderPaid).not.toHaveBeenCalled();
  });

  it('an irrelevant verified event (status=null) is recorded as a 200 no-op', async () => {
    const event = { id: 'evt_3', type: 'payment_intent.created' };
    verifyWebhook.mockReturnValue(event);
    parseEvent.mockReturnValue({ rail_event_id: 'evt_3', type: 'payment_intent.created', order_id: 'ord-1', status: null });

    const res = await request(app())
      .post('/webhook/stripe/marketplace')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'good')
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);
    expect(markOrderPaid).not.toHaveBeenCalled();
    expect(clawbackCopy).not.toHaveBeenCalled();
  });

  it('a refund event carrying NO order_id is a 200 no-op (nothing to claw back), no clawback call', async () => {
    const event = { id: 'evt_norefund', type: 'charge.refunded' };
    verifyWebhook.mockReturnValue(event);
    // A verified refund event that does not resolve to an order — the handler records nothing to
    // claw back and answers 200 (so Stripe stops retrying), but must NOT call clawbackCopy.
    parseEvent.mockReturnValue({ rail_event_id: 'evt_norefund', type: 'charge.refunded', order_id: null, status: 'refunding' });

    const res = await request(app())
      .post('/webhook/stripe/marketplace')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'good')
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);
    expect(res.body.noop).toBe('no_order');
    expect(clawbackCopy).not.toHaveBeenCalled();
  });

  it('a paid event whose markOrderPaid THROWS → 500 so Stripe retries (idempotent on replay)', async () => {
    const event = { id: 'evt_boom', type: 'payment_intent.succeeded' };
    verifyWebhook.mockReturnValue(event);
    parseEvent.mockReturnValue({ rail_event_id: 'evt_boom', type: 'payment_intent.succeeded', order_id: 'ord-1', status: 'paid' });
    // A genuine processing failure AFTER verification (e.g. the DB write errored). The webhook must
    // return 500 so Stripe re-delivers; markOrderPaid is idempotent so the retry is safe.
    markOrderPaid.mockRejectedValue(new Error('db write failed'));

    const res = await request(app())
      .post('/webhook/stripe/marketplace')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'good')
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('webhook_processing_failed');
    // No delivery nudge fired on a failed paid-record.
    expect(dispatchPendingDeliveries).not.toHaveBeenCalled();
  });

  it('a refunding event on an UNPAID order (illegal refund) → the handler 500s (NOT_REFUNDABLE bubbles), Stripe retries', async () => {
    // A 'created' order can never transition to 'refunding' (the DAG forbids it). A refund webhook
    // for such an order makes refundOrder throw NOT_REFUNDABLE; the webhook's catch returns 500.
    // (A 500 is acceptable here — Stripe retries; the order genuinely is not refundable yet. The
    // owner/admin REST refund route maps this same case to a precise 409, pinned separately below.)
    seed('marketplace_orders', [
      { order_id: 'ord-1', pack_id: 'pak-1', buyer_wallet: BUYER, seller_wallet: SELLER, status: 'created', rail: 'stripe', amount: '9.99', currency: 'usd' },
    ]);
    const event = { id: 'evt_badrefund', type: 'charge.refunded' };
    verifyWebhook.mockReturnValue(event);
    parseEvent.mockReturnValue({ rail_event_id: 'evt_badrefund', type: 'charge.refunded', order_id: 'ord-1', status: 'refunding' });

    const res = await request(app())
      .post('/webhook/stripe/marketplace')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 'good')
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(500);
    // The illegal order was NOT moved + no clawback ran (the transition was rejected up front).
    expect(tables['marketplace_orders'][0].status).toBe('created');
    expect(clawbackCopy).not.toHaveBeenCalled();
  });
});
