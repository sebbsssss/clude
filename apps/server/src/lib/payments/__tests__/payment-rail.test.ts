/**
 * PaymentRail — the rail-agnostic payment interface (Stripe now; Solana/Base later).
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 1), Task 2 (spec §3E).
 *
 * The orchestrator depends only on this interface so a second rail (Slice 3 $CLUDE/Solana,
 * Slice 4 Base) drops in without touching order/delivery logic. This suite is mostly a
 * compile-time contract: it asserts StripeRail STRUCTURALLY satisfies PaymentRail and that
 * the shared ParsedRailEvent shape carries exactly the four fields the durable webhook path
 * reads (rail_event_id, type, order_id, status). The Stripe SDK + config are mocked so the
 * file can be imported without a key.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('stripe', () => {
  class StripeMock {
    paymentIntents = { create: vi.fn() };
    webhooks = { constructEvent: vi.fn() };
    constructor(public key: string) {}
  }
  return { default: StripeMock };
});
vi.mock('@clude/shared/config', () => ({
  config: { stripe: { secretKey: 'sk_test_fake', webhookSecret: 'whsec_fake' } },
}));

import type { PaymentRail, ParsedRailEvent } from '../payment-rail.js';
import { StripeRail } from '../stripe-rail.js';

describe('PaymentRail contract', () => {
  it('StripeRail is assignable to PaymentRail (structural conformance)', () => {
    // Compile-time check made runtime-visible: if StripeRail drifts from the interface,
    // the typecheck fails and this assignment is flagged.
    const rail: PaymentRail = new StripeRail();
    expect(rail.name).toBe('stripe');
    expect(typeof rail.createIntent).toBe('function');
    expect(typeof rail.verifyWebhook).toBe('function');
    expect(typeof rail.parseEvent).toBe('function');
  });

  it('ParsedRailEvent carries the four durable-path fields', () => {
    const ev: ParsedRailEvent = {
      rail_event_id: 'evt_1',
      type: 'payment_intent.succeeded',
      order_id: 'ord-1',
      status: 'paid',
    };
    expect(Object.keys(ev).sort()).toEqual(['order_id', 'rail_event_id', 'status', 'type']);
  });
});
