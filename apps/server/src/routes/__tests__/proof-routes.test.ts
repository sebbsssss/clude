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

import { proofRoutes } from '../proof.routes.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/proof', proofRoutes());
  return app;
}

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
