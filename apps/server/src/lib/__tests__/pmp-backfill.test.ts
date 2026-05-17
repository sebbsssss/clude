/**
 * Tests for the batch-mode backfill worker.
 *
 * The Supabase client and the MintClient are mocked. The real
 * tokenizeMemoryBatch primitive runs (it's pure — it just needs a
 * MintClient, and we hand it a FakeMintClient).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMintClient, type MintClient } from '@clude/tokenization';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Supabase mock ──
interface FakeMemoryRow {
  id: number;
  hash_id: string;
  content: string;
  memory_type: string;
  owner_wallet: string | null;
  created_at: string;
  tags: string[] | null;
  source: string | null;
  related_user: string | null;
  related_wallet: string | null;
}

let batchQueue: FakeMemoryRow[][] = [];
let updateCalls: Array<{ table: string; patch: Record<string, unknown>; where: Record<string, unknown> }> = [];
let insertCalls: Array<{ table: string; rows: Record<string, unknown> }> = [];

function makeChain(table: string) {
  let op: 'select' | 'update' | 'insert' | null = null;
  let pendingPatch: Record<string, unknown> = {};
  let pendingInsert: Record<string, unknown> = {};
  const where: Record<string, unknown> = {};
  const chain: Record<string, unknown> = {
    select: () => {
      op = 'select';
      return chain;
    },
    or: () => chain,
    order: () => chain,
    eq: (c: string, v: unknown) => {
      where[c] = v;
      return chain;
    },
    in: (c: string, v: unknown) => {
      where[c] = v;
      return chain;
    },
    limit: () => chain,
    update: (p: Record<string, unknown>) => {
      op = 'update';
      pendingPatch = p;
      return chain;
    },
    insert: (r: Record<string, unknown>) => {
      op = 'insert';
      pendingInsert = r;
      return chain;
    },
    then: (resolve: (v: { data: unknown; error: unknown }) => unknown) => {
      let result: { data: unknown; error: unknown };
      if (op === 'select') {
        result = { data: batchQueue.shift() ?? [], error: null };
      } else if (op === 'update') {
        updateCalls.push({ table, patch: pendingPatch, where: { ...where } });
        result = { data: null, error: null };
      } else if (op === 'insert') {
        insertCalls.push({ table, rows: pendingInsert });
        result = { data: null, error: null };
      } else {
        result = { data: null, error: null };
      }
      return Promise.resolve(result).then(resolve);
    },
  };
  return chain;
}

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({ from: (table: string) => makeChain(table) }),
}));

// ── MintClient mock ──
let mintClient: MintClient = new FakeMintClient();
vi.mock('../pda-mint-client.js', () => ({
  getPdaMintClient: () => mintClient,
}));

import { runPmpBackfill } from '../pmp-backfill.js';

function row(i: number, source: string | null = 'chat'): FakeMemoryRow {
  return {
    id: 1000 + i,
    hash_id: `clude-${String(i).padStart(8, '0')}`,
    content: `memory content ${i}`,
    memory_type: 'episodic',
    owner_wallet: i % 2 === 0 ? null : `wallet-${i}`,
    created_at: `2026-05-17T10:0${i % 10}:00.000Z`,
    tags: [`t${i}`],
    source,
    related_user: null,
    related_wallet: null,
  };
}

// Fast tests: huge rate → interBatchMs hits its 200ms floor; few batches keeps it ~sub-second.
const FAST = { ratePerMinute: 100_000 };

beforeEach(() => {
  batchQueue = [];
  updateCalls = [];
  insertCalls = [];
  mintClient = new FakeMintClient();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('runPmpBackfill — batch mode', () => {
  it('commits a batch and patches every memory row', async () => {
    batchQueue = [[row(0), row(1), row(2)], []];
    const stats = await runPmpBackfill({ batchSize: 10, ...FAST });

    expect(stats.scanned).toBe(3);
    expect(stats.minted).toBe(3);
    expect(stats.skipped).toBe(0);
    expect(stats.failed).toBe(0);
    expect(stats.batches).toBe(1);

    // Three row patches applied to `memories`, each with minted status + batch root.
    const memoryUpdates = updateCalls.filter((u) => u.table === 'memories');
    expect(memoryUpdates).toHaveLength(3);
    for (const u of memoryUpdates) {
      expect(u.patch.tokenization_status).toBe('minted');
      expect(typeof u.patch.cnft_tree).toBe('string'); // batch root, non-null
      expect(typeof u.patch.cnft_leaf_index).toBe('number');
    }

    // One memory_batches record.
    const batchInserts = insertCalls.filter((i) => i.table === 'memory_batches');
    expect(batchInserts).toHaveLength(1);
    expect(batchInserts[0]!.rows.memory_count).toBe(3);
    expect(Array.isArray(batchInserts[0]!.rows.leaves)).toBe(true);
  });

  it('excludes skip-list sources from the batch and marks them skipped', async () => {
    batchQueue = [
      [row(0), row(1, 'locomo-benchmark'), row(2), row(3, 'longmemeval-benchmark')],
      [],
    ];
    const stats = await runPmpBackfill({ batchSize: 10, ...FAST });

    expect(stats.scanned).toBe(4);
    expect(stats.minted).toBe(2); // only the 2 non-skip-list rows
    expect(stats.skipped).toBe(2);
    expect(stats.batches).toBe(1);

    // The skip rows were marked 'skipped' via an .in() update.
    const skipUpdate = updateCalls.find(
      (u) => u.table === 'memories' && u.patch.tokenization_status === 'skipped',
    );
    expect(skipUpdate).toBeTruthy();
    expect(skipUpdate!.where.id).toEqual([1001, 1003]);

    // The batch only contains the 2 eligible memories.
    const batchInsert = insertCalls.find((i) => i.table === 'memory_batches');
    expect(batchInsert!.rows.memory_count).toBe(2);
  });

  it('marks the whole batch failed when the on-chain commit throws', async () => {
    // A mint client whose batch commit always throws.
    const failing = new FakeMintClient();
    failing.commitMemoryBatch = vi.fn().mockRejectedValue(new Error('RPC down'));
    mintClient = failing;

    batchQueue = [[row(0), row(1), row(2)], []];
    const stats = await runPmpBackfill({ batchSize: 10, ...FAST });

    expect(stats.minted).toBe(0);
    expect(stats.failed).toBe(3);
    expect(stats.batches).toBe(0);

    // All three rows marked 'failed' via .in().
    const failUpdate = updateCalls.find(
      (u) => u.table === 'memories' && u.patch.tokenization_status === 'failed',
    );
    expect(failUpdate).toBeTruthy();
    expect(failUpdate!.where.id).toEqual([1000, 1001, 1002]);

    // No batch record written.
    expect(insertCalls.filter((i) => i.table === 'memory_batches')).toHaveLength(0);
  });

  it('stops when the fetch returns no rows', async () => {
    batchQueue = [[]];
    const stats = await runPmpBackfill({ ...FAST });
    expect(stats.scanned).toBe(0);
    expect(stats.minted).toBe(0);
    expect(stats.batches).toBe(0);
  });

  it('honours maxMemories — caps the run and the final fetch', async () => {
    // Plenty of rows available; maxMemories should cap minted at 2.
    batchQueue = [[row(0), row(1)], [row(2), row(3)], []];
    const stats = await runPmpBackfill({ batchSize: 2, maxMemories: 2, ...FAST });
    expect(stats.minted).toBe(2);
    expect(stats.batches).toBe(1);
  });

  it('honours shouldStop', async () => {
    batchQueue = [[row(0)], [row(1)], [row(2)], []];
    let calls = 0;
    const stats = await runPmpBackfill({
      batchSize: 1,
      ...FAST,
      shouldStop: () => {
        calls += 1;
        return calls > 1; // allow the first iteration, stop before the second
      },
    });
    expect(stats.minted).toBe(1);
  });

  it('processes multiple batches until the queue drains', async () => {
    batchQueue = [[row(0), row(1)], [row(2), row(3)], [row(4)], []];
    const stats = await runPmpBackfill({ batchSize: 2, ...FAST });
    expect(stats.scanned).toBe(5);
    expect(stats.minted).toBe(5);
    expect(stats.batches).toBe(3);
    expect(insertCalls.filter((i) => i.table === 'memory_batches')).toHaveLength(3);
  });
});
