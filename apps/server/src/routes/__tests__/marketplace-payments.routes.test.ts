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
const { verifyWebhook, parseEvent, createIntent, createOrder, markOrderPaid, dispatchPendingDeliveries, grantCopy, clawbackCopy } =
  vi.hoisted(() => ({
    verifyWebhook: vi.fn(),
    parseEvent: vi.fn(),
    createIntent: vi.fn(),
    createOrder: vi.fn(),
    markOrderPaid: vi.fn(),
    dispatchPendingDeliveries: vi.fn(),
    grantCopy: vi.fn(),
    clawbackCopy: vi.fn(),
  }));

vi.mock('../../lib/payments/stripe-rail.js', () => ({
  StripeRail: class {
    name = 'stripe' as const;
    verifyWebhook = verifyWebhook;
    parseEvent = parseEvent;
    createIntent = createIntent;
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

  it('is idempotent: a replayed client_token returns the SAME order (no second create)', async () => {
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

    const first = await request(app())
      .post('/v1/market/orders')
      .send({ listing_id: 'lst-1', rail: 'stripe', client_token: 'ct-1' });
    const second = await request(app())
      .post('/v1/market/orders')
      .send({ listing_id: 'lst-1', rail: 'stripe', client_token: 'ct-1' });

    expect(first.body.order_id).toBe('ord-abc');
    expect(second.body.order_id).toBe('ord-abc');
    // Same client_secret on the replay (Stripe createIntent is idempotent on client_token).
    expect(second.body.client_secret).toBe('pi_123_secret_x');
    // createOrder called once per request, but it short-circuits idempotently in the orchestrator.
    expect(createOrder).toHaveBeenCalledTimes(2);
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
});
