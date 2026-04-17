import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import type { Embedder } from './types';

export class LocalEmbedder implements Embedder {
  readonly dimensions = 384;
  readonly model = 'all-MiniLM-L6-v2';

  private extractor: any = null;
  private cache = new Map<string, Float32Array>();
  private readonly maxCacheSize = 10_000;

  async embed(text: string): Promise<Float32Array> {
    const cacheKey = crypto.createHash('md5').update(text).digest('hex');
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    if (!this.extractor) {
      await this.loadModel();
    }

    const output = await this.extractor(text, {
      pooling: 'mean',
      normalize: true,
    });

    const embedding = new Float32Array(output.tolist()[0]);

    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(cacheKey, embedding);

    return embedding;
  }

  private async loadModel(): Promise<void> {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.cacheDir = path.join(os.homedir(), '.clude', 'models');

    this.extractor = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2',
      { dtype: 'q8' }
    );
  }
}
