/**
 * Part B END-TO-END integration test — the full copy purchase → delivery → unlock → refund path.
 *
 * Tradeable Memory Packs — Slice 1, Part B chunk 3, Task 3 (partb-integration).
 * Spec: docs/superpowers/specs/2026-06-18-tradeable-memory-packs-design.md (§3E, §00 M6/M10/B2).
 *
 * MONEY CODE. Unlike marketplace-payments.routes.test.ts (which unit-mocks every payments lib as
 * a bare spy to isolate the HTTP wiring), THIS test drives the REAL Part B machine end to end and
 * only mocks the two genuine externals:
 *
 *   - getDb()        → a faithful in-memory Supabase that enforces the SAME two UNIQUE indexes the
 *                      idempotency guarantees rest on (uq_pay_events_dedup on
 *                      marketplace_payment_events(rail, rail_event_id) and
 *                      UNIQUE(pack_id, holder_wallet, grant_kind) on pack_entitlements), plus the
 *                      JSONB `.contains` / `.delete` / BIGSERIAL auto-id that grantCopy + clawback
 *                      actually use. Migration 032 column shapes.
 *   - stripe-rail    → verifyWebhook / parseEvent / createIntent (no real Stripe, no network).
 *
 * REAL under test: createOrder, the order-status DAG, markOrderPaid, dispatchPendingDeliveries,
 * grantCopy (clone members + entitlement), hasActiveCopyEntitlement (the copy unlock gate),
 * refundOrder + clawbackCopy, and the two HTTP routers (webhook + REST).
 *
 * The path asserted, in order:
 *   1. List a clean knowledge pack (Part A leaves it status='listed'). Buyer POSTs /v1/market/orders
 *      → real createOrder inserts the row, createIntent returns a client_secret, order → awaiting_payment.
 *   2. BEFORE payment: hasActiveCopyEntitlement(pack, buyer) is FALSE → a copy unlock would be 403.
 *   3. Stripe fires payment_intent.succeeded → the webhook VERIFIES, markOrderPaid advances the
 *      order to 'paid' (state only — delivery NEVER inline), 200.
 *   4. The durable delivery poller sweep runs grantCopy → buyer's brain gets cloned member memories
 *      tagged imported_from_pack + an ACTIVE copy_license entitlement; order → delivered.
 *   5. AFTER delivery: hasActiveCopyEntitlement(pack, buyer) is TRUE → the copy unlock gate authorises.
 *   6. IDEMPOTENCY: replaying the SAME succeeded webhook is a 200 no-op; a second poller sweep does
 *      NOT re-clone and does NOT mint a second entitlement (the DB UNIQUE is the backstop).
 *   7. REFUND: charge.refunded webhook → refundOrder advances 'refunding' + clawbackCopy DELETES the
 *      cloned rows and flips the entitlement to 'refunded'.
 *   8. AFTER refund: hasActiveCopyEntitlement(pack, buyer) is FALSE again → the copy unlock gate now
 *      DENIES (403). The buyer's cloned memories are gone (no free pack via chargeback — M10).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── Logger (quiet) ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── Auth injection — flip `authedWallet` per request (the buyer is authed for /orders). ──
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
vi.mock('@clude/brain/auth/require-ownership', () => ({
  requireOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
  optionalOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── Encryption keys — the pack under test is PLAINTEXT (no provider wraps), so grantCopy never
//    loads the provider keypair. Stub it anyway so an accidental encrypted path fails loudly
//    rather than reaching a real keystore. ──
vi.mock('@clude/shared/core/encryption-keys', () => ({
  loadProviderKeypair: () => {
    throw new Error('provider keypair not available in integration test (pack should be plaintext)');
  },
}));
// memory-envelope is only reached for encrypted packs; stub to no-ops for safety.
vi.mock('@clude/shared/core/memory-envelope', () => ({
  wrapDek: () => ({ wrapped: 'x', wrapPubkey: 'y' }),
  unwrapDek: () => new Uint8Array(32),
}));

// ── stripe-rail — the only real external. verify/parse/createIntent are driven per test. The
//    webhook constructs `new StripeRail()`, so the class must be constructible with no key. ──
const { verifyWebhook, parseEvent, createIntent } = vi.hoisted(() => ({
  verifyWebhook: vi.fn(),
  parseEvent: vi.fn(),
  createIntent: vi.fn(),
}));
vi.mock('../../lib/payments/stripe-rail.js', () => ({
  StripeRail: class {
    name = 'stripe' as const;
    verifyWebhook = verifyWebhook;
    parseEvent = parseEvent;
    createIntent = createIntent;
  },
}));

// ────────────────────────────────────────────────────────────────────────────────────────────
//  Faithful in-memory Supabase
//
//  Supports exactly the operators the REAL Part B libs use:
//    .select(cols?) .eq .in .contains .order .limit .maybeSingle .single .insert .update
//    .delete .upsert  and thenable terminal.
//  Enforces:
//    - BIGSERIAL auto-id on `memories` inserts (grantCopy reads the new id back via .single()).
//    - the two UNIQUE indexes that the idempotency guarantees depend on, raising { code: '23505' }:
//        marketplace_payment_events(rail, rail_event_id)
//        pack_entitlements(pack_id, holder_wallet, grant_kind)
//    - JSONB `@>` subset semantics for `.contains('metadata', {...})`.
// ────────────────────────────────────────────────────────────────────────────────────────────
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
let serialSeq = 1000;

/** UNIQUE indexes to enforce, as the column-tuples that must be distinct per table. */
const UNIQUE_INDEXES: Record<string, string[][]> = {
  marketplace_payment_events: [['rail', 'rail_event_id']],
  pack_entitlements: [['pack_id', 'holder_wallet', 'grant_kind']],
};

function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  serialSeq = 1000;
}
function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}

/** True iff `subset` ⊆ `target` (JSONB @> shallow semantics — enough for the keys Part B uses). */
function jsonbContains(target: unknown, subset: Record<string, unknown>): boolean {
  if (target == null || typeof target !== 'object') return false;
  const t = target as Record<string, unknown>;
  return Object.entries(subset).every(([k, v]) => t[k] === v);
}

interface Filter {
  kind: 'eq' | 'in' | 'contains';
  col: string;
  val?: any;
  vals?: any[];
  subset?: Record<string, unknown>;
}
function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((row) =>
    filters.every((f) => {
      if (f.kind === 'eq') return row[f.col] === f.val;
      if (f.kind === 'in') return (f.vals ?? []).includes(row[f.col]);
      if (f.kind === 'contains') return jsonbContains(row[f.col], f.subset ?? {});
      return true;
    }),
  );
}

/** Does inserting `row` into `table` collide with an existing row on any UNIQUE index? */
function violatesUnique(table: string, row: Row): boolean {
  const indexes = UNIQUE_INDEXES[table];
  if (!indexes) return false;
  const existing = tables[table] ?? [];
  return indexes.some((cols) =>
    existing.some((e) => cols.every((c) => e[c] === row[c])),
  );
}

function makeChain(table: string) {
  const filters: Filter[] = [];
  let pendingInsert: Row[] | null = null;
  let pendingUpdate: Row | null = null;
  let pendingDelete = false;
  let limitN: number | null = null;

  const settle = (): Promise<{ data: any; error: any }> => {
    // INSERT (with UNIQUE enforcement + BIGSERIAL id on `memories`).
    if (pendingInsert) {
      const rows = pendingInsert;
      pendingInsert = null;
      const stored: Row[] = [];
      for (const r of rows) {
        if (violatesUnique(table, r)) {
          return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key' } });
        }
        const row = { ...r };
        if (table === 'memories' && row.id == null) row.id = ++serialSeq;
        (tables[table] ??= []).push(row);
        stored.push({ ...row });
      }
      return Promise.resolve({ data: stored.length === 1 ? stored[0] : stored, error: null });
    }
    // UPDATE.
    if (pendingUpdate) {
      const patch = pendingUpdate;
      pendingUpdate = null;
      const matched = applyFilters(tables[table] ?? [], filters);
      for (const row of matched) Object.assign(row, patch);
      return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null });
    }
    // DELETE.
    if (pendingDelete) {
      pendingDelete = false;
      const all = tables[table] ?? [];
      const matched = applyFilters(all, filters);
      const matchedSet = new Set(matched);
      tables[table] = all.filter((r) => !matchedSet.has(r));
      return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null });
    }
    // SELECT.
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
    contains: (col: string, subset: Record<string, unknown>) => {
      filters.push({ kind: 'contains', col, subset });
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
    delete: () => {
      pendingDelete = true;
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

// ── Real modules under test (imported AFTER the mocks above are registered). ──
import { packMarketplacePaymentsRoutes, packMarketplaceStripeWebhookRoutes } from '../marketplace-payments.routes.js';
import { runDeliverySweepOnce } from '../../lib/payments/marketplace-delivery-poller.js';
import { grantCopy } from '../../lib/payments/grant-copy.js';
import { hasActiveCopyEntitlement } from '../../lib/payments/entitlement-gate.js';

const BUYER = 'BuYeRwallet11111111111111111111111111111111';
const SELLER = 'SeLLeRwallet2222222222222222222222222222222';
const PACK = 'pak-knowledge-1';
const LISTING = 'lst-knowledge-1';

/** App in PRODUCTION mount order: the raw-body webhook BEFORE express.json(), then the REST router. */
function app() {
  const a = express();
  a.use(packMarketplaceStripeWebhookRoutes());
  a.use(express.json());
  a.use(packMarketplacePaymentsRoutes());
  return a;
}

/**
 * Seed a CLEAN knowledge pack exactly as Part A would leave it: a listed copy listing, a
 * tokenised+sale_mode='copy' memory_packs row, a stripe price (999c = $9.99), and two PLAINTEXT
 * member memories owned by the SELLER (the pack author).
 */
function seedCleanKnowledgePack() {
  seed('pack_listings', [
    {
      listing_id: LISTING,
      pack_id: PACK,
      seller_wallet: SELLER,
      title: 'Solana Trading Notes',
      license_type: 'copy',
      status: 'listed',
      supply_kind: 'unlimited',
      supply_total: null,
      supply_sold: 0,
    },
  ]);
  seed('pack_listing_prices', [
    { listing_id: LISTING, rail: 'stripe', amount: '999', currency: 'usd', decimals: 2, enabled: true },
  ]);
  // memory_packs: author_wallet is the namespace grantCopy clones FROM; sale_mode='copy' is the gate.
  seed('memory_packs', [
    {
      pack_id: PACK,
      author_wallet: SELLER,
      name: 'Solana Trading Notes',
      version: '1.0.0',
      memory_count: 2,
      merkle_root: 'root-abc',
      pack_token_address: 'TokenMintAddr1111111111111111111111111111',
      sale_mode: 'copy',
    },
  ]);
  // Two clean (plaintext) member memories owned by the author.
  seed('memories', [
    {
      id: 1,
      memory_type: 'semantic',
      content: 'Liquidity dries up on weekends; size down.',
      summary: 'weekend liquidity',
      tags: ['trading'],
      concepts: ['liquidity'],
      emotional_valence: 0,
      importance: 0.7,
      source: 'author-note',
      related_user: null,
      related_wallet: null,
      metadata: { topic: 'liquidity' },
      decay_factor: 1.0,
      encrypted: false,
      encryption_pubkey: null,
      event_date: null,
      event_date_precision: null,
      owner_wallet: SELLER,
    },
    {
      id: 2,
      memory_type: 'procedural',
      content: 'Ladder limit orders rather than market into thin books.',
      summary: 'ladder orders',
      tags: ['trading'],
      concepts: ['execution'],
      emotional_valence: 0,
      importance: 0.8,
      source: 'author-note',
      related_user: null,
      related_wallet: null,
      metadata: { topic: 'execution' },
      decay_factor: 1.0,
      encrypted: false,
      encryption_pubkey: null,
      event_date: null,
      event_date_precision: null,
      owner_wallet: SELLER,
    },
  ]);
  // memory_pack_contents: which memories are members + leaf order.
  seed('memory_pack_contents', [
    { pack_id: PACK, memory_id: 1, leaf_index: 0, content_hash: 'h0' },
    { pack_id: PACK, memory_id: 2, leaf_index: 1, content_hash: 'h1' },
  ]);
  // No provider DEK wraps → grantCopy treats the pack as plaintext.
}

/** Helper: the buyer's cloned member memories (owner=buyer, tagged imported_from_pack). */
function buyerClones(): Row[] {
  return (tables['memories'] ?? []).filter(
    (m) => m.owner_wallet === BUYER && jsonbContains(m.metadata, { imported_from_pack: PACK }),
  );
}
/** Helper: the buyer's entitlement rows for this pack. */
function buyerEntitlements(): Row[] {
  return (tables['pack_entitlements'] ?? []).filter(
    (e) => e.holder_wallet === BUYER && e.pack_id === PACK && e.grant_kind === 'copy_license',
  );
}

/** Drive the create-order route as the buyer. Returns the supertest response. */
async function createOrderViaApi(clientToken: string) {
  authedWallet = BUYER;
  createIntent.mockResolvedValue({ rail_ref: 'pi_int_1', client_secret: 'pi_int_1_secret' });
  const res = await request(app())
    .post('/v1/market/orders')
    .send({ listing_id: LISTING, rail: 'stripe', client_token: clientToken });
  authedWallet = null;
  return res;
}

/** Fire a verified Stripe webhook with the given normalised parse result. */
async function fireWebhook(eventId: string, type: string, status: string | null, orderId: string | null) {
  const event = { id: eventId, type };
  verifyWebhook.mockReturnValue(event);
  parseEvent.mockReturnValue({ rail_event_id: eventId, type, order_id: orderId, status });
  return request(app())
    .post('/webhook/stripe/marketplace')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', 'good')
    .send(Buffer.from(JSON.stringify(event)));
}

beforeEach(() => {
  resetDb();
  authedWallet = null;
  verifyWebhook.mockReset();
  parseEvent.mockReset();
  createIntent.mockReset();
  delete process.env.PMP_ADMIN_TOKEN;
});

// ════════════════════════════════════════════════════════════════════════════════════════════
//  FULL COPY PATH — purchase → pay → deliver → unlock-allowed
// ════════════════════════════════════════════════════════════════════════════════════════════

describe('Part B copy path — purchase → webhook → delivery → entitlement', () => {
  it('lists a clean pack, creates an order, and returns a client_secret', async () => {
    seedCleanKnowledgePack();

    const res = await createOrderViaApi('ct-buy-1');

    expect(res.status).toBe(201);
    expect(typeof res.body.order_id).toBe('string');
    expect(res.body.client_secret).toBe('pi_int_1_secret');

    // The REAL createOrder inserted the row; it is awaiting_payment with the rail_ref persisted.
    const orders = tables['marketplace_orders'] ?? [];
    expect(orders).toHaveLength(1);
    expect(orders[0].buyer_wallet).toBe(BUYER);
    expect(orders[0].seller_wallet).toBe(SELLER);
    expect(orders[0].pack_id).toBe(PACK);
    expect(orders[0].amount).toBe('9.99'); // 999c / decimals=2, server-priced (buyer never supplies)
    expect(orders[0].status).toBe('awaiting_payment');
    expect(orders[0].rail_ref).toBe('pi_int_1');
  });

  it('before payment the copy unlock gate DENIES (no active entitlement)', async () => {
    seedCleanKnowledgePack();
    await createOrderViaApi('ct-buy-1');

    // hasActiveCopyEntitlement is the exact authority pmp-packs /unlock consults for sale_mode='copy'.
    await expect(hasActiveCopyEntitlement(PACK, BUYER)).resolves.toBe(false);
    // And nothing has been cloned into the buyer's brain yet.
    expect(buyerClones()).toHaveLength(0);
  });

  it('payment_intent.succeeded → markOrderPaid records the event + advances the order off STATE (M6)', async () => {
    seedCleanKnowledgePack();
    await createOrderViaApi('ct-buy-1');
    const orderId = tables['marketplace_orders'][0].order_id as string;

    const res = await fireWebhook('evt_paid_1', 'payment_intent.succeeded', 'paid', orderId);

    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);

    // markOrderPaid advanced the order off RECORDED STATE (paid_at stamped) — the M6 guarantee that
    // delivery is driven from persisted order state, never lost. The order left 'awaiting_payment'.
    const order = tables['marketplace_orders'][0];
    expect(order.paid_at).toBeTruthy();
    expect(order.status).not.toBe('awaiting_payment');
    // It reached at least 'paid'; the route's NON-blocking post-ack delivery nudge (the real
    // dispatchPendingDeliveries(grantCopy)) may already have driven it on to 'delivered' in-process —
    // both are valid M6 progress. (That the webhook never BLOCKS on / awaits delivery inline is
    // pinned deterministically by the bare-spy unit suite, marketplace-payments.routes.test.ts.)
    expect(['paid', 'delivering', 'delivered']).toContain(order.status);
    // The verified event is recorded exactly once for dedupe.
    expect((tables['marketplace_payment_events'] ?? []).filter((e) => e.rail_event_id === 'evt_paid_1')).toHaveLength(1);
  });

  it('the delivery poller runs grantCopy → buyer gets cloned memories + an active entitlement', async () => {
    seedCleanKnowledgePack();
    await createOrderViaApi('ct-buy-1');
    const orderId = tables['marketplace_orders'][0].order_id as string;
    await fireWebhook('evt_paid_1', 'payment_intent.succeeded', 'paid', orderId);

    // The DURABLE backstop: one sweep of the real poller, delivering with the real grantCopy.
    await runDeliverySweepOnce(grantCopy);

    // Buyer's brain now holds BOTH member memories, cloned into their namespace + tagged.
    const clones = buyerClones();
    expect(clones).toHaveLength(2);
    const contents = clones.map((c) => c.content).sort();
    expect(contents).toEqual(
      [
        'Ladder limit orders rather than market into thin books.',
        'Liquidity dries up on weekends; size down.',
      ].sort(),
    );
    // Clones carry BOTH provenance keys (imported_from_pack + source_order_id) that the M10 clawback keys off.
    for (const c of clones) {
      expect(c.owner_wallet).toBe(BUYER);
      expect(c.metadata.imported_from_pack).toBe(PACK);
      expect(c.metadata.source_order_id).toBe(orderId);
      expect(c.tags).toContain(`imported_from_pack:${PACK}`);
      // Fresh BIGSERIAL ids — NOT the author's source ids 1/2.
      expect(c.id).toBeGreaterThan(1000);
    }
    // The creator's SOURCE memories are untouched (provenance = not DRM; seller keeps their copy).
    const authorMems = (tables['memories'] ?? []).filter((m) => m.owner_wallet === SELLER);
    expect(authorMems).toHaveLength(2);

    // An ACTIVE copy_license entitlement was written — the sole copy-unlock authority.
    const ents = buyerEntitlements();
    expect(ents).toHaveLength(1);
    expect(ents[0].status).toBe('active');
    expect(ents[0].order_id).toBe(orderId);
    expect(ents[0].payment_rail).toBe('stripe');

    // Order completed delivering → delivered.
    expect(tables['marketplace_orders'][0].status).toBe('delivered');
    expect(tables['marketplace_orders'][0].delivered_at).toBeTruthy();
  });

  it('M6 durability: an order left PAID by a crash (no nudge) is delivered by the poller alone', async () => {
    seedCleanKnowledgePack();
    await createOrderViaApi('ct-buy-1');
    const order = tables['marketplace_orders'][0];
    // Simulate the crash window: the payment was captured + the order recorded 'paid' by
    // markOrderPaid, but the process died before the non-blocking nudge ran. Nothing delivered.
    order.status = 'paid';
    order.paid_at = new Date().toISOString();
    expect(buyerClones()).toHaveLength(0);

    // The durable interval poller's sweep is the ONLY thing that runs — and it must complete delivery.
    await runDeliverySweepOnce(grantCopy);

    expect(buyerClones()).toHaveLength(2);
    expect(buyerEntitlements()).toHaveLength(1);
    expect(buyerEntitlements()[0].status).toBe('active');
    expect(tables['marketplace_orders'][0].status).toBe('delivered');
  });

  it('M6 durability: an order stuck mid-delivery (DELIVERING) is resumed to delivered by the poller', async () => {
    seedCleanKnowledgePack();
    await createOrderViaApi('ct-buy-1');
    const order = tables['marketplace_orders'][0];
    // The recoverable state: a prior sweep claimed paid→delivering then crashed before finishing.
    order.status = 'delivering';
    order.paid_at = new Date().toISOString();

    await runDeliverySweepOnce(grantCopy);

    // Resumed: clones + entitlement landed and the order completed. grantCopy is idempotent, so a
    // partial prior run (none here) would not double-deliver either.
    expect(buyerClones()).toHaveLength(2);
    expect(buyerEntitlements()).toHaveLength(1);
    expect(tables['marketplace_orders'][0].status).toBe('delivered');
  });

  it('AFTER delivery the copy unlock gate ALLOWS (active entitlement present)', async () => {
    seedCleanKnowledgePack();
    await createOrderViaApi('ct-buy-1');
    const orderId = tables['marketplace_orders'][0].order_id as string;
    await fireWebhook('evt_paid_1', 'payment_intent.succeeded', 'paid', orderId);
    await runDeliverySweepOnce(grantCopy);

    // The same gate that returned false pre-payment now authorises the unlock for the buyer.
    await expect(hasActiveCopyEntitlement(PACK, BUYER)).resolves.toBe(true);
    // A different wallet is still denied (owner-scoped on holder_wallet).
    await expect(hasActiveCopyEntitlement(PACK, SELLER)).resolves.toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
//  IDEMPOTENCY — a replayed paid webhook + a second sweep never double-deliver
// ════════════════════════════════════════════════════════════════════════════════════════════

describe('Part B idempotency — replayed webhook / repeated sweep do not double-deliver', () => {
  it('a replayed succeeded webhook is a 200 no-op and does not re-advance or re-deliver', async () => {
    seedCleanKnowledgePack();
    await createOrderViaApi('ct-buy-1');
    const orderId = tables['marketplace_orders'][0].order_id as string;

    // First delivery.
    await fireWebhook('evt_paid_1', 'payment_intent.succeeded', 'paid', orderId);
    await runDeliverySweepOnce(grantCopy);
    expect(tables['marketplace_orders'][0].status).toBe('delivered');
    expect(buyerClones()).toHaveLength(2);
    expect(buyerEntitlements()).toHaveLength(1);

    // REPLAY the exact same Stripe event id → uq_pay_events_dedup makes it a recorded no-op.
    const replay = await fireWebhook('evt_paid_1', 'payment_intent.succeeded', 'paid', orderId);
    expect(replay.status).toBe(200);
    expect(replay.body.deduped).toBe(true);
    expect(replay.body.applied).toBe(false);

    // The order did NOT regress out of 'delivered'; only ONE payment-event row exists.
    expect(tables['marketplace_orders'][0].status).toBe('delivered');
    expect((tables['marketplace_payment_events'] ?? []).filter((e) => e.rail_event_id === 'evt_paid_1')).toHaveLength(1);
    // Still exactly 2 clones + 1 entitlement — no double delivery.
    expect(buyerClones()).toHaveLength(2);
    expect(buyerEntitlements()).toHaveLength(1);
  });

  it('a second poller sweep after delivery re-runs grantCopy as an idempotent no-op (no re-clone)', async () => {
    seedCleanKnowledgePack();
    await createOrderViaApi('ct-buy-1');
    const orderId = tables['marketplace_orders'][0].order_id as string;
    await fireWebhook('evt_paid_1', 'payment_intent.succeeded', 'paid', orderId);
    await runDeliverySweepOnce(grantCopy);

    const clonesAfterFirst = buyerClones().map((c) => c.id).sort();
    expect(clonesAfterFirst).toHaveLength(2);

    // A delivered order is no longer in paid/delivering, so the sweep picks nothing up. Even if it
    // did (crash-resume), grantCopy short-circuits on the active entitlement. Either way: no change.
    await runDeliverySweepOnce(grantCopy);

    expect(buyerClones().map((c) => c.id).sort()).toEqual(clonesAfterFirst);
    expect(buyerEntitlements()).toHaveLength(1);
  });

  it('grantCopy invoked twice directly for the same order does not clone twice or mint a 2nd entitlement', async () => {
    seedCleanKnowledgePack();
    await createOrderViaApi('ct-buy-1');
    const order = { ...tables['marketplace_orders'][0] } as any;

    await grantCopy({ ...order, status: 'delivering' });
    expect(buyerClones()).toHaveLength(2);
    expect(buyerEntitlements()).toHaveLength(1);

    // Re-invoke (simulates a crash-recovery re-delivery). The active-entitlement short-circuit
    // (and the UNIQUE backstop) keep it a clean no-op.
    await grantCopy({ ...order, status: 'delivering' });
    expect(buyerClones()).toHaveLength(2);
    expect(buyerEntitlements()).toHaveLength(1);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════
//  REFUND / CHARGEBACK — clawback deletes the clones + revokes the entitlement → unlock denied
// ════════════════════════════════════════════════════════════════════════════════════════════

describe('Part B refund path — clawback deletes clones + revokes entitlement (M10)', () => {
  /** Run the full buy→pay→deliver path and return the delivered order id. */
  async function buyAndDeliver(): Promise<string> {
    seedCleanKnowledgePack();
    await createOrderViaApi('ct-buy-1');
    const orderId = tables['marketplace_orders'][0].order_id as string;
    await fireWebhook('evt_paid_1', 'payment_intent.succeeded', 'paid', orderId);
    await runDeliverySweepOnce(grantCopy);
    return orderId;
  }

  it('charge.refunded webhook → order refunding + cloned rows deleted + entitlement refunded', async () => {
    const orderId = await buyAndDeliver();
    expect(buyerClones()).toHaveLength(2);
    expect(buyerEntitlements()[0].status).toBe('active');

    const res = await fireWebhook('evt_refund_1', 'charge.refunded', 'refunding', orderId);
    expect(res.status).toBe(200);

    // Order moved to 'refunding'.
    expect(tables['marketplace_orders'][0].status).toBe('refunding');
    // The cloned memories are DELETED from the buyer's brain (no free pack via chargeback — M10).
    expect(buyerClones()).toHaveLength(0);
    // The entitlement is flipped to 'refunded' with revoked_at stamped (not deleted — audit trail).
    const ents = buyerEntitlements();
    expect(ents).toHaveLength(1);
    expect(ents[0].status).toBe('refunded');
    expect(ents[0].revoked_at).toBeTruthy();
  });

  it('AFTER refund the copy unlock gate DENIES again (entitlement no longer active)', async () => {
    const orderId = await buyAndDeliver();
    await expect(hasActiveCopyEntitlement(PACK, BUYER)).resolves.toBe(true); // sanity: allowed pre-refund

    await fireWebhook('evt_refund_1', 'charge.refunded', 'refunding', orderId);

    // The gate that authorised the unlock now denies it — a copy unlock would return 403 not_entitled.
    await expect(hasActiveCopyEntitlement(PACK, BUYER)).resolves.toBe(false);
  });

  it('the refund clawback is idempotent: a replayed dispute event stays 200 and deletes nothing more', async () => {
    const orderId = await buyAndDeliver();

    // First refund event.
    await fireWebhook('evt_refund_1', 'charge.refunded', 'refunding', orderId);
    expect(buyerClones()).toHaveLength(0);
    expect(buyerEntitlements()[0].status).toBe('refunded');

    // A SECOND, distinct dispute event for the same order (Stripe can fire refund + dispute). The
    // order is already 'refunding' so refundOrder skips the transition but re-runs the (idempotent)
    // clawback: 0 clones to delete, the terminal 'refunded' re-written harmlessly.
    const replay = await fireWebhook('evt_refund_2', 'charge.dispute.created', 'refunding', orderId);
    expect(replay.status).toBe(200);
    expect(tables['marketplace_orders'][0].status).toBe('refunding');
    expect(buyerClones()).toHaveLength(0);
    expect(buyerEntitlements()).toHaveLength(1);
    expect(buyerEntitlements()[0].status).toBe('refunded');
  });

  it('clawback is ORDER-scoped: it deletes only THIS order’s clones, not a different order’s of the same pack', async () => {
    // Order A — delivered (2 clones, all stamped source_order_id = orderA).
    const orderA = await buyAndDeliver();
    expect(buyerClones()).toHaveLength(2);

    // A pre-existing clone of the SAME pack carrying a DIFFERENT order's provenance also sits in the
    // buyer's brain (e.g. an earlier purchase). The §00 M10 clawback keys off BOTH metadata keys
    // (imported_from_pack AND source_order_id), so refunding order A must NOT collaterally delete it.
    // (We do not seed a second pack_entitlements row — the table's UNIQUE(pack_id, holder_wallet,
    // grant_kind) permits only ONE copy_license grant per pack/holder; entitlement state is a single
    // shared row. The order-discrimination that matters here is on the CLONED MEMORIES.)
    const otherOrder = 'ord-earlier-buy';
    seed('memories', [
      {
        id: 5001,
        memory_type: 'semantic',
        content: 'An older clone of the same pack from a different order.',
        summary: 'older clone',
        tags: ['trading', `imported_from_pack:${PACK}`],
        metadata: { imported_from_pack: PACK, source_order_id: otherOrder },
        owner_wallet: BUYER,
      },
    ]);
    expect(buyerClones()).toHaveLength(3);

    // Refund ONLY order A.
    await fireWebhook('evt_refund_A', 'charge.refunded', 'refunding', orderA);

    // Order A's two clones are gone; the other order's clone survives (source_order_id discrimination
    // is REAL — not merely owner-scoping, since both clones share owner_wallet=BUYER and pack).
    const survivors = buyerClones();
    expect(survivors).toHaveLength(1);
    expect(survivors[0].metadata.source_order_id).toBe(otherOrder);
    expect(survivors[0].id).toBe(5001);
  });
});
