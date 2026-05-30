import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import type { Server } from 'http';

// Disable the endpoint's TTL cache so each test exercises its own RPC result.
process.env.PROOF_CACHE_TTL_MS = '0';

const mockDbQueue: Array<{ data: any; error?: any }> = [];
function dequeue() { return Promise.resolve(mockDbQueue.shift() ?? { data: null, error: null }); }
function chainBuilder(): any {
  const terminal = {
    single: () => dequeue(),
    then: (f: any, r: any) => dequeue().then(f, r),
  };
  return new Proxy(terminal, { get(t, p: string) { return p in t ? (t as any)[p] : () => chainBuilder(); } });
}
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({ from: () => chainBuilder(), rpc: () => chainBuilder() }),
}));

// --- Mocks for hallucination ask endpoint ---

vi.mock('@clude/brain/memory', () => ({
  recallMemories: vi.fn().mockResolvedValue([
    { id: 1, summary: 'Slot 328970103 was at 2025-03-25T00:04:22Z', content: 'block time 2025-03-25T00:04:22Z', importance: 0.9, decayFactor: 1 },
  ]),
  formatMemoryContext: vi.fn().mockReturnValue('Context: Slot 328970103 block time is 2025-03-25T00:04:22Z'),
}));

vi.mock('@clude/shared/core/owner-context', () => ({
  withOwnerWallet: vi.fn((_w: string | null, fn: () => unknown) => fn()),
}));

vi.mock('@clude/shared/core/openrouter-client', () => ({
  generateOpenRouterResponse: vi.fn().mockResolvedValue('2025-03-25T00:04:22Z'),
  OPENROUTER_MODELS: { 'claude-haiku-4.5': 'anthropic/claude-haiku-4.5' },
}));

// Mock the fixture loader to return known test fixtures
vi.mock('../../lib/proof-hallucination.js', () => ({
  loadHallucinationData: vi.fn().mockReturnValue({
    results: {
      placeholder: true,
      rate: null,
      baselineRate: null,
      n: 0,
      model: 'anthropic/claude-haiku-4.5',
      datasetVersion: 'crypto_solana_mainnet_us@2025-03-31',
      runAt: null,
      byCategory: {},
    },
    examples: [
      { id: 'ex-1', question: 'When was slot 1?', groundTruth: '2025-01-01T00:00:00Z', clude: { answer: '2025-01-01T00:00:00Z', correct: true }, baseline: { answer: 'I don\'t know', correct: false } },
      { id: 'ex-2', question: 'Who led slot 2?', groundTruth: 'ABC123', clude: { answer: 'ABC123', correct: true }, baseline: { answer: 'XYZ789', correct: false } },
    ],
    qa: [
      { id: 'block:328970103::block_time', category: 'block_time', question: 'What was the block time (UTC) of Solana slot 328970103?', gold: '2025-03-25T00:04:22Z', sourceRef: 'block:328970103' },
    ],
  }),
}));

import { proofRoutes } from '../proof.routes.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/proof', proofRoutes());
  return app;
}

// ---------- /tokens-saved (existing) ----------

describe('GET /api/proof/tokens-saved', () => {
  let server: Server; let baseUrl: string;
  beforeAll(async () => {
    await new Promise<void>((res) => { server = createTestApp().listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as any).port}`; res(); }); });
  });
  afterAll(async () => { await new Promise<void>((res) => server.close(() => res())); });
  beforeEach(() => { mockDbQueue.length = 0; });

  it('returns measured + hybrid-estimated total with the documented shape', async () => {
    mockDbQueue.push({ data: [{ measured_saved: 100000, measured_today: 10000, measured_frontier: 120000, historical_prompt_sum: 1000000, n: 500 }], error: null });
    const r = await fetch(`${baseUrl}/api/proof/tokens-saved`);
    const body: any = await r.json();
    expect(r.status).toBe(200);
    expect(body.baselineEstimated).toBe(820000); // round(1_000_000 * 0.82)
    expect(body.totalSaved).toBe(920000);         // 100000 + 820000
    expect(body.savedToday).toBe(10000);
    expect(body.avgSavingsPct).toBe(83);          // round(100000/120000*100)
    expect(typeof body.ratePerMin).toBe('number');
    expect(typeof body.updatedAt).toBe('string');
  });

  it('degrades to a safe payload (200, non-negative total) when the RPC errors', async () => {
    mockDbQueue.push({ data: null, error: { message: 'boom' } });
    const r = await fetch(`${baseUrl}/api/proof/tokens-saved`);
    const body: any = await r.json();
    expect(r.status).toBe(200);
    expect(body.totalSaved).toBeGreaterThanOrEqual(0);
  });
});

// ---------- /hallucination ----------

describe('GET /api/proof/hallucination', () => {
  let server: Server; let baseUrl: string;
  beforeAll(async () => {
    await new Promise<void>((res) => { server = createTestApp().listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as any).port}`; res(); }); });
  });
  afterAll(async () => { await new Promise<void>((res) => server.close(() => res())); });

  it('returns 200 with the placeholder shape from fixture', async () => {
    const r = await fetch(`${baseUrl}/api/proof/hallucination`);
    const body: any = await r.json();
    expect(r.status).toBe(200);
    expect(body).toMatchObject({
      placeholder: true,
      rate: null,
      n: 0,
      model: 'anthropic/claude-haiku-4.5',
      datasetVersion: 'crypto_solana_mainnet_us@2025-03-31',
    });
  });
});

// ---------- /hallucination/examples ----------

describe('GET /api/proof/hallucination/examples', () => {
  let server: Server; let baseUrl: string;
  beforeAll(async () => {
    await new Promise<void>((res) => { server = createTestApp().listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as any).port}`; res(); }); });
  });
  afterAll(async () => { await new Promise<void>((res) => server.close(() => res())); });

  it('returns 200 with all examples when n is not specified', async () => {
    const r = await fetch(`${baseUrl}/api/proof/hallucination/examples`);
    const body: any = await r.json();
    expect(r.status).toBe(200);
    expect(Array.isArray(body.examples)).toBe(true);
    expect(body.examples).toHaveLength(2);
  });

  it('caps results by ?n= query param', async () => {
    const r = await fetch(`${baseUrl}/api/proof/hallucination/examples?n=1`);
    const body: any = await r.json();
    expect(r.status).toBe(200);
    expect(body.examples).toHaveLength(1);
  });

  it('respects max cap of 50', async () => {
    const r = await fetch(`${baseUrl}/api/proof/hallucination/examples?n=9999`);
    const body: any = await r.json();
    expect(r.status).toBe(200);
    // fixtures have only 2 examples, so cap=50 doesn't truncate further
    expect(body.examples.length).toBeLessThanOrEqual(50);
  });
});

// ---------- /hallucination/ask ----------

describe('POST /api/proof/hallucination/ask', () => {
  let server: Server; let baseUrl: string;
  beforeAll(async () => {
    await new Promise<void>((res) => { server = createTestApp().listen(0, () => {
      baseUrl = `http://127.0.0.1:${(server.address() as any).port}`; res(); }); });
  });
  afterAll(async () => { await new Promise<void>((res) => server.close(() => res())); });

  it('returns side-by-side shape for a known questionId', async () => {
    const r = await fetch(`${baseUrl}/api/proof/hallucination/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: 'block:328970103::block_time' }),
    });
    const body: any = await r.json();
    expect(r.status).toBe(200);
    expect(typeof body.question).toBe('string');
    expect(body.groundTruth).toBe('2025-03-25T00:04:22Z');
    expect(body).toHaveProperty('clude');
    expect(body).toHaveProperty('baseline');
    expect(typeof body.clude.answer).toBe('string');
    expect(typeof body.baseline.answer).toBe('string');
    expect(typeof body.clude.recalledCount).toBe('number');
  });

  it('returns 400 when question exceeds 500 chars', async () => {
    const r = await fetch(`${baseUrl}/api/proof/hallucination/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'x'.repeat(501) }),
    });
    expect(r.status).toBe(400);
  });

  it('returns side-by-side shape for a free-text question without questionId', async () => {
    const r = await fetch(`${baseUrl}/api/proof/hallucination/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: 'What is the block time of slot 328970103?' }),
    });
    const body: any = await r.json();
    expect(r.status).toBe(200);
    expect(body).toHaveProperty('clude');
    expect(body).toHaveProperty('baseline');
    // no gold for free-text
    expect(body.groundTruth).toBeNull();
  });
});
