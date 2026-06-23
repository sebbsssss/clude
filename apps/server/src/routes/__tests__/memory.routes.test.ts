/**
 * Security regression tests for memory.routes.ts owner scoping.
 *
 * getRequestOwner() must ONLY trust req.verifiedWallet (set by requireOwnership /
 * optionalOwnership after verifying the wallet against the authenticated identity).
 * It must NEVER fall back to a client-supplied ?wallet= param — otherwise a route
 * that is (now, or in future) missing the ownership middleware would silently scope
 * to an attacker-chosen wallet. These tests pin that fail-closed contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Auth mocks mirror production: requirePrivyAuth sets only req.privyUser; requireOwnership
// is the one middleware that sets req.verifiedWallet. `verifiedWalletToSet` lets a test
// simulate the middleware NOT setting it (the fail-closed case the hardening guards).
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

// Owner-context — record which wallet a handler scopes to.
const withOwnerWalletSpy = vi.fn();
vi.mock('@clude/shared/core/owner-context', () => ({
  withOwnerWallet: (wallet: string, fn: () => Promise<unknown>) => withOwnerWalletSpy(wallet, fn),
}));

const getMemoryStatsMock = vi.fn();
vi.mock('@clude/brain/memory', () => ({
  getMemoryStats: (...a: unknown[]) => getMemoryStatsMock(...a),
  getRecentMemories: vi.fn(async () => []),
}));
vi.mock('@clude/brain/memory/trace', () => ({ traceMemory: vi.fn(), explainMemory: vi.fn() }));
vi.mock('@clude/shared/core/database', () => ({ getDb: () => ({ from: () => ({}) }) }));
vi.mock('@clude/shared/core/solana-client', () => ({ verifyMemoTransaction: vi.fn() }));
vi.mock('@clude/shared/core/openrouter-client', () => ({ getOpenRouterStats: vi.fn(async () => ({})) }));
vi.mock('@clude/shared/core/web-search', () => ({ isWebSearchEnabled: () => false }));
vi.mock('@clude/shared/utils/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));

import { memoryRoutes } from '../memory.routes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(memoryRoutes());
  return app;
}

beforeEach(() => {
  authed = true;
  verifiedWalletToSet = null;
  withOwnerWalletSpy.mockReset();
  withOwnerWalletSpy.mockImplementation(async (_w: string, fn: () => Promise<unknown>) => fn());
  getMemoryStatsMock.mockReset();
  getMemoryStatsMock.mockResolvedValue({
    total: 7, byType: {}, embeddedCount: 0, avgDecay: 0, avgImportance: 0,
    uniqueUsers: 0, totalDreamSessions: 0, topTags: [], topConcepts: [],
  });
});

describe('memory.routes owner scoping — getRequestOwner', () => {
  // Impersonation / fail-closed guard: a client-supplied ?wallet= must never scope.
  it('ignores ?wallet= when verifiedWallet is unset (fail-closed, no impersonation)', async () => {
    verifiedWalletToSet = null; // ownership middleware did NOT set a verified wallet
    const res = await request(buildApp()).get('/memory-stats?wallet=victim-wallet');
    expect(res.status).toBe(200);
    // No verified wallet → unscoped, NOT scoped to the attacker-supplied ?wallet=.
    expect(res.body.scoped_to).toBeNull();
    expect(withOwnerWalletSpy).not.toHaveBeenCalledWith('victim-wallet', expect.any(Function));
  });

  it('scopes to the verified wallet and ignores a divergent ?wallet=', async () => {
    verifiedWalletToSet = 'owner-wallet';
    const res = await request(buildApp()).get('/memory-stats?wallet=victim-wallet');
    expect(res.status).toBe(200);
    expect(res.body.scoped_to).toBe('owner-wallet');
    expect(withOwnerWalletSpy).toHaveBeenCalledWith('owner-wallet', expect.any(Function));
    expect(withOwnerWalletSpy).not.toHaveBeenCalledWith('victim-wallet', expect.any(Function));
  });
});
