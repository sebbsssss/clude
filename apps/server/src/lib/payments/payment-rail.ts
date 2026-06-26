/**
 * PaymentRail — the rail-agnostic payment abstraction.
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 1), Task 2 (spec §3E + §00 M6).
 *
 * MONEY CODE. The order orchestrator and the (Part-B chunk-2) webhook handler depend ONLY
 * on this interface, never on a concrete SDK. That keeps the durable payment→delivery path
 * (§00 M6) identical across rails: Stripe ships in Slice 1; the $CLUDE/Solana rail (Slice 3)
 * and Base rail (Slice 4) drop in behind the same three methods without touching order or
 * delivery logic.
 *
 * The contract, deliberately minimal:
 *   createIntent  — open a payment for an order. Returns a rail reference (e.g. a Stripe
 *                   PaymentIntent id) + whatever the client needs to complete payment
 *                   (e.g. a client_secret). Each rail binds the order_id INTO the
 *                   provider object so the webhook can resolve the order with zero trust
 *                   in the client, and uses the order's client_token as the rail's native
 *                   idempotency key so a retried create can never double-charge.
 *   verifyWebhook — verify an inbound rail callback's authenticity from the RAW body +
 *                   signature header, BEFORE any DB write (Risk R6). Throws on a bad or
 *                   unverifiable signature; the verified provider event is the return.
 *   parseEvent    — normalise a *verified* provider event into ParsedRailEvent. The handler
 *                   then writes order status off this, idempotently. Never call parseEvent
 *                   on an unverified event.
 */

import type { OrderStatus } from './order-orchestrator.js';

/** Input to open a payment for an existing order. Amount is a decimal string (no float). */
export interface CreateIntentInput {
  /** The order this payment is for. Bound into the provider object's metadata. */
  orderId: string;
  /** Decimal amount in the major currency unit, e.g. '9.99'. */
  amount: string;
  /** ISO-4217 lowercase currency, e.g. 'usd'. */
  currency: string;
  /** The order's idempotency key — used as the rail's native idempotency key. */
  clientToken: string;
  /** The creator who will be paid (for destination-charge routing / audit). */
  sellerWallet: string;
  /** Optional human-readable line item shown on the payment. */
  description?: string;
}

/** What a rail returns after opening a payment. */
export interface CreateIntentResult {
  /** Provider reference, e.g. a Stripe PaymentIntent id — persisted as order.rail_ref. */
  rail_ref: string;
  /** Secret the client uses to complete payment (Stripe client_secret); rail-specific. */
  client_secret?: string;
}

/**
 * A verified provider event, normalised to the four fields the durable webhook path reads.
 *   rail_event_id — the provider's unique event id (Stripe 'evt_…'); the dedupe key for
 *                   UNIQUE(rail, rail_event_id) so a webhook re-delivery is a no-op.
 *   type          — the raw provider event type, persisted for audit.
 *   order_id      — the order this event concerns, read ONLY from provider-trusted data
 *                   (e.g. PaymentIntent metadata), or null if the event carries none.
 *   status        — the order status this event should drive the order TO, or null when the
 *                   event is irrelevant and must be ignored (still recorded for audit).
 */
export interface ParsedRailEvent {
  rail_event_id: string;
  type: string;
  order_id: string | null;
  status: OrderStatus | null;
}

/**
 * The rail-agnostic payment interface. `RawEvent` is the provider's verified-event type
 * (Stripe.Event for the Stripe rail); it flows verifyWebhook → parseEvent unchanged so a
 * caller can never hand parseEvent an unverified object by accident.
 */
export interface PaymentRail<RawEvent = unknown> {
  /** Stable rail identifier, matching marketplace_orders.rail ('stripe' | 'solana' | 'base'). */
  readonly name: 'stripe' | 'solana' | 'base';

  /** Open a payment for an order. Idempotent on the order's client_token. */
  createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;

  /**
   * Verify an inbound webhook from its RAW body + signature header. Throws on any bad or
   * unverifiable signature (and when the rail's verifying secret is unconfigured) — fail
   * closed. Returns the verified provider event. MUST run before any DB write.
   */
  verifyWebhook(rawBody: Buffer | string, signature: string | undefined): RawEvent;

  /** Normalise a VERIFIED provider event into the rail-agnostic ParsedRailEvent. */
  parseEvent(event: RawEvent): ParsedRailEvent;
}
