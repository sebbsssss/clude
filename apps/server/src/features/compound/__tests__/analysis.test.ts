import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Market, CompoundAnalysis } from '../types';

// Mock dependencies before importing
vi.mock('../../../core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../memory', () => ({
  recallMemories: vi.fn().mockResolvedValue([]),
}));

const mockBuildAndGenerate = vi.fn();
vi.mock('../../../services/response.service', () => ({
  buildAndGenerate: (...args: any[]) => mockBuildAndGenerate(...args),
}));

import { analyzeMarket, analyzeMarkets } from '../analysis';
import { recallMemories } from '../../../memory';

function makeMarket(overrides: Partial<Market> = {}): Market {
  return {
    sourceId: 'test-123',
    source: 'polymarket',
    question: 'Will test event happen by 2026?',
    currentOdds: 0.5,
    volume: 100000,
    liquidity: 50000,
    closeDate: new Date('2026-12-31'),
    category: 'tech',
    active: true,
    url: 'https://polymarket.com/test',
    ...overrides,
  };
}

describe('analyzeMarket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns analysis with LLM-generated probability and reasoning', async () => {
    mockBuildAndGenerate.mockResolvedValueOnce(JSON.stringify({
      estimatedProbability: 0.72,
      confidence: 0.8,
      reasoning: 'Strong evidence suggests this will happen based on current trends.',
      evidence: ['Recent announcements', 'Historical precedent'],
    }));

    const market = makeMarket({ currentOdds: 0.45 });
    const analysis = await analyzeMarket(market, { valueThreshold: 0.10 });

    expect(analysis.estimatedProbability).toBe(0.72);
    expect(analysis.confidence).toBe(0.8);
    expect(analysis.reasoning).toContain('Strong evidence');
    expect(analysis.evidence).toHaveLength(2);
    expect(analysis.edge).toBeCloseTo(0.27, 2);
    expect(analysis.isValue).toBe(true);
    expect(analysis.market).toBe(market);
    expect(analysis.analyzedAt).toBeInstanceOf(Date);
  });

  it('recalls memories related to the market question', async () => {
    mockBuildAndGenerate.mockResolvedValueOnce(JSON.stringify({
      estimatedProbability: 0.5,
      confidence: 0.3,
      reasoning: 'Insufficient data.',
      evidence: [],
    }));

    const market = makeMarket({ category: 'crypto' });
    await analyzeMarket(market, { valueThreshold: 0.10 });

    expect(recallMemories).toHaveBeenCalledWith(expect.objectContaining({
      query: market.question,
      tags: ['compound', 'crypto'],
      limit: 10,
      trackAccess: true,
    }));
  });

  it('clamps probability to [0, 1] range', async () => {
    mockBuildAndGenerate.mockResolvedValueOnce(JSON.stringify({
      estimatedProbability: 1.5,
      confidence: -0.2,
      reasoning: 'Out of range values.',
      evidence: [],
    }));

    const analysis = await analyzeMarket(makeMarket(), { valueThreshold: 0.10 });
    expect(analysis.estimatedProbability).toBe(1);
    expect(analysis.confidence).toBe(0);
  });

  it('handles LLM returning markdown-wrapped JSON', async () => {
    mockBuildAndGenerate.mockResolvedValueOnce('```json\n{"estimatedProbability": 0.65, "confidence": 0.7, "reasoning": "Wrapped in markdown.", "evidence": ["test"]}\n```');

    const analysis = await analyzeMarket(makeMarket(), { valueThreshold: 0.10 });
    expect(analysis.estimatedProbability).toBe(0.65);
    expect(analysis.reasoning).toBe('Wrapped in markdown.');
  });

  it('falls back to defaults on LLM parse failure', async () => {
    mockBuildAndGenerate.mockResolvedValueOnce('This is not JSON at all');

    const analysis = await analyzeMarket(makeMarket(), { valueThreshold: 0.10 });
    expect(analysis.estimatedProbability).toBe(0.5);
    expect(analysis.confidence).toBe(0.3);
    expect(analysis.reasoning).toContain('Analysis failed');
  });

  it('correctly detects value when edge exceeds threshold', async () => {
    mockBuildAndGenerate.mockResolvedValueOnce(JSON.stringify({
      estimatedProbability: 0.80,
      confidence: 0.9,
      reasoning: 'Very confident.',
      evidence: [],
    }));

    const market = makeMarket({ currentOdds: 0.50 });
    const analysis = await analyzeMarket(market, { valueThreshold: 0.20 });

    expect(analysis.edge).toBeCloseTo(0.30, 2);
    expect(analysis.isValue).toBe(true);
  });

  it('marks as not-value when edge is below threshold', async () => {
    mockBuildAndGenerate.mockResolvedValueOnce(JSON.stringify({
      estimatedProbability: 0.52,
      confidence: 0.6,
      reasoning: 'Close to market.',
      evidence: [],
    }));

    const market = makeMarket({ currentOdds: 0.50 });
    const analysis = await analyzeMarket(market, { valueThreshold: 0.10 });

    expect(analysis.edge).toBeCloseTo(0.02, 2);
    expect(analysis.isValue).toBe(false);
  });
});

describe('analyzeMarkets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('analyzes multiple markets sequentially', async () => {
    mockBuildAndGenerate
      .mockResolvedValueOnce(JSON.stringify({ estimatedProbability: 0.6, confidence: 0.7, reasoning: 'First.', evidence: [] }))
      .mockResolvedValueOnce(JSON.stringify({ estimatedProbability: 0.3, confidence: 0.5, reasoning: 'Second.', evidence: [] }));

    const markets = [makeMarket({ sourceId: '1' }), makeMarket({ sourceId: '2' })];
    const analyses = await analyzeMarkets(markets, { valueThreshold: 0.10 });

    expect(analyses).toHaveLength(2);
    expect(analyses[0].estimatedProbability).toBe(0.6);
    expect(analyses[1].estimatedProbability).toBe(0.3);
  });

  it('continues on individual market failure', async () => {
    mockBuildAndGenerate
      .mockRejectedValueOnce(new Error('LLM timeout'))
      .mockResolvedValueOnce(JSON.stringify({ estimatedProbability: 0.8, confidence: 0.9, reasoning: 'Works.', evidence: [] }));

    const markets = [makeMarket({ sourceId: 'fail' }), makeMarket({ sourceId: 'ok' })];
    const analyses = await analyzeMarkets(markets, { valueThreshold: 0.10 });

    // Both complete — first with default fallback (analyzeMarket catches errors), second with LLM result
    expect(analyses).toHaveLength(2);
    expect(analyses[1].estimatedProbability).toBe(0.8);
  });
});
