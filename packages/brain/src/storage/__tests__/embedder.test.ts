import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn(),
  env: { cacheDir: '' },
}));

import { LocalEmbedder } from '../embedder';
import { pipeline } from '@huggingface/transformers';

describe('LocalEmbedder', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct dimensions and model name', () => {
    const embedder = new LocalEmbedder();
    expect(embedder.dimensions).toBe(384);
    expect(embedder.model).toBe('all-MiniLM-L6-v2');
  });

  it('generates embedding with correct dimensions', async () => {
    const mockOutput = {
      tolist: () => [Array.from({ length: 384 }, () => Math.random())],
    };
    const mockExtractor = vi.fn().mockResolvedValue(mockOutput);
    vi.mocked(pipeline).mockResolvedValue(mockExtractor as any);

    const embedder = new LocalEmbedder();
    const result = await embedder.embed('test sentence');

    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(384);
    expect(mockExtractor).toHaveBeenCalledWith('test sentence', {
      pooling: 'mean',
      normalize: true,
    });
  });

  it('caches embeddings for the same text', async () => {
    const mockOutput = {
      tolist: () => [Array.from({ length: 384 }, () => 0.5)],
    };
    const mockExtractor = vi.fn().mockResolvedValue(mockOutput);
    vi.mocked(pipeline).mockResolvedValue(mockExtractor as any);

    const embedder = new LocalEmbedder();
    const result1 = await embedder.embed('same text');
    const result2 = await embedder.embed('same text');

    expect(result1).toEqual(result2);
    expect(mockExtractor).toHaveBeenCalledTimes(1);
  });

  it('generates different embeddings for different text', async () => {
    let callCount = 0;
    const mockExtractor = vi.fn().mockImplementation(() => {
      callCount++;
      return Promise.resolve({
        tolist: () => [Array.from({ length: 384 }, (_, i) => i * callCount * 0.001)],
      });
    });
    vi.mocked(pipeline).mockResolvedValue(mockExtractor as any);

    const embedder = new LocalEmbedder();
    const result1 = await embedder.embed('hello world');
    const result2 = await embedder.embed('goodbye world');

    expect(mockExtractor).toHaveBeenCalledTimes(2);
    expect(result1).not.toEqual(result2);
  });
});
