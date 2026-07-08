import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Recall canary (Memory 3.0 · C0): the guarantee under test is that every recall
 * RPC lane is probed with an owner-scoped sentinel, that an empty/erroring lane
 * flips the report unhealthy and logs at ERROR level (the alert surface), and
 * that sentinels are cleaned up whatever the outcome.
 *
 * SITE_ONLY short-circuits config env validation at import; vi.hoisted runs
 * before static imports (memory-integrity test pattern).
 */
vi.hoisted(() => {
  process.env.SITE_ONLY = 'true';
});

const logSpies = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => logSpies,
}));

// ---- DB mock ---------------------------------------------------------------
// Chainable Supabase-lite: memories.insert().select() resolves sentinel ids;
// fragment/link inserts resolve directly; deletes are recorded; rpc() answers
// from a per-test map and records every call.
const state = vi.hoisted(() => ({
  insertResult: { data: [{ id: 11 }, { id: 12 }], error: null } as { data: Array<{ id: number }> | null; error: { message: string } | null },
  fragInsertError: null as { message: string } | null,
  linkInsertError: null as { message: string } | null,
  rpcResults: new Map<string, { data: unknown; error: { message: string } | null }>(),
  rpcCalls: [] as Array<{ name: string; args: any }>,
  deletes: [] as Array<{ table: string; col: string; val: string }>,
}));

const mockDb = {
  from: (table: string) => ({
    insert: (_rows: unknown) => {
      if (table === 'memories') {
        return { select: (_cols: string) => Promise.resolve(state.insertResult) };
      }
      const error = table === 'memory_fragments' ? state.fragInsertError : state.linkInsertError;
      return Promise.resolve({ error });
    },
    delete: () => ({
      eq: (col: string, val: string) => {
        state.deletes.push({ table, col, val });
        return Promise.resolve({ error: null });
      },
    }),
  }),
  rpc: (name: string, args: any) => {
    state.rpcCalls.push({ name, args });
    return Promise.resolve(state.rpcResults.get(name) ?? { data: [], error: null });
  },
};

vi.mock('@clude/shared/core/database', () => ({ getDb: () => mockDb }));

import { runRecallCanary, canaryEmbedding, getLastCanaryReport, CANARY_OWNER } from '../recall-canary';

const ALL_LANES = ['match_memories', 'match_memory_fragments', 'match_memories_temporal', 'get_linked_memories'];

function healthyRpcResults() {
  state.rpcResults.set('match_memories', { data: [{ id: 11, similarity: 1.0 }], error: null });
  state.rpcResults.set('match_memory_fragments', { data: [{ memory_id: 11, max_similarity: 1.0 }], error: null });
  state.rpcResults.set('match_memories_temporal', { data: [{ id: 11, similarity: 1.0 }], error: null });
  state.rpcResults.set('get_linked_memories', { data: [{ memory_id: 12, linked_from: 11, link_type: 'relates', strength: 0.9 }], error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.insertResult = { data: [{ id: 11 }, { id: 12 }], error: null };
  state.fragInsertError = null;
  state.linkInsertError = null;
  state.rpcResults.clear();
  state.rpcCalls.length = 0;
  state.deletes.length = 0;
});

describe('canaryEmbedding', () => {
  it('is a deterministic 1024-dim unit vector', () => {
    const a = canaryEmbedding();
    const b = canaryEmbedding();
    expect(a).toHaveLength(1024);
    expect(a).toEqual(b);
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 6);
  });
});

describe('runRecallCanary', () => {
  it('probes all four lanes owner-scoped and reports healthy when every lane hits', async () => {
    healthyRpcResults();
    const report = await runRecallCanary();

    expect(report.healthy).toBe(true);
    expect(Object.keys(report.lanes).sort()).toEqual([...ALL_LANES].sort());
    for (const lane of ALL_LANES) expect(report.lanes[lane].ok).toBe(true);

    // Every RPC probe is scoped to the canary owner — never tenant data.
    expect(state.rpcCalls).toHaveLength(4);
    for (const call of state.rpcCalls) {
      expect(call.args.filter_owner).toBe(CANARY_OWNER);
    }
    expect(logSpies.error).not.toHaveBeenCalled();
    expect(getLastCanaryReport()).toEqual(report);
  });

  it('flips unhealthy and logs ERROR when the vector lane returns empty (migration-028 class)', async () => {
    healthyRpcResults();
    state.rpcResults.set('match_memories', { data: [], error: null }); // silent lane death

    const report = await runRecallCanary();

    expect(report.healthy).toBe(false);
    expect(report.lanes.match_memories.ok).toBe(false);
    expect(report.lanes.match_memories.error).toBeNull(); // no error — EMPTY is the failure
    expect(report.lanes.match_memory_fragments.ok).toBe(true);
    expect(logSpies.error).toHaveBeenCalledWith(
      expect.objectContaining({ broken: ['match_memories'] }),
      expect.stringContaining('RECALL CANARY FAILED'),
    );
  });

  it('captures an RPC error as a lane failure without killing the other probes', async () => {
    healthyRpcResults();
    state.rpcResults.set('match_memories_temporal', { data: null, error: { message: 'function does not exist' } });

    const report = await runRecallCanary();

    expect(report.healthy).toBe(false);
    expect(report.lanes.match_memories_temporal.ok).toBe(false);
    expect(report.lanes.match_memories_temporal.error).toContain('function does not exist');
    // The other three lanes were still probed.
    expect(state.rpcCalls.map((c) => c.name)).toEqual(expect.arrayContaining(ALL_LANES));
  });

  it('reports every lane unknown-broken when sentinel seeding fails, and probes nothing', async () => {
    state.insertResult = { data: null, error: { message: 'permission denied' } };

    const report = await runRecallCanary();

    expect(report.healthy).toBe(false);
    for (const lane of ALL_LANES) {
      expect(report.lanes[lane].ok).toBe(false);
      expect(report.lanes[lane].error).toContain('seed failed');
    }
    expect(state.rpcCalls).toHaveLength(0);
    expect(logSpies.error).toHaveBeenCalled();
  });

  it('marks only the link lane broken when the link seed fails', async () => {
    healthyRpcResults();
    state.linkInsertError = { message: 'constraint violation' };

    const report = await runRecallCanary();

    expect(report.healthy).toBe(false);
    expect(report.lanes.get_linked_memories.ok).toBe(false);
    expect(report.lanes.get_linked_memories.error).toContain('link seed failed');
    expect(report.lanes.match_memories.ok).toBe(true);
    // get_linked_memories RPC never fired — its seed was missing.
    expect(state.rpcCalls.map((c) => c.name)).not.toContain('get_linked_memories');
  });

  it('cleans up sentinels before seeding and after probing (crash-leftover safe)', async () => {
    healthyRpcResults();
    await runRecallCanary();

    const memoryDeletes = state.deletes.filter((d) => d.table === 'memories');
    expect(memoryDeletes).toHaveLength(2); // pre-clean + post-clean
    for (const d of memoryDeletes) {
      expect(d.col).toBe('owner_wallet');
      expect(d.val).toBe(CANARY_OWNER);
    }
  });
});
