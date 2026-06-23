/**
 * Marketplace delivery poller — the durable §00 M6 backstop.
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 3).
 *
 * Pins the operational guarantees of the interval that drives paid copy orders to delivered:
 *   1. a sweep calls dispatchPendingDeliveries with the grantCopy deliverer;
 *   2. overlapping ticks are GUARDED — a still-running sweep is skipped, never stacked;
 *   3. a sweep error is SWALLOWED (logged) so a transient DB blip can't kill the poller;
 *   4. start/stop manage exactly one interval (idempotent start).
 *
 * dispatchPendingDeliveries + grantCopy are mocked — this tests the poller wrapper only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { dispatchPendingDeliveries, grantCopy, expireStaleSupplyHolds, reconcileTitleMintsOnce } = vi.hoisted(() => ({
  dispatchPendingDeliveries: vi.fn(),
  grantCopy: vi.fn(),
  expireStaleSupplyHolds: vi.fn(),
  reconcileTitleMintsOnce: vi.fn(),
}));
vi.mock('../delivery-dispatcher.js', () => ({ dispatchPendingDeliveries }));
vi.mock('../grant-copy.js', () => ({ grantCopy }));
vi.mock('../supply-expiry.js', () => ({ expireStaleSupplyHolds }));
vi.mock('../reconcile-title-mints.js', () => ({ reconcileTitleMintsOnce }));

import {
  runDeliverySweepOnce,
  startMarketplaceDeliveryPoller,
  stopMarketplaceDeliveryPoller,
} from '../marketplace-delivery-poller.js';

beforeEach(() => {
  dispatchPendingDeliveries.mockReset();
  grantCopy.mockReset();
  expireStaleSupplyHolds.mockReset();
  reconcileTitleMintsOnce.mockReset();
  dispatchPendingDeliveries.mockResolvedValue({ delivered: 0, failed: 0, examined: 0 });
  expireStaleSupplyHolds.mockResolvedValue({ expired: 0 });
  reconcileTitleMintsOnce.mockResolvedValue({ examined: 0, minted: 0, skipped: 0, failed: 0 });
});

afterEach(() => {
  stopMarketplaceDeliveryPoller();
});

describe('runDeliverySweepOnce', () => {
  it('calls dispatchPendingDeliveries with the grantCopy deliverer by default', async () => {
    await runDeliverySweepOnce();
    expect(dispatchPendingDeliveries).toHaveBeenCalledTimes(1);
    expect(dispatchPendingDeliveries.mock.calls[0][0]).toBe(grantCopy);
  });

  it('guards against overlap — a sweep started while another is in-flight is skipped', async () => {
    let release!: () => void;
    dispatchPendingDeliveries.mockImplementationOnce(
      () => new Promise<void>((resolve) => { release = () => resolve(); }),
    );

    const first = runDeliverySweepOnce(); // takes the lock, hangs
    const second = runDeliverySweepOnce(); // should no-op (lock held)
    await second;
    expect(dispatchPendingDeliveries).toHaveBeenCalledTimes(1);

    release();
    await first;

    // After the first completes the lock is free again — a third sweep runs.
    await runDeliverySweepOnce();
    expect(dispatchPendingDeliveries).toHaveBeenCalledTimes(2);
  });

  it('swallows a sweep error (does not throw) so the poller survives', async () => {
    dispatchPendingDeliveries.mockRejectedValueOnce(new Error('db blip'));
    await expect(runDeliverySweepOnce()).resolves.toBeUndefined();
    // Lock released after the error — the next sweep still runs.
    await runDeliverySweepOnce();
    expect(dispatchPendingDeliveries).toHaveBeenCalledTimes(2);
  });
});

describe('startMarketplaceDeliveryPoller', () => {
  it('starts an interval that sweeps, and is idempotent (one sweeper)', async () => {
    vi.useFakeTimers();
    try {
      const h1 = startMarketplaceDeliveryPoller(1000);
      const h2 = startMarketplaceDeliveryPoller(1000); // second call: no-op
      expect(h1).toBeTruthy();
      expect(h2).toBeTruthy();

      await vi.advanceTimersByTimeAsync(1000);
      expect(dispatchPendingDeliveries).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000);
      expect(dispatchPendingDeliveries).toHaveBeenCalledTimes(2);
    } finally {
      stopMarketplaceDeliveryPoller();
      vi.useRealTimers();
    }
  });

  it('stop() halts further sweeps', async () => {
    vi.useFakeTimers();
    try {
      startMarketplaceDeliveryPoller(1000);
      await vi.advanceTimersByTimeAsync(1000);
      expect(dispatchPendingDeliveries).toHaveBeenCalledTimes(1);
      stopMarketplaceDeliveryPoller();
      await vi.advanceTimersByTimeAsync(5000);
      expect(dispatchPendingDeliveries).toHaveBeenCalledTimes(1); // no more sweeps
    } finally {
      vi.useRealTimers();
    }
  });
});
