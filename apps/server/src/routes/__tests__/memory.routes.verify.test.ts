// Security regression tests for the two on-chain memory-verify routes (opsec H3).
//
// Both `GET /api/memory/:id/verify` and `GET /api/memories/verify` return plaintext
// content/summary/tags. They were unauthenticated and authorised only by a client-supplied
// `?wallet=`, so anyone could read any tenant's memory. These tests pin the fix: the routes now
// require a proven Privy identity and authorise against `req.verifiedWallet`, never a query param.
import express from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

// ── Auth injection — flip `authedWallet` per test (null = anonymous). ──
let authedWallet: string | null = null;
vi.mock('@clude/brain/auth/privy-auth', () => ({
  optionalPrivyAuth: (req: Request, _res: Response, next: NextFunction) => {
    if (authedWallet) (req as Request & { verifiedWallet?: string }).verifiedWallet = authedWallet;
    next();
  },
  requirePrivyAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!authedWallet) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    (req as Request & { verifiedWallet?: string }).verifiedWallet = authedWallet;
    next();
  },
}));
vi.mock('@clude/brain/auth/require-ownership', () => ({
  requireOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
  optionalOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── A memory owned by OTHER, returned by every getDb query in these tests. ──
const OTHER = 'WALLET_OTHER_owns_this_memory';
const memRow = {
  id: 1,
  content: 'TOP-SECRET plaintext that must never leak cross-tenant',
  summary: 'secret summary',
  memory_type: 'episodic',
  tags: ['private'],
  created_at: '2026-06-01T00:00:00Z',
  owner_wallet: OTHER,
  solana_signature: 'sig-abc',
  onchain_tx: 'tx-abc',
  onchain_hash: 'deadbeef',
  onchain_committed_at: '2026-06-01T00:00:00Z',
};
const single = vi.fn(async () => ({ data: memRow, error: null }));
const dbBuilder = { select: () => dbBuilder, eq: () => dbBuilder, single } as any;
vi.mock('@clude/shared/core/database', () => ({ getDb: () => ({ from: () => dbBuilder }) }));

// ── Remaining module-load imports stubbed so memory.routes imports cleanly. ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@clude/shared/utils/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@clude/shared/core/solana-client', () => ({ verifyMemoTransaction: vi.fn(async () => true) }));
vi.mock('@clude/brain/memory', () => ({ getMemoryStats: vi.fn(), getRecentMemories: vi.fn() }));
vi.mock('@clude/brain/memory/trace', () => ({ traceMemory: vi.fn(), explainMemory: vi.fn() }));
vi.mock('@clude/shared/core/openrouter-client', () => ({ getOpenRouterStats: vi.fn() }));
vi.mock('@clude/shared/core/web-search', () => ({ isWebSearchEnabled: () => false }));
vi.mock('@clude/shared/core/owner-context', () => ({
  withOwnerWallet: (_w: string | null, fn: () => unknown) => fn(),
}));

import { memoryRoutes } from '../memory.routes.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api', memoryRoutes());
  return a;
}

describe('memory verify routes — opsec H3 (no unauthenticated cross-tenant plaintext)', () => {
  beforeEach(() => {
    authedWallet = null;
    single.mockClear();
  });

  it('GET /api/memories/verify is 401 without a token (was: leaked any tenant via ?wallet=)', async () => {
    const res = await request(app()).get('/api/memories/verify?tx=sig-abc&wallet=' + OTHER);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('TOP-SECRET');
    // The DB was never even queried — rejected at the auth gate.
    expect(single).not.toHaveBeenCalled();
  });

  it('GET /api/memory/:id/verify is 401 without a token', async () => {
    const res = await request(app()).get('/api/memory/1/verify?wallet=' + OTHER);
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('TOP-SECRET');
    expect(single).not.toHaveBeenCalled();
  });

  it('GET /api/memories/verify authed as a DIFFERENT wallet is 403, no plaintext (?wallet= is ignored)', async () => {
    authedWallet = 'WALLET_ATTACKER';
    const res = await request(app()).get('/api/memories/verify?tx=sig-abc&wallet=' + OTHER);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('TOP-SECRET');
  });

  it('GET /api/memory/:id/verify authed as a DIFFERENT wallet is 403, no plaintext', async () => {
    authedWallet = 'WALLET_ATTACKER';
    const res = await request(app()).get('/api/memory/1/verify?wallet=' + OTHER);
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('TOP-SECRET');
  });

  it('GET /api/memories/verify authed as the OWNER passes the gate (200, verifies own memory)', async () => {
    authedWallet = OTHER;
    const res = await request(app()).get('/api/memories/verify?tx=sig-abc');
    expect(res.status).toBe(200);
    expect(res.body.memory.content).toBe(memRow.content); // owner may read their own
  });
});
