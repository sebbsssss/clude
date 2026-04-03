import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rerankWithCrossEncoder, rerankWithVoyage, type RerankableMemory } from '../reranker';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

function makeMem(id: number, score: number, summary: string = `Memory ${id}`): RerankableMemory {
  return { id, _score: score, summary, content: `Content for ${id}` };
}

describe('reranker', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('rerankWithCrossEncoder', () => {
    it('returns original memories when no API key', async () => {
      const memories = [makeMem(1, 0.9), makeMem(2, 0.8)];
      const result = await rerankWithCrossEncoder(memories, 'test query', { apiKey: '' });
      expect(result).toBe(memories);
    });

    it('returns original memories when only one memory', async () => {
      const memories = [makeMem(1, 0.9)];
      const result = await rerankWithCrossEncoder(memories, 'test query', { apiKey: 'key' });
      expect(result).toBe(memories);
    });

    it('reranks memories on successful API response', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          results: [
            { index: 1, relevance_score: 0.95 },
            { index: 0, relevance_score: 0.75 },
          ],
        }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const memories = [makeMem(1, 0.9), makeMem(2, 0.8)];
      const result = await rerankWithCrossEncoder(memories, 'test query', { apiKey: 'test-key' });

      expect(result).toHaveLength(2);
      // Memory 2 should be first (higher relevance_score)
      expect(result[0].id).toBe(2);
      expect(result[0]._score).toBe(0.95);
      expect(result[1].id).toBe(1);
      expect(result[1]._score).toBe(0.75);
    });

    it('returns original order on API error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Server error'),
      }));

      const memories = [makeMem(1, 0.9), makeMem(2, 0.8)];
      const result = await rerankWithCrossEncoder(memories, 'test query', { apiKey: 'test-key' });
      expect(result).toBe(memories);
    });

    it('returns original order on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));

      const memories = [makeMem(1, 0.9), makeMem(2, 0.8)];
      const result = await rerankWithCrossEncoder(memories, 'test query', { apiKey: 'test-key' });
      expect(result).toBe(memories);
    });

    it('sends correct request body to Cohere', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [{ index: 0, relevance_score: 0.9 }] }),
      });
      vi.stubGlobal('fetch', mockFetch);

      const memories = [makeMem(1, 0.9), makeMem(2, 0.8)];
      await rerankWithCrossEncoder(memories, 'my query', { apiKey: 'key', topN: 5, model: 'rerank-v3.5' });

      expect(mockFetch).toHaveBeenCalledWith('https://api.cohere.com/v2/rerank', expect.objectContaining({
        method: 'POST',
        body: expect.any(String),
      }));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('rerank-v3.5');
      expect(body.query).toBe('my query');
      expect(body.documents).toHaveLength(2);
      expect(body.top_n).toBe(2); // min(topN=5, memories.length=2)
    });

    it('preserves _originalScore on reranked memories', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          results: [{ index: 0, relevance_score: 0.99 }],
        }),
      }));

      const memories = [makeMem(1, 0.75), makeMem(2, 0.6)];
      const result = await rerankWithCrossEncoder(memories, 'query', { apiKey: 'key' });
      expect((result[0] as any)._originalScore).toBe(0.75);
    });
  });

  describe('rerankWithVoyage', () => {
    it('returns original memories when no API key', async () => {
      const memories = [makeMem(1, 0.9), makeMem(2, 0.8)];
      const result = await rerankWithVoyage(memories, 'test query', { apiKey: '' });
      expect(result).toBe(memories);
    });

    it('returns original memories when only one memory', async () => {
      const memories = [makeMem(1, 0.9)];
      const result = await rerankWithVoyage(memories, 'test query', { apiKey: 'key' });
      expect(result).toBe(memories);
    });

    it('reranks memories on successful API response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          data: [
            { index: 1, relevance_score: 0.92 },
            { index: 0, relevance_score: 0.71 },
          ],
        }),
      }));

      const memories = [makeMem(1, 0.9), makeMem(2, 0.8)];
      const result = await rerankWithVoyage(memories, 'test query', { apiKey: 'test-key' });
      expect(result[0].id).toBe(2);
      expect(result[0]._score).toBe(0.92);
    });

    it('returns original order on API failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));

      const memories = [makeMem(1, 0.9), makeMem(2, 0.8)];
      const result = await rerankWithVoyage(memories, 'test query', { apiKey: 'test-key' });
      expect(result).toBe(memories);
    });

    it('returns original order on network error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

      const memories = [makeMem(1, 0.9), makeMem(2, 0.8)];
      const result = await rerankWithVoyage(memories, 'test query', { apiKey: 'test-key' });
      expect(result).toBe(memories);
    });
  });
});
