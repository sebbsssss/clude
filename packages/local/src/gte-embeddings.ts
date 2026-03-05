/**
 * GTE-Small embedding provider — implements @clude/brain's EmbeddingProvider.
 * Local ONNX runtime, no API keys needed.
 */

import { embed, embedBatch, cosineSim, getEmbeddingDims } from './embeddings.js';

export class GteSmallEmbeddings {
  readonly name = 'gte-small';
  readonly dimensions = 384;

  async embed(text: string): Promise<number[]> {
    return embed(text);
  }

  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    const results = await embedBatch(texts);
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    return embed(text);
  }

  async warmup(): Promise<void> {
    await embed('warmup');
  }
}
