/**
 * Memory 3.0 C2 outbox poller (apps/server side).
 *
 * A single paced sweeper that drains memory_write_jobs every INTERVAL. Re-entrancy-guarded (a slow
 * sweep never overlaps the next tick), unref'd (never keeps the process alive), and idempotent to
 * start (a second startOutboxWorkerPoller is a no-op). A tick that throws — e.g. the claim RPC is
 * missing because migration 045 is unapplied — is caught and logged; the loop continues, so an
 * unapplied migration degrades to "does nothing" rather than crashing.
 */
import { drainWriteJobsOnce } from '@clude/brain/memory/outbox-worker';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('outbox-poller');

const DEFAULT_INTERVAL_MS = 5_000;

let timer: NodeJS.Timeout | null = null;
let sweeping = false;

export async function runOutboxSweepOnce(): Promise<void> {
  if (sweeping) return; // a prior sweep is still draining; skip this tick
  sweeping = true;
  try {
    const { examined } = await drainWriteJobsOnce();
    if (examined > 0) log.info({ examined }, 'outbox sweep drained jobs');
  } catch (err) {
    // claim RPC missing (045 unapplied) or transient DB error — retry next tick.
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'outbox sweep failed (will retry next tick)');
  } finally {
    sweeping = false;
  }
}

export function startOutboxWorkerPoller(intervalMs = DEFAULT_INTERVAL_MS): { stop: () => void } {
  if (timer) return { stop: stopOutboxWorkerPoller }; // idempotent — one sweeper
  timer = setInterval(() => void runOutboxSweepOnce(), intervalMs);
  timer.unref?.(); // never block process exit on the poller
  return { stop: stopOutboxWorkerPoller };
}

export function stopOutboxWorkerPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
