/**
 * Tests for PATCH / DELETE /api/cortex/memories/:id — the hosted-mode backend
 * for the MCP `update_memory` / `delete_memory` tools.
 *
 * Contract under test:
 *   - Both routes sit behind cortexAuth (Bearer clk_ key) → 401 without it.
 *   - The caller can only touch rows whose owner_wallet matches the wallet
 *     bound to their key. A row owned by someone else is indistinguishable
 *     from a missing row (404) so the API never confirms another tenant's ids.
 *   - PATCH validates its body with Zod (400 on bad input) BEFORE any DB call.
 *   - The write itself runs inside withOwnerWallet(<caller wallet>) so the
 *     brain-level scopeToOwner() filter applies to the UPDATE / DELETE.
 *   - Responses match what packages/brain/src/mcp/server.ts expects:
 *     { updated: true } / { deleted: true }.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { getContextOwnerWallet } from '@clude/shared/core/owner-context';

const WALLET_A = 'WalletAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const AGENT_A = { id: 1, agent_id: 'agent_a', owner_wallet: WALLET_A, tier: 'AGENT_VERIFIED', is_active: true };

// ── Auth / rate-limit / logger mocks ──
const mockAuthenticateAgent = vi.fn();
const mockRecordAgentInteraction = vi.fn();
vi.mock('@clude/brain/features/agent-tier', () => ({
  authenticateAgent: (...args: any[]) => mockAuthenticateAgent(...args),
  recordAgentInteraction: (...args: any[]) => mockRecordAgentInteraction(...args),
  registerAgent: vi.fn(),
  findOrCreateAgentForDid: vi.fn(),
}));
vi.mock('@clude/brain/auth/privy-wallet-resolver', () => ({
  findOrCreatePrivyUserByEmail: vi.fn(),
}));
vi.mock('@clude/shared/utils/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => true),
}));
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── Brain memory layer: the routes delegate the write to updateMemory /
//    deleteMemory. We record the owner context they were invoked under. ──
const mockUpdateMemory = vi.fn();
const mockDeleteMemory = vi.fn();
let walletSeenByBrain: string | null | undefined;
vi.mock('@clude/brain/memory', () => ({
  updateMemory: (...args: any[]) => { walletSeenByBrain = getContextOwnerWallet(); return mockUpdateMemory(...args); },
  deleteMemory: (...args: any[]) => { walletSeenByBrain = getContextOwnerWallet(); return mockDeleteMemory(...args); },
  storeMemory: vi.fn(),
  recallMemories: vi.fn(),
  recallMemorySummaries: vi.fn(),
  hydrateMemories: vi.fn(),
  getMemoryStats: vi.fn(),
  getRecentMemories: vi.fn(),
  getSelfModel: vi.fn(),
  createMemoryLink: vi.fn(),
}));
vi.mock('@clude/brain/memory/clinamen', () => ({ findClinamen: vi.fn() }));
vi.mock('@clude/brain/memory/graph', () => ({
  findSimilarEntities: vi.fn(),
  getMemoriesByEntity: vi.fn(),
}));

// ── Recording Supabase double. Every chained call is logged; the chain is
//    thenable and resolves to the next queued { data, error } fixture. ──
type DbResult = { data?: any; error?: any };
const dbQueue: DbResult[] = [];
const dbCalls: Array<{ method: string; args: unknown[] }> = [];

function chain(): any {
  const terminal = {
    then: (ok: any, ko: any) =>
      Promise.resolve(dbQueue.shift() ?? { data: null, error: null }).then(ok, ko),
  };
  return new Proxy(terminal, {
    get(target, prop: string | symbol) {
      if (prop in target || typeof prop === 'symbol') return (target as any)[prop];
      return (...args: unknown[]) => {
        dbCalls.push({ method: prop, args });
        return chain();
      };
    },
  });
}

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({
    from: (table: string) => {
      dbCalls.push({ method: 'from', args: [table] });
      return chain();
    },
  }),
}));

// ── HTTP helper ──
async function request(
  server: http.Server,
  method: 'PATCH' | 'DELETE',
  path: string,
  opts: { body?: unknown; auth?: boolean } = {},
): Promise<{ status: number; body: any }> {
  const port = (server.address() as AddressInfo).port;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.auth !== false) headers['Authorization'] = 'Bearer clk_test';
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
  let body: any;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

/** The owner-scoped lookup the route must perform before writing. */
function expectOwnerScopedLookup(id: number) {
  expect(dbCalls).toEqual(expect.arrayContaining([
    { method: 'from', args: ['memories'] },
    { method: 'eq', args: ['id', id] },
    { method: 'eq', args: ['owner_wallet', WALLET_A] },
  ]));
}

let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const { cortexRoutes } = await import('../cortex.routes.js');
  app.use('/api/cortex', cortexRoutes());
  await new Promise<void>(resolve => { server = app.listen(0, resolve); });
});

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()));
});

beforeEach(() => {
  dbQueue.length = 0;
  dbCalls.length = 0;
  walletSeenByBrain = undefined;
  mockAuthenticateAgent.mockReset().mockResolvedValue({ ...AGENT_A });
  mockRecordAgentInteraction.mockReset().mockResolvedValue(undefined);
  mockUpdateMemory.mockReset().mockResolvedValue(true);
  mockDeleteMemory.mockReset().mockResolvedValue(true);
});

describe('PATCH /api/cortex/memories/:id', () => {
  it('updates an owned memory and returns { updated: true }', async () => {
    dbQueue.push({ data: { id: 123 }, error: null });

    const res = await request(server, 'PATCH', '/api/cortex/memories/123', {
      body: {
        content: 'Body <b>bold</b>',
        summary: 'New summary',
        tags: ['alpha', 'beta'],
        importance: 0.7,
        memory_type: 'semantic',
      },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ updated: true });
    expectOwnerScopedLookup(123);
    expect(mockUpdateMemory).toHaveBeenCalledTimes(1);
    expect(mockUpdateMemory).toHaveBeenCalledWith(123, {
      content: 'Body bold', // HTML stripped, same as POST /store
      summary: 'New summary',
      tags: ['alpha', 'beta'],
      importance: 0.7,
      memory_type: 'semantic',
    });
    expect(walletSeenByBrain).toBe(WALLET_A);
    expect(mockRecordAgentInteraction).toHaveBeenCalledWith('agent_a');
  });

  it('passes only the fields that were provided', async () => {
    dbQueue.push({ data: { id: 7 }, error: null });

    const res = await request(server, 'PATCH', '/api/cortex/memories/7', {
      body: { importance: 0.2 },
    });

    expect(res.status).toBe(200);
    const [, patches] = mockUpdateMemory.mock.calls[0];
    expect(patches).toStrictEqual({ importance: 0.2 });
  });

  it('returns 404 and never writes when the row belongs to another owner (or does not exist)', async () => {
    dbQueue.push({ data: null, error: null }); // owner-scoped lookup finds nothing

    const res = await request(server, 'PATCH', '/api/cortex/memories/4024421', {
      body: { summary: 'hijack attempt' },
    });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Memory not found' });
    expectOwnerScopedLookup(4024421);
    expect(mockUpdateMemory).not.toHaveBeenCalled();
  });

  it('rejects importance outside 0..1 with 400 before touching the DB', async () => {
    const res = await request(server, 'PATCH', '/api/cortex/memories/1', {
      body: { importance: 1.5 },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/importance/i);
    expect(dbCalls).toHaveLength(0);
    expect(mockUpdateMemory).not.toHaveBeenCalled();
  });

  it('rejects a memory_type outside the 5 typed tiers with 400', async () => {
    const res = await request(server, 'PATCH', '/api/cortex/memories/1', {
      body: { memory_type: 'bogus' },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/memory_type/i);
    expect(dbCalls).toHaveLength(0);
  });

  it('rejects an empty patch with 400', async () => {
    const res = await request(server, 'PATCH', '/api/cortex/memories/1', { body: {} });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one/i);
    expect(dbCalls).toHaveLength(0);
  });

  it('rejects content that is blank once HTML is stripped', async () => {
    const res = await request(server, 'PATCH', '/api/cortex/memories/1', {
      body: { content: '<script></script>   ' },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/content/i);
    expect(dbCalls).toHaveLength(0);
  });

  it('rejects a summary that is blank once HTML is stripped', async () => {
    const res = await request(server, 'PATCH', '/api/cortex/memories/1', {
      body: { summary: '<p></p>' },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/summary/i);
    expect(dbCalls).toHaveLength(0);
  });

  it('rejects a non-numeric id with 400', async () => {
    const res = await request(server, 'PATCH', '/api/cortex/memories/clude-abc', {
      body: { summary: 'x' },
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/id/i);
    expect(dbCalls).toHaveLength(0);
  });

  it('returns 500 when the ownership lookup fails', async () => {
    dbQueue.push({ data: null, error: { message: 'db down' } });

    const res = await request(server, 'PATCH', '/api/cortex/memories/1', {
      body: { summary: 'x' },
    });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/update/i);
    expect(mockUpdateMemory).not.toHaveBeenCalled();
  });

  it('returns 500 when the brain-level update reports failure', async () => {
    dbQueue.push({ data: { id: 1 }, error: null });
    mockUpdateMemory.mockResolvedValue(false);

    const res = await request(server, 'PATCH', '/api/cortex/memories/1', {
      body: { summary: 'x' },
    });

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to update memory' });
  });

  it('returns 401 without a Bearer key', async () => {
    const res = await request(server, 'PATCH', '/api/cortex/memories/1', {
      body: { summary: 'x' },
      auth: false,
    });

    expect(res.status).toBe(401);
    expect(dbCalls).toHaveLength(0);
  });
});

describe('DELETE /api/cortex/memories/:id', () => {
  it('deletes an owned memory and returns { deleted: true }', async () => {
    dbQueue.push({ data: { id: 123 }, error: null });

    const res = await request(server, 'DELETE', '/api/cortex/memories/123');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ deleted: true });
    expectOwnerScopedLookup(123);
    expect(mockDeleteMemory).toHaveBeenCalledWith(123);
    expect(walletSeenByBrain).toBe(WALLET_A);
    expect(mockRecordAgentInteraction).toHaveBeenCalledWith('agent_a');
  });

  it('returns 404 and never deletes when the row belongs to another owner (or does not exist)', async () => {
    dbQueue.push({ data: null, error: null });

    const res = await request(server, 'DELETE', '/api/cortex/memories/4024421');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Memory not found' });
    expectOwnerScopedLookup(4024421);
    expect(mockDeleteMemory).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric id with 400', async () => {
    const res = await request(server, 'DELETE', '/api/cortex/memories/not-a-number');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/id/i);
    expect(dbCalls).toHaveLength(0);
    expect(mockDeleteMemory).not.toHaveBeenCalled();
  });

  it('returns 500 when the brain-level delete reports failure', async () => {
    dbQueue.push({ data: { id: 1 }, error: null });
    mockDeleteMemory.mockResolvedValue(false);

    const res = await request(server, 'DELETE', '/api/cortex/memories/1');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Failed to delete memory' });
  });

  it('returns 401 without a Bearer key', async () => {
    const res = await request(server, 'DELETE', '/api/cortex/memories/1', { auth: false });

    expect(res.status).toBe(401);
    expect(dbCalls).toHaveLength(0);
    expect(mockDeleteMemory).not.toHaveBeenCalled();
  });
});
