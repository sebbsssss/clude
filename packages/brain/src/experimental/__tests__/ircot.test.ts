import { describe, it, expect, vi } from 'vitest';
import { runIRCoT, isMultiHopQuery } from '../ircot';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('ircot', () => {
  describe('isMultiHopQuery', () => {
    it('detects "what did X say about Y" patterns', () => {
      expect(isMultiHopQuery('What did Alice say about the project?')).toBe(true);
    });

    it('detects "how does X relate to Y" patterns', () => {
      expect(isMultiHopQuery('How does the memory system relate to embeddings?')).toBe(true);
    });

    it('detects "compare X with Y" patterns', () => {
      expect(isMultiHopQuery('Compare vector search with keyword search')).toBe(true);
      expect(isMultiHopQuery('Compare Solana and Ethereum')).toBe(true);
    });

    it('detects "after X, what" patterns', () => {
      expect(isMultiHopQuery('After the migration, what happened?')).toBe(true);
    });

    it('detects "before X what" patterns', () => {
      expect(isMultiHopQuery('Before the launch what did they decide?')).toBe(true);
    });

    it('detects "since X what" patterns', () => {
      expect(isMultiHopQuery('Since the upgrade what has changed?')).toBe(true);
    });

    it('detects "how many/often" patterns', () => {
      expect(isMultiHopQuery('How many times did the bot crash?')).toBe(true);
      expect(isMultiHopQuery('How often did they deploy?')).toBe(true);
    });

    it('detects multiple capitalized words (named entities)', () => {
      expect(isMultiHopQuery('Tell me about Alice and Bob')).toBe(true);
    });

    it('detects "and" with question mark', () => {
      expect(isMultiHopQuery('What is the status and timeline?')).toBe(true);
    });

    it('returns false for simple single-hop queries', () => {
      expect(isMultiHopQuery('what is my wallet address')).toBe(false);
      expect(isMultiHopQuery('tell me about the bot')).toBe(false);
    });
  });

  describe('runIRCoT', () => {
    it('returns initial memories if LLM outputs SUFFICIENT', async () => {
      const initial = [{ id: 1, summary: 'Memory 1', _score: 0.9 }];
      const recallFn = vi.fn();
      const llmCallFn = vi.fn().mockResolvedValue('THINKING: I have enough info.\nSUFFICIENT');

      const result = await runIRCoT('test query', initial, recallFn, llmCallFn);
      expect(result.memories).toEqual(initial);
      expect(result.earlyStop).toBe(true);
      expect(result.iterations).toBe(1);
      expect(recallFn).not.toHaveBeenCalled();
    });

    it('executes sub-queries from LLM reasoning', async () => {
      const initial = [{ id: 1, summary: 'Memory 1', _score: 0.9 }];
      const recallFn = vi.fn().mockResolvedValue([{ id: 2, summary: 'Memory 2', _score: 0.8 }]);
      const llmCallFn = vi.fn()
        .mockResolvedValueOnce('THINKING: Need more info\nQUERY: search for tokens')
        .mockResolvedValueOnce('THINKING: Got it now\nSUFFICIENT');

      const result = await runIRCoT('test query', initial, recallFn, llmCallFn);
      expect(result.memories).toHaveLength(2);
      expect(result.memories[1].id).toBe(2);
      expect(recallFn).toHaveBeenCalled();
    });

    it('stops when no new memories are found', async () => {
      const initial = [{ id: 1, summary: 'Memory 1', _score: 0.9 }];
      const recallFn = vi.fn().mockResolvedValue([{ id: 1, summary: 'Memory 1', _score: 0.9 }]); // same
      const llmCallFn = vi.fn().mockResolvedValue('THINKING: Need more\nQUERY: search for more information');

      const result = await runIRCoT('test query', initial, recallFn, llmCallFn);
      expect(result.earlyStop).toBe(true);
    });

    it('respects maxSteps limit', async () => {
      const initial = [{ id: 1, summary: 'Memory 1', _score: 0.9 }];
      let callCount = 0;
      const recallFn = vi.fn().mockImplementation(() => {
        callCount++;
        // Return a unique new memory each call
        return Promise.resolve([{ id: 100 + callCount, summary: `New ${callCount}`, _score: 0.5 }]);
      });
      const llmCallFn = vi.fn().mockResolvedValue('THINKING: Need more\nQUERY: search for more details');

      const result = await runIRCoT('test query', initial, recallFn, llmCallFn, { maxSteps: 2 });
      expect(result.iterations).toBe(2);
      expect(result.earlyStop).toBe(false);
    });

    it('handles recall failures gracefully', async () => {
      const initial = [{ id: 1, summary: 'Memory 1', _score: 0.9 }];
      const recallFn = vi.fn().mockRejectedValue(new Error('DB error'));
      const llmCallFn = vi.fn()
        .mockResolvedValueOnce('THINKING: Need more\nQUERY: search for details')
        .mockResolvedValueOnce('THINKING: No new context\nSUFFICIENT');

      // Should not throw
      const result = await runIRCoT('test query', initial, recallFn, llmCallFn);
      expect(result.memories).toHaveLength(1); // only initial
    });

    it('deduplicates memories across iterations', async () => {
      const initial = [{ id: 1, summary: 'Memory 1', _score: 0.9 }];
      const recallFn = vi.fn().mockResolvedValue([
        { id: 1, summary: 'Memory 1', _score: 0.9 }, // duplicate
        { id: 2, summary: 'Memory 2', _score: 0.8 },
      ]);
      const llmCallFn = vi.fn()
        .mockResolvedValueOnce('THINKING: Need more\nQUERY: search for details')
        .mockResolvedValueOnce('SUFFICIENT');

      const result = await runIRCoT('test query', initial, recallFn, llmCallFn);
      expect(result.memories).toHaveLength(2);
    });

    it('limits to 3 sub-queries per iteration', async () => {
      const initial = [{ id: 1, summary: 'Memory 1', _score: 0.9 }];
      let callCount = 0;
      const recallFn = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve([{ id: 200 + callCount, summary: `Mem ${callCount}`, _score: 0.5 }]);
      });
      const llmCallFn = vi.fn()
        .mockResolvedValueOnce('THINKING: Need many\nQUERY: first search query\nQUERY: second search query\nQUERY: third search query\nQUERY: fourth search query\nQUERY: fifth search query')
        .mockResolvedValueOnce('SUFFICIENT');

      await runIRCoT('test query', initial, recallFn, llmCallFn);
      // recallFn should be called at most 3 times (first 3 queries)
      expect(recallFn).toHaveBeenCalledTimes(3);
    });
  });
});
