import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Memory 3.0 C0 / P0.4: the boot-blob freeze.
 *
 * Guarantees under test:
 *  - Established DB, schema intact  -> verify-only, exec_sql NEVER called.
 *  - Established DB, object missing -> DRIFT: log.error, exec_sql NEVER called.
 *  - Fresh DB (memories table absent) -> boot DDL runs once (SDK zero-config).
 *  - Probe errors (network/auth)    -> 'unknown', no mutation.
 *  - INIT_DB_MODE=replay            -> legacy unconditional replay.
 *  - INIT_DB_MODE=verify            -> never mutates, even fresh.
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

vi.mock('../logger', () => ({
  createChildLogger: () => logSpies,
}));

import { initDatabase, getSchemaDriftReport } from '../database';
import type { SupabaseClient } from '@supabase/supabase-js';

type ProbeError = { message: string } | null;

// Fake Supabase client: table probes answer from `tableErrors`, RPC probes from
// `rpcErrors`, and exec_sql invocations are counted.
function fakeDb(opts: {
  tableErrors?: Record<string, ProbeError>;
  rpcErrors?: Record<string, ProbeError>;
  onExecSql?: () => void;
  // After exec_sql runs, table/rpc errors are cleared (simulates successful bootstrap).
  bootstrapHeals?: boolean;
}) {
  const state = { execSqlCalls: 0 };
  const healed = () => opts.bootstrapHeals && state.execSqlCalls > 0;
  const db = {
    from: (table: string) => ({
      select: (_cols: string, _o?: unknown) => ({
        limit: (_n: number) =>
          Promise.resolve({ data: null, error: healed() ? null : (opts.tableErrors?.[table] ?? null) }),
      }),
    }),
    rpc: (name: string, _args: unknown) => {
      if (name === 'exec_sql') {
        state.execSqlCalls++;
        opts.onExecSql?.();
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: [], error: healed() ? null : (opts.rpcErrors?.[name] ?? null) });
    },
    _state: state,
  };
  return db as unknown as SupabaseClient & { _state: { execSqlCalls: number } };
}

const MISSING = (obj: string): ProbeError => ({ message: `relation "${obj}" does not exist` });

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.INIT_DB_MODE;
});

afterEach(() => {
  delete process.env.INIT_DB_MODE;
});

describe('initDatabase (boot blob frozen)', () => {
  it('verifies only on an intact established DB — exec_sql is never called', async () => {
    const db = fakeDb({});
    await initDatabase(db);
    expect(db._state.execSqlCalls).toBe(0);
    expect(getSchemaDriftReport()?.status).toBe('ok');
    expect(logSpies.error).not.toHaveBeenCalled();
  });

  it('reports DRIFT and refuses to mutate when a core object is missing on an established DB', async () => {
    const db = fakeDb({ tableErrors: { memory_links: MISSING('memory_links') } });
    await initDatabase(db);
    expect(db._state.execSqlCalls).toBe(0);
    const report = getSchemaDriftReport();
    expect(report?.status).toBe('drift');
    expect(report?.missingTables).toEqual(['memory_links']);
    expect(logSpies.error).toHaveBeenCalledWith(
      expect.objectContaining({ missingTables: ['memory_links'] }),
      expect.stringContaining('SCHEMA DRIFT'),
    );
  });

  it('reports DRIFT when a core RPC is missing (stale schema)', async () => {
    const db = fakeDb({ rpcErrors: { bm25_search_memories: MISSING('bm25_search_memories') } });
    await initDatabase(db);
    expect(db._state.execSqlCalls).toBe(0);
    expect(getSchemaDriftReport()?.brokenRpcs).toEqual(['bm25_search_memories']);
  });

  it('reports DRIFT when the primary vector lane match_memories is missing', async () => {
    // Regression: match_memories was absent from the boot blob, so a box provisioned solely
    // by initDatabase lacked it and recall silently degraded to keyword-only. The probe must
    // now catch that at boot. PostgREST reports absence as "Could not find the function ...".
    const db = fakeDb({
      rpcErrors: { match_memories: { message: 'Could not find the function public.match_memories in the schema cache' } },
    });
    await initDatabase(db);
    expect(db._state.execSqlCalls).toBe(0);
    expect(getSchemaDriftReport()?.brokenRpcs).toEqual(['match_memories']);
  });

  it('bootstraps a FRESH database (memories table absent) exactly once', async () => {
    const db = fakeDb({
      tableErrors: { memories: MISSING('memories'), memory_links: MISSING('memory_links') },
      bootstrapHeals: true,
    });
    await initDatabase(db);
    expect(db._state.execSqlCalls).toBe(1);
    expect(getSchemaDriftReport()?.status).toBe('fresh-bootstrapped');
  });

  it('treats non-schema probe failures as UNKNOWN and never mutates', async () => {
    const db = fakeDb({ tableErrors: { memories: { message: 'connection refused' } } });
    await initDatabase(db);
    expect(db._state.execSqlCalls).toBe(0);
    expect(getSchemaDriftReport()?.status).toBe('unknown');
  });

  it('INIT_DB_MODE=replay preserves legacy unconditional replay', async () => {
    process.env.INIT_DB_MODE = 'replay';
    const db = fakeDb({});
    await initDatabase(db);
    expect(db._state.execSqlCalls).toBe(1);
    expect(getSchemaDriftReport()?.status).toBe('replayed');
  });

  it('INIT_DB_MODE=verify never mutates, even on a fresh DB', async () => {
    process.env.INIT_DB_MODE = 'verify';
    const db = fakeDb({ tableErrors: { memories: MISSING('memories') } });
    await initDatabase(db);
    expect(db._state.execSqlCalls).toBe(0);
    expect(getSchemaDriftReport()?.status).toBe('drift');
  });
});
