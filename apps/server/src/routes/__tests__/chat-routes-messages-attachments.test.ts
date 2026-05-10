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
vi.mock('@clude/shared/core/database', () => {
  // Minimal Supabase mock — chained from('...').select/insert/etc.
  const conv = { id: 'CONV', model: 'claude-sonnet-4.6', owner_wallet: 'WALLET' };
  const fromImpl = (table: string) => {
    const out: any = {};
    out.select = () => out;
    out.eq = () => out;
    out.in = () => out;
    out.single = async () => ({ data: conv, error: null });
    out.insert = () => out;
    out.delete = () => out;
    out.order = () => out;
    out.limit = async () => ({ data: [], error: null });
    return out;
  };
  return {
    getDb: () => ({
      from: vi.fn(fromImpl),
      storage: {
        from: vi.fn(() => ({
          createSignedUrl: vi.fn(async () => ({ data: { signedUrl: 'https://signed/x' }, error: null })),
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

/** Helper: send with a fake Cortex API key so chatAuth passes */
function withAuth(req: request.Test) {
  return req.set('Authorization', 'Bearer clk_testtoken');
}

beforeEach(() => { streamTextMock.mockClear(); });

describe('POST /api/chat/messages with attachments', () => {
  it('rejects attachments with bad storage_path', async () => {
    const res = await withAuth(
      request(buildApp())
        .post('/api/chat/messages')
        .send({
          conversationId: CONV, content: 'hi', model: 'claude-sonnet-4.6',
          attachments: [{ storage_path: 'OTHER/x/y.png', mime: 'image/png', width: 1, height: 1, size_bytes: 10 }],
        })
    );
    expect(res.status).toBe(400);
  });

  it('rejects attachments on a non-vision model', async () => {
    const res = await withAuth(
      request(buildApp())
        .post('/api/chat/messages')
        .send({
          conversationId: CONV, content: 'hi', model: 'llama-3.3-70b',
          attachments: [{
            storage_path: `${WALLET}/${CONV}/abcd.png`, mime: 'image/png', width: 1, height: 1, size_bytes: 10,
          }],
        })
    );
    expect(res.status).toBe(400);
  });
});
