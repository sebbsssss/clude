/**
 * VoyageEmbeddings — implements @clude/brain EmbeddingProvider using Voyage AI API.
 * Default model: voyage-4-large (1024 dims).
 */

export interface VoyageConfig {
  apiKey: string;
  model?: string;         // default: voyage-4-large
  queryModel?: string;    // default: same as model
  dimensions?: number;    // default: 1024
}

interface EmbeddingProvider {
  name: string;
  dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<(number[] | null)[]>;
  embedQuery?(text: string): Promise<number[]>;
}

export class VoyageEmbeddings implements EmbeddingProvider {
  readonly name = 'voyage';
  readonly dimensions: number;
  private apiKey: string;
  private model: string;
  private queryModel: string;

  constructor(config: VoyageConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'voyage-4-large';
    this.queryModel = config.queryModel || this.model;
    this.dimensions = config.dimensions || 1024;
  }

  async embed(text: string): Promise<number[]> {
    const result = await this.callAPI([text], 'document');
    if (!result[0]) throw new Error('Voyage embed returned null');
    return result[0];
  }

  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    if (texts.length === 0) return [];
    // Voyage supports up to 128 texts per batch
    const results: (number[] | null)[] = [];
    for (let i = 0; i < texts.length; i += 128) {
      const batch = texts.slice(i, i + 128);
      const embeddings = await this.callAPI(batch, 'document');
      results.push(...embeddings);
    }
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    const result = await this.callAPI([text], 'query');
    if (!result[0]) throw new Error('Voyage embedQuery returned null');
    return result[0];
  }

  private async callAPI(texts: string[], inputType: 'document' | 'query'): Promise<(number[] | null)[]> {
    const model = inputType === 'query' ? this.queryModel : this.model;
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: texts,
        input_type: inputType,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Voyage API error ${res.status}: ${body}`);
    }

    const json = await res.json() as any;
    return json.data.map((d: any) => d.embedding as number[]);
  }
}
