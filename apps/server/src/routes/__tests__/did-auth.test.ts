/**
 * Tests for Spec 032: DID-Based Identity in Routes.
 *
 * Covers:
 *  - auto-register: wallet optional, DID-based registration
 *  - chatAuth: DID fallback when no wallet param
 *  - Existing clk_* and Privy+wallet paths remain untouched
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';

// ---- Mocks (hoisted before imports) ----

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockAuthenticateAgent = vi.fn();
const mockAuthenticateAgentByDid = vi.fn();
const mockFindOrCreateAgentForWallet = vi.fn();
const mockFindOrCreateAgentForDid = vi.fn();

vi.mock('@clude/brain/features/agent-tier', () => ({
  authenticateAgent: (...args: any[]) => mockAuthenticateAgent(...args),
  authenticateAgentByDid: (...args: any[]) => mockAuthenticateAgentByDid(...args),
  findOrCreateAgentForWallet: (...args: any[]) => mockFindOrCreateAgentForWallet(...args),
  findOrCreateAgentForDid: (...args: any[]) => mockFindOrCreateAgentForDid(...args),
}));

// Track which requests have privyUser set (simulates optionalPrivyAuth middleware)
let currentPrivyUser: { userId: string } | null = null;

vi.mock('@clude/brain/auth/privy-auth', () => ({
  requirePrivyAuth: (req: any, _res: any, next: any) => {
    if (currentPrivyUser) {
      req.privyUser = currentPrivyUser;
      next();
    } else {
      _res.status(401).json({ error: 'Unauthorized' });
    }
  },
  optionalPrivyAuth: (req: any, _res: any, next: any) => {
    if (currentPrivyUser) {
      req.privyUser = currentPrivyUser;
    }
    next();
  },
}));

vi.mock('@clude/shared/core/owner-context', () => ({
  withOwnerWallet: (_wallet: any, fn: any) => fn(),
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
    privy: { appId: null, jwksUrl: null },
    openrouter: { apiKey: 'test-key' },
    chat: { llmTimeoutSec: 60, maxContextTokens: 128000 },
    features: {
      freePromoEnabled: false,
      freePromoExpiry: null,
      freePromoCreditUsdc: 5,
    },
  },
}));

const mockDbQueue: Array<{ data: any; error?: any }> = [];
const mockCheckRateLimit = vi.fn().mockResolvedValue(true);

function dequeue() {
  const item = mockDbQueue.shift();
  return Promise.resolve(item ?? { data: null, error: null });
}

function chainBuilder(): any {
  const terminal = {
    single: () => dequeue(),
    then: (onFulfilled: any, onRejected: any) => dequeue().then(onFulfilled, onRejected),
  };
  return new Proxy(terminal, {
    get(target, prop: string) {
      if (prop in target) return (target as any)[prop];
      return (..._args: any[]) => chainBuilder();
    },
  });
}

vi.mock('@clude/shared/utils/rate-limit', () => ({
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
  getRateLimitCount: vi.fn().mockResolvedValue(0),
}));
vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({ from: () => chainBuilder() }),
}));

import { chatRoutes } from '../chat.routes.js';

// ---- Test infrastructure ----

// Simulate the app-level optionalPrivyAuth that runs before all /api routes
function testOptionalPrivyAuth(req: any, _res: any, next: any) {
  if (currentPrivyUser) {
    req.privyUser = currentPrivyUser;
  }
  next();
}

function createTestApp() {
  const app = express();
  app.use(express.json());
  // Apply optionalPrivyAuth at the router level — mirrors app.ts: app.use('/api', optionalPrivyAuth)
  app.use('/api/chat', testOptionalPrivyAuth);
  app.use('/api/chat', chatRoutes());
  return app;
}

async function request(
  server: http.Server,
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: Record<string, any>; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const addr = server.address() as any;
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  };
  if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${baseUrl}${path}`, init);
  let body: any;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

// ---- Tests ----

describe('DID-based auth (Spec 032)', () => {
  let server: http.Server;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = createTestApp().listen(0, () => resolve());
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    mockAuthenticateAgent.mockReset();
    mockAuthenticateAgentByDid.mockReset();
    mockFindOrCreateAgentForWallet.mockReset();
    mockFindOrCreateAgentForDid.mockReset();
    mockCheckRateLimit.mockResolvedValue(true);
    mockDbQueue.length = 0;
    currentPrivyUser = null;
  });

  // ---- auto-register endpoint ----

  describe('POST /api/chat/auto-register', () => {
    it('registers with wallet: calls findOrCreateAgentForDid with DID and wallet', async () => {
      currentPrivyUser = { userId: 'did:privy:abc123' };
      mockFindOrCreateAgentForDid.mockResolvedValueOnce({
        apiKey: 'clk_newkey',
        agentId: 'agent_new',
        isNew: true,
        ownerWallet: 'So11111111111111111111111111111111111111111',
      });

      const res = await request(server, 'POST', '/api/chat/auto-register', {
        body: { wallet: 'So11111111111111111111111111111111111111111' },
        headers: { Authorization: 'Bearer privy_jwt_token' },
      });

      expect(res.status).toBe(200);
      expect(res.body.api_key).toBe('clk_newkey');
      expect(res.body.agent_id).toBe('agent_new');
      expect(res.body.wallet).toBe('So11111111111111111111111111111111111111111');
      expect(res.body.created).toBe(true);

      expect(mockFindOrCreateAgentForDid).toHaveBeenCalledWith(
        'did:privy:abc123',
        'So11111111111111111111111111111111111111111',
      );
    });

    it('registers without wallet: calls findOrCreateAgentForDid with DID only, returns synthetic wallet', async () => {
      currentPrivyUser = { userId: 'did:privy:emailuser' };
      const syntheticWallet = 'a'.repeat(44);
      mockFindOrCreateAgentForDid.mockResolvedValueOnce({
        apiKey: 'clk_emailkey',
        agentId: 'agent_email',
        isNew: true,
        ownerWallet: syntheticWallet,
      });

      const res = await request(server, 'POST', '/api/chat/auto-register', {
        body: {},
        headers: { Authorization: 'Bearer privy_jwt_token' },
      });

      expect(res.status).toBe(200);
      expect(res.body.api_key).toBe('clk_emailkey');
      expect(res.body.wallet).toBe(syntheticWallet);
      expect(res.body.created).toBe(true);

      expect(mockFindOrCreateAgentForDid).toHaveBeenCalledWith(
        'did:privy:emailuser',
        undefined,
      );
    });

    it('returns 400 for invalid wallet format', async () => {
      currentPrivyUser = { userId: 'did:privy:abc123' };

      const res = await request(server, 'POST', '/api/chat/auto-register', {
        body: { wallet: 'not-a-valid-wallet' },
        headers: { Authorization: 'Bearer privy_jwt_token' },
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid Solana wallet/i);
      expect(mockFindOrCreateAgentForDid).not.toHaveBeenCalled();
    });

    it('returns existing agent when already registered (isNew=false)', async () => {
      currentPrivyUser = { userId: 'did:privy:existing' };
      mockFindOrCreateAgentForDid.mockResolvedValueOnce({
        apiKey: 'clk_existingkey',
        agentId: 'agent_existing',
        isNew: false,
        ownerWallet: 'So11111111111111111111111111111111111111111',
      });

      const res = await request(server, 'POST', '/api/chat/auto-register', {
        body: { wallet: 'So11111111111111111111111111111111111111111' },
        headers: { Authorization: 'Bearer privy_jwt_token' },
      });

      expect(res.status).toBe(200);
      expect(res.body.created).toBe(false);
    });
  });

  // ---- chatAuth middleware — clk_* path (untouched) ----

  describe('chatAuth: clk_* API key path', () => {
    it('authenticates with valid clk_* key and sets ownerWallet', async () => {
      const agent = { id: 1, agent_id: 'agent-1', owner_wallet: 'walletABC123456789012345678901234567890123' };
      mockAuthenticateAgent.mockResolvedValueOnce(agent);

      // Push a DB response for the conversations query inside the route
      mockDbQueue.push({ data: [], error: null });

      const res = await request(server, 'GET', '/api/chat/conversations', {
        headers: { Authorization: 'Bearer clk_validkey' },
      });

      // Should not get 401 (auth succeeded)
      expect(res.status).not.toBe(401);
      expect(mockAuthenticateAgent).toHaveBeenCalledWith('clk_validkey');
      // authenticateAgentByDid should NOT be called for clk_* path
      expect(mockAuthenticateAgentByDid).not.toHaveBeenCalled();
    });

    it('returns 401 for invalid clk_* key', async () => {
      mockAuthenticateAgent.mockResolvedValueOnce(null);

      const res = await request(server, 'GET', '/api/chat/conversations', {
        headers: { Authorization: 'Bearer clk_invalidkey' },
      });

      expect(res.status).toBe(401);
    });
  });

  // ---- chatAuth middleware — Privy JWT + wallet param (untouched) ----

  describe('chatAuth: Privy JWT + wallet param path', () => {
    it('authenticates with Privy JWT and valid ?wallet= param', async () => {
      currentPrivyUser = { userId: 'did:privy:user1' };
      mockDbQueue.push({ data: [], error: null });

      const res = await request(server, 'GET', '/api/chat/conversations?wallet=So11111111111111111111111111111111111111111', {
        headers: { Authorization: 'Bearer privy_jwt' },
      });

      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(400);
      // DID lookup should NOT be called when wallet param is present
      expect(mockAuthenticateAgentByDid).not.toHaveBeenCalled();
    });

    it('returns 400 for Privy JWT with invalid ?wallet= format', async () => {
      currentPrivyUser = { userId: 'did:privy:user1' };

      const res = await request(server, 'GET', '/api/chat/conversations?wallet=invalid-wallet', {
        headers: { Authorization: 'Bearer privy_jwt' },
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/wallet/i);
    });
  });

  // ---- chatAuth middleware — DID fallback (new path) ----

  describe('chatAuth: Privy JWT, no wallet param — DID fallback', () => {
    it('resolves ownerWallet via DID when no ?wallet= param provided', async () => {
      currentPrivyUser = { userId: 'did:privy:emailonly' };
      mockAuthenticateAgentByDid.mockResolvedValueOnce({
        id: 5,
        agent_id: 'agent_email',
        owner_wallet: 'SynthWalletAddress12345678901234567890123',
        is_active: true,
      });
      mockDbQueue.push({ data: [], error: null });

      const res = await request(server, 'GET', '/api/chat/conversations', {
        headers: { Authorization: 'Bearer privy_jwt' },
      });

      expect(res.status).not.toBe(401);
      expect(mockAuthenticateAgentByDid).toHaveBeenCalledWith('did:privy:emailonly');
    });

    it('returns 401 when Privy JWT present but no wallet param and no agent registered', async () => {
      currentPrivyUser = { userId: 'did:privy:unregistered' };
      mockAuthenticateAgentByDid.mockResolvedValueOnce(null);

      const res = await request(server, 'GET', '/api/chat/conversations', {
        headers: { Authorization: 'Bearer privy_jwt' },
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/No agent registered/i);
    });

    it('returns 401 when DID lookup throws an error', async () => {
      currentPrivyUser = { userId: 'did:privy:erroring' };
      mockAuthenticateAgentByDid.mockRejectedValueOnce(new Error('DB connection failed'));

      const res = await request(server, 'GET', '/api/chat/conversations', {
        headers: { Authorization: 'Bearer privy_jwt' },
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/No agent registered/i);
    });
  });
});
