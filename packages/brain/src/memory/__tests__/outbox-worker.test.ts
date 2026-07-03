import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Memory 3.0 C2 outbox worker. Guarantees under test: enrich runs in the job's owner context;
 * reconcile/backfill are no-op successes; a missing/undecryptable memory is done (not retried
 * forever); failures back off exponentially and go terminal (next_retry_at NULL) at MAX_ATTEMPTS;
 * a hung enricher times out (job written failed, never left running); the claim RPC drives the
 * drain and its error propagates to the caller. Nothing thrown escapes runMemoryWriteJob.
 *
 * SITE_ONLY short-circuits config validation; vi.hoisted runs before static imports.
 */
vi.hoisted(() => {
  process.env.SITE_ONLY = 'true';
});

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// withOwnerWallet passthrough that RECORDS the scope it was called with.
const ownerScopes: Array<string | null> = [];
vi.mock('@clude/shared/core/owner-context', () => ({
  withOwnerWallet: <T>(scope: string | null, fn: () => T | Promise<T>) => {
    ownerScopes.push(scope);
    return fn();
  },
}));

// Replace the whole ./memory module (huge, config-heavy) with just what the worker imports.
const runEnrichPipeline = vi.fn(async () => undefined);
vi.mock('../memory', () => ({
  SCOPE_BOT_OWN: '__BOT_OWN__',
  runEnrichPipeline: (...a: unknown[]) => runEnrichPipeline(...a),
}));

const decryptOneContent = vi.fn(async (row: { content: string }) => row.content);
vi.mock('../memory-decryption', () => ({ decryptOneContent: (...a: unknown[]) => decryptOneContent(...a) }));

// DB mock: records job updates + claim-RPC calls; serves a rehydrate row.
const jobUpdates: Array<{ patch: any; id: number }> = [];
let rehydrateRow: any = { id: 7, content: 'c', summary: 's', tags: ['t'], source: 'chat', related_user: null, related_wallet: null, memory_type: 'semantic', evidence_ids: [], encrypted: false, metadata: {} };
let claimResult: { data: any; error: any } = { data: [], error: null };

const mockDb = {
  from: (table: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: table === 'memories' ? rehydrateRow : null }) }) }),
    update: (patch: any) => ({ eq: (_c: string, id: number) => { jobUpdates.push({ patch, id }); return Promise.resolve({ error: null }); } }),
  }),
  rpc: (_name: string, _args: unknown) => Promise.resolve(claimResult),
};
vi.mock('@clude/shared/core/database', () => ({ getDb: () => mockDb }));

import { runMemoryWriteJob, drainWriteJobsOnce, type ClaimedJob } from '../outbox-worker';

const job = (over: Partial<ClaimedJob> = {}): ClaimedJob => ({ id: 100, memory_id: 7, job_type: 'enrich', attempts: 1, owner_wallet: 'wallet-A', ...over });

beforeEach(() => {
  vi.clearAllMocks();
  ownerScopes.length = 0;
  jobUpdates.length = 0;
  rehydrateRow = { id: 7, content: 'c', summary: 's', tags: ['t'], source: 'chat', related_user: null, related_wallet: null, memory_type: 'semantic', evidence_ids: [], encrypted: false, metadata: {} };
  claimResult = { data: [], error: null };
  runEnrichPipeline.mockResolvedValue(undefined);
  decryptOneContent.mockImplementation(async (row: { content: string }) => row.content);
});

describe('runMemoryWriteJob — enrich', () => {
  it('runs the pipeline in the job owner context and marks done', async () => {
    await runMemoryWriteJob(job({ owner_wallet: 'wallet-A' }));
    expect(ownerScopes).toEqual(['wallet-A']);
    expect(runEnrichPipeline).toHaveBeenCalledWith(7, expect.objectContaining({ type: 'semantic', content: 'c' }));
    expect(jobUpdates).toEqual([{ patch: expect.objectContaining({ status: 'done', last_error: null }), id: 100 }]);
  });

  it('maps a null owner_wallet to SCOPE_BOT_OWN (fail-closed convention)', async () => {
    await runMemoryWriteJob(job({ owner_wallet: null }));
    expect(ownerScopes).toEqual(['__BOT_OWN__']);
  });

  it('decrypts encrypted content before enriching', async () => {
    rehydrateRow = { ...rehydrateRow, encrypted: true, content: 'CIPHER' };
    decryptOneContent.mockResolvedValue('PLAINTEXT');
    await runMemoryWriteJob(job());
    expect(runEnrichPipeline).toHaveBeenCalledWith(7, expect.objectContaining({ content: 'PLAINTEXT' }));
  });
});

describe('runMemoryWriteJob — non-retry terminals', () => {
  it('reconcile / backfill_v2 are no-op successes (pipeline never runs)', async () => {
    await runMemoryWriteJob(job({ job_type: 'reconcile' }));
    await runMemoryWriteJob(job({ job_type: 'backfill_v2' }));
    expect(runEnrichPipeline).not.toHaveBeenCalled();
    expect(jobUpdates.map((u) => u.patch.status)).toEqual(['done', 'done']);
  });

  it('a deleted memory is marked done (not retried forever)', async () => {
    rehydrateRow = null;
    await runMemoryWriteJob(job());
    expect(runEnrichPipeline).not.toHaveBeenCalled();
    expect(jobUpdates[0].patch.status).toBe('done');
  });

  it('an undecryptable (revoked) memory is marked done', async () => {
    rehydrateRow = { ...rehydrateRow, encrypted: true };
    decryptOneContent.mockResolvedValue(null);
    await runMemoryWriteJob(job());
    expect(runEnrichPipeline).not.toHaveBeenCalled();
    expect(jobUpdates[0].patch.status).toBe('done');
  });
});

describe('runMemoryWriteJob — failure backoff + terminal', () => {
  it('backs off exponentially on failure below MAX_ATTEMPTS', async () => {
    runEnrichPipeline.mockRejectedValue(new Error('embed 429'));
    for (const attempts of [1, 2, 3]) {
      jobUpdates.length = 0;
      const before = Date.now();
      await runMemoryWriteJob(job({ attempts }));
      const u = jobUpdates[0].patch;
      expect(u.status).toBe('failed');
      expect(u.last_error).toContain('embed 429');
      const base = 30 * 2 ** (attempts - 1);
      const delayMs = new Date(u.next_retry_at).getTime() - before;
      expect(delayMs).toBeGreaterThanOrEqual(base * 1000 - 500);
      expect(delayMs).toBeLessThanOrEqual(base * 1.2 * 1000 + 1500); // +20% jitter cap
    }
  });

  it('goes terminal at MAX_ATTEMPTS (status failed, next_retry_at null)', async () => {
    runEnrichPipeline.mockRejectedValue(new Error('boom'));
    await runMemoryWriteJob(job({ attempts: 6 }));
    expect(jobUpdates[0].patch).toEqual(expect.objectContaining({ status: 'failed', next_retry_at: null }));
  });

  it('a hung enricher is timed out and written failed (never left running)', async () => {
    vi.useFakeTimers();
    runEnrichPipeline.mockImplementation(() => new Promise(() => {})); // never resolves
    const p = runMemoryWriteJob(job({ attempts: 1 }));
    await vi.advanceTimersByTimeAsync(120_001);
    await p;
    expect(jobUpdates[0].patch.status).toBe('failed');
    expect(jobUpdates[0].patch.last_error).toContain('timed out');
    vi.useRealTimers();
  });
});

describe('drainWriteJobsOnce', () => {
  it('runs each claimed job and reports the count', async () => {
    claimResult = { data: [job({ id: 1 }), job({ id: 2 })], error: null };
    const { examined } = await drainWriteJobsOnce();
    expect(examined).toBe(2);
    expect(jobUpdates.map((u) => u.id)).toEqual([1, 2]); // both marked done, in order
  });

  it('propagates a claim-RPC error to the caller (poller catches it)', async () => {
    claimResult = { data: null, error: { message: 'function claim_memory_write_jobs does not exist' } };
    await expect(drainWriteJobsOnce()).rejects.toMatchObject({ message: expect.stringContaining('does not exist') });
  });
});
