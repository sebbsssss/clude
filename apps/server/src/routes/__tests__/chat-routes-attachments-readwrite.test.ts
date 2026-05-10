import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks
const streamTextMock = vi.fn();
vi.mock('ai', () => ({
  streamText: (...args: any[]) => {
    streamTextMock(...args);
    return {
      pipeUIMessageStreamToResponse: (res: any) => { res.status(200).end(); },
    };
  },
  smoothStream: () => (x: unknown) => x,
}));

// Stub heavy deps
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info(){}, warn(){}, error(){}, debug(){} }),
}));

// Mutable storage mock state
const createSignedUrlMock = vi.fn(async () => ({ data: { signedUrl: 'https://signed/x' }, error: null }));
const listMock = vi.fn(async () => ({ data: [{ name: 'a.png' }, { name: 'b.png' }], error: null }));
const removeMock = vi.fn(async () => ({ data: null, error: null }));

vi.mock('@clude/shared/core/database', () => {
  const WALLET = 'WALLET';
  const CONV = '11111111-1111-4111-8111-111111111111';

  const conv = { id: CONV, model: 'claude-sonnet-4.6', owner_wallet: WALLET };
  const msgWithAttachment = {
    id: 'MSG1',
    conversation_id: CONV,
    role: 'user',
    content: 'hello',
    attachments: [
      {
        storage_path: `${WALLET}/${CONV}/abcd.png`,
        mime: 'image/png',
        width: 1,
        height: 1,
        size_bytes: 10,
      },
    ],
    created_at: new Date().toISOString(),
  };

  const fromImpl = (table: string) => {
    const out: any = {};
    out.select = () => out;
    out.eq = () => out;
    out.lt = () => out;
    out.in = () => out;
    out.order = () => out;
    out.single = async () => {
      if (table === 'chat_conversations') return { data: conv, error: null };
      return { data: null, error: null };
    };
    out.limit = async () => ({ data: [msgWithAttachment], error: null });
    out.insert = () => out;
    out.delete = () => out;
    return out;
  };

  // separate fromImpl for DELETE that verifies conversation exists then deletes
  const fromImplDelete = (table: string) => {
    const out: any = {};
    out.select = () => out;
    out.eq = () => out;
    out.single = async () => ({ data: { id: CONV }, error: null });
    out.delete = () => out;
    return out;
  };

  return {
    getDb: () => ({
      from: vi.fn((table: string) => fromImpl(table)),
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: createSignedUrlMock,
          list: listMock,
          remove: removeMock,
        })),
      },
    }),
  };
});

vi.mock('@clude/shared/utils/rate-limit', () => ({
  checkRateLimit: vi.fn(async () => true),
  getRateLimitCount: vi.fn(async () => 0),
}));
vi.mock('@clude/shared/core/guardrails', () => ({ checkInputContent: () => ({ allowed: true }) }));
vi.mock('@clude/brain/memory', () => ({ recallMemories: vi.fn(async () => []), storeMemory: vi.fn() }));
vi.mock('@clude/shared/core/owner-context', () => ({ withOwnerWallet: (_w: string, fn: any) => fn() }));
vi.mock('@clude/brain/auth/privy-auth', () => ({ requirePrivyAuth: (_req: any, _res: any, next: any) => next() }));
vi.mock('@clude/brain/features/agent-tier', () => ({
  authenticateAgent: vi.fn(async () => ({ agent_id: 'test', owner_wallet: 'WALLET', id: 1 })),
  authenticateAgentByDid: vi.fn(),
  findOrCreateAgentForWallet: vi.fn(),
  findOrCreateAgentForDid: vi.fn(),
}));
vi.mock('@clude/shared/config', () => ({
  config: { owner: { wallet: 'WALLET' }, chat: { llmTimeoutSec: 60 } },
}));
vi.mock('@clude/shared/core/openrouter-client', () => ({
  isOpenRouterEnabled: () => true,
  getOpenRouterConfig: () => ({ apiKey: 'x', baseURL: 'y' }),
  OPENROUTER_MODELS: { 'claude-sonnet-4.6': 'anthropic/claude-sonnet-4.6' },
}));
vi.mock('@clude/brain/experimental/temporal-bonds', () => ({
  detectTemporalConstraints: () => null,
  matchMemoriesTemporal: vi.fn(async () => []),
}));
vi.mock('@ai-sdk/anthropic', () => ({ createAnthropic: () => ({ chat: () => ({}) }) }));
vi.mock('@ai-sdk/openai',    () => ({ createOpenAI:    () => ({ chat: () => ({}) }) }));
vi.mock('@ai-sdk/google',    () => ({ createGoogleGenerativeAI: () => ({ chat: () => ({}) }) }));
vi.mock('@ai-sdk/xai',       () => ({ createXai:       () => ({ chat: () => ({}) }) }));
vi.mock('vercel-minimax-ai-provider', () => ({ createMinimax: () => ({ chat: () => ({}) }) }));
vi.mock('@openrouter/ai-sdk-provider', () => ({ createOpenRouter: () => ({ chat: () => ({}) }) }));

import express from 'express';
import request from 'supertest';
import { chatRoutes } from '../chat.routes';

const WALLET = 'WALLET';
const CONV = '11111111-1111-4111-8111-111111111111';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/chat', chatRoutes());
  return app;
}

function withAuth(req: request.Test) {
  return req.set('Authorization', 'Bearer clk_testtoken');
}

beforeEach(() => {
  streamTextMock.mockClear();
  createSignedUrlMock.mockClear();
  listMock.mockClear();
  removeMock.mockClear();
  // Reset to default behaviors
  createSignedUrlMock.mockResolvedValue({ data: { signedUrl: 'https://signed/x' }, error: null });
  listMock.mockResolvedValue({ data: [{ name: 'a.png' }, { name: 'b.png' }], error: null });
  removeMock.mockResolvedValue({ data: null, error: null });
});

describe('GET /api/chat/conversations/:id re-signs attachment URLs', () => {
  it('returns messages with fresh signed URLs', async () => {
    const res = await withAuth(
      request(buildApp()).get(`/api/chat/conversations/${CONV}`)
    );

    expect(res.status).toBe(200);
    const msg = res.body.messages?.[0];
    expect(msg).toBeDefined();
    const att = msg?.attachments?.[0];
    expect(att).toBeDefined();
    expect(att.url).toBe('https://signed/x');
    expect(att.storage_path).toBe(`${WALLET}/${CONV}/abcd.png`);
  });
});

describe('DELETE /api/chat/conversations/:id clears storage', () => {
  it('calls remove with the correct paths', async () => {
    const res = await withAuth(
      request(buildApp()).delete(`/api/chat/conversations/${CONV}`)
    );

    expect(res.status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith([
      `${WALLET}/${CONV}/a.png`,
      `${WALLET}/${CONV}/b.png`,
    ]);
  });

  it('survives storage remove failure with 200', async () => {
    removeMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } } as any);

    const res = await withAuth(
      request(buildApp()).delete(`/api/chat/conversations/${CONV}`)
    );

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
