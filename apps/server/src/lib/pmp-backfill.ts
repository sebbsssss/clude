/**
 * PMP backfill worker.
 *
 * Tokenises memories that predate the PMP rollout (or had their first mint
 * attempt fail). Paced by a target rate so we don't exhaust the Solana RPC
 * quota or burn through the bot wallet's SOL on a burst.
 *
 * Selection:
 *   tokenization_status IS NULL                  → never attempted
 *   tokenization_status = 'failed'               → retry-eligible
 *
 * Order:
 *   importance DESC, created_at DESC             → most-likely-to-be-verified first
 *
 * Skip list (matches storeMemory's existing skip-list for chain commits):
 *   source IN ('locomo-benchmark', 'longmemeval-benchmark')
 *
 * The worker is resumable — state is on the row, not in the worker. Crashing
 * mid-batch leaves a row in 'pending' which a future run picks up.
 */

import { createChildLogger } from '@clude/shared/core/logger';
import { getDb } from '@clude/shared/core/database';
import {
  tokenizeMemory,
  type TokenizeMemoryInput,
  type MemoryType,
} from '@clude/tokenization';
import { getPdaMintClient } from './pda-mint-client.js';

const log = createChildLogger('pmp-backfill');

const SKIP_SOURCES = new Set(['locomo-benchmark', 'longmemeval-benchmark']);

export interface BackfillOptions {
  /** How many rows to fetch + process per loop iteration. */
  batchSize?: number;
  /** Target throughput. Worker sleeps between batches to honour this. */
  ratePerMinute?: number;
  /** Stop after this many memories tokenised. Undefined = run until empty. */
  maxMemories?: number;
  /** Stop after this many milliseconds. Undefined = no time limit. */
  maxDurationMs?: number;
  /** Bail-out flag the caller can flip (e.g. on SIGTERM). */
  shouldStop?: () => boolean;
}

export interface BackfillStats {
  scanned: number;
  minted: number;
  skipped: number;
  failed: number;
  durationMs: number;
}

interface MemoryRow {
  id: number;
  hash_id: string;
  content: string;
  memory_type: MemoryType;
  owner_wallet: string | null;
  created_at: string;
  tags: string[] | null;
  source: string | null;
  related_user: string | null;
  related_wallet: string | null;
}

function rowToInput(r: MemoryRow): TokenizeMemoryInput {
  return {
    hashId: r.hash_id,
    content: r.content,
    memory_type: r.memory_type,
    owner_wallet: r.owner_wallet,
    created_at: r.created_at,
    tags: r.tags ?? [],
    source: r.source,
    related_user: r.related_user,
    related_wallet: r.related_wallet,
  };
}

async function fetchBatch(batchSize: number): Promise<MemoryRow[]> {
  const db = getDb();
  const { data, error } = await db
    .from('memories')
    .select(
      'id, hash_id, content, memory_type, owner_wallet, created_at, tags, source, related_user, related_wallet',
    )
    .or('tokenization_status.is.null,tokenization_status.eq.failed')
    .order('importance', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(batchSize);

  if (error) {
    log.warn({ err: error }, 'backfill batch fetch failed');
    return [];
  }
  return (data ?? []) as MemoryRow[];
}

async function markSkipped(id: number, reason: string): Promise<void> {
  const db = getDb();
  await db
    .from('memories')
    .update({ tokenization_status: 'skipped' })
    .eq('id', id);
  log.debug({ id, reason }, 'memory marked skipped');
}

async function markFailed(id: number): Promise<void> {
  const db = getDb();
  await db
    .from('memories')
    .update({ tokenization_status: 'failed' })
    .eq('id', id);
}

async function applyMintPatch(
  id: number,
  patch: {
    content_hash: string;
    cnft_address: string;
    cnft_tree: string | null;
    cnft_leaf_index: number | null;
    cnft_tx_sig: string;
    tokenization_status: 'minted';
    tokenized_at: string;
  },
): Promise<void> {
  const db = getDb();
  await db.from('memories').update(patch).eq('id', id);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the backfill worker.
 *
 * Returns a stats summary. Honours `shouldStop()` and `maxDurationMs` to
 * exit cleanly on interrupt or budget exhaustion.
 */
export async function runPmpBackfill(
  opts: BackfillOptions = {},
): Promise<BackfillStats> {
  const batchSize = opts.batchSize ?? 25;
  const ratePerMinute = opts.ratePerMinute ?? 100;
  const intervalPerMemoryMs = Math.max(60_000 / ratePerMinute, 50);
  const start = Date.now();

  const stats: BackfillStats = {
    scanned: 0,
    minted: 0,
    skipped: 0,
    failed: 0,
    durationMs: 0,
  };

  const mint = getPdaMintClient();

  while (true) {
    if (opts.shouldStop?.()) {
      log.info({ stats }, 'backfill stopped via shouldStop');
      break;
    }
    if (opts.maxDurationMs && Date.now() - start > opts.maxDurationMs) {
      log.info({ stats }, 'backfill stopped: maxDurationMs reached');
      break;
    }
    if (opts.maxMemories && stats.minted >= opts.maxMemories) {
      log.info({ stats }, 'backfill stopped: maxMemories reached');
      break;
    }

    const batch = await fetchBatch(batchSize);
    if (batch.length === 0) {
      log.info({ stats }, 'backfill complete: no more pending memories');
      break;
    }

    for (const row of batch) {
      stats.scanned += 1;
      try {
        if (row.source && SKIP_SOURCES.has(row.source)) {
          await markSkipped(row.id, 'source-skiplist');
          stats.skipped += 1;
          continue;
        }

        const result = await tokenizeMemory(rowToInput(row), mint);
        await applyMintPatch(row.id, result.patch);
        stats.minted += 1;

        // Pace between mints so we hit the target rate (not just the batch
        // boundary). The batch fetch itself is amortised across the batch.
        await sleep(intervalPerMemoryMs);
      } catch (err) {
        log.warn(
          { err, memoryId: row.id, hashId: row.hash_id },
          'backfill: tokenizeMemory failed',
        );
        await markFailed(row.id).catch(() => undefined);
        stats.failed += 1;
        // Don't break the loop — keep going on next memory.
      }
    }
  }

  stats.durationMs = Date.now() - start;
  log.info({ stats }, 'backfill run complete');
  return stats;
}
