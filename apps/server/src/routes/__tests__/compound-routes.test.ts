import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';

vi.mock('../../core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockRecallMemories = vi.fn();
const mockHydrateMemories = vi.fn();

vi.mock('../../memory', () => ({
  recallMemories: (...args: any[]) => mockRecallMemories(...args),
  hydrateMemories: (...args: any[]) => mockHydrateMemories(...args),
}));

vi.mock('../../features/compound', () => ({
  getAccuracyStats: vi.fn().mockResolvedValue({
    totalPredictions: 0,
    totalResolved: 0,
    correctCount: 0,
    accuracy: 0,
    avgBrierScore: 0,
    byCategory: {},
  }),
  isCompoundRunning: vi.fn().mockReturnValue(false),
}));

vi.mock('../../features/compound/market-adapters', () => ({
  createAdapters: vi.fn().mockReturnValue([]),
  fetchAllMarkets: vi.fn().mockResolvedValue([]),
}));

import { compoundRoutes } from '../compound.routes.js';

// Simple HTTP test helper (no supertest needed)
function createTestServer() {
  const app = express();
  app.use('/api/compound', compoundRoutes());
  return app;
}

async function get(app: ReturnType<typeof express>, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address() as any;
      const url = `http://127.0.0.1:${addr.port}${path}`;
      http.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode!, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode!, body: data });
          }
        });
      }).on('error', (err) => {
        server.close();
        reject(err);
      });
    });
  });
}

// --- Fixtures ---

function makePredictionMemory(overrides: Record<string, any> = {}) {
  return {
    id: 42,
    hash_id: 'clude-abc123',
    memory_type: 'episodic',
    content: [
      'Prediction for: Will BTC hit 100k by 2026?',
      'Source: polymarket (pm-123)',
      'Market odds: 40.0%',
      'Compound estimate: 65.0%',
      'Edge: 25.0pp',
      'Confidence: 80%',
      'Value opportunity: YES',
      'Category: crypto',
      'Close date: 2026-12-31',
      '',
      'Reasoning: Strong institutional adoption trends.',
      '',
      '- Major ETF inflows continuing',
      '- Historical halving cycle data',
    ].join('\n'),
    summary: 'Predicted 65% on "Will BTC hit 100k by 2026?" (market: 40%, edge: 25pp)',
    tags: ['compound', 'prediction', 'crypto', 'polymarket'],
    concepts: [],
    emotional_valence: 0,
    importance: 0.75,
    access_count: 3,
    source: 'compound',
    source_id: 'polymarket:pm-123',
    related_user: null,
    related_wallet: null,
    metadata: {
      compound_type: 'prediction',
      source_platform: 'polymarket',
      source_id: 'pm-123',
      market_odds: 0.4,
      estimated_probability: 0.65,
      confidence: 0.8,
      edge: 0.25,
      is_value: true,
      category: 'crypto',
      close_date: '2026-12-31T00:00:00.000Z',
      market_url: 'https://polymarket.com/test',
    },
    created_at: '2026-03-15T10:00:00Z',
    last_accessed: '2026-03-20T10:00:00Z',
    decay_factor: 0.93,
    evidence_ids: [],
    solana_signature: null,
    compacted: false,
    compacted_into: null,
    encrypted: false,
    encryption_pubkey: null,
    ...overrides,
  };
}

function makeResolutionMemory(predictionMemoryId: number, correct: boolean) {
  return {
    id: 99,
    memory_type: 'episodic',
    summary: `${correct ? 'Correct' : 'Wrong'}: "Will BTC hit 100k?" resolved YES`,
    content: 'Resolution details...',
    tags: ['compound', 'resolution', correct ? 'correct' : 'incorrect', 'crypto'],
    metadata: {
      compound_type: 'resolution',
      source_platform: 'polymarket',
      source_id: 'pm-123',
      outcome: 1.0,
      estimated_probability: 0.65,
      brier_score: 0.1225,
      correct,
      resolved_at: '2026-06-15T00:00:00.000Z',
      prediction_memory_id: predictionMemoryId,
    },
    importance: 0.6,
    created_at: '2026-06-15T10:00:00Z',
    decay_factor: 0.93,
  };
}

describe('GET /api/compound/markets/:id', () => {
  let app: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestServer();
  });

  it('returns 400 for non-numeric ID', async () => {
    const res = await get(app, '/api/compound/markets/abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid market ID/);
  });

  it('returns 404 when memory not found', async () => {
    mockHydrateMemories.mockResolvedValueOnce([]);

    const res = await get(app, '/api/compound/markets/999');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/);
  });

  it('returns 404 when memory is not a prediction', async () => {
    mockHydrateMemories.mockResolvedValueOnce([{
      id: 1,
      metadata: { compound_type: 'resolution' },
      content: '',
      tags: [],
    }]);

    const res = await get(app, '/api/compound/markets/1');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not a Compound prediction/);
  });

  it('returns full market detail with reasoning and evidence', async () => {
    const prediction = makePredictionMemory();
    mockHydrateMemories.mockResolvedValueOnce([prediction]);
    mockRecallMemories.mockResolvedValueOnce([]);

    const res = await get(app, '/api/compound/markets/42');
    expect(res.status).toBe(200);

    expect(res.body.memoryId).toBe(42);
    expect(res.body.source).toBe('polymarket');
    expect(res.body.sourceId).toBe('pm-123');
    expect(res.body.marketOdds).toBe(0.4);
    expect(res.body.estimatedProbability).toBe(0.65);
    expect(res.body.confidence).toBe(0.8);
    expect(res.body.edge).toBe(0.25);
    expect(res.body.isValue).toBe(true);
    expect(res.body.category).toBe('crypto');
    expect(res.body.reasoning).toBe('Strong institutional adoption trends.');
    expect(res.body.evidence).toEqual(['Major ETF inflows continuing', 'Historical halving cycle data']);
    expect(res.body.resolution).toBeNull();
  });

  it('includes resolution data when market is resolved', async () => {
    const prediction = makePredictionMemory();
    mockHydrateMemories.mockResolvedValueOnce([prediction]);
    mockRecallMemories.mockResolvedValueOnce([makeResolutionMemory(42, true)]);

    const res = await get(app, '/api/compound/markets/42');
    expect(res.status).toBe(200);

    expect(res.body.resolution).toEqual({
      outcome: 1.0,
      resolvedAt: '2026-06-15T00:00:00.000Z',
      brierScore: 0.1225,
      correct: true,
      resolutionMemoryId: 99,
    });
  });
});

describe('GET /api/compound/predictions', () => {
  let app: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestServer();
  });

  it('returns paginated predictions', async () => {
    const pred1 = makePredictionMemory({ id: 42 });
    const pred2 = makePredictionMemory({ id: 43, created_at: '2026-03-16T10:00:00Z' });

    mockRecallMemories.mockResolvedValueOnce([pred1, pred2]);
    mockRecallMemories.mockResolvedValueOnce([]);

    const res = await get(app, '/api/compound/predictions?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.predictions).toHaveLength(2);
    expect(res.body.total).toBe(2);
    expect(res.body.limit).toBe(10);
    expect(res.body.offset).toBe(0);
  });

  it('applies offset pagination', async () => {
    const pred1 = makePredictionMemory({ id: 42 });
    const pred2 = makePredictionMemory({ id: 43 });

    mockRecallMemories.mockResolvedValueOnce([pred1, pred2]);
    mockRecallMemories.mockResolvedValueOnce([]);

    const res = await get(app, '/api/compound/predictions?limit=1&offset=1');
    expect(res.status).toBe(200);
    expect(res.body.predictions).toHaveLength(1);
    expect(res.body.predictions[0].memoryId).toBe(43);
    expect(res.body.total).toBe(2);
  });

  it('filters by resolved=true', async () => {
    const pred1 = makePredictionMemory({ id: 42 });
    const pred2 = makePredictionMemory({ id: 43 });

    mockRecallMemories.mockResolvedValueOnce([pred1, pred2]);
    mockRecallMemories.mockResolvedValueOnce([makeResolutionMemory(42, true)]);

    const res = await get(app, '/api/compound/predictions?resolved=true');
    expect(res.status).toBe(200);
    expect(res.body.predictions).toHaveLength(1);
    expect(res.body.predictions[0].memoryId).toBe(42);
    expect(res.body.predictions[0].resolution).not.toBeNull();
  });

  it('filters by resolved=false', async () => {
    const pred1 = makePredictionMemory({ id: 42 });
    const pred2 = makePredictionMemory({ id: 43 });

    mockRecallMemories.mockResolvedValueOnce([pred1, pred2]);
    mockRecallMemories.mockResolvedValueOnce([makeResolutionMemory(42, true)]);

    const res = await get(app, '/api/compound/predictions?resolved=false');
    expect(res.status).toBe(200);
    expect(res.body.predictions).toHaveLength(1);
    expect(res.body.predictions[0].memoryId).toBe(43);
  });

  it('returns empty results gracefully', async () => {
    mockRecallMemories.mockResolvedValueOnce([]);
    mockRecallMemories.mockResolvedValueOnce([]);

    const res = await get(app, '/api/compound/predictions');
    expect(res.status).toBe(200);
    expect(res.body.predictions).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});

describe('GET /api/compound/stats/timeline', () => {
  let app: ReturnType<typeof createTestServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestServer();
  });

  it('returns timeline with accuracy by week', async () => {
    mockRecallMemories.mockResolvedValueOnce([
      {
        id: 99,
        metadata: { correct: true, brier_score: 0.04, resolved_at: '2026-03-10T00:00:00Z' },
        created_at: '2026-03-10T00:00:00Z',
        tags: ['compound', 'resolution'],
      },
      {
        id: 100,
        metadata: { correct: false, brier_score: 0.64, resolved_at: '2026-03-10T00:00:00Z' },
        created_at: '2026-03-10T00:00:00Z',
        tags: ['compound', 'resolution'],
      },
    ]);
    mockRecallMemories.mockResolvedValueOnce([
      { id: 42, created_at: '2026-03-09T00:00:00Z', tags: ['compound', 'prediction'] },
      { id: 43, created_at: '2026-03-10T00:00:00Z', tags: ['compound', 'prediction'] },
    ]);

    const res = await get(app, '/api/compound/stats/timeline?interval=week');
    expect(res.status).toBe(200);
    expect(res.body.timeline).toBeDefined();
    expect(res.body.interval).toBe('week');
    expect(res.body.totalResolved).toBe(2);

    const bucket = res.body.timeline.find((t: any) => t.resolved > 0);
    expect(bucket).toBeDefined();
    expect(bucket.correct).toBe(1);
    expect(bucket.accuracy).toBe(0.5);
    expect(bucket.cumulativeAccuracy).toBeDefined();
  });

  it('returns 400 for invalid from date', async () => {
    const res = await get(app, '/api/compound/stats/timeline?from=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid.*from/);
  });

  it('returns 400 for invalid to date', async () => {
    const res = await get(app, '/api/compound/stats/timeline?to=garbage');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid.*to/);
  });

  it('filters by date range', async () => {
    mockRecallMemories.mockResolvedValueOnce([
      {
        id: 99,
        metadata: { correct: true, brier_score: 0.04, resolved_at: '2026-03-10T00:00:00Z' },
        created_at: '2026-03-10T00:00:00Z',
        tags: ['compound', 'resolution'],
      },
      {
        id: 100,
        metadata: { correct: false, brier_score: 0.64, resolved_at: '2026-01-15T00:00:00Z' },
        created_at: '2026-01-15T00:00:00Z',
        tags: ['compound', 'resolution'],
      },
    ]);
    mockRecallMemories.mockResolvedValueOnce([]);

    const res = await get(app, '/api/compound/stats/timeline?from=2026-03-01&to=2026-03-31');
    expect(res.status).toBe(200);
    expect(res.body.totalResolved).toBe(1);
  });

  it('supports day interval', async () => {
    mockRecallMemories.mockResolvedValueOnce([]);
    mockRecallMemories.mockResolvedValueOnce([
      { id: 42, created_at: '2026-03-15T10:00:00Z', tags: ['compound', 'prediction'] },
    ]);

    const res = await get(app, '/api/compound/stats/timeline?interval=day');
    expect(res.status).toBe(200);
    expect(res.body.interval).toBe('day');
    if (res.body.timeline.length > 0) {
      expect(res.body.timeline[0].period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('supports month interval', async () => {
    mockRecallMemories.mockResolvedValueOnce([]);
    mockRecallMemories.mockResolvedValueOnce([
      { id: 42, created_at: '2026-03-15T10:00:00Z', tags: ['compound', 'prediction'] },
    ]);

    const res = await get(app, '/api/compound/stats/timeline?interval=month');
    expect(res.status).toBe(200);
    expect(res.body.interval).toBe('month');
    if (res.body.timeline.length > 0) {
      expect(res.body.timeline[0].period).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('returns empty timeline gracefully', async () => {
    mockRecallMemories.mockResolvedValueOnce([]);
    mockRecallMemories.mockResolvedValueOnce([]);

    const res = await get(app, '/api/compound/stats/timeline');
    expect(res.status).toBe(200);
    expect(res.body.timeline).toEqual([]);
    expect(res.body.totalPredictions).toBe(0);
    expect(res.body.totalResolved).toBe(0);
  });
});
