/**
 * PMP backfill worker — batch mode.
 *
 * Tokenises memories that predate the PMP rollout (or had their first mint
 * attempt fail). Commits memories in BATCHES: one Merkle root on-chain per
 * batch instead of one transaction per memory. A 100k-memory backfill is
 * ~100 transactions instead of 100k.
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
 *   These rows are marked 'skipped' and excluded from the Merkle tree.
 *
 * Per batch:
 *   1. Fetch up to batchSize candidate rows.
 *   2. Partition into skip-list rows (marked 'skipped') and eligible rows.
 *   3. tokenizeMemoryBatch() over the eligible rows — ONE on-chain commit.
 *   4. Apply each member's row patch (content_hash, cnft_tree=batch root,
 *      cnft_leaf_index, status='minted').
 *   5. Record the batch in `memory_batches` so inclusion proofs can be
 *      regenerated later.
 *   If the single batch commit throws, every eligible row in that batch is
 *   marked 'failed' so a future run retries it.
 *
 * Resumable: state lives on memories.tokenization_status, not in the worker.
 * A crash mid-run just means re-triggering picks up the still-NULL/'failed'
 * rows.
 */

import { randomBytes } from 'node:crypto';
import { createChildLogger } from '@clude/shared/core/logger';
import { getDb } from '@clude/shared/core/database';
import {
  tokenizeMemoryBatch,
  type TokenizeBatchMemberInput,
  type TokenizeMemoryPatch,
  type BatchCommitment,
  type MemoryType,
} from '@clude/tokenization';
import { getPdaMintClient } from './pda-mint-client.js';

const log = createChildLogger('pmp-backfill');

const SKIP_SOURCES = new Set(['locomo-benchmark', 'longmemeval-benchmark']);

export interface BackfillOptions {
  /** How many rows to fetch per batch (and commit with one on-chain write). */
  batchSize?: number;
  /**
   * Max batch commits per minute. One batch = one on-chain transaction, so
   * this throttles RPC pressure. Effective memory throughput is roughly
   * `ratePerMinute × batchSize`.
   */
  ratePerMinute?: number;
  /** Stop after this many memories tokenised. Undefined = run until empty. */
  maxMemories?: number;
  /** Stop after this many milliseconds. Undefined = no time limit. */
  maxDurationMs?: number;
  /** Bail-out flag the caller can flip (e.g. on SIGTERM). */
  shouldStop?: () => boolean;
  /**
   * Called once per completed batch with a snapshot of cumulative stats.
   * Lets a long-running caller (e.g. the admin endpoint) surface live
   * progress without waiting for the whole run to finish.
   */
  onProgress?: (stats: BackfillStats) => void;
}

export interface BackfillStats {
  /** Rows fetched and considered. */
  scanned: number;
  /** Memories successfully tokenised. */
  minted: number;
  /** Rows skipped (skip-list sources). */
  skipped: number;
  /** Memories whose batch commit failed (left for retry). */
  failed: number;
  /** Number of on-chain batch commitments made. */
  batches: number;
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

function rowToInput(r: MemoryRow): TokenizeBatchMemberInput {
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

function generateBatchId(): string {
  return `batch-${randomBytes(6).toString('hex')}`;
}

async function fetchBatch(limit: number): Promise<MemoryRow[]> {
  const db = getDb();
  const { data, error } = await db
    .from('memories')
    .select(
      'id, hash_id, content, memory_type, owner_wallet, created_at, tags, source, related_user, related_wallet',
    )
    .or('tokenization_status.is.null,tokenization_status.eq.failed')
    .order('importance', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    log.warn({ err: error }, 'backfill batch fetch failed');
    return [];
  }
  return (data ?? []) as MemoryRow[];
}

async function markStatus(ids: number[], status: 'skipped' | 'failed'): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  await db.from('memories').update({ tokenization_status: status }).in('id', ids);
}

async function applyMintPatch(id: number, patch: TokenizeMemoryPatch): Promise<void> {
  const db = getDb();
  await db.from('memories').update(patch).eq('id', id);
}

async function recordBatch(
  batchId: string,
  merkleRoot: string,
  leaves: string[],
  commitment: BatchCommitment,
): Promise<void> {
  const db = getDb();
  const { error } = await db.from('memory_batches').insert({
    batch_id: batchId,
    merkle_root: merkleRoot,
    memory_count: leaves.length,
    leaves,
    commitment_asset: commitment.assetId,
    commitment_tx_sig: commitment.txSig,
    chain: commitment.chain,
  });
  if (error) {
    // The on-chain commit already succeeded and the memory rows are patched.
    // A missing batch record only costs us proof-regeneration convenience —
    // log loudly but don't fail the run.
    log.error({ err: error, batchId }, 'backfill: memory_batches insert failed');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run the backfill worker in batch mode.
 *
 * Returns a stats summary. Honours `shouldStop()`, `maxMemories`, and
 * `maxDurationMs` to exit cleanly.
 */
export async function runPmpBackfill(
  opts: BackfillOptions = {},
): Promise<BackfillStats> {
  const batchSize = Math.max(opts.batchSize ?? 25, 1);
  const ratePerMinute = Math.max(opts.ratePerMinute ?? 100, 1);
  const interBatchMs = Math.max(60_000 / ratePerMinute, 200);
  const start = Date.now();

  const stats: BackfillStats = {
    scanned: 0,
    minted: 0,
    skipped: 0,
    failed: 0,
    batches: 0,
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

    // Cap the final batch so we don't overshoot maxMemories.
    const remaining = opts.maxMemories ? opts.maxMemories - stats.minted : batchSize;
    const fetchLimit = Math.min(batchSize, Math.max(remaining, 1));
    const rows = await fetchBatch(fetchLimit);
    if (rows.length === 0) {
      log.info({ stats }, 'backfill complete: no more pending memories');
      break;
    }
    stats.scanned += rows.length;

    // Partition: skip-list rows vs eligible rows.
    const skipRows = rows.filter((r) => r.source !== null && SKIP_SOURCES.has(r.source));
    const eligible = rows.filter((r) => !(r.source !== null && SKIP_SOURCES.has(r.source)));

    if (skipRows.length > 0) {
      await markStatus(skipRows.map((r) => r.id), 'skipped').catch((err) =>
        log.warn({ err }, 'backfill: markSkipped failed'),
      );
      stats.skipped += skipRows.length;
    }

    if (eligible.length > 0) {
      const batchId = generateBatchId();
      try {
        const result = await tokenizeMemoryBatch(
          batchId,
          eligible.map(rowToInput),
          mint,
        );

        // Apply each member's patch to its row. Members are returned in input
        // order; map by hash_id to be robust regardless.
        const rowIdByHashId = new Map(eligible.map((r) => [r.hash_id, r.id]));
        for (const member of result.members) {
          const rowId = rowIdByHashId.get(member.hashId);
          if (rowId !== undefined) {
            await applyMintPatch(rowId, member.patch);
          }
        }

        await recordBatch(batchId, result.batchRoot, result.tree.leaves, result.commitment);

        stats.minted += result.members.length;
        stats.batches += 1;
        log.info(
          { batchId, count: result.members.length, root: result.batchRoot.slice(0, 16) },
          'backfill: batch committed',
        );
      } catch (err) {
        log.warn(
          { err, batchId, count: eligible.length },
          'backfill: tokenizeMemoryBatch failed; marking batch failed for retry',
        );
        await markStatus(eligible.map((r) => r.id), 'failed').catch(() => undefined);
        stats.failed += eligible.length;
      }
    }

    stats.durationMs = Date.now() - start;
    opts.onProgress?.({ ...stats });

    await sleep(interBatchMs);
  }

  stats.durationMs = Date.now() - start;
  log.info({ stats }, 'backfill run complete');
  return stats;
}
