/**
 * Stripe payment rail — the concrete PaymentRail implementation.
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 1), Task 2 (spec §3E + §00 M6).
 *
 * MONEY CODE. The Stripe SDK is fully MOCKED here — no real Stripe, no network, no key.
 * We assert the three rail contract points that the durable money path depends on:
 *
 *   createIntent  → calls paymentIntents.create with the order amount in the smallest
 *                   currency unit, metadata.order_id bound (so the webhook can find the
 *                   order with zero trust in the client), and — critically — Stripe's
 *                   native idempotencyKey set to the order's client_token, so a retried
 *                   create can never mint a second PaymentIntent / second charge.
 *
 *   verifyWebhook → delegates to stripe.webhooks.constructEvent(rawBody, sig, secret).
 *                   A bad/forged signature (constructEvent throws) MUST reject — no event
 *                   object escapes. This is the R6 guard, and it runs BEFORE any DB write.
 *                   A missing webhook secret also fails closed.
 *
 *   parseEvent    → maps a verified Stripe event to the rail-agnostic shape
 *                   { rail_event_id, type, order_id, status }. payment_intent.succeeded
 *                   → status 'paid'; the dispute/refund events → 'refunding'; payment
 *                   failure → 'failed'. order_id is read from the PaymentIntent metadata,
 *                   never from anything client-controlled.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── Stripe SDK mock. The default export is a constructor returning an object with the
//    two namespaces the rail uses: paymentIntents.create and webhooks.constructEvent. ──
const createIntentMock = vi.fn();
const constructEventMock = vi.fn();

vi.mock('stripe', () => {
  class StripeMock {
    paymentIntents = { create: createIntentMock };
    webhooks = { constructEvent: constructEventMock };
    constructor(public key: string, public opts?: unknown) {}
  }
  return { default: StripeMock };
});

// ── Config: provide a non-empty secret + webhook secret so the rail initialises.
//    Individual tests override config.stripe.webhookSecret to exercise the fail-closed path. ──
vi.mock('@clude/shared/config', () => ({
  config: {
    stripe: { secretKey: 'sk_test_fake', webhookSecret: 'whsec_fake' },
  },
}));

import { config } from '@clude/shared/config';
import { StripeRail } from '../stripe-rail.js';

beforeEach(() => {
  createIntentMock.mockReset();
  constructEventMock.mockReset();
  // Restore the default happy config each test.
  (config as any).stripe.secretKey = 'sk_test_fake';
  (config as any).stripe.webhookSecret = 'whsec_fake';
});

describe('StripeRail.createIntent', () => {
  it('creates a PaymentIntent with order_id metadata + client_token idempotency key', async () => {
    createIntentMock.mockResolvedValue({
      id: 'pi_123',
      client_secret: 'pi_123_secret_xyz',
      status: 'requires_payment_method',
    });

    const rail = new StripeRail();
    const out = await rail.createIntent({
      orderId: 'ord-deadbeef',
      amount: '9.99',
      currency: 'usd',
      clientToken: 'ct-001',
      sellerWallet: 'SeLLeR',
      description: 'Memory pack: Foo',
    });

    expect(createIntentMock).toHaveBeenCalledTimes(1);
    const [params, options] = createIntentMock.mock.calls[0];
    // $9.99 → 999 minor units (no float drift).
    expect(params.amount).toBe(999);
    expect(params.currency).toBe('usd');
    expect(params.metadata.order_id).toBe('ord-deadbeef');
    // Stripe-native idempotency keyed on the caller's client_token.
    expect(options.idempotencyKey).toBe('ct-001');

    expect(out.rail_ref).toBe('pi_123');
    expect(out.client_secret).toBe('pi_123_secret_xyz');
  });

  it('zero-decimal currencies (jpy) are NOT multiplied by 100', async () => {
    createIntentMock.mockResolvedValue({ id: 'pi_jpy', client_secret: 'cs', status: 'requires_payment_method' });
    const rail = new StripeRail();
    await rail.createIntent({
      orderId: 'ord-jpy',
      amount: '500',
      currency: 'jpy',
      clientToken: 'ct-jpy',
      sellerWallet: 'S',
    });
    const [params] = createIntentMock.mock.calls[0];
    expect(params.amount).toBe(500);
    expect(params.currency).toBe('jpy');
  });

  it('throws (fails closed) when no Stripe secret key is configured', () => {
    (config as any).stripe.secretKey = '';
    expect(() => new StripeRail()).toThrow(/stripe.*not configured|secret/i);
  });
});

describe('StripeRail.verifyWebhook', () => {
  it('returns the verified event when the signature is valid', () => {
    const fakeEvent = { id: 'evt_1', type: 'payment_intent.succeeded', data: { object: {} } };
    constructEventMock.mockReturnValue(fakeEvent);

    const rail = new StripeRail();
    const ev = rail.verifyWebhook(Buffer.from('{"raw":true}'), 't=1,v1=abc');

    expect(constructEventMock).toHaveBeenCalledWith(
      expect.anything(),
      't=1,v1=abc',
      'whsec_fake',
    );
    expect(ev).toBe(fakeEvent);
  });

  it('REJECTS a bad signature — constructEvent throws, no event escapes', () => {
    constructEventMock.mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature for payload');
    });
    const rail = new StripeRail();
    expect(() => rail.verifyWebhook(Buffer.from('{}'), 'bad-sig')).toThrow(/signature/i);
  });

  it('fails closed when the webhook secret is not configured (never trust an unverifiable body)', () => {
    (config as any).stripe.webhookSecret = '';
    const rail = new StripeRail();
    expect(() => rail.verifyWebhook(Buffer.from('{}'), 't=1,v1=abc')).toThrow(
      /webhook secret|not configured/i,
    );
    // constructEvent must NOT have been reached.
    expect(constructEventMock).not.toHaveBeenCalled();
  });
});

describe('StripeRail.parseEvent', () => {
  function stripeEvent(type: string, object: Record<string, unknown>, id = 'evt_x') {
    return { id, type, data: { object } } as any;
  }

  it('maps payment_intent.succeeded → status "paid", reading order_id from PI metadata', () => {
    const rail = new StripeRail();
    const parsed = rail.parseEvent(
      stripeEvent('payment_intent.succeeded', {
        id: 'pi_abc',
        metadata: { order_id: 'ord-111' },
      }, 'evt_paid'),
    );
    expect(parsed.rail_event_id).toBe('evt_paid');
    expect(parsed.type).toBe('payment_intent.succeeded');
    expect(parsed.order_id).toBe('ord-111');
    expect(parsed.status).toBe('paid');
  });

  it('maps payment_intent.payment_failed → status "failed"', () => {
    const rail = new StripeRail();
    const parsed = rail.parseEvent(
      stripeEvent('payment_intent.payment_failed', {
        id: 'pi_fail',
        metadata: { order_id: 'ord-222' },
      }),
    );
    expect(parsed.order_id).toBe('ord-222');
    expect(parsed.status).toBe('failed');
  });

  it('maps a dispute (charge.dispute.created) → status "refunding" (clawback path, §00 M10)', () => {
    const rail = new StripeRail();
    const parsed = rail.parseEvent(
      stripeEvent('charge.dispute.created', {
        id: 'dp_1',
        payment_intent: 'pi_disputed',
        metadata: { order_id: 'ord-333' },
      }),
    );
    expect(parsed.order_id).toBe('ord-333');
    expect(parsed.status).toBe('refunding');
  });

  it('returns status null (ignored) for an unrelated event type, but still surfaces rail_event_id', () => {
    const rail = new StripeRail();
    const parsed = rail.parseEvent(
      stripeEvent('customer.created', { id: 'cus_1' }, 'evt_ignore'),
    );
    expect(parsed.rail_event_id).toBe('evt_ignore');
    expect(parsed.status).toBeNull();
  });

  it('leaves order_id null when the PI carries no order_id metadata (never invent one)', () => {
    const rail = new StripeRail();
    const parsed = rail.parseEvent(
      stripeEvent('payment_intent.succeeded', { id: 'pi_nometa', metadata: {} }),
    );
    expect(parsed.status).toBe('paid');
    expect(parsed.order_id).toBeNull();
  });
});
