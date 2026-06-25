/**
 * Marketplace PAYMENTS endpoints + the Stripe webhook (copy-license, Stripe rail).
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 3), Task 1 (spec §3E + §00 M6).
 *
 * MONEY CODE. The HTTP layer over the durable payment→delivery machine. The §00 M6 binding
 * correction governs the whole module: the webhook NEVER delivers inline. It verifies the
 * Stripe signature, records the order paid IDEMPOTENTLY, answers 200 fast, and lets a
 * separate worker (dispatchPendingDeliveries, driven off ORDER STATE) clone the pack. A
 * crash between webhook-ack and delivery can therefore never lose a paid-for pack.
 *
 * Two routers, deliberately split by body-parsing needs:
 *
 *   packMarketplaceStripeWebhookRoutes()  — POST /webhook/stripe/marketplace. Uses
 *       express.raw() at the router level so stripe.webhooks.constructEvent sees the EXACT
 *       bytes Stripe signed. MUST be mounted BEFORE the global express.json() (which would
 *       otherwise consume the stream and leave only a parsed object). Mirrors the proven
 *       topup webhook idiom but with Stripe's signature scheme.
 *
 *   packMarketplacePaymentsRoutes()       — the privy + ownership REST surface:
 *       POST /v1/market/orders             create order intent → { order_id, client_secret }
 *       GET  /v1/market/orders/:id         owner-scoped order state (buyer OR seller)
 *       POST /v1/market/orders/:id/refund  owner-or-admin → refunding + clawbackCopy
 *       POST /v1/market/payout-account     Stripe Connect onboarding stub
 *
 * Auth model:
 *   - Owner routes use requirePrivyAuth + requireOwnership (the FIXED pattern). `ownerFromReq`
 *     reads ONLY req.verifiedWallet — it NEVER trusts a client-supplied ?owner=, which was the
 *     impersonation hole. requireOwnership precedes every owner route.
 *   - The webhook is signature-authed (Stripe-Signature → stripe-rail.verifyWebhook). No privy.
 *   - The refund route additionally accepts a static X-Admin-Token (PMP_ADMIN_TOKEN) so support
 *     can refund on a buyer's behalf (mirrors pmp-admin.routes' admin gate).
 *
 * Owner-scoping: marketplace_orders is a two-party table (buyer + seller) — a documented
 * departure from single-owner scoping (design §2). Every order read/refund here filters by the
 * order id and then authorises the caller as buyer OR seller (or admin). The table is never
 * returned un-scoped. pack_listings / pack_listing_prices reads are server-trusted source of
 * truth for price + seller; the buyer never supplies an amount.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import express from 'express';
import { timingSafeEqual } from 'node:crypto';
import { getDb } from '@clude/shared/core/database';
import { requirePrivyAuth } from '@clude/brain/auth/privy-auth';
import { requireOwnership } from '@clude/brain/auth/require-ownership';
import { createChildLogger } from '@clude/shared/core/logger';
import { StripeRail } from '../lib/payments/stripe-rail.js';
import { createOrder, canTransition, type OrderRow } from '../lib/payments/order-orchestrator.js';
import { refundSolanaTitleSale } from '../lib/payments/solana-title-sale.js';
import { markOrderPaid, dispatchPendingDeliveries } from '../lib/payments/delivery-dispatcher.js';
import { grantCopy } from '../lib/payments/grant-copy.js';
import { clawbackCopy } from '../lib/payments/refund-clawback.js';

const log = createChildLogger('marketplace-payments-routes');

// The only rail wired in Slice 1. A non-stripe rail on /orders is refused (422) here.
const SUPPORTED_RAIL = 'stripe' as const;

interface ErrorBody {
  error: string;
  reason?: string;
  hint?: string;
}

/**
 * The wallet requireOwnership verified against the authenticated identity. NEVER a
 * client-supplied ?owner= (that was an impersonation hole). requireOwnership precedes
 * every route using this.
 */
function ownerFromReq(req: Request): string | null {
  return req.verifiedWallet ?? null;
}

function publicBaseUrl(req: Request): string {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? req.protocol;
  const host = req.headers['x-forwarded-host'] ?? req.headers.host;
  return `${proto}://${host}`;
}

/** Constant-time compare for the admin token (avoids leaking length/contents via timing). */
function adminTokenValid(provided: unknown): boolean {
  const expected = process.env.PMP_ADMIN_TOKEN;
  if (!expected) return false; // admin disabled unless explicitly configured
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Convert an integer minor-unit amount (e.g. 999 cents, `decimals`=2) to the decimal
 * major-unit STRING the orchestrator / rail expect (e.g. '9.99'). No float: we slice the
 * integer string at the decimal position so 999/2 → '9.99' exactly, never 9.9899999.
 */
function minorUnitsToMajorString(amount: string | number, decimals: number): string {
  const raw = String(amount).trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error(`invalid minor-unit amount: ${JSON.stringify(amount)}`);
  }
  if (decimals <= 0) return String(BigInt(raw)); // zero-decimal currency: already major
  const padded = raw.padStart(decimals + 1, '0'); // ensure at least one digit before the point
  const whole = padded.slice(0, padded.length - decimals);
  const frac = padded.slice(padded.length - decimals);
  return `${whole}.${frac}`;
}

interface ListingRow {
  listing_id: string;
  pack_id: string;
  seller_wallet: string;
  license_type: 'copy' | 'title';
  status: string;
  // Supply accounting — a limited/single listing has a finite supply_total; supply_sold is the
  // running count of CLAIMED units. NULL supply_total = unlimited (no cap). The order path must
  // read these to refuse / atomically claim against the cap, else a limited copy over-sells.
  supply_kind: 'unlimited' | 'limited' | 'single';
  supply_total: number | null;
  supply_sold: number;
}

interface PriceRow {
  listing_id: string;
  rail: string;
  amount: string | number;
  currency: string;
  decimals: number;
  enabled: boolean;
}

// ─────────────────────────── Webhook router (RAW body) ───────────────────────────

/**
 * Stripe webhook router — POST /webhook/stripe/marketplace. The express.raw() middleware MUST
 * see the request before the global express.json(), so mount THIS router before that parser.
 *
 * Flow: verify the signature off the RAW body (fail-closed; a bad/absent signature throws →
 * 400, no DB write). On the verified, normalised event:
 *   - status='paid'      → markOrderPaid (idempotent; a replay is a 200 no-op). NO inline
 *                          delivery — the worker delivers off order state (M6). A best-effort,
 *                          NON-blocking delivery nudge is kicked after the 200 ack.
 *   - status='refunding' → clawbackCopy + advance the order to 'refunding' (idempotent; M10).
 *   - status=null        → irrelevant event, recorded-only 200 no-op.
 */
export function packMarketplaceStripeWebhookRoutes(): Router {
  const router = Router();

  router.post(
    '/webhook/stripe/marketplace',
    // Raw body so Stripe's signature check sees the exact signed bytes. `type: '*/*'` captures
    // the body regardless of the Content-Type Stripe sends.
    express.raw({ type: '*/*' }),
    async (req: Request, res: Response) => {
      const sig = req.headers['stripe-signature'] as string | undefined;
      // express.raw yields a Buffer for a body, or {} for a body-less request. Coerce defensively:
      // a Buffer/string passes through; anything else becomes an empty Buffer, which verifyWebhook
      // rejects as a bad signature (clean 400) rather than throwing on Buffer.from({}).
      const rawBody: Buffer = Buffer.isBuffer(req.body)
        ? req.body
        : typeof req.body === 'string'
          ? Buffer.from(req.body)
          : Buffer.alloc(0);

      // 1) VERIFY FIRST — before any DB write (Risk R6). A forged/absent signature, or an
      //    unconfigured webhook secret, throws → reject. No event escapes unverified.
      let rail: StripeRail;
      try {
        rail = new StripeRail();
      } catch (err) {
        // Stripe not configured on this deploy — cannot verify, so reject (fail closed).
        log.error({ err }, 'stripe webhook: rail unconfigured, rejecting');
        res.status(500).json({ error: 'stripe_not_configured' } satisfies ErrorBody);
        return;
      }

      let parsed;
      try {
        const event = rail.verifyWebhook(rawBody, sig);
        parsed = rail.parseEvent(event);
      } catch (err) {
        log.warn({ err }, 'stripe webhook: signature verification failed');
        res.status(400).json({ error: 'invalid_signature' } satisfies ErrorBody);
        return;
      }

      try {
        // 2a) Paid: record idempotently, answer 200, let the worker deliver (M6). Never inline.
        if (parsed.status === 'paid') {
          const result = await markOrderPaid('stripe', parsed);
          // Best-effort, NON-blocking delivery nudge — the durable poller is the real backstop,
          // so we never await this and a failure here cannot fail the webhook ack.
          if (result.applied) {
            void dispatchDeliveryNudge();
          }
          res.status(200).json({ ok: true, applied: result.applied, deduped: result.deduped });
          return;
        }

        // 2b) Refund / dispute: revoke + delete the cloned copy, advance to 'refunding' (M10).
        if (parsed.status === 'refunding') {
          if (!parsed.order_id) {
            // A verified refund event with no resolvable order — record nothing to claw back.
            log.warn({ event: parsed.rail_event_id }, 'stripe webhook: refund event carries no order_id');
            res.status(200).json({ ok: true, noop: 'no_order' });
            return;
          }
          try {
            await refundOrder(parsed.order_id);
          } catch (refundErr) {
            // A title whose NFT already transferred can't be clawed back. ACK (200) so Stripe stops
            // retrying, and alert LOUDLY — a human must reconcile the seller's loss (the money moved on
            // Stripe's side; the on-chain title is gone). Other errors fall through to the 500 retry.
            if ((refundErr as { code?: string }).code === 'TITLE_FINAL') {
              log.error({ orderId: parsed.order_id, event: parsed.rail_event_id }, 'stripe webhook: TITLE_FINAL on refund — post-transfer chargeback needs MANUAL reconciliation');
              res.status(200).json({ ok: true, title_final: true });
              return;
            }
            throw refundErr;
          }
          res.status(200).json({ ok: true, refunded: true });
          return;
        }

        // 2c) Irrelevant verified event — recorded-only 200 no-op.
        res.status(200).json({ ok: true, ignored: parsed.type });
      } catch (err) {
        // A genuine processing error AFTER verification. Return 500 so Stripe retries the
        // delivery — markOrderPaid / refundOrder are idempotent, so a retry is safe.
        log.error({ err, event: parsed.rail_event_id }, 'stripe webhook: processing failed');
        res.status(500).json({ error: 'webhook_processing_failed' } satisfies ErrorBody);
      }
    },
  );

  return router;
}

/**
 * Fire one delivery sweep, non-blocking, swallowing errors. Called as a nudge after a paid
 * webhook so the buyer is served promptly without waiting for the next poll tick. The durable
 * interval poller (startMarketplaceDeliveryPoller) is the guarantee; this is only latency.
 */
function dispatchDeliveryNudge(): void {
  // Fire-and-forget: the durable interval poller is the real M6 backstop; this only trims
  // latency. Never awaited, errors swallowed — a nudge failure can't fail the webhook ack.
  Promise.resolve(dispatchPendingDeliveries(grantCopy)).catch((err) =>
    log.warn({ err }, 'marketplace: post-webhook delivery nudge failed (poller will retry)'),
  );
}

/**
 * Advance an order into 'refunding' (when legal) and run the copy clawback (M10). Shared by the
 * webhook refund path and the owner/admin refund route. Idempotent: an already-'refunding'
 * order skips the transition but still re-runs the (idempotent) clawback so a half-done unwind
 * completes. Returns the order's pre-state so the route can answer 404/409 precisely.
 */
async function refundOrder(orderId: string): Promise<{ found: boolean; transitioned: boolean; alreadyRefunding: boolean }> {
  const db = getDb();
  const { data, error } = await db
    .from('marketplace_orders')
    .select('*')
    .eq('order_id', orderId)
    .limit(1)
    .maybeSingle();
  if (error) {
    log.error({ err: error, orderId }, 'refundOrder: order lookup failed');
    throw new Error('failed to load order for refund');
  }
  const order = (data as OrderRow | null) ?? null;
  if (!order) return { found: false, transitioned: false, alreadyRefunding: false };

  // TITLE FINALITY (Phase 3): runs for EVERY title-order refund attempt — INCLUDING an already-'refunding'
  // one (Stripe retries the dispute/refund webhook), so a refund can never be re-confirmed after the
  // 1-of-1 has transferred on-chain. refundSolanaTitleSale THROWS TITLE_FINAL past the transfer, aborts an
  // in-flight pre-transfer saga, and is a no-op for a non-title order. title_sale_sagas is shared by the
  // Base + Solana title flows, so this guards both chains.
  if ((order as { listing_kind?: string | null }).listing_kind === 'title') {
    await refundSolanaTitleSale(db, orderId);
  }

  const status = order.status;
  const alreadyRefunding = status === 'refunding' || status === 'refunded';

  // Advance to 'refunding' only from a legal source state. The DAG allows
  // delivered/settled/paid → refunding. created/awaiting_payment/failed/expired cannot refund.
  let transitioned = false;
  if (!alreadyRefunding) {
    if (!canTransition(status, 'refunding')) {
      // Caller-facing precondition failure (e.g. refunding an unpaid order). No clawback.
      const e = new Error('not_refundable') as Error & { code?: string };
      e.code = 'NOT_REFUNDABLE';
      throw e;
    }
    const { error: updErr } = await db
      .from('marketplace_orders')
      .update({ status: 'refunding' })
      .eq('order_id', orderId)
      .eq('status', status); // guard: only move the row we just read
    if (updErr) {
      log.error({ err: updErr, orderId }, 'refundOrder: status update failed');
      throw new Error('failed to mark order refunding');
    }
    transitioned = true;
  }

  // Run the clawback (delete cloned imported_from_pack rows + revoke entitlement). Idempotent —
  // safe on a re-run / an already-refunding order.
  await clawbackCopy({ ...order, status: 'refunding' });

  return { found: true, transitioned, alreadyRefunding };
}

// ─────────────────────────── REST router (privy + ownership) ───────────────────────────

export function packMarketplacePaymentsRoutes(): Router {
  const router = Router();

  router.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Token');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  /**
   * POST /v1/market/orders — create an order intent for a listed copy pack.
   * Body: { listing_id, rail:'stripe', client_token }.
   * Loads the listing (must be status='listed'), reads the seller + price SERVER-SIDE
   * (the buyer never supplies an amount), creates the order idempotently on
   * (buyer, client_token), opens a Stripe PaymentIntent, persists rail_ref, advances the
   * order created → awaiting_payment, and returns { order_id, client_secret }.
   */
  router.post('/v1/market/orders', requirePrivyAuth, requireOwnership, async (req: Request, res: Response) => {
    const buyer = ownerFromReq(req);
    if (!buyer) {
      res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
      return;
    }

    const body = req.body ?? {};
    const listingId = typeof body.listing_id === 'string' ? body.listing_id.trim() : '';
    const rail = typeof body.rail === 'string' ? body.rail : SUPPORTED_RAIL;
    const clientToken = typeof body.client_token === 'string' ? body.client_token.trim() : '';

    if (!listingId) {
      res.status(422).json({ error: 'invalid_body', hint: 'listing_id is required' } satisfies ErrorBody);
      return;
    }
    if (!clientToken) {
      res.status(422).json({ error: 'invalid_body', hint: 'client_token is required (idempotency key)' } satisfies ErrorBody);
      return;
    }
    if (rail !== SUPPORTED_RAIL) {
      res.status(422).json({ error: 'unsupported_rail', reason: 'stripe_only_in_slice1' } satisfies ErrorBody);
      return;
    }

    try {
      const db = getDb();

      // 1) Load the listing — must exist and be LISTED to be buyable. supply_* are read so the
      //    order path can refuse / atomically claim against a finite supply (over-sell guard).
      const { data: listingData, error: lErr } = await db
        .from('pack_listings')
        .select('listing_id, pack_id, seller_wallet, license_type, status, supply_kind, supply_total, supply_sold')
        .eq('listing_id', listingId)
        .limit(1)
        .maybeSingle();
      if (lErr) {
        log.warn({ err: lErr, listingId }, 'order: listing lookup failed');
        res.status(500).json({ error: 'order_failed' } satisfies ErrorBody);
        return;
      }
      const listing = (listingData as ListingRow | null) ?? null;
      if (!listing || listing.status !== 'listed') {
        res.status(404).json({ error: 'listing_not_available' } satisfies ErrorBody);
        return;
      }
      // Copy-only in this slice (title is Slice 2).
      if (listing.license_type !== 'copy') {
        res.status(422).json({ error: 'unsupported_license_type', reason: 'copy_only_in_slice1' } satisfies ErrorBody);
        return;
      }

      // 2) Price — read SERVER-SIDE from pack_listing_prices for this rail. The buyer cannot
      //    supply or influence the amount.
      const { data: priceData, error: pErr } = await db
        .from('pack_listing_prices')
        .select('listing_id, rail, amount, currency, decimals, enabled')
        .eq('listing_id', listingId)
        .eq('rail', rail)
        .limit(1)
        .maybeSingle();
      if (pErr) {
        log.warn({ err: pErr, listingId }, 'order: price lookup failed');
        res.status(500).json({ error: 'order_failed' } satisfies ErrorBody);
        return;
      }
      const price = (priceData as PriceRow | null) ?? null;
      if (!price || price.enabled === false) {
        res.status(422).json({ error: 'no_price_for_rail', hint: `no enabled ${rail} price for this listing` } satisfies ErrorBody);
        return;
      }

      let amountMajor: string;
      try {
        amountMajor = minorUnitsToMajorString(price.amount, price.decimals);
      } catch (err) {
        log.error({ err, listingId, amount: price.amount }, 'order: price conversion failed');
        res.status(500).json({ error: 'order_failed' } satisfies ErrorBody);
        return;
      }
      const currency = String(price.currency || 'usd').toLowerCase();

      // 3) Create the order, idempotent on (buyer, client_token). A replay collapses to the
      //    same row (created=false) — no second order, no second charge.
      const orderResult = await createOrder({
        packId: listing.pack_id,
        listingId: listing.listing_id,
        listingKind: 'copy',
        buyerWallet: buyer,
        sellerWallet: listing.seller_wallet,
        rail,
        currency,
        amount: amountMajor,
        clientToken,
      });
      const order = orderResult.order;

      // 3b) SUPPLY GUARD (over-sell fix). A limited/single listing has a finite supply_total; a
      //     copy must never be ordered + delivered past it. We claim a unit ONLY for a genuinely
      //     NEW order (created=true): a replay already claimed its unit on first creation, so
      //     re-claiming would double-count. The claim is an ATOMIC compare-and-swap on supply_sold
      //     (claimSupplyUnit) that also flips the listing to 'sold_out' at the cap — so two racing
      //     buyers of the last unit cannot both win. If the listing is sold out (or the race is
      //     lost), the just-created order is marked 'failed' (a harmless terminal row that can
      //     never be paid — no intent is opened below — nor delivered) and we answer 409.
      if (orderResult.created && listing.supply_total !== null) {
        const claimed = await claimSupplyUnit(listing.listing_id, listing.supply_total);
        if (!claimed) {
          await failOrphanOrder(order.order_id);
          res.status(409).json({ error: 'sold_out', hint: 'this listing has no remaining supply' } satisfies ErrorBody);
          return;
        }
      }

      // 4) Open (or, idempotently, re-open) the Stripe PaymentIntent. createIntent uses the
      //    order's client_token as Stripe's native idempotency key, so a replay returns the
      //    SAME PaymentIntent + client_secret — recovering the secret for an idempotent order.
      const intent = await rail_createIntent(order, amountMajor, currency, clientToken);

      // 5) Persist rail_ref + advance created → awaiting_payment (only on first creation; a
      //    replayed order is already past 'created'). Guarded so we never move a paid order back.
      if (order.status === 'created' && canTransition('created', 'awaiting_payment')) {
        const { error: updErr } = await db
          .from('marketplace_orders')
          .update({ status: 'awaiting_payment', rail_ref: intent.rail_ref })
          .eq('order_id', order.order_id)
          .eq('status', 'created');
        if (updErr) {
          // The order + intent both exist; the buyer can still pay. Log and continue — the
          // webhook advances created→paid directly, so a missed awaiting_payment is non-fatal.
          log.warn({ err: updErr, orderId: order.order_id }, 'order: awaiting_payment advance failed (non-fatal)');
        }
      } else if (!order.rail_ref) {
        // Idempotent replay that never recorded a rail_ref — backfill it (best-effort).
        await db
          .from('marketplace_orders')
          .update({ rail_ref: intent.rail_ref })
          .eq('order_id', order.order_id);
      }

      res.status(orderResult.created ? 201 : 200).json({
        order_id: order.order_id,
        client_secret: intent.client_secret ?? null,
        status: orderResult.created ? 'awaiting_payment' : order.status,
        amount: amountMajor,
        currency,
      });
    } catch (err) {
      log.error({ err, listingId }, 'POST /v1/market/orders failed');
      res.status(500).json({ error: 'order_failed' } satisfies ErrorBody);
    }
  });

  /**
   * GET /v1/market/orders/:id — owner-scoped order state. The caller must be the order's
   * BUYER or SELLER (two-party scoping). A third party gets 403; an unknown order 404.
   */
  router.get('/v1/market/orders/:id', requirePrivyAuth, requireOwnership, async (req: Request, res: Response) => {
    const owner = ownerFromReq(req);
    if (!owner) {
      res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
      return;
    }
    const id = String(req.params.id ?? '');
    if (!id || id.length > 64) {
      res.status(422).json({ error: 'invalid_id' } satisfies ErrorBody);
      return;
    }
    try {
      const order = await loadOrder(id);
      if (!order) {
        res.status(404).json({ error: 'order_not_found' } satisfies ErrorBody);
        return;
      }
      if (order.buyer_wallet !== owner && order.seller_wallet !== owner) {
        res.status(403).json({ error: 'forbidden' } satisfies ErrorBody);
        return;
      }
      res.json({ order });
    } catch (err) {
      log.error({ err, id }, 'GET /v1/market/orders/:id failed');
      res.status(500).json({ error: 'order_failed' } satisfies ErrorBody);
    }
  });

  /**
   * POST /v1/market/orders/:id/refund — refund a delivered/settled/paid copy order.
   * Authorised by: the order's buyer OR seller (privy + ownership), OR a valid X-Admin-Token.
   * Moves the order to 'refunding' and runs the copy clawback (M10). Idempotent.
   *
   * Auth ordering note: privy is NOT required up front because the admin-token path must work
   * without a Privy session. We authorise inside the handler: admin token → allow; else require
   * the verified wallet to match buyer/seller. (requireOwnership still ran via the chain when a
   * wallet is present; with no wallet + a valid admin token we proceed.)
   */
  router.post('/v1/market/orders/:id/refund', maybeOwnership, async (req: Request, res: Response) => {
    const id = String(req.params.id ?? '');
    if (!id || id.length > 64) {
      res.status(422).json({ error: 'invalid_id' } satisfies ErrorBody);
      return;
    }

    const isAdmin = adminTokenValid(req.headers['x-admin-token']);
    const owner = ownerFromReq(req);

    try {
      const order = await loadOrder(id);
      if (!order) {
        res.status(404).json({ error: 'order_not_found' } satisfies ErrorBody);
        return;
      }

      // Authorise: a valid admin token, or the verified wallet is the order's buyer/seller.
      const isParty = !!owner && (order.buyer_wallet === owner || order.seller_wallet === owner);
      if (!isAdmin && !isParty) {
        // No identity at all → 401 unauthenticated; an authenticated non-party → 403 forbidden.
        const status = owner ? 403 : 401;
        res.status(status).json({ error: status === 401 ? 'unauthenticated' : 'forbidden' } satisfies ErrorBody);
        return;
      }

      const result = await refundOrder(id);
      // refundOrder already re-checked existence; found=false is a race (deleted) → 404.
      if (!result.found) {
        res.status(404).json({ error: 'order_not_found' } satisfies ErrorBody);
        return;
      }
      res.json({ ok: true, order_id: id, status: 'refunding', refunded: true });
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'NOT_REFUNDABLE') {
        res.status(409).json({ error: 'not_refundable', hint: 'order is not in a refundable state' } satisfies ErrorBody);
        return;
      }
      if (code === 'TITLE_FINAL') {
        res.status(409).json({ error: 'title_final', hint: 'the title transferred on-chain; the sale is final and cannot be refunded' } satisfies ErrorBody);
        return;
      }
      log.error({ err, id }, 'POST /v1/market/orders/:id/refund failed');
      res.status(500).json({ error: 'refund_failed' } satisfies ErrorBody);
    }
  });

  /**
   * POST /v1/market/payout-account — create/refresh a creator's Stripe Connect payout
   * destination and return an onboarding link (stub in Slice 1: the real Connect Account +
   * AccountLink are wired when Connect is enabled; here we persist the destination row and
   * return a deterministic onboarding URL so the client flow is exercisable end-to-end).
   */
  router.post('/v1/market/payout-account', requirePrivyAuth, requireOwnership, async (req: Request, res: Response) => {
    const owner = ownerFromReq(req);
    if (!owner) {
      res.status(401).json({ error: 'unauthenticated' } satisfies ErrorBody);
      return;
    }
    try {
      const db = getDb();
      const nowIso = new Date().toISOString();
      // Upsert the payout destination (one per creator — owner_wallet UNIQUE). payouts_enabled
      // stays false until Connect onboarding completes (a Connect webhook flips it, later).
      const { error: upErr } = await db
        .from('creator_payout_accounts')
        .upsert(
          {
            owner_wallet: owner,
            payout_rail: 'stripe_connect',
            payouts_enabled: false,
            updated_at: nowIso,
          },
          { onConflict: 'owner_wallet' },
        );
      if (upErr) {
        log.warn({ err: upErr, owner }, 'payout-account: upsert failed');
        res.status(500).json({ error: 'payout_account_failed' } satisfies ErrorBody);
        return;
      }

      // Onboarding link stub — a return URL into the dashboard. Replaced by a real Stripe
      // AccountLink.url when Connect is enabled on the account.
      const onboardingUrl = `${publicBaseUrl(req)}/dashboard/payouts/onboard?wallet=${encodeURIComponent(owner)}`;

      res.json({ payout_rail: 'stripe_connect', payouts_enabled: false, onboarding_url: onboardingUrl });
    } catch (err) {
      log.error({ err }, 'POST /v1/market/payout-account failed');
      res.status(500).json({ error: 'payout_account_failed' } satisfies ErrorBody);
    }
  });

  return router;
}

/**
 * requireOwnership only when a wallet is actually claimed; otherwise pass through so the
 * admin-token refund path (no Privy session) can proceed. Mirrors optionalOwnership's intent
 * but is local so the route file owns this nuance explicitly. With a claimed wallet present,
 * the real ownership verification still runs.
 */
function maybeOwnership(req: Request, res: Response, next: NextFunction): void {
  const hasWallet = !!(req.query.wallet || (req.body && typeof req.body.wallet === 'string'));
  const hasAdmin = !!req.headers['x-admin-token'];
  if (!hasWallet && hasAdmin) {
    next();
    return;
  }
  // Otherwise require a Privy session + ownership (sets req.verifiedWallet).
  requirePrivyAuth(req, res, (err?: unknown) => {
    if (err) {
      next(err as Error);
      return;
    }
    if (res.headersSent) return; // requirePrivyAuth already answered 401
    void requireOwnership(req, res, next);
  });
}

// ─────────────────────────── shared helpers ───────────────────────────

/** Load a marketplace order by id (un-authorised — callers MUST authorise the party). */
async function loadOrder(orderId: string): Promise<OrderRow | null> {
  const db = getDb();
  const { data, error } = await db
    .from('marketplace_orders')
    .select('*')
    .eq('order_id', orderId)
    .limit(1)
    .maybeSingle();
  if (error) {
    log.warn({ err: error, orderId }, 'loadOrder: lookup failed');
    throw new Error('failed to load order');
  }
  return (data as OrderRow | null) ?? null;
}

/** How many CAS retries claimSupplyUnit makes before conceding the race (sold out / contention). */
const SUPPLY_CLAIM_MAX_ATTEMPTS = 5;

/**
 * Atomically claim ONE unit of a finite-supply listing (the over-sell guard). Returns true iff a
 * unit was claimed; false iff the listing is sold out (or lost an unwinnable race).
 *
 * PostgREST has no column-vs-column predicate, so we do an optimistic compare-and-swap on the
 * EXACT observed `supply_sold` integer (the same read-then-conditional-`.eq()` idiom the order DAG
 * uses for status, e.g. refundOrder's `.eq('status', status)`):
 *
 *   read supply_sold = N → if N >= supply_total, sold out → false.
 *   else UPDATE … SET supply_sold = N+1 WHERE listing_id = ? AND supply_sold = N  → .select() the
 *   row: exactly ONE concurrent claimant matches the row (the CAS), the loser matches ZERO rows
 *   (supply_sold already moved off N) and retries against the fresh value. So two buyers racing for
 *   the last unit can NEVER both win — at most `supply_total` units are ever claimed.
 *
 * When the claimed unit is the LAST (N+1 === supply_total) the listing is flipped to 'sold_out' in
 * the same conditional update, so it leaves the buyable set atomically with the final claim. A
 * bounded retry caps the (rare) contention loop; conceding after the cap is safe — it just refuses
 * an order that a subsequent attempt could place, never an over-sell.
 */
async function claimSupplyUnit(listingId: string, supplyTotal: number): Promise<boolean> {
  const db = getDb();
  for (let attempt = 0; attempt < SUPPLY_CLAIM_MAX_ATTEMPTS; attempt++) {
    // Re-read the live counter each attempt (the route's earlier read may be stale by now).
    const { data: row, error: readErr } = await db
      .from('pack_listings')
      .select('supply_sold')
      .eq('listing_id', listingId)
      .limit(1)
      .maybeSingle();
    if (readErr) {
      log.warn({ err: readErr, listingId }, 'claimSupplyUnit: supply read failed');
      throw new Error('failed to read listing supply');
    }
    const sold = (row as { supply_sold: number } | null)?.supply_sold;
    if (typeof sold !== 'number') {
      // Listing vanished mid-flight (delisted/deleted) — nothing to claim.
      return false;
    }
    if (sold >= supplyTotal) return false; // sold out

    const next = sold + 1;
    const atCap = next >= supplyTotal;
    const patch: Record<string, unknown> = { supply_sold: next };
    if (atCap) patch.status = 'sold_out'; // last unit → leave the buyable set atomically

    // CAS: only the claimant whose observed `sold` still matches wins the row.
    const { data: claimed, error: updErr } = await db
      .from('pack_listings')
      .update(patch)
      .eq('listing_id', listingId)
      .eq('supply_sold', sold)
      .select('listing_id');
    if (updErr) {
      log.warn({ err: updErr, listingId }, 'claimSupplyUnit: supply claim update failed');
      throw new Error('failed to claim listing supply');
    }
    if (Array.isArray(claimed) && claimed.length > 0) return true; // won the unit
    // Lost the CAS (another buyer moved supply_sold) — retry against the fresh value.
  }
  // Exhausted the retry budget under contention. Concede (no over-sell); the buyer can re-try.
  log.warn({ listingId }, 'claimSupplyUnit: conceded after max CAS attempts (contention)');
  return false;
}

/**
 * Mark a just-created order 'failed' when its supply claim could not be honoured (sold out / race
 * lost). The order was created (idempotency row) but no PaymentIntent is opened for it, so 'failed'
 * is a harmless terminal state: it can never be paid nor delivered. created → failed is a sanctioned
 * DAG edge. Best-effort: a failure to mark it leaves a stranded 'created' row that expires on its
 * own, which is strictly safer than an over-sell.
 */
async function failOrphanOrder(orderId: string): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('marketplace_orders')
    .update({ status: 'failed' })
    .eq('order_id', orderId)
    .eq('status', 'created'); // only fail an order still in its initial state
  if (error) {
    log.warn({ err: error, orderId }, 'failOrphanOrder: could not mark order failed (will expire)');
  }
}

/**
 * Open the Stripe PaymentIntent for an order. Split out so the route reads cleanly and so a
 * future rail dispatch (solana/base) slots in here. Idempotent on the order's client_token.
 */
async function rail_createIntent(
  order: OrderRow,
  amountMajor: string,
  currency: string,
  clientToken: string,
): Promise<{ rail_ref: string; client_secret?: string }> {
  const rail = new StripeRail();
  return rail.createIntent({
    orderId: order.order_id,
    amount: amountMajor,
    currency,
    clientToken,
    sellerWallet: order.seller_wallet,
    description: `Memory pack ${order.pack_id}`,
  });
}
