import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// memory.ts → database.ts → config.ts validates required env at load (throws
// "Missing X_API_KEY" with no .env). SITE_ONLY makes that import side-effect-free.
// vi.hoisted runs before the static imports below. Mirrors format-memory-context.test.ts.
vi.hoisted(() => {
  process.env.SITE_ONLY = 'true';
});

// Quiet, deterministic logger.
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ---- DB mock ---------------------------------------------------------------
// Chainable Supabase-style query builder. Each builder records the table it was
// opened on and the insert payload it received, then resolves to a configurable
// terminal value. `single()` and awaiting the builder both resolve.
type Terminal = { data?: any; error: any; count?: number };

const insertPayloads: any[] = [];
const fromCalls: string[] = [];
const rpcCalls: Array<{ name: string; args: any }> = [];

// Per-table terminal result the builder should resolve to. Defaults are benign.
let memoriesInsertResult: Terminal = {
  data: { id: 123, hash_id: 'clude-test', content: 'x', memory_type: 'semantic', owner_wallet: null, created_at: '2026-06-20T00:00:00Z', tags: [], source: 'mcp', related_user: null, related_wallet: null },
  error: null,
};
let memoriesRows: any[] = [];          // rows returned by the paginated stats select
let dreamCount = 0;                    // count returned for dream_logs

function makeBuilder(table: string) {
  fromCalls.push(table);
  const builder: any = {
    _table: table,
    insert(payload: any) { if (table === 'memories') insertPayloads.push(payload); return builder; },
    select(_cols?: any, _opts?: any) { return builder; },
    eq() { return builder; },
    is() { return builder; },
    not() { return builder; },
    in() { return builder; },
    gte() { return builder; },
    gt() { return builder; },
    order() { return builder; },
    contains() { return builder; },
    range() {
      // The stats paginator awaits the builder after .range(); return rows once.
      return Promise.resolve({ data: memoriesRows, error: null });
    },
    single() {
      if (table === 'memories') return Promise.resolve(memoriesInsertResult);
      return Promise.resolve({ data: null, error: null });
    },
    update() { return builder; },
    // Awaiting the builder directly (head/count queries) resolves to a terminal.
    then(resolve: any, reject: any) {
      let terminal: Terminal;
      if (table === 'dream_logs') terminal = { count: dreamCount, error: null };
      else terminal = { count: 0, error: null };
      return Promise.resolve(terminal).then(resolve, reject);
    },
  };
  return builder;
}

const mockDb = {
  from: (table: string) => makeBuilder(table),
  rpc: (name: string, args: any) => { rpcCalls.push({ name, args }); return Promise.resolve({ error: null }); },
};

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => mockDb,
}));

// Keep the heavy fire-and-forget collaborators inert and deterministic.
vi.mock('@clude/shared/core/embeddings', () => ({
  generateEmbedding: vi.fn(async () => null),
  generateQueryEmbedding: vi.fn(async () => null),
  generateEmbeddings: vi.fn(async () => []),
  isEmbeddingEnabled: () => false,
}));
vi.mock('@clude/shared/core/solana-client', () => ({
  writeMemo: vi.fn(async () => null),
  isRegistryEnabled: () => false,
  registerMemoryOnChain: vi.fn(async () => null),
}));
vi.mock('../graph', () => ({
  extractAndLinkEntities: vi.fn(async () => undefined),
  findSimilarEntities: vi.fn(async () => []),
  getMemoriesByEntity: vi.fn(async () => []),
  getEntityCooccurrences: vi.fn(async () => []),
}));
vi.mock('../content-tokens', () => ({ setContentTokens: vi.fn(async () => undefined) }));

import {
  scoreImportanceOnWrite,
  storeMemory,
  getMemoryStats,
  type StoreMemoryOptions,
} from '../memory';

function makeOpts(over: Partial<StoreMemoryOptions> = {}): StoreMemoryOptions {
  return {
    type: 'episodic',
    content: 'a meaningful memory body that is clearly non-empty',
    summary: 'summary',
    source: 'mcp',
    ...over,
  };
}

beforeEach(() => {
  insertPayloads.length = 0;
  fromCalls.length = 0;
  rpcCalls.length = 0;
  memoriesRows = [];
  dreamCount = 0;
  vi.clearAllMocks();
});

describe('scoreImportanceOnWrite', () => {
  it('scores a short episodic LOWER than a long semantic-with-tags', () => {
    const shortEpisodic = scoreImportanceOnWrite(makeOpts({ type: 'episodic', content: 'hi', summary: 'hi' }));
    const longSemantic = scoreImportanceOnWrite(
      makeOpts({
        type: 'semantic',
        content: 'x'.repeat(1200),               // saturates the +0.15 length bonus
        summary: 'a substantial fact',
        tags: ['important', 'fact'],
      }),
    );
    expect(longSemantic).toBeGreaterThan(shortEpisodic);
  });

  it('stays within [0, 1]', () => {
    const maxed = scoreImportanceOnWrite(makeOpts({ type: 'self_model', content: 'x'.repeat(5000), tags: ['a'], concepts: ['b'] }));
    expect(maxed).toBeGreaterThanOrEqual(0);
    expect(maxed).toBeLessThanOrEqual(1);
  });

  it('nudges internal sources (dream/reflection) slightly lower than the same external write', () => {
    const external = scoreImportanceOnWrite(makeOpts({ type: 'semantic', source: 'mcp', content: 'same body here' }));
    const internal = scoreImportanceOnWrite(makeOpts({ type: 'semantic', source: 'reflection', content: 'same body here' }));
    expect(internal).toBeLessThan(external);
    // 'reflection'/'emergence' get concepts from the source alone in inferConcepts();
    // that bonus must not cancel the internal nudge.
    const emergence = scoreImportanceOnWrite(makeOpts({ type: 'semantic', source: 'emergence', content: 'same body here' }));
    expect(emergence).toBeLessThan(external);
  });
});

describe('storeMemory: empty content', () => {
  it('returns null and performs no insert for empty content', async () => {
    const id = await storeMemory(makeOpts({ content: '' }));
    expect(id).toBeNull();
    expect(insertPayloads).toHaveLength(0);
    expect(fromCalls).not.toContain('memories');
  });

  it('returns null and performs no insert for whitespace-only content', async () => {
    const id = await storeMemory(makeOpts({ content: '   \n\t  ' }));
    expect(id).toBeNull();
    expect(insertPayloads).toHaveLength(0);
  });
});

describe('storeMemory: importance handling', () => {
  it('preserves an explicitly provided importance (does not auto-overwrite it)', async () => {
    await storeMemory(makeOpts({ type: 'episodic', importance: 0.91 }));
    expect(insertPayloads).toHaveLength(1);
    expect(insertPayloads[0].importance).toBeCloseTo(0.91, 5);
  });

  it('auto-scores when importance is omitted (not the old flat 0.5)', async () => {
    await storeMemory(makeOpts({ type: 'self_model', content: 'x'.repeat(1200), tags: ['a'], importance: undefined }));
    expect(insertPayloads).toHaveLength(1);
    // self_model base 0.75 + length(+0.15) + tags(+0.05) + concepts(+0.05) → clamped high, definitely != 0.5
    expect(insertPayloads[0].importance).not.toBe(0.5);
    expect(insertPayloads[0].importance).toBeGreaterThan(0.5);
  });
});

describe('getMemoryStats', () => {
  it('counts the owner_wallet toward uniqueUsers when related_user is null (MCP writes)', async () => {
    memoriesRows = [
      { importance: 0.6, decay_factor: 1, created_at: '2026-06-01T00:00:00Z', related_user: null, owner_wallet: 'WalletA', tags: [], concepts: [] },
      { importance: 0.4, decay_factor: 1, created_at: '2026-06-02T00:00:00Z', related_user: null, owner_wallet: 'WalletA', tags: [], concepts: [] },
    ];
    dreamCount = 0;
    const stats = await getMemoryStats();
    expect(stats.uniqueUsers).toBeGreaterThanOrEqual(1);
  });

  it('reflects the scoped dream_logs count in totalDreamSessions', async () => {
    memoriesRows = [
      { importance: 0.5, decay_factor: 1, created_at: '2026-06-01T00:00:00Z', related_user: null, owner_wallet: 'WalletA', tags: [], concepts: [] },
    ];
    dreamCount = 3;
    const stats = await getMemoryStats();
    expect(stats.totalDreamSessions).toBe(3);
  });
});

describe('updateMemoryAccess RPC contract (read does not inflate importance)', () => {
  // updateMemoryAccess is a private function reachable only through the heavy
  // recallMemories path, so we pin the regression at the source: the
  // batch_boost_memory_access call must pass ONLY memory_ids — never an
  // importance_boosts argument (migration 019: read→rank→read feedback loop).
  it('does not pass importance_boosts to batch_boost_memory_access', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../memory.ts'), 'utf8');
    const start = src.indexOf("db.rpc('batch_boost_memory_access'");
    expect(start).toBeGreaterThan(-1);
    const callSlice = src.slice(start, start + 200);
    expect(callSlice).toContain('memory_ids');
    expect(callSlice).not.toContain('importance_boosts');
  });
});
