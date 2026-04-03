import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bm25SearchMemories, resetBm25Cache } from '../bm25-search';

vi.mock('@clude/shared/core/database', () => ({
  getDb: vi.fn(() => ({
    rpc: vi.fn(),
  })),
}));

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('bm25-search', () => {
  beforeEach(() => {
    resetBm25Cache();
    vi.restoreAllMocks();
  });

  describe('bm25SearchMemories', () => {
    it('returns empty array when tsvector not available (RPC error)', async () => {
      const { getDb } = await import('@clude/shared/core/database');
      (getDb as ReturnType<typeof vi.fn>).mockReturnValue({
        rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'function not found' } }),
      });

      const result = await bm25SearchMemories('test query');
      expect(result).toEqual([]);
    });

    it('returns results when RPC is available', async () => {
      const mockResults = [
        { id: 1, rank: 0.85 },
        { id: 2, rank: 0.72 },
      ];
      const rpcFn = vi.fn()
        // First call: availability check
        .mockResolvedValueOnce({ data: [], error: null })
        // Second call: actual search
        .mockResolvedValueOnce({ data: mockResults, error: null });

      const { getDb } = await import('@clude/shared/core/database');
      (getDb as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: rpcFn });

      const result = await bm25SearchMemories('test query');
      expect(result).toEqual(mockResults);
    });

    it('caches availability check result', async () => {
      const rpcFn = vi.fn()
        .mockResolvedValueOnce({ data: [], error: null }) // availability: ok
        .mockResolvedValue({ data: [{ id: 1, rank: 0.5 }], error: null }); // searches

      const { getDb } = await import('@clude/shared/core/database');
      (getDb as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: rpcFn });

      await bm25SearchMemories('query1');
      await bm25SearchMemories('query2');

      // availability check once + 2 searches = 3 calls
      expect(rpcFn).toHaveBeenCalledTimes(3);
    });

    it('passes filter options correctly', async () => {
      const rpcFn = vi.fn()
        .mockResolvedValueOnce({ data: [], error: null })
        .mockResolvedValueOnce({ data: [], error: null });

      const { getDb } = await import('@clude/shared/core/database');
      (getDb as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: rpcFn });

      await bm25SearchMemories('query', {
        limit: 5,
        minDecay: 0.2,
        filterOwner: 'wallet123',
        filterTypes: ['episodic'],
        filterTags: ['test'],
      });

      // Second call is the actual search
      expect(rpcFn).toHaveBeenCalledWith('bm25_search_memories', {
        search_query: 'query',
        match_count: 5,
        min_decay: 0.2,
        filter_owner: 'wallet123',
        filter_types: ['episodic'],
        filter_tags: ['test'],
      });
    });

    it('handles search RPC failure gracefully', async () => {
      const rpcFn = vi.fn()
        .mockResolvedValueOnce({ data: [], error: null }) // availability ok
        .mockResolvedValueOnce({ data: null, error: { message: 'query error' } }); // search fails

      const { getDb } = await import('@clude/shared/core/database');
      (getDb as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: rpcFn });

      const result = await bm25SearchMemories('bad query');
      expect(result).toEqual([]);
    });

    it('handles exception in search gracefully', async () => {
      const rpcFn = vi.fn()
        .mockResolvedValueOnce({ data: [], error: null })
        .mockRejectedValueOnce(new Error('connection lost'));

      const { getDb } = await import('@clude/shared/core/database');
      (getDb as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: rpcFn });

      const result = await bm25SearchMemories('query');
      expect(result).toEqual([]);
    });
  });

  describe('resetBm25Cache', () => {
    it('forces re-check of availability', async () => {
      const rpcFn = vi.fn()
        .mockResolvedValueOnce({ data: null, error: { message: 'not found' } }) // not available
        .mockResolvedValueOnce({ data: [], error: null }) // now available after reset
        .mockResolvedValueOnce({ data: [{ id: 1, rank: 0.5 }], error: null }); // search

      const { getDb } = await import('@clude/shared/core/database');
      (getDb as ReturnType<typeof vi.fn>).mockReturnValue({ rpc: rpcFn });

      // First attempt: not available
      let result = await bm25SearchMemories('query');
      expect(result).toEqual([]);

      // Reset and try again
      resetBm25Cache();
      result = await bm25SearchMemories('query');
      expect(result).toEqual([{ id: 1, rank: 0.5 }]);
    });
  });
});
