/**
 * Marketplace delivery poller — the DURABLE backstop for §00 M6 copy delivery.
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 3), Task 1 (spec §00 M6).
 *
 * MONEY CODE. The §00 M6 guarantee in its operational form: a crash between the Stripe
 * webhook-ack and delivery must NEVER lose a paid-for pack. The webhook only records the order
 * paid; THIS poller is what actually drives paid → delivering → delivered, by repeatedly
 * sweeping order state via dispatchPendingDeliveries(grantCopy). Because delivery is read off
 * persisted ORDER STATE (never an in-process event), any order left at 'paid' or 'delivering'
 * by a crash is picked up by the next tick and driven to completion. The post-webhook nudge in
 * the route is only latency; this interval is the durability.
 *
 * Design:
 *   - A single in-process interval (one sweeper instance — the concurrency assumption the
 *     dispatcher documents). Re-entrancy guarded: a tick that overruns the interval is skipped
 *     rather than stacked, so a slow DB never piles up overlapping sweeps.
 *   - Errors are swallowed per-tick (logged) — a transient DB blip must not kill the poller;
 *     the next tick retries. dispatchPendingDeliveries is itself crash-safe and idempotent.
 *   - Started once from bootstrap. `unref()` so the interval never keeps the process alive on
 *     its own (graceful shutdown is unaffected).
 */

import { createChildLogger } from '@clude/shared/core/logger';
import { dispatchPendingDeliveries, type DeliverFn } from './delivery-dispatcher.js';
import { grantCopy } from './grant-copy.js';
import { expireStaleSupplyHolds } from './supply-expiry.js';

const log = createChildLogger('marketplace-delivery-poller');

/** Default sweep cadence. Frequent enough for prompt delivery, cheap (one bounded query/tick). */
const DEFAULT_INTERVAL_MS = 15_000;

let timer: NodeJS.Timeout | null = null;
let sweeping = false;

/** Run exactly one delivery sweep, guarded against overlap and swallowing errors. */
export async function runDeliverySweepOnce(deliver: DeliverFn = grantCopy): Promise<void> {
  if (sweeping) {
    // A previous tick is still running — skip rather than stack overlapping sweeps.
    return;
  }
  sweeping = true;
  try {
    const summary = await dispatchPendingDeliveries(deliver);
    if (summary.examined > 0) {
      log.info(summary, 'marketplace delivery sweep complete');
    }
    // Same tick: free supply units held by abandoned, unpaid orders past expiry (so a single/limited
    // listing can't be griefed into permanent 'sold_out'). Idempotent + crash-safe; logs its own work.
    await expireStaleSupplyHolds();
  } catch (err) {
    // Never let a transient failure kill the poller — the next tick retries.
    log.error({ err }, 'marketplace delivery sweep failed (will retry next tick)');
  } finally {
    sweeping = false;
  }
}

/**
 * Start the recurring delivery poller. Idempotent — a second call is a no-op (one sweeper).
 * Returns a stop() handle (mainly for tests / graceful shutdown).
 *
 * @param intervalMs sweep cadence in ms (default 15s).
 * @param deliver    the delivery callback (default grantCopy — the copy-license deliverer).
 */
export function startMarketplaceDeliveryPoller(
  intervalMs: number = DEFAULT_INTERVAL_MS,
  deliver: DeliverFn = grantCopy,
): { stop: () => void } {
  if (timer) {
    return { stop: stopMarketplaceDeliveryPoller };
  }
  log.info({ intervalMs }, 'starting marketplace delivery poller (durable M6 backstop)');
  timer = setInterval(() => {
    void runDeliverySweepOnce(deliver);
  }, intervalMs);
  // Don't let the interval alone keep the process alive.
  if (typeof timer.unref === 'function') timer.unref();
  return { stop: stopMarketplaceDeliveryPoller };
}

/** Stop the poller (clears the interval). Safe to call when not running. */
export function stopMarketplaceDeliveryPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
