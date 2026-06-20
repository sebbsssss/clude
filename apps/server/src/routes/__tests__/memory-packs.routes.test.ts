/**
 * Security regression tests for memory-packs.routes.ts owner scoping.
 *
 * getRequestOwner() must ONLY trust req.verifiedWallet (set by optionalOwnership after
 * verifying the wallet against the authenticated identity). It must NEVER fall back to a
 * client-supplied ?wallet= — otherwise a route missing the ownership middleware would
 * scope its DB query to an attacker-chosen wallet. These tests pin the fail-closed contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Mirrors production: requirePrivyAuth sets only req.privyUser; ownership middleware is
// the only thing that sets req.verifiedWallet. `verifiedWalletToSet` lets a test simulate
// the middleware NOT setting it (the fail-closed case the hardening guards).
let authed = true;
let verifiedWalletToSet: string | null = null;
vi.mock('@clude/brain/auth/privy-auth', () => ({
  requirePrivyAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!authed) { res.status(401).json({ error: 'unauthenticated' }); return; }
    (req as Request & { privyUser?: { userId: string } }).privyUser = { userId: 'did:privy:test', appId: 'test-app' };
    next();
  },
  optionalPrivyAuth: (req: Request, _res: Response, next: NextFunction) => {
    if (authed) (req as Request & { privyUser?: { userId: string } }).privyUser = { userId: 'did:privy:test', appId: 'test-app' };
    next();
  },
}));
vi.mock('@clude/brain/auth/require-ownership', () => ({
  requireOwnership: (req: Request, _res: Response, next: NextFunction) => {
    if (verifiedWalletToSet) (req as Request & { verifiedWallet?: string }).verifiedWallet = verifiedWalletToSet;
    next();
  },
  optionalOwnership: (req: Request, _res: Response, next: NextFunction) => {
    if (verifiedWalletToSet) (req as Request & { verifiedWallet?: string }).verifiedWallet = verifiedWalletToSet;
    next();
  },
}));

vi.mock('@clude/shared/core/owner-context', () => ({
  withOwnerWallet: async <T>(_w: string, fn: () => Promise<T>): Promise<T> => fn(),
}));

vi.mock('@clude/brain/memory', () => ({
  getMemoryStats: vi.fn(async () => ({ total: 0 })),
  getRecentMemories: vi.fn(async () => []),
  storeMemory: vi.fn(async () => 1),
}));

// DB mock records every .eq('owner_wallet', X) filter so a test can prove which wallet a
// query was scoped to. Terminal calls resolve to an empty page (stops the export loop).
const eqCalls: Array<[string, unknown]> = [];
vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: (col: string, val: unknown) => { eqCalls.push([col, val]); return chain; },
        in: () => chain,
        or: () => chain,
        order: () => chain,
        range: () => Promise.resolve({ data: [], error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      });
      return chain;
    },
  }),
}));

import { memoryPacksRoutes } from '../memory-packs.routes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(memoryPacksRoutes());
  return app;
}

const scopedTo = (wallet: string) => eqCalls.some(([col, val]) => col === 'owner_wallet' && val === wallet);

beforeEach(() => {
  authed = true;
  verifiedWalletToSet = null;
  eqCalls.length = 0;
});

describe('memory-packs.routes owner scoping — getRequestOwner', () => {
  // Impersonation / fail-closed guard: a client-supplied ?wallet= must never scope the query.
  it('ignores ?wallet= when verifiedWallet is unset (fail-closed, no impersonation)', async () => {
    verifiedWalletToSet = null; // ownership middleware did NOT set a verified wallet
    const res = await request(buildApp())
      .post('/export?wallet=victim-wallet')
      .send({ name: 'Heist' });
    expect(res.status).toBe(200);
    expect(res.body.memory_count).toBe(0);
    // The export query must NOT have been scoped to the attacker-supplied wallet.
    expect(scopedTo('victim-wallet')).toBe(false);
  });

  it('scopes the export to the verified wallet, ignoring a divergent ?wallet=', async () => {
    verifiedWalletToSet = 'owner-wallet';
    await request(buildApp())
      .post('/export?wallet=victim-wallet')
      .send({ name: 'Mine' });
    expect(scopedTo('owner-wallet')).toBe(true);
    expect(scopedTo('victim-wallet')).toBe(false);
  });
});
