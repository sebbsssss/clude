// ============================================================
// Voyage AI Embedding Provider
// ============================================================

import type { EmbeddingProvider } from '../types/provider.js';

export interface VoyageConfig {
  apiKey: string;
  model?: string;           // default: voyage-4-large
  queryModel?: string;       // optional asymmetric query model
}

export class VoyageEmbeddings implements EmbeddingProvider {
  readonly name = 'voyage';
  readonly dimensions = 1024;

  private apiKey: string;
  private model: string;
  private queryModel?: string;

  constructor(config: VoyageConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? 'voyage-4-large';
    this.queryModel = config.queryModel;
  }

  async embed(text: string): Promise<number[]> {
    return this.callAPI(text, this.model);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.callAPI(text, this.queryModel ?? this.model);
  }

  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    if (texts.length === 0) return [];

    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: texts.map(t => t.slice(0, 8000)),
        model: this.model,
      }),
    });

    if (!res.ok) throw new Error(`Voyage batch error: ${res.status}`);

    const data = await res.json() as { data: Array<{ embedding: number[]; index: number }> };
    const result: (number[] | null)[] = texts.map(() => null);
    for (const item of data.data ?? []) {
      result[item.index] = item.embedding;
    }
    return result;
  }

  private async callAPI(text: string, model: string): Promise<number[]> {
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: text.slice(0, 8000),
        model,
      }),
    });

    if (!res.ok) throw new Error(`Voyage error: ${res.status}`);

    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    const embedding = data.data?.[0]?.embedding;
    if (!embedding) throw new Error('No embedding returned');
    return embedding;
  }
}
