/**
 * Backfill runner — a process-level singleton that owns at most one
 * in-flight PMP backfill and exposes its live status.
 *
 * Why a singleton: the backfill mints on-chain (costs SOL, hits RPC limits).
 * Running two concurrently would double the spend and race on the same rows.
 * `start()` refuses if one is already running.
 *
 * Crash behaviour: if the process restarts mid-backfill, the run is lost —
 * but that's fine. The backfill is resumable: progress lives on the
 * `memories.tokenization_status` column, not in this process. Re-triggering
 * after a restart picks up exactly where it left off.
 *
 * This module is consumed by the admin HTTP endpoints (pmp-admin.routes.ts).
 */

import { runPmpBackfill, type BackfillOptions, type BackfillStats } from './pmp-backfill.js';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('pmp-backfill-runner');

export type RunnerState = 'idle' | 'running';

export interface RunnerStatus {
  state: RunnerState;
  startedAt: string | null;
  finishedAt: string | null;
  /** Live during a run (updated per batch); final when state returns to idle. */
  stats: BackfillStats | null;
  /** Set if the last run threw. Cleared when a new run starts. */
  lastError: string | null;
  /** True if a stop was requested for the current run. */
  stopRequested: boolean;
  /** Options the current/last run was started with. */
  options: Pick<BackfillOptions, 'batchSize' | 'ratePerMinute' | 'maxMemories'> | null;
}

// ── Module-level state ──
let state: RunnerState = 'idle';
let startedAt: string | null = null;
let finishedAt: string | null = null;
let stats: BackfillStats | null = null;
let lastError: string | null = null;
let stopRequested = false;
let options: RunnerStatus['options'] = null;

export interface StartResult {
  started: boolean;
  reason?: 'already_running';
  status: RunnerStatus;
}

export interface StartBackfillOptions {
  batchSize?: number;
  ratePerMinute?: number;
  maxMemories?: number;
  maxDurationMs?: number;
}

/**
 * Start a backfill in the background. Returns immediately — the run continues
 * after this function resolves. Refuses (started: false) if one is already
 * in flight.
 *
 * The `runBackfill` parameter is injectable for testing; production callers
 * omit it and get the real worker.
 */
export function startBackfill(
  opts: StartBackfillOptions = {},
  runBackfill: (o: BackfillOptions) => Promise<BackfillStats> = runPmpBackfill,
): StartResult {
  if (state === 'running') {
    return { started: false, reason: 'already_running', status: getBackfillStatus() };
  }

  state = 'running';
  startedAt = new Date().toISOString();
  finishedAt = null;
  lastError = null;
  stopRequested = false;
  stats = { scanned: 0, minted: 0, skipped: 0, failed: 0, durationMs: 0 };
  options = {
    batchSize: opts.batchSize,
    ratePerMinute: opts.ratePerMinute,
    maxMemories: opts.maxMemories,
  };

  log.info({ opts }, 'backfill run starting');

  // Fire-and-forget. The promise chain updates module state on completion.
  void runBackfill({
    batchSize: opts.batchSize,
    ratePerMinute: opts.ratePerMinute,
    maxMemories: opts.maxMemories,
    maxDurationMs: opts.maxDurationMs,
    shouldStop: () => stopRequested,
    onProgress: (s) => {
      stats = s;
    },
  })
    .then((finalStats) => {
      stats = finalStats;
      state = 'idle';
      finishedAt = new Date().toISOString();
      log.info({ stats: finalStats }, 'backfill run finished');
    })
    .catch((err: unknown) => {
      lastError = err instanceof Error ? err.message : String(err);
      state = 'idle';
      finishedAt = new Date().toISOString();
      log.error({ err }, 'backfill run threw');
    });

  return { started: true, status: getBackfillStatus() };
}

/** Request the in-flight backfill stop after its current memory. No-op if idle. */
export function requestBackfillStop(): RunnerStatus {
  if (state === 'running') {
    stopRequested = true;
    log.info('backfill stop requested');
  }
  return getBackfillStatus();
}

/** Current status snapshot — safe to call any time. */
export function getBackfillStatus(): RunnerStatus {
  return {
    state,
    startedAt,
    finishedAt,
    stats: stats ? { ...stats } : null,
    lastError,
    stopRequested,
    options: options ? { ...options } : null,
  };
}

/** Test hook — reset module state between tests. */
export function _resetBackfillRunner(): void {
  state = 'idle';
  startedAt = null;
  finishedAt = null;
  stats = null;
  lastError = null;
  stopRequested = false;
  options = null;
}
