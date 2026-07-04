import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Memory 3.0 C2 outbox poller. Guarantees: one sweep drains once; a re-entrant tick is skipped
 * while a prior sweep is still running; a throwing sweep (e.g. claim RPC missing) is swallowed so
 * the loop survives; start is idempotent + unref'd; stop clears the timer.
 */
vi.hoisted(() => {
  process.env.SITE_ONLY = 'true';
});

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const drainWriteJobsOnce = vi.fn((..._a: unknown[]) => Promise.resolve({ examined: 0 }));
vi.mock('@clude/brain/memory/outbox-worker', () => ({
  drainWriteJobsOnce: (...a: unknown[]) => drainWriteJobsOnce(...a),
}));

import {
  runOutboxSweepOnce,
  startOutboxWorkerPoller,
  stopOutboxWorkerPoller,
} from '../outbox-worker-poller';

beforeEach(() => {
  vi.clearAllMocks();
  drainWriteJobsOnce.mockResolvedValue({ examined: 0 });
});

afterEach(() => {
  stopOutboxWorkerPoller();
  vi.useRealTimers();
});

describe('runOutboxSweepOnce', () => {
  it('drains once per call', async () => {
    drainWriteJobsOnce.mockResolvedValue({ examined: 3 });
    await runOutboxSweepOnce();
    expect(drainWriteJobsOnce).toHaveBeenCalledTimes(1);
  });

  it('swallows a claim-RPC error so the loop survives (does not throw)', async () => {
    drainWriteJobsOnce.mockRejectedValue(new Error('claim_memory_write_jobs does not exist'));
    await expect(runOutboxSweepOnce()).resolves.toBeUndefined();
    // and a subsequent sweep still runs (sweeping flag was reset in finally)
    drainWriteJobsOnce.mockResolvedValue({ examined: 0 });
    await runOutboxSweepOnce();
    expect(drainWriteJobsOnce).toHaveBeenCalledTimes(2);
  });

  it('re-entrancy guard: an overlapping tick is skipped while a sweep is in flight', async () => {
    let release!: () => void;
    drainWriteJobsOnce.mockImplementation(() => new Promise<{ examined: number }>((r) => { release = () => r({ examined: 0 }); }));
    const first = runOutboxSweepOnce();      // starts, holds
    await runOutboxSweepOnce();               // overlapping tick — must skip
    expect(drainWriteJobsOnce).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});

describe('startOutboxWorkerPoller', () => {
  it('is idempotent (a second start does not create a second timer) and unref-s', async () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    startOutboxWorkerPoller(1000);
    startOutboxWorkerPoller(1000);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1); // one sweeper only
  });

  it('sweeps on the interval and stop() halts it', async () => {
    vi.useFakeTimers();
    startOutboxWorkerPoller(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(drainWriteJobsOnce).toHaveBeenCalledTimes(1);
    stopOutboxWorkerPoller();
    await vi.advanceTimersByTimeAsync(3000);
    expect(drainWriteJobsOnce).toHaveBeenCalledTimes(1); // no more ticks after stop
  });
});
