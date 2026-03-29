import { describe, it, expect, vi } from 'vitest';
import { ensembleAnswer, parseSpecialistResponse } from '../ensemble-answer';

vi.mock('../../core/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ensemble-answer', () => {
  describe('parseSpecialistResponse', () => {
    it('parses confidence and answer', () => {
      const result = parseSpecialistResponse('CONFIDENCE: 0.85\nANSWER: The capital is Paris.');
      expect(result.confidence).toBe(0.85);
      expect(result.answer).toBe('The capital is Paris.');
      expect(result.insufficient).toBe(false);
    });

    it('detects INSUFFICIENT', () => {
      const result = parseSpecialistResponse('CONFIDENCE: 0.0\nANSWER: INSUFFICIENT');
      expect(result.insufficient).toBe(true);
      expect(result.confidence).toBe(0);
      expect(result.answer).toBe('');
    });

    it('detects INSUFFICIENT in raw text', () => {
      const result = parseSpecialistResponse('INSUFFICIENT');
      expect(result.insufficient).toBe(true);
    });

    it('defaults confidence to 0.5 when missing', () => {
      const result = parseSpecialistResponse('ANSWER: Some answer without confidence');
      expect(result.confidence).toBe(0.5);
      expect(result.answer).toBe('Some answer without confidence');
    });

    it('clamps confidence to [0, 1]', () => {
      expect(parseSpecialistResponse('CONFIDENCE: 1.5\nANSWER: test').confidence).toBe(1);
      expect(parseSpecialistResponse('CONFIDENCE: -0.2\nANSWER: test').confidence).toBe(0);
    });

    it('handles multiline answers', () => {
      const result = parseSpecialistResponse('CONFIDENCE: 0.9\nANSWER: Line one.\nLine two.');
      expect(result.answer).toBe('Line one.\nLine two.');
    });
  });

  describe('ensembleAnswer', () => {
    it('returns aggregated answer when 2+ specialists agree', async () => {
      const llmCallFn = vi.fn()
        // Fact specialist
        .mockResolvedValueOnce('CONFIDENCE: 0.9\nANSWER: Paris is the capital.')
        // Temporal specialist
        .mockResolvedValueOnce('CONFIDENCE: 0.8\nANSWER: Paris is the capital of France.')
        // Context synthesizer
        .mockResolvedValueOnce('CONFIDENCE: 0.7\nANSWER: The capital is Paris.')
        // Aggregator
        .mockResolvedValueOnce('Paris is the capital of France.');

      const result = await ensembleAnswer('some context', 'What is the capital?', llmCallFn);

      expect(result.answer).toBe('Paris is the capital of France.');
      expect(result.specialists).toHaveLength(3);
      expect(result.llmCalls).toBe(4); // 3 specialists + 1 aggregator
      expect(result.strategy).toBe('majority');
      expect(result.estimatedCostUsd).toBeGreaterThan(0);
    });

    it('uses single sufficient specialist when only one answers', async () => {
      const llmCallFn = vi.fn()
        .mockResolvedValueOnce('CONFIDENCE: 0.9\nANSWER: The event was in 2023.')
        .mockResolvedValueOnce('INSUFFICIENT')
        .mockResolvedValueOnce('INSUFFICIENT');

      const result = await ensembleAnswer('context', 'When was the event?', llmCallFn);

      expect(result.answer).toBe('The event was in 2023.');
      expect(result.strategy).toBe('single_sufficient');
      expect(result.llmCalls).toBe(3); // no aggregator needed
    });

    it('returns no-info when all specialists say INSUFFICIENT', async () => {
      const llmCallFn = vi.fn()
        .mockResolvedValueOnce('INSUFFICIENT')
        .mockResolvedValueOnce('CONFIDENCE: 0.0\nANSWER: INSUFFICIENT')
        .mockResolvedValueOnce('INSUFFICIENT');

      const result = await ensembleAnswer('empty context', 'Unknown question?', llmCallFn);

      expect(result.answer).toContain("don't have information");
      expect(result.confidence).toBe(0);
      expect(result.strategy).toBe('single_sufficient');
    });

    it('handles specialist failures gracefully', async () => {
      const llmCallFn = vi.fn()
        .mockRejectedValueOnce(new Error('API error'))
        .mockResolvedValueOnce('CONFIDENCE: 0.8\nANSWER: Good answer.')
        .mockResolvedValueOnce('INSUFFICIENT');

      const result = await ensembleAnswer('context', 'question', llmCallFn);

      expect(result.answer).toBe('Good answer.');
      expect(result.strategy).toBe('single_sufficient');
      expect(result.specialists[0].insufficient).toBe(true); // failed one
    });

    it('falls back to highest confidence when aggregator fails', async () => {
      const llmCallFn = vi.fn()
        .mockResolvedValueOnce('CONFIDENCE: 0.9\nANSWER: Best answer.')
        .mockResolvedValueOnce('CONFIDENCE: 0.6\nANSWER: Okay answer.')
        .mockResolvedValueOnce('INSUFFICIENT')
        // Aggregator fails
        .mockRejectedValueOnce(new Error('Aggregator failure'));

      const result = await ensembleAnswer('context', 'question', llmCallFn);

      expect(result.answer).toBe('Best answer.');
      expect(result.strategy).toBe('highest_confidence');
      expect(result.confidence).toBe(0.9);
    });

    it('passes date context to specialists', async () => {
      const llmCallFn = vi.fn()
        .mockResolvedValueOnce('CONFIDENCE: 0.9\nANSWER: Answer 1.')
        .mockResolvedValueOnce('CONFIDENCE: 0.8\nANSWER: Answer 2.')
        .mockResolvedValueOnce('INSUFFICIENT')
        .mockResolvedValueOnce('Final answer.');

      await ensembleAnswer('context', 'question', llmCallFn, 'temporal', '2025-01-15');

      // Check that the system prompts contain the date
      const firstCall = llmCallFn.mock.calls[0];
      expect(firstCall[0]).toContain('2025-01-15');
    });

    it('tracks cost across all calls', async () => {
      const llmCallFn = vi.fn()
        .mockResolvedValueOnce('CONFIDENCE: 0.9\nANSWER: A')
        .mockResolvedValueOnce('CONFIDENCE: 0.8\nANSWER: B')
        .mockResolvedValueOnce('CONFIDENCE: 0.7\nANSWER: C')
        .mockResolvedValueOnce('Final');

      const result = await ensembleAnswer('ctx', 'q', llmCallFn);

      expect(result.estimatedCostUsd).toBeGreaterThan(0);
      expect(result.llmCalls).toBe(4);
    });
  });
});
