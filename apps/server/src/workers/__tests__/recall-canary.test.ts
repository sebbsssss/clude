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

// ---- migration profile mock ------------------------------------------------
// Controls the active embedding space so we can exercise both the Voyage (default)
// and Vertex (post-GCP-cutover) recall lanes. Mirrors the real 2-line resolver in
// packages/shared/src/core/migration-profile.ts: vectorRpcName appends `_vertex`
// iff the active space is vertex.
const migration = vi.hoisted(() => ({ space: 'voyage' as 'voyage' | 'vertex' }));

vi.mock('@clude/shared/core/migration-profile', () => ({
  activeEmbeddingSpace: () => migration.space,
  vectorRpcName: (base: string) => (migration.space === 'vertex' ? `${base}_vertex` : base),
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
  inserts: [] as Array<{ table: string; rows: any }>,
}));

const mockDb = {
  from: (table: string) => ({
    insert: (rows: unknown) => {
      state.inserts.push({ table, rows });
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

// Same shape as healthyRpcResults but under the _vertex RPC names the canary must
// probe once EMBEDDING_ACTIVE=vertex. get_linked_memories is embedding-agnostic and
// keeps its base name in both spaces.
function healthyVertexRpcResults() {
  state.rpcResults.set('match_memories_vertex', { data: [{ id: 11, similarity: 1.0 }], error: null });
  state.rpcResults.set('match_memory_fragments_vertex', { data: [{ memory_id: 11, max_similarity: 1.0 }], error: null });
  state.rpcResults.set('match_memories_temporal_vertex', { data: [{ id: 11, similarity: 1.0 }], error: null });
  state.rpcResults.set('get_linked_memories', { data: [{ memory_id: 12, linked_from: 11, link_type: 'relates', strength: 0.9 }], error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  migration.space = 'voyage';
  state.insertResult = { data: [{ id: 11 }, { id: 12 }], error: null };
  state.fragInsertError = null;
  state.linkInsertError = null;
  state.rpcResults.clear();
  state.rpcCalls.length = 0;
  state.deletes.length = 0;
  state.inserts.length = 0;
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

describe('runRecallCanary — embedding-space routing (GCP Voyage→Vertex cutover)', () => {
  const memRows = () => state.inserts.find((i) => i.table === 'memories')!.rows as any[];
  const fragRow = () => state.inserts.find((i) => i.table === 'memory_fragments')!.rows as any;

  it('probes the Voyage base lanes and seeds the embedding column by default (dormant-safe)', async () => {
    healthyRpcResults();
    await runRecallCanary();

    const probed = state.rpcCalls.map((c) => c.name);
    expect(probed).toEqual(expect.arrayContaining(ALL_LANES));
    expect(probed.some((n) => n.endsWith('_vertex'))).toBe(false);

    for (const row of memRows()) {
      expect(row.embedding).toBeDefined();
      expect(row.embedding_vertex).toBeUndefined();
    }
    expect(fragRow().embedding).toBeDefined();
    expect(fragRow().embedding_vertex).toBeUndefined();
  });

  it('routes the three vector lanes through the _vertex RPCs when EMBEDDING_ACTIVE=vertex', async () => {
    migration.space = 'vertex';
    healthyVertexRpcResults();

    const report = await runRecallCanary();

    expect(report.healthy).toBe(true);
    const probed = state.rpcCalls.map((c) => c.name);
    expect(probed).toEqual(
      expect.arrayContaining([
        'match_memories_vertex',
        'match_memory_fragments_vertex',
        'match_memories_temporal_vertex',
        'get_linked_memories', // embedding-agnostic — never suffixed
      ]),
    );
    // The Voyage lane must NOT be probed while vertex is active — that was the bug.
    expect(probed).not.toContain('match_memories');
    expect(logSpies.error).not.toHaveBeenCalled();
  });

  it('seeds the sentinel embedding into embedding_vertex (not embedding) when vertex is active', async () => {
    migration.space = 'vertex';
    healthyVertexRpcResults();

    await runRecallCanary();

    const rows = memRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.embedding_vertex).toBeDefined();
      expect(row.embedding).toBeUndefined();
    }
    expect(fragRow().embedding_vertex).toBeDefined();
    expect(fragRow().embedding).toBeUndefined();
  });

  it('catches a silently broken vertex lane during cutover (empty vertex probe → unhealthy + ERROR)', async () => {
    migration.space = 'vertex';
    healthyVertexRpcResults();
    state.rpcResults.set('match_memories_vertex', { data: [], error: null }); // vertex lane silently dead

    const report = await runRecallCanary();

    expect(report.healthy).toBe(false);
    // The report key stays the stable logical lane name; only the probed RPC is suffixed.
    expect(report.lanes.match_memories.ok).toBe(false);
    expect(report.lanes.match_memory_fragments.ok).toBe(true);
    expect(logSpies.error).toHaveBeenCalledWith(
      expect.objectContaining({ broken: ['match_memories'] }),
      expect.stringContaining('RECALL CANARY FAILED'),
    );
  });
});
