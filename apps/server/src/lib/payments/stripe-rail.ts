/**
 * Stripe payment rail — the concrete PaymentRail for card payments (Slice 1).
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 1), Task 2 (spec §3E + §00 M6).
 *
 * MONEY CODE. Three contract points, each a guarantee the durable money path rests on:
 *
 *   createIntent  — paymentIntents.create with the amount in the smallest currency unit,
 *                   metadata.order_id bound so the webhook resolves the order with ZERO
 *                   trust in the client, and Stripe's native idempotencyKey set to the
 *                   order's client_token so a retried create can never mint a second
 *                   PaymentIntent / second charge.
 *
 *   verifyWebhook — stripe.webhooks.constructEvent(rawBody, sig, webhookSecret). This is the
 *                   R6 spoof guard and it runs BEFORE any DB write. A forged/absent signature
 *                   makes constructEvent throw → we reject, no event escapes. A missing
 *                   webhook secret fails closed (we never trust an unverifiable body).
 *
 *   parseEvent    — map a VERIFIED Stripe event to the rail-agnostic ParsedRailEvent. The
 *                   order status is driven off the mapped `status`; order_id is read only
 *                   from PaymentIntent metadata, never anything client-controlled.
 *
 * The Stripe client is constructed lazily from config.stripe.secretKey; constructing the
 * rail without a key throws (fail closed). Pin the API version so a Stripe-side default bump
 * can't silently change event shapes under us.
 */

import Stripe from 'stripe';
import { config } from '@clude/shared/config';
import { createChildLogger } from '@clude/shared/core/logger';
import type {
  PaymentRail,
  CreateIntentInput,
  CreateIntentResult,
  ParsedRailEvent,
} from './payment-rail.js';
import type { OrderStatus } from './order-orchestrator.js';

const log = createChildLogger('stripe-rail');

/**
 * Pinned Stripe API version. Locking this means inbound event/object shapes are stable
 * regardless of the account's dashboard default. Bump deliberately, with a test pass.
 */
const STRIPE_API_VERSION = '2026-05-27.dahlia' as const;

/**
 * ISO-4217 currencies Stripe treats as ZERO-decimal: the amount is already in the smallest
 * unit, so it must NOT be multiplied by 100. (Authoritative list per Stripe docs.)
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg',
  'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

/**
 * Convert a decimal major-unit amount string to Stripe's integer smallest unit.
 *   '9.99' usd → 999   ·   '500' jpy → 500 (zero-decimal)   ·   '10' usd → 1000
 * Uses Math.round on the scaled value to avoid binary-float drift (9.99 * 100 = 998.999…).
 */
function toSmallestUnit(amount: string, currency: string): number {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid Stripe amount: ${JSON.stringify(amount)}`);
  }
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toLowerCase())) {
    return Math.round(n);
  }
  return Math.round(n * 100);
}

/**
 * Map a verified Stripe event TYPE to the order status it should drive the order to, or null
 * when the event is irrelevant (recorded for audit, no status change). Only the events the
 * Slice 1 copy path needs are mapped; everything else is intentionally ignored.
 */
function statusForEventType(type: string): OrderStatus | null {
  switch (type) {
    case 'payment_intent.succeeded':
      return 'paid';
    case 'payment_intent.payment_failed':
    case 'payment_intent.canceled':
      return 'failed';
    // A dispute or a refund both open the clawback path (§00 M10): delete the delivered copy.
    case 'charge.dispute.created':
    case 'charge.refunded':
    case 'charge.refund.updated':
      return 'refunding';
    default:
      return null;
  }
}

/** Pull order_id out of a Stripe object's metadata, if present. Never invents one. */
function orderIdFromObject(obj: unknown): string | null {
  const meta = (obj as { metadata?: Record<string, unknown> } | null)?.metadata;
  const id = meta?.order_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export class StripeRail implements PaymentRail<Stripe.Event> {
  public readonly name = 'stripe' as const;
  private readonly client: Stripe;

  constructor(client?: Stripe) {
    if (client) {
      this.client = client;
      return;
    }
    const key = config.stripe.secretKey;
    if (!key) {
      throw new Error('Stripe rail not configured: STRIPE_SECRET_KEY is empty');
    }
    this.client = new Stripe(key, { apiVersion: STRIPE_API_VERSION });
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const amount = toSmallestUnit(input.amount, input.currency);
    const pi = await this.client.paymentIntents.create(
      {
        amount,
        currency: input.currency.toLowerCase(),
        // Bind the order so the webhook resolves it with zero trust in the client.
        metadata: { order_id: input.orderId, seller_wallet: input.sellerWallet },
        ...(input.description ? { description: input.description } : {}),
      },
      // Stripe-native idempotency: a retried create with the same key returns the SAME PI.
      { idempotencyKey: input.clientToken },
    );

    log.info({ orderId: input.orderId, piId: pi.id }, 'stripe createIntent: PaymentIntent created');
    return {
      rail_ref: pi.id,
      client_secret: pi.client_secret ?? undefined,
    };
  }

  /**
   * Verify a Stripe webhook from its RAW body + Stripe-Signature header. Throws on a bad or
   * unverifiable signature, and fails closed when the webhook secret is unconfigured — this
   * runs BEFORE any DB write so an unverified event never reaches the order state.
   */
  verifyWebhook(rawBody: Buffer | string, signature: string | undefined): Stripe.Event {
    const secret = config.stripe.webhookSecret;
    if (!secret) {
      throw new Error('Stripe webhook secret not configured: STRIPE_WEBHOOK_SECRET is empty');
    }
    if (!signature) {
      throw new Error('missing Stripe-Signature header');
    }
    // constructEvent throws StripeSignatureVerificationError on a forged/expired signature.
    return this.client.webhooks.constructEvent(rawBody, signature, secret);
  }

  /** Normalise a VERIFIED Stripe event into the rail-agnostic shape. */
  parseEvent(event: Stripe.Event): ParsedRailEvent {
    const obj = (event.data as { object?: unknown } | undefined)?.object ?? null;
    return {
      rail_event_id: event.id,
      type: event.type,
      order_id: orderIdFromObject(obj),
      status: statusForEventType(event.type),
    };
  }
}
