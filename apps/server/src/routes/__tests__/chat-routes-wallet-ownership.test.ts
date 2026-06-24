/**
 * Owner-trust regression for the chat auth middleware (chatAuth).
 *
 * VULN CLASS (fixed in d317a844): chatAuth's Privy path scoped the chat session
 * by a CLIENT-SUPPLIED ?wallet= without proving the caller owns it. Any
 * authenticated Privy user could pass ?wallet=<victim> and run a session against
 * the victim's memories (read back through responses) while billing the victim.
 *
 * The fix resolves the caller's Privy-linked wallets via resolveWalletsForDid and
 * 403s an unlinked claim before scoping `ownerWallet`. These tests pin that:
 *   - a forged ?wallet=<VICTIM> is REJECTED (403), and the victim's data is never
 *     queried (the DB owner_wallet filter is captured and asserted);
 *   - the legitimate owner path (?wallet=<WALLET_A>, where the caller provably
 *     owns WALLET_A) still works and scopes to WALLET_A;
 *   - the Cortex clk_ Bearer path (independent of Privy) still works.
 *
 * chatAuth is module-internal, so it is driven through the mounted chat router.
 * req.privyUser is normally set by an upstream Privy middleware; here a tiny
 * test middleware sets it from an x-test-did header to exercise the Privy branch
 * in isolation. resolveWalletsForDid is mocked so the linked-wallet set is
 * controllable with NO network call.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

const H = vi.hoisted(() => {
  const WALLET_A = 'AAAA1111111111111111111111111111111111111111'; // caller provably owns this
  const VICTIM = 'VViiccttiimm9999999999999999999999999999999z'; // a different tenant's wallet
  const CLK_WALLET = 'CLKCLKCLK22222222222222222222222222222222222'; // owner of the clk_ agent
  return {
    WALLET_A,
    VICTIM,
    CLK_WALLET,
    // Mutable: which wallets the (mocked) Privy resolver reports for the caller.
    state: {
      linkedWallets: [WALLET_A] as string[],
      resolverThrows: false,
    },
    // Captures every owner_wallet value the route filters chat_conversations by.
    // A forged-wallet request must NEVER produce a query scoped to VICTIM.
    conversationOwnerFilters: [] as string[],
    resolveWalletsForDid: vi.fn(),
    authenticateAgent: vi.fn(),
    authenticateAgentByDid: vi.fn(),
  };
});

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Privy JWT resolver — mocked so the linked-wallet set is fully controllable and
// NO network/PrivyClient is constructed. This is the seam the fix relies on.
vi.mock('@clude/brain/auth/privy-wallet-resolver', () => ({
  resolveWalletsForDid: (...args: unknown[]) => {
    H.resolveWalletsForDid(...args);
    if (H.state.resolverThrows) throw new Error('privy unreachable');
    return Promise.resolve(H.state.linkedWallets);
  },
}));

// Cortex API-key (clk_) auth — independent of Privy. Drives the clk_ Bearer path.
vi.mock('@clude/brain/features/agent-tier', () => ({
  authenticateAgent: (...args: unknown[]) => H.authenticateAgent(...args),
  authenticateAgentByDid: (...args: unknown[]) => H.authenticateAgentByDid(...args),
  findOrCreateAgentForWallet: vi.fn(),
  findOrCreateAgentForDid: vi.fn(),
}));

// Privy middleware is mounted upstream in prod; here it's a no-op passthrough —
// req.privyUser is injected by a dedicated test middleware (see app()).
vi.mock('@clude/brain/auth/privy-auth', () => ({
  requirePrivyAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  optionalPrivyAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock('@clude/shared/core/owner-context', () => ({
  withOwnerWallet: (_wallet: unknown, fn: () => unknown) => fn(),
}));

vi.mock('@clude/brain/memory', () => ({
  recallMemories: vi.fn().mockResolvedValue([]),
  storeMemory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@clude/shared/core/guardrails', () => ({
  checkInputContent: vi.fn().mockReturnValue({ allowed: true }),
}));

vi.mock('@clude/shared/core/embeddings', () => ({
  generateQueryEmbedding: vi.fn().mockResolvedValue(null),
  isEmbeddingEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@clude/brain/experimental/temporal-bonds', () => ({
  detectTemporalConstraints: vi.fn().mockReturnValue(null),
  matchMemoriesTemporal: vi.fn().mockResolvedValue([]),
}));

vi.mock('@clude/shared/config', () => ({
  config: {
    privy: { appId: 'test-app', jwksUrl: 'https://example.test/jwks' },
    openrouter: { apiKey: 'test-openrouter-key' },
    chat: { llmTimeoutSec: 60, maxContextTokens: 128000 },
    features: { freePromoEnabled: false, freePromoCreditUsdc: 5, freePromoExpiry: null },
  },
}));

vi.mock('@clude/shared/utils/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  getRateLimitCount: vi.fn().mockReturnValue(0),
}));

// Table-routed Supabase mock. For chat_conversations SELECT it records the
// owner_wallet filter (so we can prove a forged request never scopes to VICTIM)
// and returns one conversation owned by whatever wallet was filtered.
vi.mock('@clude/shared/core/database', () => ({
  getDb: () => {
    let table = '';
    const filters: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      from(t: string) { table = t; return chain; },
      select() { return chain; },
      insert() { return chain; },
      update() { return chain; },
      delete() { return chain; },
      eq(col: string, val: unknown) { filters[col] = val; return chain; },
      in() { return chain; },
      not() { return chain; },
      is() { return chain; },
      gt() { return chain; },
      gte() { return chain; },
      lt() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      range() { return chain; },
      single() { return chain; },
      then(resolve: (r: { data: unknown; error: null; count?: number }) => void) {
        if (table === 'chat_conversations') {
          const owner = filters['owner_wallet'];
          if (typeof owner === 'string') H.conversationOwnerFilters.push(owner);
          // Scoped read: only ever return rows for the wallet that was filtered.
          resolve({ data: [{ id: 'conv-1', owner_wallet: owner, title: 'c', model: 'kimi-k2-thinking' }], error: null });
        } else {
          resolve({ data: [], error: null, count: 0 });
        }
      },
    };
    return chain;
  },
}));

// eslint-disable-next-line import/first
import { chatRoutes } from '../chat.routes.js';

/**
 * Mount the real chat router. A tiny test-only middleware simulates the upstream
 * Privy middleware: when x-test-did is present it sets req.privyUser, exercising
 * chatAuth's Privy branch. clk_ Bearer requests omit the header.
 */
function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/chat', (req: Request, _res: Response, next: NextFunction) => {
    const did = req.headers['x-test-did'] as string | undefined;
    if (did) (req as Request & { privyUser?: unknown }).privyUser = { userId: did, appId: 'test-app' };
    next();
  });
  a.use('/api/chat', chatRoutes());
  return a;
}

const PRIVY_HEADERS = { Authorization: 'Bearer privy-jwt', 'x-test-did': 'did:privy:caller' };

beforeEach(() => {
  H.state.linkedWallets = [H.WALLET_A];
  H.state.resolverThrows = false;
  H.conversationOwnerFilters.length = 0;
  H.resolveWalletsForDid.mockClear();
  H.authenticateAgent.mockReset();
  H.authenticateAgentByDid.mockReset();
});

describe('chat auth — forged ?wallet= owner-trust regression', () => {
  it('CRITICAL: authed Privy user forging ?wallet=<VICTIM> is rejected (403), never scoped to the victim', async () => {
    // Caller owns WALLET_A only; they claim the victim's wallet.
    const res = await request(app())
      .get(`/api/chat/conversations?wallet=${H.VICTIM}`)
      .set(PRIVY_HEADERS);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/not linked/i);
    // Ownership was actually checked against the caller's DID...
    expect(H.resolveWalletsForDid).toHaveBeenCalledWith('did:privy:caller', undefined);
    // ...and the victim's conversations were NEVER queried.
    expect(H.conversationOwnerFilters).not.toContain(H.VICTIM);
    expect(H.conversationOwnerFilters).toHaveLength(0);
  });

  it('legit owner: ?wallet=<WALLET_A> (caller provably owns it) → 200, scoped to WALLET_A only', async () => {
    const res = await request(app())
      .get(`/api/chat/conversations?wallet=${H.WALLET_A}`)
      .set(PRIVY_HEADERS);

    expect(res.status).toBe(200);
    expect(H.resolveWalletsForDid).toHaveBeenCalledWith('did:privy:caller', undefined);
    // The session — and therefore the DB read — was scoped to the owned wallet.
    expect(H.conversationOwnerFilters).toEqual([H.WALLET_A]);
    expect(res.body[0].owner_wallet).toBe(H.WALLET_A);
  });

  it('legit clk_ Bearer path still works → 200, scoped to the agent owner_wallet (no Privy involved)', async () => {
    H.authenticateAgent.mockResolvedValueOnce({ id: 7, agent_id: 'agent-clk', owner_wallet: H.CLK_WALLET });

    const res = await request(app())
      .get('/api/chat/conversations')
      .set({ Authorization: 'Bearer clk_livekey' });
    // No x-test-did → no privyUser → pure Cortex-key path.

    expect(res.status).toBe(200);
    expect(H.resolveWalletsForDid).not.toHaveBeenCalled(); // Privy path untouched
    expect(H.conversationOwnerFilters).toEqual([H.CLK_WALLET]);
    expect(res.body[0].owner_wallet).toBe(H.CLK_WALLET);
  });

  it('Privy user with NO ?wallet= falls back to DID agent lookup → 200, scoped to that agent wallet', async () => {
    // email-only user path: no wallet claim, resolve owner via DID.
    H.authenticateAgentByDid.mockResolvedValueOnce({ id: 9, agent_id: 'agent-did', owner_wallet: H.WALLET_A });

    const res = await request(app())
      .get('/api/chat/conversations')
      .set(PRIVY_HEADERS);

    expect(res.status).toBe(200);
    // No wallet claim ⇒ no ownership resolution needed.
    expect(H.resolveWalletsForDid).not.toHaveBeenCalled();
    expect(H.conversationOwnerFilters).toEqual([H.WALLET_A]);
  });

  it('malformed ?wallet= is rejected (400) before any ownership lookup or DB read', async () => {
    const res = await request(app())
      .get('/api/chat/conversations?wallet=not-a-valid-solana-address!!')
      .set(PRIVY_HEADERS);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/wallet/i);
    expect(H.resolveWalletsForDid).not.toHaveBeenCalled();
    expect(H.conversationOwnerFilters).toHaveLength(0);
  });

  it('fail-closed: if the ownership resolver throws, the request 500s and is NEVER scoped to the claim', async () => {
    H.state.resolverThrows = true;
    const res = await request(app())
      .get(`/api/chat/conversations?wallet=${H.VICTIM}`)
      .set(PRIVY_HEADERS);

    expect(res.status).toBe(500);
    expect(H.conversationOwnerFilters).not.toContain(H.VICTIM);
    expect(H.conversationOwnerFilters).toHaveLength(0);
  });

  it('missing Authorization header → 401 (no privyUser, no clk_ token)', async () => {
    const res = await request(app()).get('/api/chat/conversations');
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Missing Authorization/);
  });
});
