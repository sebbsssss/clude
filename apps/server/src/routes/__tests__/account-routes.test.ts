/**
 * Tests for DELETE /api/account — full account wipe.
 *
 * Covers the cascade flow: owner-scoped DB rows are deleted in order, then the
 * Privy user record is deleted via the admin client. Failure semantics:
 *   - DB error mid-cascade → 500, Privy is NOT called
 *   - Privy 404 → 204 (idempotent)
 *   - Privy 500 → 500 (app data already gone, logged)
 *   - Unauthenticated → 401, no DB or Privy calls
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'http';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@clude/shared/config', () => ({
  config: {
    privy: {
      appId: 'test-app-id',
      appSecret: 'test-app-secret',
      jwksUrl: 'https://test.privy.io/jwks',
    },
  },
}));

// ── Auth middleware mocks: real verification is irrelevant here. ──
// We exercise the route handler logic; the auth flow is unit-tested elsewhere.
let injectedPrivyUser: { userId: string } | null = { userId: 'did:privy:abc' };
let injectedWallet: string | null = 'OwnerWallet11111111111111111111111111111111';

vi.mock('@clude/brain/auth/privy-auth', () => ({
  optionalPrivyAuth: (req: Request, _res: Response, next: NextFunction) => {
    if (injectedPrivyUser) (req as any).privyUser = injectedPrivyUser;
    next();
  },
}));

vi.mock('@clude/brain/auth/require-ownership', () => ({
  requireOwnership: async (req: Request, res: Response, next: NextFunction) => {
    if (!injectedWallet) {
      res.status(401).json({ error: 'No wallet' });
      return;
    }
    (req as any).verifiedWallet = injectedWallet;
    next();
  },
}));

const mockDeletePrivyUser = vi.fn();
vi.mock('@clude/brain/auth/privy-admin-client', () => ({
  deletePrivyUser: (...args: any[]) => mockDeletePrivyUser(...args),
}));

// ── Flexible DB mock: each chain resolves against a queue of
//    { data?, error?, count? } items in call order. Tests push fixtures in
//    the order the route will hit them. ──
type DbResult = { data?: any; error?: any; count?: number };
const dbQueue: DbResult[] = [];
const fromCalls: string[] = [];

function dequeue(): Promise<DbResult> {
  return Promise.resolve(dbQueue.shift() ?? { data: null, error: null, count: 0 });
}

function chainBuilder(): any {
  const terminal = {
    then: (onFulfilled: any, onRejected: any) =>
      dequeue().then(onFulfilled, onRejected),
  };
  return new Proxy(terminal, {
    get(target, prop: string) {
      if (prop in target) return (target as any)[prop];
      return (..._args: any[]) => chainBuilder();
    },
  });
}

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({
    from: (table: string) => {
      fromCalls.push(table);
      return chainBuilder();
    },
  }),
}));

import { accountRoutes } from '../account.routes.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/account', accountRoutes());
  return app;
}

function startServer(app: express.Express): Promise<http.Server> {
  return new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
}
function stopServer(s: http.Server): Promise<void> {
  return new Promise((resolve) => s.close(() => resolve()));
}

async function req(
  server: http.Server,
  method: 'DELETE',
  path: string,
): Promise<{ status: number; body: any }> {
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;
  const res = await fetch(url, { method });
  let body: any;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

let server: http.Server;

beforeAll(async () => {
  server = await startServer(createApp());
});
afterAll(async () => {
  await stopServer(server);
});
beforeEach(() => {
  injectedPrivyUser = { userId: 'did:privy:abc' };
  injectedWallet = 'OwnerWallet11111111111111111111111111111111';
  dbQueue.length = 0;
  fromCalls.length = 0;
  mockDeletePrivyUser.mockReset();
  mockDeletePrivyUser.mockResolvedValue(undefined);
});

describe('DELETE /api/account', () => {
  it('returns 401 when no owner wallet can be resolved (no auth)', async () => {
    injectedPrivyUser = null;
    injectedWallet = null;
    const r = await req(server, 'DELETE', '/api/account');
    expect(r.status).toBe(401);
    expect(fromCalls).toHaveLength(0);
    expect(mockDeletePrivyUser).not.toHaveBeenCalled();
  });

  it('happy path: wipes every owner-scoped table then calls Privy delete, returns 204', async () => {
    // Every table delete succeeds.
    for (let i = 0; i < 20; i++) dbQueue.push({ error: null, count: 1 });

    const r = await req(server, 'DELETE', '/api/account');

    expect(r.status).toBe(204);
    // We expect at least the core tables to be touched. Order doesn't matter
    // for the assertion, but the route must NOT skip any of them.
    expect(fromCalls).toEqual(
      expect.arrayContaining([
        'memories',
        'llm_outputs',
        'chat_conversations',
        'chat_usage',
        'chat_topups',
        'chat_balances',
        'agent_keys',
      ]),
    );
    expect(mockDeletePrivyUser).toHaveBeenCalledWith('did:privy:abc');
    expect(mockDeletePrivyUser).toHaveBeenCalledTimes(1);
  });

  it('aborts with 500 if a DB delete fails mid-cascade and does NOT call Privy', async () => {
    // First call succeeds, second fails.
    dbQueue.push({ error: null, count: 1 });
    dbQueue.push({ error: { message: 'db down' } });

    const r = await req(server, 'DELETE', '/api/account');

    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/partially failed|delete/i);
    expect(mockDeletePrivyUser).not.toHaveBeenCalled();
  });

  it('treats a Privy NotFoundError as success (handled inside deletePrivyUser) → 204', async () => {
    for (let i = 0; i < 20; i++) dbQueue.push({ error: null, count: 0 });
    // `deletePrivyUser` swallows NotFoundError internally, so it resolves.
    mockDeletePrivyUser.mockResolvedValue(undefined);

    const r = await req(server, 'DELETE', '/api/account');

    expect(r.status).toBe(204);
  });

  it('returns 500 when Privy delete throws a non-404 error (app data already gone)', async () => {
    for (let i = 0; i < 20; i++) dbQueue.push({ error: null, count: 0 });
    mockDeletePrivyUser.mockRejectedValue(new Error('privy 503'));

    const r = await req(server, 'DELETE', '/api/account');

    expect(r.status).toBe(500);
    expect(r.body.error).toMatch(/privy|account/i);
  });

  it('cortex-key path: when no Privy JWT, fetches privy_did from agent_keys before wiping', async () => {
    injectedPrivyUser = null;
    // First DB hit: agent_keys lookup returns the DID.
    dbQueue.push({ data: { privy_did: 'did:privy:fromrow' }, error: null });
    // Then 7 cascade deletes succeed.
    for (let i = 0; i < 20; i++) dbQueue.push({ error: null, count: 0 });

    const r = await req(server, 'DELETE', '/api/account');

    expect(r.status).toBe(204);
    expect(fromCalls[0]).toBe('agent_keys'); // lookup happens first
    expect(mockDeletePrivyUser).toHaveBeenCalledWith('did:privy:fromrow');
  });

  it('cortex-key path with no privy_did on row: wipes data and skips Privy → 204', async () => {
    injectedPrivyUser = null;
    dbQueue.push({ data: { privy_did: null }, error: null });
    for (let i = 0; i < 20; i++) dbQueue.push({ error: null, count: 0 });

    const r = await req(server, 'DELETE', '/api/account');

    expect(r.status).toBe(204);
    expect(mockDeletePrivyUser).not.toHaveBeenCalled();
  });
});
