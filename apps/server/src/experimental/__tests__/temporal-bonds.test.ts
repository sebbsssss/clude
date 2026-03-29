import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TEMPORAL_BOND_TYPE_WEIGHTS, detectTemporalConstraints, matchMemoriesTemporal } from '../temporal-bonds';

// Mock database
vi.mock('../../core/database', () => ({
  getDb: vi.fn(() => ({
    rpc: vi.fn(),
  })),
}));

// Mock logger
vi.mock('../../core/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('temporal-bonds', () => {
  describe('TEMPORAL_BOND_TYPE_WEIGHTS', () => {
    it('includes all standard bond types', () => {
      expect(TEMPORAL_BOND_TYPE_WEIGHTS.causes).toBe(1.0);
      expect(TEMPORAL_BOND_TYPE_WEIGHTS.supports).toBe(0.9);
      expect(TEMPORAL_BOND_TYPE_WEIGHTS.resolves).toBe(0.8);
      expect(TEMPORAL_BOND_TYPE_WEIGHTS.elaborates).toBe(0.7);
      expect(TEMPORAL_BOND_TYPE_WEIGHTS.contradicts).toBe(0.6);
      expect(TEMPORAL_BOND_TYPE_WEIGHTS.relates).toBe(0.4);
      expect(TEMPORAL_BOND_TYPE_WEIGHTS.follows).toBe(0.3);
    });

    it('includes temporal bond types', () => {
      expect(TEMPORAL_BOND_TYPE_WEIGHTS.concurrent_with).toBe(0.8);
      expect(TEMPORAL_BOND_TYPE_WEIGHTS.happens_before).toBe(0.7);
      expect(TEMPORAL_BOND_TYPE_WEIGHTS.happens_after).toBe(0.7);
    });

    it('has 10 total bond types', () => {
      expect(Object.keys(TEMPORAL_BOND_TYPE_WEIGHTS)).toHaveLength(10);
    });
  });

  describe('detectTemporalConstraints', () => {
    it('returns null for non-temporal queries', () => {
      expect(detectTemporalConstraints('What is the meaning of life?')).toBeNull();
      expect(detectTemporalConstraints('Tell me about tokens')).toBeNull();
    });

    it('detects "yesterday"', () => {
      const result = detectTemporalConstraints('What happened yesterday?');
      expect(result).not.toBeNull();
      expect(result!.startDate).toBeDefined();
      expect(result!.endDate).toBeDefined();
      // startDate should be before endDate
      expect(new Date(result!.startDate).getTime()).toBeLessThan(new Date(result!.endDate).getTime());
    });

    it('detects "last week"', () => {
      const result = detectTemporalConstraints('What happened last week?');
      expect(result).not.toBeNull();
      const start = new Date(result!.startDate);
      const end = new Date(result!.endDate);
      // Should span ~7 days
      const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(6);
      expect(diffDays).toBeLessThanOrEqual(8);
    });

    it('detects "N days ago"', () => {
      const result = detectTemporalConstraints('What happened 3 days ago?');
      expect(result).not.toBeNull();
      expect(new Date(result!.startDate).getTime()).toBeLessThan(new Date(result!.endDate).getTime());
    });

    it('detects "N weeks ago"', () => {
      const result = detectTemporalConstraints('What happened 2 weeks ago?');
      expect(result).not.toBeNull();
    });

    it('detects "N months ago"', () => {
      const result = detectTemporalConstraints('What happened 1 month ago?');
      expect(result).not.toBeNull();
    });

    it('detects "in [Month] [Year]"', () => {
      const result = detectTemporalConstraints('What happened in March 2026?');
      expect(result).not.toBeNull();
      const start = new Date(result!.startDate);
      const end = new Date(result!.endDate);
      expect(start.getMonth()).toBe(2); // March = index 2
      expect(start.getFullYear()).toBe(2026);
      expect(end.getMonth()).toBe(2);
    });

    it('detects "[Month] [Day]"', () => {
      const result = detectTemporalConstraints('What happened on March 15th?');
      expect(result).not.toBeNull();
      const start = new Date(result!.startDate);
      expect(start.getMonth()).toBe(2);
      expect(start.getDate()).toBe(15);
    });

    it('detects "[Month] [Day], [Year]"', () => {
      const result = detectTemporalConstraints('Tell me about January 5, 2026');
      expect(result).not.toBeNull();
      const start = new Date(result!.startDate);
      expect(start.getMonth()).toBe(0);
      expect(start.getDate()).toBe(5);
      expect(start.getFullYear()).toBe(2026);
    });

    it('detects "before [Month]"', () => {
      const result = detectTemporalConstraints('What happened before February?');
      expect(result).not.toBeNull();
      expect(result!.startDate).toBe('1970-01-01T00:00:00Z');
    });

    it('detects "after [Month]"', () => {
      const result = detectTemporalConstraints('What happened after March 2026?');
      expect(result).not.toBeNull();
      expect(new Date(result!.startDate).getTime()).toBeGreaterThan(0);
    });
  });

  describe('matchMemoriesTemporal', () => {
    it('returns empty array on RPC error', async () => {
      const { getDb } = await import('../../core/database');
      (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
        rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'RPC not found' } }),
      });

      const result = await matchMemoriesTemporal({
        queryEmbedding: [0.1, 0.2],
        matchThreshold: 0.3,
        matchCount: 10,
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-12-31T23:59:59Z',
      });
      expect(result).toEqual([]);
    });

    it('returns results on successful RPC call', async () => {
      const mockData = [{ id: 1, similarity: 0.85 }, { id: 2, similarity: 0.72 }];
      const { getDb } = await import('../../core/database');
      (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
        rpc: vi.fn().mockResolvedValue({ data: mockData, error: null }),
      });

      const result = await matchMemoriesTemporal({
        queryEmbedding: [0.1, 0.2],
        matchThreshold: 0.3,
        matchCount: 10,
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-12-31T23:59:59Z',
      });
      expect(result).toEqual(mockData);
    });

    it('returns empty array on exception', async () => {
      const { getDb } = await import('../../core/database');
      (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
        rpc: vi.fn().mockRejectedValue(new Error('Network error')),
      });

      const result = await matchMemoriesTemporal({
        queryEmbedding: [0.1, 0.2],
        matchThreshold: 0.3,
        matchCount: 10,
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-12-31T23:59:59Z',
      });
      expect(result).toEqual([]);
    });
  });
});
