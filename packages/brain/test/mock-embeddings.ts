/**
 * Mock embedding provider for testing.
 * Uses simple bag-of-words hashing to produce deterministic vectors.
 */
import type { EmbeddingProvider } from '../src/types/provider.js';

const DIMS = 64;

function hashEmbed(text: string): number[] {
  const vec = new Array(DIMS).fill(0);
  const words = text.toLowerCase().split(/\s+/);
  for (const word of words) {
    for (let i = 0; i < word.length; i++) {
      const idx = (word.charCodeAt(i) * 31 + i * 7) % DIMS;
      vec[idx] += 1;
    }
  }
  // Normalize
  const mag = Math.sqrt(vec.reduce((s: number, v: number) => s + v * v, 0));
  if (mag > 0) for (let i = 0; i < DIMS; i++) vec[i] /= mag;
  return vec;
}

export class MockEmbeddings implements EmbeddingProvider {
  name = 'mock';
  dimensions = DIMS;

  async embed(text: string): Promise<number[]> {
    return hashEmbed(text);
  }

  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    return texts.map(t => hashEmbed(t));
  }

  async embedQuery(text: string): Promise<number[]> {
    return hashEmbed(text);
  }
}
