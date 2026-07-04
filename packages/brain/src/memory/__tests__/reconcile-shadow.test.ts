import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Memory 3.0 C1 SHADOW reconciliation (LLM-free slice). Guarantees under test: cosine only
 * screens (>= LO → needs_router, never a cosine-only supersession); below LO → add; no embedding →
 * skip; self + already-invalidated candidates are dropped; the candidate query is owner-fenced by
 * the RESOLVED scope (never null); exactly one log row per call; the memories/memory_links tables
 * are NEVER written (mutation-free by construction); a missing log table degrades exactly once.
 *
 * Thresholds pinned via env so the test is independent of the config defaults. SITE_ONLY
 * short-circuits config validation; vi.hoisted runs before the static config import.
 */
vi.hoisted(() => {
  process.env.SITE_ONLY = 'true';
  process.env.MEMORY_RECONCILE_FLOOR = '0.5';
  process.env.MEMORY_RECONCILE_LO = '0.85';
  process.env.MEMORY_RECONCILE_HI = '0.95';
  delete process.env.BENCH_MODE;
});

// hoisted so the vi.mock factory (itself hoisted) can reference `warn` — the module calls
// createChildLogger at import time, before a plain `const warn` would be initialized.
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() }),
}));

const SCOPE_BOT_OWN = '__BOT_OWN__';

// DB mock: records reconciliation-log inserts + RPC args; serves configurable embedding / screen /
// hydrate responses; traps any write to memories or memory_links (must never happen in shadow).
const inserted: Array<Record<string, unknown>> = [];
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
const forbidden: string[] = [];
let hydrateScope: { method: 'eq' | 'is'; col: string; val: unknown } | null = null;
let hydrateIds: unknown[] | null = null;

let embeddingResp: { data: unknown; error: unknown };
let rpcResp: { data: unknown; error: unknown };
let hydrateResp: { data: unknown; error: unknown };
let insertResp: { error: unknown };

const mockDb = {
  from(table: string) {
    if (table === 'memory_reconciliation_log') {
      return { insert: (row: Record<string, unknown>) => { inserted.push(row); return Promise.resolve(insertResp); } };
    }
    if (table === 'memory_links') {
      return { insert: () => { forbidden.push('memory_links.insert'); return Promise.resolve({ error: null }); } };
    }
    if (table === 'memories') {
      return {
        select: (cols: string) => {
          if (cols.includes('embedding')) {
            return { eq: () => ({ maybeSingle: () => Promise.resolve(embeddingResp) }) };
          }
          const term = (method: 'eq' | 'is') => (col: string, val: unknown) => {
            hydrateScope = { method, col, val };
            return Promise.resolve(hydrateResp);
          };
          const builder: Record<string, unknown> = {};
          builder.in = (_col: string, arr: unknown[]) => { hydrateIds = arr; return builder; };
          builder.eq = term('eq');
          builder.is = term('is');
          return builder;
        },
        update: () => { forbidden.push('memories.update'); return { eq: () => Promise.resolve({ error: null }) }; },
      };
    }
    throw new Error('unexpected table ' + table);
  },
  rpc(name: string, args: Record<string, unknown>) { rpcCalls.push({ name, args }); return Promise.resolve(rpcResp); },
};
vi.mock('@clude/shared/core/database', () => ({ getDb: () => mockDb }));

// Router (slice 1.5) mocked: default OFF, so the >= LO branch logs needs_router exactly as slice 1.
const { isRouterConfigured, routerBudgetAvailable, noteRouterCall, routeReconcile } = vi.hoisted(() => ({
  isRouterConfigured: vi.fn(() => false),
  routerBudgetAvailable: vi.fn(() => true),
  noteRouterCall: vi.fn(),
  routeReconcile: vi.fn(),
}));
vi.mock('../reconcile-router', () => ({ isRouterConfigured, routerBudgetAvailable, noteRouterCall, routeReconcile }));

import { runReconcileShadow, _resetReconcileDegradeLog } from '../reconcile-shadow';

beforeEach(() => {
  vi.clearAllMocks();
  inserted.length = 0; rpcCalls.length = 0; forbidden.length = 0; hydrateScope = null; hydrateIds = null;
  embeddingResp = { data: { embedding: '[0.1,0.2,0.3]' }, error: null };
  rpcResp = { data: [{ id: 42, similarity: 0.9 }], error: null };
  hydrateResp = { data: [{ id: 42, owner_wallet: 'wallet-A', invalid_at: null }], error: null };
  insertResp = { error: null };
  delete process.env.BENCH_MODE;
  _resetReconcileDegradeLog();
  isRouterConfigured.mockReturnValue(false);
  routerBudgetAvailable.mockReturnValue(true);
  routeReconcile.mockReset();
});

const only = () => { expect(inserted).toHaveLength(1); return inserted[0]; };

describe('runReconcileShadow — the gate', () => {
  it('>= LO but < HI → needs_router (mid), targets the top candidate, NEVER a cosine NOOP/UPDATE', async () => {
    rpcResp = { data: [{ id: 42, similarity: 0.9 }], error: null };
    await runReconcileShadow(1, 'wallet-A');
    expect(only()).toMatchObject({
      proposed_op: 'needs_router', band: 'mid', target_memory_id: 42, max_cosine: 0.9, router_used: false,
    });
  });

  it('>= HI → needs_router (hi)', async () => {
    rpcResp = { data: [{ id: 42, similarity: 0.97 }], error: null };
    await runReconcileShadow(1, 'wallet-A');
    expect(only()).toMatchObject({ proposed_op: 'needs_router', band: 'hi', target_memory_id: 42 });
  });

  it('candidate between FLOOR and LO → add(below_lo), max_cosine captured for LO tuning', async () => {
    rpcResp = { data: [{ id: 42, similarity: 0.7 }], error: null };
    await runReconcileShadow(1, 'wallet-A');
    expect(only()).toMatchObject({ proposed_op: 'add', band: 'lo', max_cosine: 0.7, target_memory_id: null });
  });

  it('no candidate above the floor → add(no_candidate), band none, max_cosine null', async () => {
    rpcResp = { data: [], error: null };
    await runReconcileShadow(1, 'wallet-A');
    expect(only()).toMatchObject({ proposed_op: 'add', reason: 'no_candidate', band: 'none', max_cosine: null });
  });

  it('no persisted embedding → skip(no_embedding), and the screen RPC is never called', async () => {
    embeddingResp = { data: { embedding: null }, error: null };
    await runReconcileShadow(1, 'wallet-A');
    expect(only()).toMatchObject({ proposed_op: 'skip', reason: 'no_embedding' });
    expect(rpcCalls).toHaveLength(0);
  });
});

describe('runReconcileShadow — candidate filtering', () => {
  it('drops the just-inserted memory from its own candidates', async () => {
    rpcResp = { data: [{ id: 1, similarity: 0.99 }, { id: 42, similarity: 0.9 }], error: null };
    await runReconcileShadow(1, 'wallet-A'); // memoryId 1 is the self
    const row = only();
    expect(row.target_memory_id).toBe(42);      // not 1
    expect(row.max_cosine).toBe(0.9);            // self's 0.99 ignored
    // hydrate was asked only about the non-self id
    expect(hydrateIds).toEqual([42]);
    expect(hydrateScope).toMatchObject({ method: 'eq', val: 'wallet-A' });
  });

  it('drops already-invalidated candidates; all invalid → add(no_valid_candidate)', async () => {
    rpcResp = { data: [{ id: 43, similarity: 0.9 }], error: null };
    hydrateResp = { data: [{ id: 43, owner_wallet: 'wallet-A', invalid_at: '2020-01-01T00:00:00Z' }], error: null };
    await runReconcileShadow(1, 'wallet-A');
    expect(only()).toMatchObject({ proposed_op: 'add', reason: 'no_valid_candidate', band: 'none' });
  });
});

describe('runReconcileShadow — owner fencing (the cross-tenant guard)', () => {
  it('wallet scope → RPC filter_owner is the wallet, hydrate uses .eq, row carries the wallet', async () => {
    await runReconcileShadow(1, 'wallet-A');
    expect(rpcCalls[0].args.filter_owner).toBe('wallet-A');
    expect(hydrateScope).toMatchObject({ method: 'eq', col: 'owner_wallet', val: 'wallet-A' });
    expect(only().owner_wallet).toBe('wallet-A');
  });

  it('screens via the boot-blob-present RPC (match_memories_temporal, null dates, FLOOR threshold)', async () => {
    // Guards the deploy-F1 fix: match_memories is NOT in the boot blob, so a revert to it (or to a
    // non-null date / a non-FLOOR threshold) would silently break fresh boxes — catch it here.
    await runReconcileShadow(1, 'wallet-A');
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe('match_memories_temporal');
    expect(rpcCalls[0].args).toMatchObject({ match_threshold: 0.5, start_date: null, end_date: null, min_decay: 0 });
  });

  it('bot-own scope → RPC filter_owner is the sentinel, hydrate uses .is null, row owner_wallet null', async () => {
    hydrateResp = { data: [{ id: 42, owner_wallet: null, invalid_at: null }], error: null };
    await runReconcileShadow(1, SCOPE_BOT_OWN);
    expect(rpcCalls[0].args.filter_owner).toBe(SCOPE_BOT_OWN);
    expect(hydrateScope).toMatchObject({ method: 'is', col: 'owner_wallet', val: null });
    expect(only().owner_wallet).toBeNull();
  });

  it('a candidate whose owner_wallet does not match the scope is dropped by the post-guard', async () => {
    rpcResp = { data: [{ id: 42, similarity: 0.9 }], error: null };
    hydrateResp = { data: [{ id: 42, owner_wallet: 'wallet-OTHER', invalid_at: null }], error: null };
    await runReconcileShadow(1, 'wallet-A');
    expect(only()).toMatchObject({ proposed_op: 'add', reason: 'no_valid_candidate' });
  });
});

describe('runReconcileShadow — safety invariants', () => {
  it('never writes memories or memory_links (mutation-free), exactly one log row', async () => {
    await runReconcileShadow(1, 'wallet-A');
    expect(forbidden).toEqual([]);
    expect(inserted).toHaveLength(1);
  });

  it('BENCH_MODE → total no-op (no screen, no log row)', async () => {
    process.env.BENCH_MODE = 'true';
    await runReconcileShadow(1, 'wallet-A');
    expect(rpcCalls).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it('a missing log table (insert error) degrades exactly once across writes, never throws', async () => {
    insertResp = { error: { code: '42P01', message: 'relation "memory_reconciliation_log" does not exist' } };
    await expect(runReconcileShadow(1, 'wallet-A')).resolves.toBeUndefined();
    await expect(runReconcileShadow(2, 'wallet-A')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('every row is stamped with the gate_version (thresholds regime) for later filtering', async () => {
    await runReconcileShadow(1, 'wallet-A');
    expect(only().gate_version).toBe('c1-shadow-v1:floor=0.5:lo=0.85:hi=0.95');
  });
});

describe('runReconcileShadow — router (slice 1.5)', () => {
  it('router on → logs the router op (update) with router_used + model, and notes the budget', async () => {
    isRouterConfigured.mockReturnValue(true);
    routeReconcile.mockResolvedValue({ op: 'update', targetId: 42, reason: 'newer date', model: 'anthropic/claude-haiku-4.5' });
    await runReconcileShadow(1, 'wallet-A');
    expect(noteRouterCall).toHaveBeenCalledWith('wallet-A');
    expect(only()).toMatchObject({
      proposed_op: 'update', target_memory_id: 42, router_used: true, router_model: 'anthropic/claude-haiku-4.5',
    });
  });

  it('router decision add → target null even though a candidate matched (cosine did not decide)', async () => {
    isRouterConfigured.mockReturnValue(true);
    routeReconcile.mockResolvedValue({ op: 'add', targetId: null, reason: 'distinct', model: 'm' });
    await runReconcileShadow(1, 'wallet-A');
    expect(only()).toMatchObject({ proposed_op: 'add', target_memory_id: null, router_used: true });
  });

  it('over budget → needs_router, the router is NOT called', async () => {
    isRouterConfigured.mockReturnValue(true);
    routerBudgetAvailable.mockReturnValue(false);
    await runReconcileShadow(1, 'wallet-A');
    expect(routeReconcile).not.toHaveBeenCalled();
    expect(only()).toMatchObject({ proposed_op: 'needs_router', router_used: false });
  });
});
