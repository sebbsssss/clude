/**
 * Tests for chat conversation creation, loading, and memory recall flow.
 * Covers: CLU-141 — Add test coverage for chat conversation creation flow.
 *
 * Routes tested:
 *   POST   /api/chat/conversations           — create conversation
 *   GET    /api/chat/conversations           — list conversations
 *   GET    /api/chat/conversations/:id       — load conversation with messages
 *   POST   /api/chat/conversations/:id/messages — send message (partial: validation + memory recall)
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express from 'express';
import http from 'http';

// ---- Mocks (hoisted before imports) ----

vi.mock('../../core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockAuthenticateAgent = vi.fn();
vi.mock('../../features/agent-tier', () => ({
  authenticateAgent: (...args: any[]) => mockAuthenticateAgent(...args),
  findOrCreateAgentForWallet: vi.fn(),
}));

vi.mock('../privy-auth', () => ({
  requirePrivyAuth: (_req: any, _res: any, next: any) => next(),
  optionalPrivyAuth: (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../core/owner-context', () => ({
  withOwnerWallet: (_wallet: any, fn: any) => fn(),
}));

const mockRecallMemories = vi.fn();
vi.mock('../../memory', () => ({
  recallMemories: (...args: any[]) => mockRecallMemories(...args),
  storeMemory: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../core/guardrails', () => ({
  checkInputContent: vi.fn().mockReturnValue({ allowed: true }),
}));

vi.mock('../../core/embeddings', () => ({
  generateQueryEmbedding: vi.fn().mockResolvedValue(null),
  isEmbeddingEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('../../experimental/temporal-bonds', () => ({
  detectTemporalConstraints: vi.fn().mockReturnValue(null),
  matchMemoriesTemporal: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../config', () => ({
  config: {
    privy: { appId: null, jwksUrl: null },
    openrouter: { apiKey: 'test-openrouter-key' },
    chat: { llmTimeoutSec: 60, maxContextTokens: 128000 },
  },
}));

// ---- Flexible DB mock ----
// Each test pushes { data, error } objects onto mockDbQueue in call order.
// The Supabase-like chain builder pops the queue when the query is awaited.

const mockDbQueue: Array<{ data: any; error?: any; count?: number }> = [];
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

vi.mock('../../core/database', () => ({
  getDb: () => ({ from: () => chainBuilder() }),
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
}));

import { chatRoutes } from '../chat.routes.js';

// ---- Test infrastructure ----

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', chatRoutes());
  return app;
}

const AGENT_MOCK = { id: 1, agent_id: 'agent-1', owner_wallet: 'walletABC' };
const AUTH_HEADER = { Authorization: 'Bearer clk_validkey' };

describe('Chat conversation routes', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = createTestApp().listen(0, () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    mockAuthenticateAgent.mockReset();
    mockRecallMemories.mockReset();
    mockCheckRateLimit.mockResolvedValue(true);
    mockDbQueue.length = 0; // clear any leftover queue items
  });

  // ---- Helpers ----

  async function request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    opts: { body?: Record<string, any>; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; body: any }> {
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

  function authAs(agent = AGENT_MOCK) {
    mockAuthenticateAgent.mockResolvedValueOnce(agent);
  }

  // ---- POST /conversations ----

  describe('POST /api/chat/conversations', () => {
    it('happy path: creates conversation and returns 200 with conversation object', async () => {
      const fakeConv = {
        id: 'conv-abc123',
        owner_wallet: 'walletABC',
        title: null,
        model: 'kimi-k2-thinking',
        created_at: '2026-03-24T00:00:00Z',
        updated_at: '2026-03-24T00:00:00Z',
        message_count: 0,
      };
      authAs();
      mockDbQueue.push({ data: fakeConv, error: null });

      const res = await request('POST', '/api/chat/conversations', {
        body: {},
        headers: AUTH_HEADER,
      });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('conv-abc123');
      expect(res.body.model).toBe('kimi-k2-thinking');
    });

    it('unknown model falls back to DEFAULT_MODEL — no rejection', async () => {
      authAs();
      mockDbQueue.push({ data: { id: 'x', model: 'kimi-k2-thinking' }, error: null });

      const res = await request('POST', '/api/chat/conversations', {
        body: { model: 'nonexistent-model-xyz' },
        headers: AUTH_HEADER,
      });

      expect(res.status).toBe(200);
      expect(res.body.model).toBe('kimi-k2-thinking');
    });

    it('missing Authorization header → 401', async () => {
      const res = await request('POST', '/api/chat/conversations', { body: {} });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Missing Authorization/);
    });

    it('invalid Cortex API key → 401', async () => {
      mockAuthenticateAgent.mockResolvedValueOnce(null);
      const res = await request('POST', '/api/chat/conversations', {
        body: {},
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(401);
      expect(res.body.error).toMatch(/Invalid or inactive API key/);
    });

    it('DB failure → 500 with database error message', async () => {
      authAs();
      mockDbQueue.push({ data: null, error: { message: 'connection refused' } });

      const res = await request('POST', '/api/chat/conversations', {
        body: {},
        headers: AUTH_HEADER,
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/Database error:/);
    });
  });

  // ---- GET /conversations ----

  describe('GET /api/chat/conversations', () => {
    it('returns list of conversations for authenticated user', async () => {
      const convs = [
        { id: 'conv-1', title: 'Chat 1', model: 'kimi-k2-thinking', message_count: 3 },
        { id: 'conv-2', title: 'Chat 2', model: 'kimi-k2-thinking', message_count: 1 },
      ];
      authAs();
      mockDbQueue.push({ data: convs, error: null });

      const res = await request('GET', '/api/chat/conversations', { headers: AUTH_HEADER });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].id).toBe('conv-1');
    });

    it('returns empty array when user has no conversations', async () => {
      authAs();
      mockDbQueue.push({ data: [], error: null });

      const res = await request('GET', '/api/chat/conversations', { headers: AUTH_HEADER });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('auth failure → 401', async () => {
      const res = await request('GET', '/api/chat/conversations');
      expect(res.status).toBe(401);
    });

    it('DB failure → 500', async () => {
      authAs();
      mockDbQueue.push({ data: null, error: { message: 'timeout' } });

      const res = await request('GET', '/api/chat/conversations', { headers: AUTH_HEADER });
      expect(res.status).toBe(500);
    });
  });

  // ---- GET /conversations/:id ----

  describe('GET /api/chat/conversations/:id', () => {
    it('returns conversation with messages and hasMore flag', async () => {
      const conv = {
        id: 'conv-abc',
        owner_wallet: 'walletABC',
        model: 'kimi-k2-thinking',
        title: 'My chat',
        message_count: 5,
      };
      // DB returns newest-first (DESC order); route reverses to chronological
      const messages = [
        { id: 'msg-2', role: 'assistant', content: 'Hi!', created_at: '2026-03-24T10:00:01Z' },
        { id: 'msg-1', role: 'user', content: 'Hello', created_at: '2026-03-24T10:00:00Z' },
      ];

      authAs();
      // DB call 1: fetch conversation
      mockDbQueue.push({ data: conv, error: null });
      // DB call 2: fetch messages (≤20, no hasMore)
      mockDbQueue.push({ data: messages, error: null });

      const res = await request('GET', '/api/chat/conversations/conv-abc', {
        headers: AUTH_HEADER,
      });

      expect(res.status).toBe(200);
      expect(res.body.id).toBe('conv-abc');
      expect(res.body.messages).toHaveLength(2);
      expect(res.body.messages[0].role).toBe('user');
      expect(res.body.hasMore).toBe(false);
    });

    it('hasMore is true when more than 20 messages exist', async () => {
      const conv = { id: 'conv-full', owner_wallet: 'walletABC', model: 'kimi-k2-thinking', title: null };
      // Return 21 messages (limit + 1 triggers hasMore)
      const messages = Array.from({ length: 21 }, (_, i) => ({
        id: `msg-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
        created_at: new Date(Date.now() + i * 1000).toISOString(),
      }));

      authAs();
      mockDbQueue.push({ data: conv, error: null });
      mockDbQueue.push({ data: messages, error: null });

      const res = await request('GET', '/api/chat/conversations/conv-full', {
        headers: AUTH_HEADER,
      });

      expect(res.status).toBe(200);
      expect(res.body.hasMore).toBe(true);
      expect(res.body.messages).toHaveLength(20); // sliced to 20
    });

    it('returns 404 for non-existent or unowned conversation', async () => {
      authAs();
      // Conversation not found (different owner or doesn't exist)
      mockDbQueue.push({ data: null, error: { code: 'PGRST116' } });

      const res = await request('GET', '/api/chat/conversations/does-not-exist', {
        headers: AUTH_HEADER,
      });

      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/not found/i);
    });

    it('auth failure → 401', async () => {
      const res = await request('GET', '/api/chat/conversations/any-id');
      expect(res.status).toBe(401);
    });
  });

  // ---- POST /conversations/:id/messages — validation + memory recall ----

  describe('POST /api/chat/conversations/:id/messages', () => {
    it('missing content → 400', async () => {
      authAs();
      const res = await request('POST', '/api/chat/conversations/conv-1/messages', {
        body: {},
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/content is required/);
    });

    it('unknown conversation → 404', async () => {
      authAs();
      // Conversation lookup returns null (not found)
      mockDbQueue.push({ data: null, error: null });

      const res = await request('POST', '/api/chat/conversations/unknown-conv/messages', {
        body: { content: 'Hello there' },
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Conversation not found/);
    });

    it('rate limit exceeded → 429', async () => {
      authAs();
      // Conversation found
      mockDbQueue.push({ data: { id: 'conv-1', model: 'kimi-k2-thinking' }, error: null });
      // Rate limit exceeded
      mockCheckRateLimit.mockResolvedValueOnce(false);

      const res = await request('POST', '/api/chat/conversations/conv-1/messages', {
        body: { content: 'Hello' },
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(429);
      expect(res.body.error).toMatch(/Rate limit/);
    });

    it('insufficient balance for pro model → 402 with descriptive message', async () => {
      authAs();
      // DB call 1: conversation lookup (pro model)
      mockDbQueue.push({ data: { id: 'conv-1', model: 'claude-sonnet-4.6' }, error: null });
      // rate limit passes (default mock)
      // content filter passes (default mock)
      // DB call 2: balance check — nearly zero
      mockDbQueue.push({ data: { balance_usdc: '0.00001' }, error: null });

      const res = await request('POST', '/api/chat/conversations/conv-1/messages', {
        body: { content: 'Hello' },
        headers: AUTH_HEADER,
      });
      expect(res.status).toBe(402);
      expect(res.body.error).toMatch(/Insufficient balance.*Top up/);
      expect(res.body.model).toBe('claude-sonnet-4.6');
    });

    it('memories are recalled when sending a message', async () => {
      const memories = [
        { id: 1, summary: 'User likes TypeScript', memory_type: 'semantic', content: '...', tags: [] },
        { id: 2, summary: 'User is working on a chatbot', memory_type: 'episodic', content: '...', tags: [] },
      ];

      authAs();
      // DB call 1: conversation lookup
      mockDbQueue.push({ data: { id: 'conv-1', model: 'kimi-k2-thinking' }, error: null });
      // rate limit passes (default mock)
      // content filter passes (default mock)
      // DB call 2: insert user message
      mockDbQueue.push({ data: { id: 'msg-new' }, error: null });
      // DB call 3: memory count
      mockDbQueue.push({ count: 5, data: null, error: null });
      // Set up memory recall
      mockRecallMemories.mockResolvedValueOnce(memories);

      // Note: after memory recall, the route calls OpenRouter AI (SSE).
      // We interrupt the SSE connection immediately — we only care that recall happened.
      const controller = new AbortController();
      const fetchPromise = fetch(`${baseUrl}/api/chat/conversations/conv-1/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...AUTH_HEADER },
        body: JSON.stringify({ content: 'What do you know about me?' }),
        signal: controller.signal,
      });

      // Give the server time to process up to the memory recall step
      await new Promise((resolve) => setTimeout(resolve, 150));
      controller.abort();

      try { await fetchPromise; } catch { /* expected abort */ }

      // Verify recallMemories was called with the right query
      expect(mockRecallMemories).toHaveBeenCalledOnce();
      expect(mockRecallMemories.mock.calls[0][0]).toMatchObject({
        query: 'What do you know about me?',
        limit: 25,
      });
    });
  });
});
