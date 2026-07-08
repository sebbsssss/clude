import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

/**
 * Privilege-escalation regression for the dashboard owner gate.
 *
 * The old local `requireOwner` compared a CLIENT-SUPPLIED ?wallet= to the
 * hardcoded (publicly revealed) OWNER_WALLET with no proof of ownership — so any
 * logged-in Privy user could pass ?wallet=<OWNER_WALLET> and gain bot-owner
 * admin, including remote task execution. The gate now proves ownership via
 * requireOwnership (sets req.verifiedWallet to a wallet the caller actually
 * owns) and then asserts that wallet IS the owner. These tests pin that.
 */

const H = vi.hoisted(() => {
  const OWNER_WALLET = 'OWNER1111111111111111111111111111111111111';
  return {
    OWNER_WALLET,
    // Mutable auth state the mocks read; reset in beforeEach.
    state: { loggedIn: true, callerOwnedWallet: OWNER_WALLET as string | null },
    executeTaskManually: vi.fn(async () => ({ ok: true })),
    agentKeysRows: [
      { agent_id: 'a-owner', agent_name: 'Owner Agent', owner_wallet: OWNER_WALLET, registered_at: '2026-01-01', last_used: null, is_active: true },
      { agent_id: 'a-victim', agent_name: 'Victim Agent', owner_wallet: 'VICTIM9999', registered_at: '2026-01-02', last_used: null, is_active: true },
    ],
  };
});

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// OWNER_WALLET is derived from config.owner.wallet in the route module.
vi.mock('@clude/shared/config', () => ({ config: { owner: { wallet: H.OWNER_WALLET } } }));

// requirePrivyAuth: 401 if no session, else attach a privyUser.
vi.mock('@clude/brain/auth/privy-auth', () => ({
  requirePrivyAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!H.state.loggedIn) { res.status(401).json({ error: 'auth required' }); return; }
    (req as Request & { privyUser?: unknown }).privyUser = { userId: 'did:test', appId: 'test-app' };
    next();
  },
}));

// requireOwnership: FAITHFUL to the real contract — only sets verifiedWallet to a
// wallet the caller PROVABLY owns. A claimed ?wallet= that the caller does not
// own is rejected (403); no session at all is 401.
vi.mock('@clude/brain/auth/require-ownership', () => ({
  requireOwnership: (req: Request, res: Response, next: NextFunction) => {
    const claimed =
      (req.query.wallet as string | undefined) ||
      (req.body && typeof req.body.wallet === 'string' ? req.body.wallet : undefined);
    if (!H.state.callerOwnedWallet) { res.status(401).json({ error: 'auth required' }); return; }
    if (claimed && claimed !== H.state.callerOwnedWallet) {
      res.status(403).json({ error: 'Wallet not linked to your account' });
      return;
    }
    (req as Request & { verifiedWallet?: string }).verifiedWallet = H.state.callerOwnedWallet;
    next();
  },
}));

// executeTaskManually — spy so we can assert a forged wallet NEVER reaches it.
vi.mock('@clude/brain/agents', () => ({
  executeTaskManually: H.executeTaskManually,
  AGENT_TYPE_CONFIGS: {},
}));

// Minimal table-routed Supabase mock. agent_keys reads honour .eq('owner_wallet').
vi.mock('@clude/shared/core/database', () => ({
  getDb: () => {
    const filters: Record<string, unknown> = {};
    let table = '';
    const chain: Record<string, unknown> = {
      from(t: string) { table = t; return chain; },
      select() { return chain; },
      insert() { return chain; },
      update() { return chain; },
      delete() { return chain; },
      eq(c: string, v: unknown) { filters[c] = v; return chain; },
      in() { return chain; },
      gt() { return chain; },
      gte() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      range() { return chain; },
      single() { return chain; },
      then(resolve: (r: { data: unknown; error: null }) => void) {
        if (table === 'agent_keys') {
          const rows = H.agentKeysRows.filter((r) => r.owner_wallet === filters['owner_wallet'] && r.is_active);
          resolve({ data: rows, error: null });
        } else {
          resolve({ data: [], error: null });
        }
      },
    };
    return chain;
  },
}));

// eslint-disable-next-line import/first
import { dashboardRoutes } from '../dashboard.routes.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/dashboard', dashboardRoutes());
  return a;
}

beforeEach(() => {
  H.state.loggedIn = true;
  H.state.callerOwnedWallet = H.OWNER_WALLET;
  H.executeTaskManually.mockClear();
});

describe('dashboard owner gate — privilege-escalation regression', () => {
  it('CRITICAL: a non-owner cannot trigger task execution by forging ?wallet=<OWNER_WALLET>', async () => {
    H.state.callerOwnedWallet = 'ATTACKER0000'; // logged in, but owns a different wallet
    const res = await request(app())
      .post(`/api/dashboard/tasks/t1/execute?wallet=${H.OWNER_WALLET}`)
      .send({});
    expect(res.status).toBe(403);
    expect(H.executeTaskManually).not.toHaveBeenCalled();
  });

  it('CRITICAL: same protection on /retry', async () => {
    H.state.callerOwnedWallet = 'ATTACKER0000';
    const res = await request(app())
      .post(`/api/dashboard/tasks/t1/retry?wallet=${H.OWNER_WALLET}`)
      .send({});
    expect(res.status).toBe(403);
    expect(H.executeTaskManually).not.toHaveBeenCalled();
  });

  it('an authenticated user who DOES own their own wallet still cannot reach owner admin', async () => {
    H.state.callerOwnedWallet = 'SOMEUSER1234'; // proven owner of their own wallet, not the bot owner
    const res = await request(app())
      .post('/api/dashboard/tasks/t1/execute?wallet=SOMEUSER1234')
      .send({});
    expect(res.status).toBe(403); // assertOwnerWallet: verifiedWallet !== OWNER_WALLET
    expect(H.executeTaskManually).not.toHaveBeenCalled();
  });

  it('the proven owner CAN trigger execution', async () => {
    H.state.callerOwnedWallet = H.OWNER_WALLET;
    const res = await request(app())
      .post(`/api/dashboard/tasks/t1/execute?wallet=${H.OWNER_WALLET}`)
      .send({});
    expect(res.status).toBe(200);
    expect(H.executeTaskManually).toHaveBeenCalledWith('t1');
  });

  it('GET /agents: a non-owner cannot enumerate another tenant by forging ?wallet=', async () => {
    H.state.callerOwnedWallet = 'ATTACKER0000';
    const res = await request(app()).get(`/api/dashboard/agents?wallet=${H.OWNER_WALLET}`);
    expect(res.status).toBe(403); // requireOwnership rejects the forged wallet
  });

  it('GET /agents: scoped to the caller’s verified wallet — never another tenant’s rows', async () => {
    H.state.callerOwnedWallet = H.OWNER_WALLET;
    const res = await request(app()).get(`/api/dashboard/agents?wallet=${H.OWNER_WALLET}`);
    expect(res.status).toBe(200);
    const ids = res.body.map((a: { id: string }) => a.id);
    expect(ids).toContain('a-owner');
    expect(ids).not.toContain('a-victim'); // VICTIM9999's agent never leaks
  });

  it('unauthenticated requests are rejected (401)', async () => {
    H.state.loggedIn = false;
    const res = await request(app()).get('/api/dashboard/agents');
    expect(res.status).toBe(401);
  });

  // ── Mutation-route coverage: the owner gate must hold on WRITES, not just
  //    the task-execution endpoints. These pin the `ownerOnly` array so a
  //    future refactor that drops assertOwnerWallet (or only guards /tasks)
  //    can't silently re-open agent-fleet CRUD to a forged wallet.

  it('CRITICAL: PUT /agents/:id is not writable by forging ?wallet=<OWNER_WALLET>', async () => {
    H.state.callerOwnedWallet = 'ATTACKER0000'; // logged in, owns a different wallet
    const res = await request(app())
      .put(`/api/dashboard/agents/some-agent-id?wallet=${H.OWNER_WALLET}`)
      .send({ name: 'pwned', budget_monthly_usd: 999999 });
    expect(res.status).toBe(403); // requireOwnership rejects the forged wallet
  });

  it('CRITICAL: DELETE /agents/:id is not reachable by forging ?wallet=<OWNER_WALLET>', async () => {
    H.state.callerOwnedWallet = 'ATTACKER0000';
    const res = await request(app())
      .delete(`/api/dashboard/agents/some-agent-id?wallet=${H.OWNER_WALLET}`);
    expect(res.status).toBe(403);
  });

  it('CRITICAL: a forged wallet in the JSON BODY (not query) is also blocked on POST /agents', async () => {
    // The real extractClaimedWallet falls back to body.wallet, so the attack
    // surface includes a forged wallet smuggled through the request body.
    H.state.callerOwnedWallet = 'ATTACKER0000';
    const res = await request(app())
      .post('/api/dashboard/agents')
      .send({ name: 'pwned-agent', wallet: H.OWNER_WALLET });
    expect(res.status).toBe(403);
  });

  it('CRITICAL: a proven non-owner cannot forge the body wallet to reach task execution', async () => {
    H.state.callerOwnedWallet = 'ATTACKER0000';
    const res = await request(app())
      .post('/api/dashboard/tasks/t1/execute')
      .send({ wallet: H.OWNER_WALLET });
    expect(res.status).toBe(403);
    expect(H.executeTaskManually).not.toHaveBeenCalled();
  });

  it('an authenticated user proving their OWN wallet still cannot mutate the fleet (PUT /agents/:id)', async () => {
    H.state.callerOwnedWallet = 'SOMEUSER1234'; // proven owner of their own wallet, not bot owner
    const res = await request(app())
      .put('/api/dashboard/agents/some-agent-id?wallet=SOMEUSER1234')
      .send({ name: 'still-not-allowed' });
    expect(res.status).toBe(403); // assertOwnerWallet: verifiedWallet !== OWNER_WALLET
  });

  it('the proven owner CAN perform a mutation (PUT /agents/:id passes the gate, reaches the handler)', async () => {
    // Positive path for a WRITE route: the gate must not over-block the real
    // owner. A 403 here would mean assertOwnerWallet wrongly rejected the bot
    // owner; a 401 would mean requireOwnership failed to verify. Anything else
    // (the mock returns a 2xx from the handler) proves the gate let the owner
    // through to the handler — which is the contract under test.
    H.state.callerOwnedWallet = H.OWNER_WALLET;
    const res = await request(app())
      .put(`/api/dashboard/agents/some-agent-id?wallet=${H.OWNER_WALLET}`)
      .send({ name: 'legit-rename' });
    expect(res.status).not.toBe(403); // gate did NOT block the owner
    expect(res.status).not.toBe(401);
    expect(res.status).toBeLessThan(300); // reached the handler successfully
  });

  it('the clk_ / DID path (no ?wallet=) is honoured when the resolved wallet IS the owner', async () => {
    // requireOwnership also accepts an email-only / Cortex-API-key caller with
    // NO ?wallet= and resolves verifiedWallet from the agent row. The mock
    // models that as callerOwnedWallet with no claimed wallet in the request.
    H.state.callerOwnedWallet = H.OWNER_WALLET;
    const res = await request(app())
      .post('/api/dashboard/tasks/t1/execute')
      .send({}); // no ?wallet=, no body.wallet — pure resolved-owner path
    expect(res.status).toBe(200);
    expect(H.executeTaskManually).toHaveBeenCalledWith('t1');
  });
});
