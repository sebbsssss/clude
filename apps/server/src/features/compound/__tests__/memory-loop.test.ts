import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CompoundAnalysis, Market, MarketResolution } from '../types';

vi.mock('../../../core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockStoreMemory = vi.fn();
const mockRecallMemories = vi.fn();
const mockCreateMemoryLink = vi.fn();

vi.mock('../../../core/memory', () => ({
  storeMemory: (...args: any[]) => mockStoreMemory(...args),
  recallMemories: (...args: any[]) => mockRecallMemories(...args),
  createMemoryLink: (...args: any[]) => mockCreateMemoryLink(...args),
}));

const mockDbQuery = vi.fn();

vi.mock('../../../core/database', () => ({
  getDb: () => ({
    from: (_table: string) => ({
      select: (cols: string) => ({
        contains: (_col: string, tags: string[]) => ({
          limit: (_n: number) => mockDbQuery(cols, tags),
        }),
      }),
    }),
  }),
}));

import { storePrediction, storeResolution, getAccuracyStats } from '../memory-loop';

function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    sourceId: 'test-123',
    source: 'polymarket',
    question: 'Will AI pass the Turing test by 2026?',
    currentOdds: 0.4,
    volume: 250000,
    liquidity: 80000,
    closeDate: new Date('2026-12-31'),
    category: 'tech',
    active: true,
    url: 'https://polymarket.com/test',
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<CompoundAnalysis> = {}): CompoundAnalysis {
  const market = makeMarket();
  return {
    market,
    estimatedProbability: 0.7,
    confidence: 0.8,
    reasoning: 'Strong evidence from recent developments.',
    edge: 0.3,
    isValue: true,
    evidence: ['Evidence A', 'Evidence B'],
    analyzedAt: new Date('2026-03-21T10:00:00Z'),
    ...overrides,
  };
}

describe('storePrediction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreMemory.mockResolvedValue(42);
  });

  it('stores prediction as episodic memory with correct tags', async () => {
    const analysis = makeAnalysis();
    const id = await storePrediction(analysis);

    expect(id).toBe(42);
    expect(mockStoreMemory).toHaveBeenCalledOnce();

    const call = mockStoreMemory.mock.calls[0][0];
    expect(call.type).toBe('episodic');
    expect(call.tags).toEqual(['compound', 'prediction', 'tech', 'polymarket']);
    expect(call.source).toBe('compound');
    expect(call.sourceId).toBe('polymarket:test-123');
  });

  it('includes market metadata for resolution matching', async () => {
    const analysis = makeAnalysis();
    await storePrediction(analysis);

    const call = mockStoreMemory.mock.calls[0][0];
    expect(call.metadata).toMatchObject({
      compound_type: 'prediction',
      source_platform: 'polymarket',
      source_id: 'test-123',
      market_odds: 0.4,
      estimated_probability: 0.7,
      confidence: 0.8,
      edge: 0.3,
      is_value: true,
      category: 'tech',
    });
  });

  it('calculates importance based on edge, confidence, and volume', async () => {
    // High edge + high confidence + high volume = high importance
    const analysis = makeAnalysis({
      edge: 0.25,
      confidence: 0.9,
      market: makeMarket({ volume: 2_000_000 }),
    });
    await storePrediction(analysis);

    const importance = mockStoreMemory.mock.calls[0][0].importance;
    expect(importance).toBeGreaterThan(0.5);
    expect(importance).toBeLessThanOrEqual(0.95);
  });

  it('generates meaningful summary', async () => {
    await storePrediction(makeAnalysis());

    const summary = mockStoreMemory.mock.calls[0][0].summary;
    expect(summary).toContain('70%');
    expect(summary).toContain('Will AI pass the Turing test');
    expect(summary).toContain('edge');
  });
});

describe('storeResolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStoreMemory.mockResolvedValue(99);
    mockCreateMemoryLink.mockResolvedValue(undefined);
  });

  it('matches resolution to prediction and computes Brier score', async () => {
    // Simulate finding the original prediction
    mockRecallMemories.mockResolvedValueOnce([{
      id: 42,
      memory_type: 'episodic',
      summary: 'Predicted 70% on test market',
      content: 'Prediction details...',
      tags: ['compound', 'prediction'],
      metadata: {
        compound_type: 'prediction',
        source_platform: 'polymarket',
        source_id: 'test-123',
        estimated_probability: 0.7,
        category: 'tech',
      },
      importance: 0.8,
      decay_factor: 0.93,
      created_at: '2026-03-01',
    }]);

    const resolution: MarketResolution = {
      sourceId: 'test-123',
      source: 'polymarket',
      question: 'Will AI pass the Turing test by 2026?',
      outcome: 1.0, // YES
      resolvedAt: new Date('2026-06-15'),
    };

    const result = await storeResolution(resolution);

    expect(result).not.toBeNull();
    expect(result!.outcome).toBe(1.0);
    expect(result!.correct).toBe(true); // 0.7 > 0.5, outcome = YES
    expect(result!.brierScore).toBeCloseTo(0.09, 2); // (0.7 - 1.0)^2 = 0.09

    // Check stored resolution memory
    const storeCall = mockStoreMemory.mock.calls[0][0];
    expect(storeCall.type).toBe('episodic');
    expect(storeCall.tags).toContain('resolution');
    expect(storeCall.tags).toContain('correct');
    expect(storeCall.metadata.brier_score).toBeCloseTo(0.09, 2);
    expect(storeCall.evidenceIds).toEqual([42]);
  });

  it('links outcome to prediction memory', async () => {
    mockRecallMemories.mockResolvedValueOnce([{
      id: 42,
      metadata: { compound_type: 'prediction', source_platform: 'polymarket', source_id: 'test-123', estimated_probability: 0.7, category: 'tech' },
      tags: ['compound'],
    }]);

    await storeResolution({
      sourceId: 'test-123',
      source: 'polymarket',
      question: 'Test?',
      outcome: 1.0,
      resolvedAt: new Date(),
    });

    expect(mockCreateMemoryLink).toHaveBeenCalledWith(99, 42, 'follows', 0.9);
  });

  it('tags incorrect predictions appropriately', async () => {
    mockRecallMemories.mockResolvedValueOnce([{
      id: 42,
      metadata: { compound_type: 'prediction', source_platform: 'manifold', source_id: 'mf-1', estimated_probability: 0.8, category: 'politics' },
      tags: ['compound'],
    }]);

    await storeResolution({
      sourceId: 'mf-1',
      source: 'manifold',
      question: 'Wrong prediction',
      outcome: 0.0, // NO, but Compound predicted 80% YES
      resolvedAt: new Date(),
    });

    const storeCall = mockStoreMemory.mock.calls[0][0];
    expect(storeCall.tags).toContain('incorrect');
    expect(storeCall.metadata.correct).toBe(false);
    // Wrong predictions get higher importance (to learn from)
    expect(storeCall.importance).toBe(0.8);
  });

  it('returns null when no matching prediction found', async () => {
    mockRecallMemories.mockResolvedValueOnce([]);

    const result = await storeResolution({
      sourceId: 'unknown',
      source: 'polymarket',
      question: 'Unknown market',
      outcome: 1.0,
      resolvedAt: new Date(),
    });

    expect(result).toBeNull();
    expect(mockStoreMemory).not.toHaveBeenCalled();
  });
});

describe('getAccuracyStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('computes accuracy from resolution memories', async () => {
    // getAccuracyStats uses direct DB queries (not recallMemories)
    // mockDbQuery differentiates by tags: resolution vs prediction
    mockDbQuery.mockImplementation((_cols: string, tags: string[]) => {
      if (tags.includes('resolution')) {
        return Promise.resolve({
          data: [
            { metadata: { correct: true, brier_score: 0.04, category: 'tech' } },
            { metadata: { correct: true, brier_score: 0.09, category: 'tech' } },
            { metadata: { correct: false, brier_score: 0.64, category: 'politics' } },
          ],
          error: null,
        });
      }
      // prediction query
      return Promise.resolve({
        data: [{}, {}, {}, {}], // 4 total predictions
        error: null,
      });
    });

    const stats = await getAccuracyStats();

    expect(stats.totalPredictions).toBe(4);
    expect(stats.totalResolved).toBe(3);
    expect(stats.correctCount).toBe(2);
    expect(stats.accuracy).toBeCloseTo(0.667, 2);
    expect(stats.avgBrierScore).toBeCloseTo(0.257, 2);
    expect(stats.byCategory.tech).toEqual({ count: 2, correct: 2, avgBrier: expect.closeTo(0.065, 2) });
    expect(stats.byCategory.politics).toEqual({ count: 1, correct: 0, avgBrier: 0.64 });
  });

  it('handles zero resolutions', async () => {
    mockDbQuery.mockResolvedValue({ data: [], error: null });

    const stats = await getAccuracyStats();
    expect(stats.accuracy).toBe(0);
    expect(stats.avgBrierScore).toBe(0);
    expect(stats.byCategory).toEqual({});
  });
});
