#!/usr/bin/env node
/**
 * CLI: PMP backfill worker.
 *
 * Tokenises memories that predate the PMP rollout. Designed to run as a
 * one-shot script (cron, manual invocation, or Railway one-off command).
 *
 * Usage:
 *   pnpm --filter @clude/server tsx src/bin/pmp-backfill.ts            # default config
 *   PMP_BACKFILL_RATE=200 PMP_BACKFILL_MAX=10000 tsx src/bin/pmp-backfill.ts
 *
 * Environment:
 *   PMP_BACKFILL_BATCH       int, rows per batch (default 25)
 *   PMP_BACKFILL_RATE        int, mints per minute (default 100)
 *   PMP_BACKFILL_MAX         int, stop after N successful mints (default unlimited)
 *   PMP_BACKFILL_DURATION_S  int, stop after N seconds (default unlimited)
 *
 * Honours SIGINT / SIGTERM cleanly — finishes the current row, then stops.
 */

import { runPmpBackfill } from '../lib/pmp-backfill.js';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('pmp-backfill-cli');

function envInt(name: string): number | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function main(): Promise<void> {
  let stop = false;
  process.once('SIGINT', () => {
    log.info('SIGINT received, draining current batch...');
    stop = true;
  });
  process.once('SIGTERM', () => {
    log.info('SIGTERM received, draining current batch...');
    stop = true;
  });

  const durationS = envInt('PMP_BACKFILL_DURATION_S');
  const opts = {
    batchSize: envInt('PMP_BACKFILL_BATCH') ?? 25,
    ratePerMinute: envInt('PMP_BACKFILL_RATE') ?? 100,
    maxMemories: envInt('PMP_BACKFILL_MAX'),
    maxDurationMs: durationS ? durationS * 1000 : undefined,
    shouldStop: () => stop,
  };

  log.info({ opts }, 'starting PMP backfill');
  const stats = await runPmpBackfill(opts);
  log.info({ stats }, 'PMP backfill finished');

  // Exit explicitly so background timers don't hold the process open.
  process.exit(stats.failed === stats.scanned && stats.scanned > 0 ? 1 : 0);
}

main().catch((err) => {
  log.error({ err }, 'PMP backfill crashed');
  process.exit(2);
});
