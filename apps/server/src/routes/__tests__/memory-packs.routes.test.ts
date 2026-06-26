import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

/**
 * Client-wallet-trust regression for /api/memory-packs.
 *
 * These routes scope owner-private data by `getRequestOwner(req)`, which is
 * `req.verifiedWallet ?? req.query.wallet`. The ?wallet= fallback is only safe
 * if `optionalOwnership` makes it UNREACHABLE with an unverified wallet:
 *   - when a wallet is claimed (query OR body), optionalOwnership delegates to
 *     requireOwnership, which proves ownership (sets verifiedWallet) or 4xx's;
 *   - when no wallet is claimed, it falls through with verifiedWallet UNSET and
 *     query.wallet absent, so getRequestOwner returns null.
 *
 * The mocks below faithfully simulate that contract (a claimed wallet the
 * caller does NOT own is rejected). The DB mock records which owner_wallet the
 * export/smart-export queries scope to, so a forged victim wallet leaking into
 * the query is observable as a test failure — not just an HTTP status.
 */

const H = vi.hoisted(() => {
  return {
    // Mutable auth state the mocks read; reset in beforeEach.
    state: { loggedIn: true, callerOwnedWallet: 'OWNER1111111111111111111111111111111111111' as string | null },
    // Records every owner_wallet value the memories table was scoped by.
    scopedOwners: [] as unknown[],
    storeMemory: vi.fn(async () => 'mem-id'),
  };
});

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// requirePrivyAuth: 401 if no session, else attach a privyUser (NO wallet).
vi.mock('@clude/brain/auth/privy-auth', () => ({
  requirePrivyAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!H.state.loggedIn) { res.status(401).json({ error: 'auth required' }); return; }
    (req as Request & { privyUser?: unknown }).privyUser = { userId: 'did:test', appId: 'test-app' };
    next();
  },
  optionalPrivyAuth: (req: Request, _res: Response, next: NextFunction) => {
    if (H.state.loggedIn) {
      (req as Request & { privyUser?: unknown }).privyUser = { userId: 'did:test', appId: 'test-app' };
    }
    next();
  },
}));

// optionalOwnership / requireOwnership: FAITHFUL to the real contract.
//  - extractClaimedWallet reads ?wallet= first, then body.wallet.
//  - optionalOwnership: no claimed wallet → next() with verifiedWallet UNSET.
//  - requireOwnership: claimed wallet the caller doesn't own → 403; owns → set.
vi.mock('@clude/brain/auth/require-ownership', () => {
  const extractClaimed = (req: Request): string | undefined =>
    (req.query.wallet as string | undefined) ||
    (req.body && typeof req.body.wallet === 'string' ? req.body.wallet : undefined);

  const requireOwnership = (req: Request, res: Response, next: NextFunction) => {
    const claimed = extractClaimed(req);
    if (!H.state.callerOwnedWallet) { res.status(401).json({ error: 'auth required' }); return; }
    if (!claimed) {
      // DID / clk_ resolution path — resolve verifiedWallet from the caller.
      (req as Request & { verifiedWallet?: string }).verifiedWallet = H.state.callerOwnedWallet;
      next();
      return;
    }
    if (claimed !== H.state.callerOwnedWallet) {
      res.status(403).json({ error: 'Wallet not linked to your account' });
      return;
    }
    (req as Request & { verifiedWallet?: string }).verifiedWallet = H.state.callerOwnedWallet;
    next();
  };

  const optionalOwnership = (req: Request, res: Response, next: NextFunction) => {
    const claimed = extractClaimed(req);
    if (!claimed) { next(); return; }
    requireOwnership(req, res, next);
  };

  return { requireOwnership, optionalOwnership };
});

vi.mock('@clude/brain/memory', () => ({
  storeMemory: H.storeMemory,
  getMemoryStats: vi.fn(async () => ({})),
  getRecentMemories: vi.fn(async () => []),
}));

// Supabase mock: records the owner_wallet each memories query is scoped by,
// and returns one row so the export "happy path" produces a non-empty pack.
vi.mock('@clude/shared/core/database', () => ({
  getDb: () => {
    const filters: Record<string, unknown> = {};
    let table = '';
    let rangeStart = 0;
    const chain: Record<string, unknown> = {
      from(t: string) { table = t; return chain; },
      select() { return chain; },
      eq(c: string, v: unknown) {
        filters[c] = v;
        if (table === 'memories' && c === 'owner_wallet') H.scopedOwners.push(v);
        return chain;
      },
      in() { return chain; },
      or() { return chain; },
      order() { return chain; },
      range(start: number) { rangeStart = start; return chain; },
      then(resolve: (r: { data: unknown; error: null }) => void) {
        if (table === 'memories') {
          // First page returns one row; subsequent pages empty (ends loop).
          if (rangeStart === 0) {
            resolve({ data: [{ id: 1, memory_type: 'episodic', content: 'c', summary: 's', tags: ['t'], concepts: [], importance: 0.5, decay_factor: 1, emotional_valence: 0, access_count: 0, source: 'x', source_id: null, created_at: '2026-01-01T00:00:00Z', last_accessed: null, solana_signature: null, evidence_ids: [] }], error: null });
          } else {
            resolve({ data: [], error: null });
          }
        } else {
          resolve({ data: [], error: null });
        }
      },
    };
    return chain;
  },
}));

// eslint-disable-next-line import/first
import { memoryPacksRoutes } from '../memory-packs.routes.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/memory-packs', memoryPacksRoutes());
  return a;
}

const OWNER = 'OWNER1111111111111111111111111111111111111';
const VICTIM = 'VICTIM999999999999999999999999999999999999';

beforeEach(() => {
  H.state.loggedIn = true;
  H.state.callerOwnedWallet = OWNER;
  H.scopedOwners.length = 0;
  H.storeMemory.mockClear();
});

describe('memory-packs — client-wallet-trust regression', () => {
  // ── /export ─────────────────────────────────────────────────────────
  it('CRITICAL: /export cannot exfiltrate a victim tenant via ?wallet=<victim>', async () => {
    H.state.callerOwnedWallet = 'ATTACKER000'; // logged in, owns a different wallet
    const res = await request(app())
      .post(`/api/memory-packs/export?wallet=${VICTIM}`)
      .send({ name: 'pack' });
    expect(res.status).toBe(403);
    // The query must NEVER have been scoped to the victim.
    expect(H.scopedOwners).not.toContain(VICTIM);
  });

  it('CRITICAL: /export cannot exfiltrate a victim via body.wallet=<victim>', async () => {
    H.state.callerOwnedWallet = 'ATTACKER000';
    const res = await request(app())
      .post('/api/memory-packs/export')
      .send({ name: 'pack', wallet: VICTIM });
    expect(res.status).toBe(403);
    expect(H.scopedOwners).not.toContain(VICTIM);
  });

  it('/export scopes ONLY to the caller’s verified wallet (proven owner path)', async () => {
    H.state.callerOwnedWallet = OWNER;
    const res = await request(app())
      .post(`/api/memory-packs/export?wallet=${OWNER}`)
      .send({ name: 'pack' });
    expect(res.status).toBe(200);
    expect(res.body.memory_count).toBe(1);
    // Every scope used was the owner — no other tenant touched.
    expect(H.scopedOwners.length).toBeGreaterThan(0);
    expect([...new Set(H.scopedOwners)]).toEqual([OWNER]);
  });

  it('/export with NO wallet returns an empty pack and never scopes a query', async () => {
    // optionalOwnership passes through with verifiedWallet UNSET; getRequestOwner
    // returns null; handler short-circuits BEFORE touching the DB.
    H.state.callerOwnedWallet = OWNER; // irrelevant: no wallet claimed → not resolved
    const res = await request(app())
      .post('/api/memory-packs/export')
      .send({ name: 'pack' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ memories: [], memory_count: 0 });
    expect(H.scopedOwners).toHaveLength(0);
  });

  // ── /smart-export ───────────────────────────────────────────────────
  it('CRITICAL: /smart-export cannot target a victim via ?wallet=<victim>', async () => {
    H.state.callerOwnedWallet = 'ATTACKER000';
    const res = await request(app())
      .post(`/api/memory-packs/smart-export?wallet=${VICTIM}`)
      .send({ name: 'brief' });
    expect(res.status).toBe(403);
    expect(H.scopedOwners).not.toContain(VICTIM);
  });

  it('/smart-export with NO wallet is 401 and never scopes a query', async () => {
    H.state.callerOwnedWallet = OWNER;
    const res = await request(app())
      .post('/api/memory-packs/smart-export')
      .send({ name: 'brief' });
    expect(res.status).toBe(401);
    expect(H.scopedOwners).toHaveLength(0);
  });

  // ── /import ─────────────────────────────────────────────────────────
  it('CRITICAL: /import rejects a forged body.wallet before any write', async () => {
    H.state.callerOwnedWallet = 'ATTACKER000';
    const res = await request(app())
      .post('/api/memory-packs/import')
      .send({ name: 'p', wallet: VICTIM, memories: [{ content: 'x' }] });
    expect(res.status).toBe(403);
    expect(H.storeMemory).not.toHaveBeenCalled();
  });

  it('unauthenticated requests are rejected (401)', async () => {
    H.state.loggedIn = false;
    const res = await request(app()).post('/api/memory-packs/export').send({ name: 'p' });
    expect(res.status).toBe(401);
  });
});
