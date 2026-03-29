/**
 * Local embedding provider using Ollama.
 * Falls back to BM25 keyword matching if Ollama is unavailable.
 */
export class LocalEmbeddingProvider {
  private ollamaUrl: string;
  private model: string;
  private ollamaAvailable: boolean | null = null;

  constructor(ollamaUrl = 'http://localhost:11434', model = 'nomic-embed-text') {
    this.ollamaUrl = ollamaUrl;
    this.model = model;
  }

  async checkAvailability(): Promise<boolean> {
    if (this.ollamaAvailable !== null) return this.ollamaAvailable;
    try {
      const res = await fetch(`${this.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      const data = (await res.json()) as { models: Array<{ name: string }> };
      this.ollamaAvailable = data.models?.some((m) => m.name.includes(this.model.split(':')[0])) ?? false;
      if (!this.ollamaAvailable) {
        console.warn(`[LocalEmbeddings] Model ${this.model} not found in Ollama. Falling back to BM25.`);
        console.warn(`  Run: ollama pull ${this.model}`);
      }
    } catch {
      this.ollamaAvailable = false;
      console.warn('[LocalEmbeddings] Ollama not available. Using BM25 keyword matching.');
    }
    return this.ollamaAvailable;
  }

  async embed(text: string): Promise<number[] | null> {
    const available = await this.checkAvailability();
    if (!available) return null;

    try {
      const res = await fetch(`${this.ollamaUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
      const data = (await res.json()) as { embedding: number[] };
      return data.embedding;
    } catch (err) {
      console.error('[LocalEmbeddings] Embedding failed:', err);
      return null;
    }
  }

  async embedBatch(texts: string[]): Promise<(number[] | null)[]> {
    // Ollama doesn't have a batch API, so we embed sequentially
    // Could parallelize with limited concurrency in production
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

/**
 * BM25-inspired keyword scoring for fallback when no embeddings available.
 * Scores a query against a document based on term frequency and inverse document frequency.
 */
export function bm25Score(
  query: string,
  document: string,
  corpus: string[],
  k1 = 1.5,
  b = 0.75,
): number {
  const queryTerms = tokenize(query);
  const docTerms = tokenize(document);
  const avgDocLen = corpus.reduce((s, d) => s + tokenize(d).length, 0) / Math.max(corpus.length, 1);

  let score = 0;
  for (const term of queryTerms) {
    const tf = docTerms.filter((t) => t === term).length;
    const df = corpus.filter((d) => tokenize(d).includes(term)).length;
    const idf = Math.log((corpus.length - df + 0.5) / (df + 0.5) + 1);
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docTerms.length / avgDocLen)));
    score += idf * tfNorm;
  }
  return score;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/**
 * Cosine similarity between two embedding vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-8);
}
