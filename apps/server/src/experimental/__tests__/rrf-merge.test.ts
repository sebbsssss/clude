import { describe, it, expect, vi } from 'vitest';
import { computeRRFScores, rrfMerge, computeWeightedRRFScores, type RankableMemory } from '../rrf-merge';

vi.mock('../../core/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function mem(id: number, score: number): RankableMemory {
  return { id, _score: score };
}

describe('rrf-merge', () => {
  describe('computeRRFScores', () => {
    it('returns empty map for empty lists', () => {
      const scores = computeRRFScores([]);
      expect(scores.size).toBe(0);
    });

    it('computes RRF scores for a single list', () => {
      const list = [mem(1, 0.9), mem(2, 0.8), mem(3, 0.7)];
      const scores = computeRRFScores([list], 60);
      // rank 0 → 1/(60+1) = 0.01639
      expect(scores.get(1)).toBeCloseTo(1 / 61, 5);
      // rank 1 → 1/(60+2) = 0.01613
      expect(scores.get(2)).toBeCloseTo(1 / 62, 5);
      // rank 2 → 1/(60+3) = 0.01587
      expect(scores.get(3)).toBeCloseTo(1 / 63, 5);
    });

    it('accumulates scores across multiple lists', () => {
      const list1 = [mem(1, 0.9), mem(2, 0.8)];
      const list2 = [mem(2, 0.95), mem(1, 0.7)];
      const scores = computeRRFScores([list1, list2], 60);
      // mem1: 1/61 + 1/62
      expect(scores.get(1)).toBeCloseTo(1 / 61 + 1 / 62, 5);
      // mem2: 1/62 + 1/61
      expect(scores.get(2)).toBeCloseTo(1 / 62 + 1 / 61, 5);
    });

    it('handles memories appearing in only one list', () => {
      const list1 = [mem(1, 0.9)];
      const list2 = [mem(2, 0.8)];
      const scores = computeRRFScores([list1, list2], 60);
      expect(scores.get(1)).toBeCloseTo(1 / 61, 5);
      expect(scores.get(2)).toBeCloseTo(1 / 61, 5);
    });
  });

  describe('rrfMerge', () => {
    it('returns empty array when all lists are empty', () => {
      const result = rrfMerge([], [], []);
      expect(result).toEqual([]);
    });

    it('returns single list results when only one list has data', () => {
      const vector = [mem(1, 0.9), mem(2, 0.8)];
      const result = rrfMerge(vector, [], [], 10);
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe(1);
    });

    it('merges and deduplicates across lists', () => {
      const vector = [mem(1, 0.9), mem(2, 0.8)];
      const keyword = [mem(2, 0.95), mem(3, 0.7)];
      const importance = [mem(1, 0.85), mem(3, 0.6)];
      const result = rrfMerge(vector, keyword, importance, 10);
      // All 3 unique memories should be present
      const ids = result.map(m => m.id);
      expect(ids).toContain(1);
      expect(ids).toContain(2);
      expect(ids).toContain(3);
    });

    it('respects limit parameter', () => {
      const vector = [mem(1, 0.9), mem(2, 0.8), mem(3, 0.7)];
      const keyword = [mem(4, 0.6), mem(5, 0.5)];
      const result = rrfMerge(vector, keyword, [], 2);
      expect(result).toHaveLength(2);
    });

    it('sorts by RRF score descending', () => {
      const vector = [mem(1, 0.9), mem(2, 0.8)];
      const keyword = [mem(1, 0.95), mem(3, 0.7)];
      const importance = [mem(1, 0.85)];
      const result = rrfMerge(vector, keyword, importance, 10);
      // mem1 appears in all 3 lists, should be ranked first
      expect(result[0].id).toBe(1);
    });

    it('preserves original memory properties', () => {
      const vector = [{ id: 1, _score: 0.9, summary: 'test', extra: 'data' }];
      const result = rrfMerge(vector, [], [], 10);
      expect(result[0]).toHaveProperty('summary', 'test');
      expect(result[0]).toHaveProperty('extra', 'data');
    });
  });

  describe('computeWeightedRRFScores', () => {
    it('applies weights to RRF scores', () => {
      const list1 = [mem(1, 0.9)];
      const list2 = [mem(1, 0.8)];
      const weighted = computeWeightedRRFScores([list1, list2], [2.0, 1.0], 60);
      const unweighted = computeRRFScores([list1, list2], 60);

      // Weighted score should be different from uniform
      expect(weighted.get(1)).not.toBeCloseTo(unweighted.get(1)!, 5);
      // list1 weight=2.0: 2.0/61, list2 weight=1.0: 1.0/61
      expect(weighted.get(1)).toBeCloseTo(2.0 / 61 + 1.0 / 61, 5);
    });

    it('defaults weight to 1.0 if not provided', () => {
      const list1 = [mem(1, 0.9)];
      const list2 = [mem(2, 0.8)];
      const scores = computeWeightedRRFScores([list1, list2], [2.0], 60);
      // list2 should use default weight 1.0
      expect(scores.get(2)).toBeCloseTo(1.0 / 61, 5);
    });
  });
});
