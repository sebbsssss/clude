import { describe, it, expect, vi } from 'vitest';
import { evaluateConfidence, filterLowConfidenceMemories, type ScoredMemory } from '../confidence-gate';

vi.mock('../../core/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeMemory(id: number, score: number, type: string = 'episodic'): ScoredMemory {
  return { id, _score: score, memory_type: type };
}

describe('confidence-gate', () => {
  describe('evaluateConfidence', () => {
    it('returns zero score for empty memories', () => {
      const result = evaluateConfidence([]);
      expect(result.score).toBe(0);
      expect(result.sufficient).toBe(false);
      expect(result.hedgingInstruction).toBeDefined();
      expect(result.hedgingInstruction).toContain('no strong matches');
    });

    it('returns high confidence for many diverse high-scoring memories', () => {
      const memories = [
        makeMemory(1, 1.5, 'episodic'),
        makeMemory(2, 1.4, 'semantic'),
        makeMemory(3, 1.3, 'procedural'),
        makeMemory(4, 1.2, 'self_model'),
        makeMemory(5, 1.1, 'episodic'),
      ];
      const result = evaluateConfidence(memories);
      expect(result.score).toBeGreaterThan(0.4);
      expect(result.sufficient).toBe(true);
      expect(result.hedgingInstruction).toBeUndefined();
    });

    it('returns low confidence for a single low-scoring memory', () => {
      const memories = [makeMemory(1, 0.1, 'episodic')];
      const result = evaluateConfidence(memories);
      expect(result.score).toBeLessThan(0.4);
      expect(result.sufficient).toBe(false);
      expect(result.hedgingInstruction).toBeDefined();
    });

    it('respects custom threshold', () => {
      const memories = [
        makeMemory(1, 0.8, 'episodic'),
        makeMemory(2, 0.7, 'semantic'),
        makeMemory(3, 0.6, 'procedural'),
      ];
      // With high threshold
      const highThreshold = evaluateConfidence(memories, { threshold: 0.9 });
      expect(highThreshold.sufficient).toBe(false);

      // With low threshold
      const lowThreshold = evaluateConfidence(memories, { threshold: 0.1 });
      expect(lowThreshold.sufficient).toBe(true);
    });

    it('computes coverage component correctly', () => {
      // 1 memory vs minExpected=3 → coverage = 1/3
      const single = evaluateConfidence([makeMemory(1, 1.0)]);
      expect(single.components.coverage).toBeCloseTo(1 / 3, 2);

      // 5 memories vs minExpected=3 → coverage = min(5/3, 1) = 1.0
      const many = evaluateConfidence([
        makeMemory(1, 1.0),
        makeMemory(2, 0.9),
        makeMemory(3, 0.8),
        makeMemory(4, 0.7),
        makeMemory(5, 0.6),
      ]);
      expect(many.components.coverage).toBe(1.0);
    });

    it('computes diversity component correctly', () => {
      // All same type → diversity = 1/4
      const sametype = evaluateConfidence([
        makeMemory(1, 1.0, 'episodic'),
        makeMemory(2, 0.9, 'episodic'),
        makeMemory(3, 0.8, 'episodic'),
      ]);
      expect(sametype.components.diversity).toBe(0.25);

      // 4 types → diversity = 1.0
      const diverse = evaluateConfidence([
        makeMemory(1, 1.0, 'episodic'),
        makeMemory(2, 0.9, 'semantic'),
        makeMemory(3, 0.8, 'procedural'),
        makeMemory(4, 0.7, 'self_model'),
      ]);
      expect(diverse.components.diversity).toBe(1.0);
    });

    it('uses noEvidence hedging for empty memories', () => {
      const result = evaluateConfidence([]);
      expect(result.score).toBe(0);
      expect(result.hedgingInstruction).toContain('no strong matches');
    });

    it('uses weakEvidence hedging for borderline scores', () => {
      // Score between 0.15 and threshold (0.4)
      const memories = [
        makeMemory(1, 0.5, 'episodic'),
        makeMemory(2, 0.4, 'semantic'),
      ];
      const result = evaluateConfidence(memories);
      if (!result.sufficient && result.score >= 0.15) {
        expect(result.hedgingInstruction).toContain('weak matches');
      }
    });
  });

  describe('filterLowConfidenceMemories', () => {
    it('filters out memories below minScore', () => {
      const memories = [
        makeMemory(1, 0.5),
        makeMemory(2, 0.1),
        makeMemory(3, 0.3),
        makeMemory(4, 0.05),
      ];
      const result = filterLowConfidenceMemories(memories, 0.15);
      expect(result).toHaveLength(2);
      expect(result.map(m => m.id)).toEqual([1, 3]);
    });

    it('returns all memories when all above threshold', () => {
      const memories = [makeMemory(1, 0.5), makeMemory(2, 0.3)];
      const result = filterLowConfidenceMemories(memories, 0.1);
      expect(result).toHaveLength(2);
    });

    it('returns empty array when all below threshold', () => {
      const memories = [makeMemory(1, 0.01), makeMemory(2, 0.02)];
      const result = filterLowConfidenceMemories(memories, 0.5);
      expect(result).toHaveLength(0);
    });

    it('uses default minScore of 0.15', () => {
      const memories = [makeMemory(1, 0.1), makeMemory(2, 0.2)];
      const result = filterLowConfidenceMemories(memories);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(2);
    });
  });
});
