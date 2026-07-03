/**
 * Memory 3.0 C2 — durable enrichment outbox worker (packages/brain side).
 *
 * Drains memory_write_jobs: for each claimed 'enrich' job it rehydrates the write options from the
 * memories row (decrypting content), runs the embed → link → extract pipeline in the memory's OWNER
 * CONTEXT (so autoLinkMemory / the embed tag-pass scope to the right tenant off the bare poller
 * tick), and writes the job's terminal state. All idempotent, all crash-safe:
 *   - the claim RPC (migration 045) atomically flips pending/failed-due AND stale-'running' jobs to
 *     'running' and increments attempts, so a crashed worker's job is reclaimed after the stale
 *     window and every claim costs exactly one attempt (bounds poison pills);
 *   - a per-job hard timeout (well below the reclaim window) turns a hung enricher into a throw, so
 *     a slow job can never be double-claimed while still running;
 *   - failures back off exponentially with jitter and go terminal after MAX_ATTEMPTS.
 * Nothing thrown here escapes runMemoryWriteJob: every outcome is written to the job row.
 */
import { getDb } from '@clude/shared/core/database';
import { withOwnerWallet } from '@clude/shared/core/owner-context';
import { createChildLogger } from '@clude/shared/core/logger';
import { SCOPE_BOT_OWN, runEnrichPipeline, type StoreMemoryOptions } from './memory';
import { decryptOneContent } from './memory-decryption';

const log = createChildLogger('outbox-worker');

const BASE_RETRY_SEC = 30;
const CAP_RETRY_SEC = 3600;
const MAX_ATTEMPTS = 6;
const JOB_TIMEOUT_MS = 120_000; // MUST stay << the claim RPC's p_stale_running (15 min) so a normal
// job completes or times out long before it could be reclaimed as stale.

export interface ClaimedJob {
  id: number;
  memory_id: number;
  job_type: string;
  attempts: number;
  owner_wallet: string | null;
}

function withTimeout<T>(ms: number, work: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`outbox job timed out after ${ms}ms`)), ms);
    work().then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Rehydrate StoreMemoryOptions from the persisted row; null if the memory was deleted or undecryptable. */
async function rehydrateOpts(memoryId: number): Promise<StoreMemoryOptions | null> {
  const db = getDb();
  const { data: row } = await db
    .from('memories')
    .select('id, content, summary, tags, source, related_user, related_wallet, memory_type, evidence_ids, encrypted, metadata')
    .eq('id', memoryId)
    .maybeSingle();
  if (!row) return null; // memory deleted since enqueue → nothing to enrich (job marked done)

  const content = await decryptOneContent({ id: row.id as number, content: row.content as string, encrypted: row.encrypted === true });
  if (content === null) return null; // encrypted + undecryptable (revoked): skip, mark done

  return {
    type: row.memory_type as StoreMemoryOptions['type'],
    content,
    summary: (row.summary as string) ?? '',
    tags: (row.tags as string[]) ?? undefined,
    source: (row.source as string) ?? 'outbox',
    relatedUser: (row.related_user as string) ?? undefined,
    relatedWallet: (row.related_wallet as string) ?? undefined,
    evidenceIds: (row.evidence_ids as number[]) ?? undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? undefined,
  };
}

async function markDone(jobId: number): Promise<void> {
  await getDb().from('memory_write_jobs').update({ status: 'done', last_error: null, updated_at: new Date().toISOString() }).eq('id', jobId);
}

async function markFailed(job: ClaimedJob, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const db = getDb();
  if (job.attempts >= MAX_ATTEMPTS) {
    // Terminal: next_retry_at NULL makes the claim predicate skip it permanently.
    await db.from('memory_write_jobs').update({ status: 'failed', next_retry_at: null, last_error: message, updated_at: new Date().toISOString() }).eq('id', job.id);
    log.error({ memory_id: job.memory_id, job_type: job.job_type, attempts: job.attempts, err: message }, 'outbox job terminal (max attempts)');
    return;
  }
  const delaySec = Math.min(BASE_RETRY_SEC * 2 ** (job.attempts - 1), CAP_RETRY_SEC);
  const jitterSec = delaySec * (deterministicJitter(job.id) * 0.2); // 0..20%, deterministic per job (no Math.random)
  const nextRetry = new Date(Date.now() + (delaySec + jitterSec) * 1000).toISOString();
  await db.from('memory_write_jobs').update({ status: 'failed', next_retry_at: nextRetry, last_error: message, updated_at: new Date().toISOString() }).eq('id', job.id);
  log.warn({ memory_id: job.memory_id, job_type: job.job_type, attempts: job.attempts, retry_sec: Math.round(delaySec + jitterSec), err: message }, 'outbox job failed, backing off');
}

/** Deterministic 0..1 jitter from the job id (avoids Math.random; spreads retries across jobs). */
function deterministicJitter(jobId: number): number {
  const x = Math.sin(jobId * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

/** Run one claimed job to completion, writing its terminal state. NEVER throws. */
export async function runMemoryWriteJob(job: ClaimedJob): Promise<void> {
  try {
    // reconcile / backfill_v2 are C1 territory — accept as a no-op success so a stray enqueue
    // never wedges the queue.
    if (job.job_type !== 'enrich') {
      await markDone(job.id);
      return;
    }

    const opts = await rehydrateOpts(job.memory_id);
    if (opts === null) {
      await markDone(job.id); // memory gone or undecryptable — nothing to do, do not retry forever
      return;
    }

    // owner_wallet NULL = bot-own → SCOPE_BOT_OWN, matching the write-path fail-closed convention.
    const scope = job.owner_wallet ?? SCOPE_BOT_OWN;
    await withOwnerWallet(scope, () => withTimeout(JOB_TIMEOUT_MS, () => runEnrichPipeline(job.memory_id, opts)));

    await markDone(job.id);
  } catch (err) {
    try {
      await markFailed(job, err);
    } catch (writeErr) {
      // Even the failure-write failed (DB down). The job stays 'running' and the stale reclaim
      // recovers it after p_stale_running. Log and move on; never rethrow.
      log.error({ memory_id: job.memory_id, err: writeErr instanceof Error ? writeErr.message : String(writeErr) }, 'outbox job: failed to record failure (stale reclaim will recover)');
    }
  }
}

/** Claim a batch and run each job sequentially. Throws only if the claim RPC itself errors (caller catches). */
export async function drainWriteJobsOnce(limit = 20): Promise<{ examined: number }> {
  const { data: jobs, error } = await getDb().rpc('claim_memory_write_jobs', {
    p_limit: limit,
    p_stale_running: '15 minutes',
    p_owner: null,
  });
  if (error) throw error; // RPC missing (045 unapplied) or DB error → poller catches, logs, retries next tick
  for (const j of (jobs ?? []) as ClaimedJob[]) {
    await runMemoryWriteJob(j);
  }
  return { examined: (jobs ?? []).length };
}
