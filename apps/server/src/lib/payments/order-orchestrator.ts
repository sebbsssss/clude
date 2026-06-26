/**
 * Order orchestrator — durable order creation + the pure order-status DAG.
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 1), Task 2 (spec §3E + §00 M6).
 *
 * MONEY CODE. Two responsibilities, both load-bearing for the durable payment→delivery
 * path the §00 M6 correction mandates (delivery is driven off ORDER STATE, never an
 * in-process event):
 *
 *   createOrder — insert a `marketplace_orders` row, IDEMPOTENTLY on (buyer_wallet,
 *                 client_token). A retried intent collapses to the same row with no second
 *                 insert. The DB index uq_orders_idem (migration 032) is the backstop: even
 *                 if two concurrent requests both miss the pre-insert SELECT, the loser's
 *                 INSERT hits 23505 and we resolve to the winner's row. Result carries
 *                 `created` so the route can answer 200 vs 409 without ever double-charging.
 *
 *   the status DAG — `ORDER_STATUS_TRANSITIONS` + `canTransition`/`assertTransition`. The
 *                 ONLY sanctioned edges (created→awaiting_payment→paid→delivering→
 *                 delivered→settled, plus refund + failure/expiry branches). The delivery
 *                 worker (chunk 2) reads this to decide every hop; an illegal transition is
 *                 a programming error, surfaced loudly. Pure — no DB, no I/O, total over
 *                 every status — so it is exhaustively unit-testable.
 *
 * Owner-scoping note: `marketplace_orders` is a two-party table (buyer + seller). It is a
 * deliberate, documented departure from single-owner scoping (design §2); the route layer
 * filters by the relevant party and the table is never returned un-scoped.
 */

import { randomBytes } from 'node:crypto';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('order-orchestrator');

// ─────────── Order status DAG (M6) ───────────

/** The full lifecycle of a marketplace order, matching the 032_payments.sql CHECK enum. */
export type OrderStatus =
  | 'created'
  | 'awaiting_payment'
  | 'paid'
  | 'delivering'
  | 'delivered'
  | 'settled'
  | 'refunding'
  | 'refunded'
  | 'failed'
  | 'expired';

/**
 * The allowed forward edges, keyed by source status. Terminal states map to `[]`.
 *
 * The happy path (created→awaiting_payment→paid→delivering→delivered→settled) is the M6
 * progression the delivery worker walks; `paid` may NOT jump straight to `delivered` —
 * delivery must pass through `delivering` so a crash mid-delivery is resumable. The refund
 * branch (delivered/settled → refunding → refunded) carries the §00 M10 copy clawback.
 * Pre-delivery states may fail or expire. There are no backward edges and no self-loops.
 */
export const ORDER_STATUS_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  created: ['awaiting_payment', 'expired', 'failed'],
  awaiting_payment: ['paid', 'failed', 'expired'],
  paid: ['delivering', 'refunding', 'failed'],
  delivering: ['delivered', 'failed'],
  delivered: ['settled', 'refunding'],
  settled: ['refunding'],
  refunding: ['refunded', 'failed'],
  refunded: [],
  failed: [],
  expired: [],
} as const;

/** True iff `to` is a sanctioned next status from `from`. Pure + total. */
export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Assert a transition is legal; throw otherwise. The delivery worker calls this before every
 * status write so an illegal hop (a logic bug) can never silently corrupt the money state.
 */
export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal order transition: ${from} → ${to}`);
  }
}

// ─────────── Order creation ───────────

/** A marketplace order row, as persisted in `marketplace_orders`. */
export interface OrderRow {
  order_id: string;
  pack_id: string;
  listing_id: string | null;
  listing_kind: 'copy' | 'title';
  buyer_wallet: string | null;
  buyer_account_id: string | null;
  seller_wallet: string;
  rail: 'stripe' | 'solana' | 'base';
  currency: string;
  amount: string;
  fee_amount: string;
  payout_amount: string;
  status: OrderStatus;
  rail_ref: string | null;
  rail_tx: string | null;
  client_token: string;
  created_at: string;
  expires_at: string;
  metadata: Record<string, unknown>;
}

export interface CreateOrderInput {
  packId: string;
  listingId?: string | null;
  listingKind: 'copy' | 'title';
  /** Buyer wallet; null for keyless (email-only) buyers, who are scoped by buyer_account_id. */
  buyerWallet: string | null;
  buyerAccountId?: string | null;
  sellerWallet: string;
  rail: 'stripe' | 'solana' | 'base';
  currency: string;
  /** Decimal amount in the major currency unit, e.g. '9.99'. Must be > 0. */
  amount: string;
  feeAmount?: string;
  payoutAmount?: string;
  /** Caller-supplied idempotency key. Mandatory — the whole no-double-charge guarantee. */
  clientToken: string;
  /** Order intent lifetime in ms (default 1h). The sweeper expires stale unpaid intents. */
  ttlMs?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateOrderResult {
  order: OrderRow;
  /** true → a new row was inserted; false → an existing order was returned (idempotent hit). */
  created: boolean;
}

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

function generateOrderId(): string {
  return `ord-${randomBytes(4).toString('hex')}`;
}

/** Validate the amount is a positive decimal. Rejects '', '0', negatives, and non-numerics. */
function assertPositiveAmount(amount: string): void {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid order amount: ${JSON.stringify(amount)} (must be > 0)`);
  }
}

/** Fetch an existing order by its idempotency identity (buyer_wallet, client_token). */
async function findByIdempotency(
  buyerWallet: string | null,
  clientToken: string,
): Promise<OrderRow | null> {
  const db = getDb();
  const { data } = await db
    .from('marketplace_orders')
    .select('*')
    .eq('buyer_wallet', buyerWallet)
    .eq('client_token', clientToken)
    .maybeSingle();
  return (data as OrderRow | null) ?? null;
}

/**
 * Create an order, idempotently on (buyer_wallet, client_token).
 *
 * Flow:
 *   1. validate (positive amount, non-empty client_token) — BEFORE any DB write.
 *   2. pre-insert SELECT on the idempotency identity → existing? return it, created=false.
 *   3. INSERT. On 23505 (a concurrent insert won the race) → re-SELECT, return that row,
 *      created=false. Any other DB error throws.
 *
 * This never inserts a second row for the same idempotency identity, and never depends on
 * the SELECT in step 2 winning the race — the UNIQUE index is the real guarantee.
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  assertPositiveAmount(input.amount);
  if (!input.clientToken) {
    throw new Error('client_token is required (idempotency key)');
  }
  if (!input.sellerWallet) {
    throw new Error('seller_wallet is required');
  }

  // 1) Idempotency short-circuit.
  const existing = await findByIdempotency(input.buyerWallet, input.clientToken);
  if (existing) {
    log.info(
      { orderId: existing.order_id, clientToken: input.clientToken },
      'createOrder: idempotent hit (pre-insert SELECT)',
    );
    return { order: existing, created: false };
  }

  // 2) Build + insert.
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (input.ttlMs ?? DEFAULT_TTL_MS));
  const row: OrderRow = {
    order_id: generateOrderId(),
    pack_id: input.packId,
    listing_id: input.listingId ?? null,
    listing_kind: input.listingKind,
    buyer_wallet: input.buyerWallet,
    buyer_account_id: input.buyerAccountId ?? null,
    seller_wallet: input.sellerWallet,
    rail: input.rail,
    currency: input.currency,
    amount: input.amount,
    fee_amount: input.feeAmount ?? '0',
    payout_amount: input.payoutAmount ?? '0',
    status: 'created',
    rail_ref: null,
    rail_tx: null,
    client_token: input.clientToken,
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    metadata: input.metadata ?? {},
  };

  const db = getDb();
  const { data, error } = await db.from('marketplace_orders').insert(row).select('*').single();

  if (error) {
    // 23505 = the concurrent-insert race: another request created this exact order first.
    if ((error as { code?: string }).code === '23505') {
      const won = await findByIdempotency(input.buyerWallet, input.clientToken);
      if (won) {
        log.info(
          { orderId: won.order_id, clientToken: input.clientToken },
          'createOrder: idempotent hit (lost insert race → existing row)',
        );
        return { order: won, created: false };
      }
      // Unique violation but the row isn't findable — surface it rather than guess.
      log.error({ err: error, clientToken: input.clientToken }, 'createOrder: 23505 but no row found');
      throw new Error('order idempotency conflict could not be resolved');
    }
    log.error({ err: error, clientToken: input.clientToken }, 'createOrder: insert failed');
    throw new Error('failed to create order');
  }

  const created = (data as OrderRow | null) ?? row;
  log.info({ orderId: created.order_id, rail: created.rail }, 'createOrder: created');
  return { order: created, created: true };
}
