import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

/**
 * Client-wallet-trust regression for /api/wiki-packs.
 *
 * The router scopes every install/list/uninstall by an owner_wallet derived in
 * `ownerOf(req) = req.verifiedWallet ?? ?wallet= ?? body.wallet`. The ONLY value
 * a caller controls (?wallet=, body.wallet) must never reach the DB as the scope
 * unless the auth chain (requirePrivyAuth + optionalOwnership → requireOwnership)
 * has PROVEN the caller owns it. These tests pin that:
 *
 *   - a forged ?wallet=<victim> (claimed, NOT owned) is rejected (403) before any
 *     DB op, so the victim's pack installations are never read, written, or deleted;
 *   - a forged body.wallet=<victim> on PUT/DELETE is rejected the same way;
 *   - the proven owner is scoped to THEIR wallet — another tenant's rows never leak;
 *   - the no-wallet edge (authenticated, no claim, nothing resolvable) yields
 *     owner=null → 400, NEVER an unscoped install/list/delete across all tenants.
 *
 * The auth mocks are FAITHFUL to the real contract: a claimed wallet the caller
 * does not own is rejected, and optionalOwnership only short-circuits (next()
 * with no verifiedWallet) when NO wallet is claimed — exactly like the source.
 */

const H = vi.hoisted(() => {
  const OWNER = 'OWNER1111111111111111111111111111111111111';
  const VICTIM = 'VICTIM999999999999999999999999999999999999';
  return {
    OWNER,
    VICTIM,
    // Mutable auth state the mocks read; reset in beforeEach.
    // loggedIn → requirePrivyAuth passes. callerOwnedWallet → the single wallet
    // the caller can prove ownership of (null = no resolvable wallet at all).
    state: { loggedIn: true, callerOwnedWallet: OWNER as string | null },
    invalidateInstalledPacksCache: vi.fn(),
    // Captures every Supabase op the handler actually issued, so we can assert a
    // forged/null owner NEVER produced a real query.
    ops: [] as Array<{ op: 'select' | 'upsert' | 'delete'; ownerFilter?: unknown; row?: unknown }>,
    // Per-(owner) installed pack rows the select path returns.
    rowsByOwner: {} as Record<string, Array<{ pack_id: string; installed_at: string }>>,
  };
});

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@clude/shared/config', () => ({ config: { owner: { wallet: H.OWNER } } }));

// requirePrivyAuth: 401 if no session, else attach a privyUser.
vi.mock('@clude/brain/auth/privy-auth', () => ({
  requirePrivyAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!H.state.loggedIn) { res.status(401).json({ error: 'auth required' }); return; }
    (req as Request & { privyUser?: unknown }).privyUser = { userId: 'did:test', appId: 'test-app' };
    next();
  },
}));

// require-ownership: FAITHFUL simulation of both exports.
//
// requireOwnership — sets verifiedWallet ONLY to a wallet the caller provably
// owns. A claimed wallet the caller doesn't own → 403; no resolvable wallet at
// all (and a claim present) → 400/401; the no-claim resolved path sets the
// caller's own wallet.
//
// optionalOwnership — short-circuits to next() (leaving verifiedWallet UNSET)
// when NO wallet is claimed; otherwise delegates to requireOwnership. This is
// the exact branch structure of the real module, so the wiki-packs ?wallet=/
// body.wallet fallback is exercised under realistic middleware behaviour.
vi.mock('@clude/brain/auth/require-ownership', () => {
  const claimOf = (req: Request): string | undefined =>
    (req.query.wallet as string | undefined) ||
    (req.body && typeof req.body.wallet === 'string' ? req.body.wallet : undefined);

  const requireOwnership = (req: Request, res: Response, next: NextFunction) => {
    const claimed = claimOf(req);
    if (!claimed) {
      // No claim: resolve from the caller's identity (Privy DID / clk_ key).
      if (H.state.callerOwnedWallet) {
        (req as Request & { verifiedWallet?: string }).verifiedWallet = H.state.callerOwnedWallet;
        next();
        return;
      }
      res.status(401).json({ error: 'No agent registered for this account' });
      return;
    }
    if (!H.state.callerOwnedWallet) { res.status(401).json({ error: 'auth required' }); return; }
    if (claimed !== H.state.callerOwnedWallet) {
      res.status(403).json({ error: 'Wallet not linked to your account' });
      return;
    }
    (req as Request & { verifiedWallet?: string }).verifiedWallet = H.state.callerOwnedWallet;
    next();
  };

  const optionalOwnership = (req: Request, res: Response, next: NextFunction) => {
    if (!claimOf(req)) { next(); return; } // no wallet → no scope set, fall through
    return requireOwnership(req, res, next);
  };

  return { requireOwnership, optionalOwnership };
});

vi.mock('@clude/brain/memory', () => ({
  invalidateInstalledPacksCache: H.invalidateInstalledPacksCache,
}));

// Supabase mock that RECORDS each op + honours .eq('owner_wallet') on select.
//
// Terminal methods the handlers await (.order() for GET, .upsert()/.delete()
// for writes) return REAL resolved Promises — the chain is never itself a
// thenable. (A self-thenable chain races under supertest's async HTTP flow and
// flakes with "socket hang up"; resolving to a concrete Promise is deterministic.)
vi.mock('@clude/shared/core/database', () => ({
  getDb: () => {
    let table = '';
    const filters: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      from(t: string) { table = t; return chain; },
      select() { return chain; },
      eq(c: string, v: unknown) { filters[c] = v; return chain; },
      // GET path: .select().eq('owner_wallet', owner).order(...) is awaited here.
      order() {
        H.ops.push({ op: 'select', ownerFilter: filters['owner_wallet'] });
        const rows = (table === 'wiki_pack_installations')
          ? (H.rowsByOwner[String(filters['owner_wallet'])] ?? [])
          : [];
        return Promise.resolve({ data: rows, error: null });
      },
      // PUT path: .upsert({ owner_wallet, pack_id }, ...) is awaited here.
      upsert(row: unknown) {
        H.ops.push({ op: 'upsert', row, ownerFilter: (row as { owner_wallet?: unknown })?.owner_wallet });
        return Promise.resolve({ data: null, error: null });
      },
      // DELETE path: .delete().eq('owner_wallet', owner).eq('pack_id', id) awaited.
      delete() {
        const p = Promise.resolve({ data: null, error: null });
        // owner filter is applied by subsequent .eq() calls; capture lazily.
        const deleteChain: Record<string, unknown> = {
          eq(c: string, v: unknown) { filters[c] = v; return deleteChain; },
          then(resolve: (r: { data: null; error: null }) => unknown, reject?: (e: unknown) => unknown) {
            H.ops.push({ op: 'delete', ownerFilter: filters['owner_wallet'] });
            return p.then(resolve, reject);
          },
        };
        return deleteChain;
      },
    };
    return chain;
  },
}));

// eslint-disable-next-line import/first
import { wikiPacksRoutes } from '../wiki-packs.routes.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/wiki-packs', wikiPacksRoutes());
  return a;
}

beforeEach(() => {
  H.state.loggedIn = true;
  H.state.callerOwnedWallet = H.OWNER;
  H.ops.length = 0;
  H.rowsByOwner = {};
  H.invalidateInstalledPacksCache.mockClear();
});

describe('wiki-packs owner scoping — client-wallet-trust regression', () => {
  // ── Forged query param ────────────────────────────────────────────────── //

  it('CRITICAL: GET cannot read a victim’s installs by forging ?wallet=<victim>', async () => {
    H.state.callerOwnedWallet = 'ATTACKER00000000000000000000000000000000000';
    H.rowsByOwner[H.VICTIM] = [{ pack_id: 'compliance', installed_at: '2026-01-01' }];
    const res = await request(app()).get(`/api/wiki-packs?wallet=${H.VICTIM}`);
    expect(res.status).toBe(403);
    // No SELECT was ever issued — the victim's rows were never touched.
    expect(H.ops.filter((o) => o.op === 'select')).toHaveLength(0);
  });

  it('CRITICAL: PUT cannot install into a victim’s scope via ?wallet=<victim>', async () => {
    H.state.callerOwnedWallet = 'ATTACKER00000000000000000000000000000000000';
    const res = await request(app()).put(`/api/wiki-packs/compliance?wallet=${H.VICTIM}`).send({});
    expect(res.status).toBe(403);
    expect(H.ops.filter((o) => o.op === 'upsert')).toHaveLength(0);
    expect(H.invalidateInstalledPacksCache).not.toHaveBeenCalled();
  });

  it('CRITICAL: DELETE cannot uninstall from a victim’s scope via ?wallet=<victim>', async () => {
    H.state.callerOwnedWallet = 'ATTACKER00000000000000000000000000000000000';
    const res = await request(app()).delete(`/api/wiki-packs/compliance?wallet=${H.VICTIM}`);
    expect(res.status).toBe(403);
    expect(H.ops.filter((o) => o.op === 'delete')).toHaveLength(0);
    expect(H.invalidateInstalledPacksCache).not.toHaveBeenCalled();
  });

  // ── Forged JSON body (the second clause of ownerOf) ────────────────────── //

  it('CRITICAL: PUT cannot install into a victim’s scope via body.wallet=<victim>', async () => {
    H.state.callerOwnedWallet = 'ATTACKER00000000000000000000000000000000000';
    const res = await request(app()).put('/api/wiki-packs/compliance').send({ wallet: H.VICTIM });
    expect(res.status).toBe(403);
    expect(H.ops.filter((o) => o.op === 'upsert')).toHaveLength(0);
  });

  it('CRITICAL: DELETE cannot uninstall from a victim’s scope via body.wallet=<victim>', async () => {
    H.state.callerOwnedWallet = 'ATTACKER00000000000000000000000000000000000';
    const res = await request(app())
      .delete('/api/wiki-packs/compliance')
      .send({ wallet: H.VICTIM });
    expect(res.status).toBe(403);
    expect(H.ops.filter((o) => o.op === 'delete')).toHaveLength(0);
  });

  // ── Positive paths: the proven owner is scoped to THEIR wallet ─────────── //

  it('GET is scoped to the caller’s verified wallet — another tenant’s rows never leak', async () => {
    H.state.callerOwnedWallet = H.OWNER;
    H.rowsByOwner[H.OWNER] = [{ pack_id: 'compliance', installed_at: '2026-01-01' }];
    H.rowsByOwner[H.VICTIM] = [{ pack_id: 'legal-secret', installed_at: '2026-01-01' }];
    const res = await request(app()).get(`/api/wiki-packs?wallet=${H.OWNER}`);
    expect(res.status).toBe(200);
    // Implicit default pack + the owner's own install; the victim's pack absent.
    expect(res.body.installed).toContain('workspace');
    expect(res.body.installed).toContain('compliance');
    expect(res.body.installed).not.toContain('legal-secret');
    const sel = H.ops.filter((o) => o.op === 'select');
    expect(sel).toHaveLength(1);
    expect(sel[0].ownerFilter).toBe(H.OWNER); // scoped to the verified wallet only
  });

  it('PUT installs under the caller’s verified wallet (owner_wallet=caller, not the claim sink)', async () => {
    H.state.callerOwnedWallet = H.OWNER;
    const res = await request(app()).put(`/api/wiki-packs/compliance?wallet=${H.OWNER}`).send({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ packId: 'compliance', installed: true });
    const ups = H.ops.filter((o) => o.op === 'upsert');
    expect(ups).toHaveLength(1);
    expect(ups[0].ownerFilter).toBe(H.OWNER);
    expect(H.invalidateInstalledPacksCache).toHaveBeenCalledWith(H.OWNER);
  });

  it('DELETE uninstalls under the caller’s verified wallet', async () => {
    H.state.callerOwnedWallet = H.OWNER;
    const res = await request(app()).delete(`/api/wiki-packs/compliance?wallet=${H.OWNER}`);
    expect(res.status).toBe(200);
    const del = H.ops.filter((o) => o.op === 'delete');
    expect(del).toHaveLength(1);
    expect(del[0].ownerFilter).toBe(H.OWNER);
    expect(H.invalidateInstalledPacksCache).toHaveBeenCalledWith(H.OWNER);
  });

  // ── No-wallet edge: owner=null must NOT mean "all tenants" ─────────────── //
  //
  // NOTE on wiki-packs vs the dashboard router: wiki-packs uses optionalOwnership
  // (NOT requireOwnership). With no ?wallet=/body.wallet, optionalOwnership
  // short-circuits to next() WITHOUT setting verifiedWallet — so the resolved
  // clk_/DID owner path is never reached here, and ownerOf() returns null. The
  // handler's `if (!owner) → 400` guard is therefore the sole thing standing
  // between a no-wallet request and an UNSCOPED query across every tenant. These
  // three tests pin that guard for list / install / uninstall.

  it('CRITICAL: GET with no wallet (authenticated, nothing resolvable) → 400, no unscoped SELECT', async () => {
    // optionalOwnership sees no claim → next() with verifiedWallet UNSET → ownerOf
    // returns null → the handler's `if (!owner)` guard returns 400 BEFORE any DB op.
    const res = await request(app()).get('/api/wiki-packs');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'wallet required' });
    expect(H.ops).toHaveLength(0); // crucial: no unscoped list across all owners
  });

  it('CRITICAL: PUT with no wallet → 400, no unscoped upsert', async () => {
    const res = await request(app()).put('/api/wiki-packs/compliance').send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'wallet required' });
    expect(H.ops).toHaveLength(0);
    expect(H.invalidateInstalledPacksCache).not.toHaveBeenCalled();
  });

  it('CRITICAL: DELETE with no wallet → 400, no unscoped delete', async () => {
    const res = await request(app()).delete('/api/wiki-packs/compliance');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'wallet required' });
    expect(H.ops).toHaveLength(0);
  });

  // ── Auth-chain front door ──────────────────────────────────────────────── //

  it('unauthenticated requests are rejected (401) before any handler logic', async () => {
    H.state.loggedIn = false;
    const res = await request(app()).get(`/api/wiki-packs?wallet=${H.OWNER}`);
    expect(res.status).toBe(401);
    expect(H.ops).toHaveLength(0);
  });

  // ── Input-validation defense-in-depth (still owner-scoped) ─────────────── //

  it('DELETE of the default workspace pack is refused (409) even for the owner', async () => {
    H.state.callerOwnedWallet = H.OWNER;
    const res = await request(app()).delete(`/api/wiki-packs/workspace?wallet=${H.OWNER}`);
    expect(res.status).toBe(409);
    expect(H.ops.filter((o) => o.op === 'delete')).toHaveLength(0);
  });

  it('PUT with a malformed pack id is rejected (400) after ownership passes', async () => {
    H.state.callerOwnedWallet = H.OWNER;
    const res = await request(app()).put(`/api/wiki-packs/BAD_ID!!?wallet=${H.OWNER}`).send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'Invalid pack id' });
    expect(H.ops.filter((o) => o.op === 'upsert')).toHaveLength(0);
  });
});
