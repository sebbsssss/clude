/**
 * LocalMemory: Offline-first persistent memory system.
 * Zero external API dependencies — uses Ollama + SQLite.
 *
 * Compatible with Clude's memory API surface so it can serve as
 * a drop-in offline alternative to the Supabase-backed production system.
 */

import { bm25Score, cosineSimilarity, LocalEmbeddingProvider } from './embeddings';
import { SqliteStore } from './sqlite-store';
import type {
  LocalMemoryConfig,
  Memory,
  MemoryLink,
  MemoryType,
  RecallOptions,
  RecallResult,
} from './types';
import { DECAY_RATES } from './types';

export class LocalMemory {
  private db: SqliteStore;
  private embeddings: LocalEmbeddingProvider;
  private config: Required<LocalMemoryConfig>;

  constructor(config: LocalMemoryConfig) {
    this.config = {
      ollamaUrl: 'http://localhost:11434',
      embeddingModel: 'nomic-embed-text',
      llmModel: 'llama3.2:3b',
      embeddingDimensions: 768,
      useEmbeddings: true,
      ...config,
    };
    this.db = new SqliteStore(config.dbPath);
    this.embeddings = new LocalEmbeddingProvider(
      this.config.ollamaUrl,
      this.config.embeddingModel,
    );
  }

  async init(): Promise<void> {
    await this.db.init();
    if (this.config.useEmbeddings) {
      await this.embeddings.checkAvailability();
    }
  }

  /**
   * Store a new memory and generate its embedding asynchronously.
   */
  async store(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
    const id = this.db.insert({
      ...memory,
      importance: Math.max(0, Math.min(1, memory.importance)),
    });

    // Generate and store embedding (non-blocking for caller)
    if (this.config.useEmbeddings) {
      this.embedMemory(id, `${memory.summary}\n${memory.content}`).catch(console.error);
    }

    return id;
  }

  private async embedMemory(id: number, text: string): Promise<void> {
    const embedding = await this.embeddings.embed(text);
    if (embedding) {
      this.db.storeEmbedding(id, embedding);
    }
  }

  /**
   * Recall memories relevant to a query using hybrid scoring:
   * vector similarity + BM25 keyword + recency + importance + decay
   */
  async recall(query: string, opts: RecallOptions = {}): Promise<RecallResult[]> {
    const limit = opts.limit ?? 10;
    const allMemories = this.db.getAll({
      types: opts.types,
      minImportance: opts.minImportance,
      limit: 500, // candidate pool
    });

    if (allMemories.length === 0) return [];

    // Filter by tags if specified
    const candidates = opts.tags?.length
      ? allMemories.filter((m) => opts.tags!.some((t) => m.tags.includes(t)))
      : allMemories;

    // Get query embedding
    let queryEmbedding: number[] | null = null;
    if (this.config.useEmbeddings && !opts.skipEmbedding) {
      queryEmbedding = await this.embeddings.embed(query);
    }

    const corpus = candidates.map((m) => `${m.summary} ${m.content}`);
    const now = Date.now();

    // Score each candidate
    const scored = candidates.map((memory, i) => {
      // 1. Recency score (exponential decay over 30 days)
      const ageMs = now - new Date(memory.createdAt!).getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      const recencyScore = Math.exp(-ageDays / 30);

      // 2. BM25 keyword relevance
      const kwScore = bm25Score(query, corpus[i], corpus);
      const maxKw = 10; // normalize
      const keywordScore = Math.min(kwScore / maxKw, 1);

      // 3. Vector similarity (if embeddings available)
      let vectorScore = 0;
      if (queryEmbedding) {
        const memEmbedding = this.db.getEmbedding(memory.id!);
        if (memEmbedding) {
          vectorScore = Math.max(0, cosineSimilarity(queryEmbedding, memEmbedding));
        }
      }

      // 4. Importance score (stored 0-1)
      const importanceScore = memory.importance;

      // 5. Decay factor
      const decayScore = memory.decayFactor ?? 1.0;

      // Composite score — weights tuned for local BM25-dominant mode
      // (mirrors production RETRIEVAL_WEIGHT_* settings)
      const vectorWeight = queryEmbedding ? 2.0 : 0;
      const kwWeight = 3.0;
      const recencyWeight = 1.5;
      const importanceWeight = 1.0;

      const score =
        decayScore *
        (vectorWeight * vectorScore +
          kwWeight * keywordScore +
          recencyWeight * recencyScore +
          importanceWeight * importanceScore);

      return {
        ...memory,
        score,
        recencyScore,
        relevanceScore: vectorScore || keywordScore,
        importanceScore,
      } as RecallResult;
    });

    // Sort by score, return top-k
    const results = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    // Track access
    for (const r of results) {
      this.db.incrementAccess(r.id!);
    }

    return results;
  }

  /**
   * Link two memories together.
   */
  link(link: MemoryLink): void {
    this.db.addLink(link);
  }

  /**
   * Get memories linked to a given memory.
   */
  getLinked(memoryId: number): { memory: Memory; linkType: string; strength: number }[] {
    return this.db.getLinkedMemories(memoryId);
  }

  /**
   * Apply decay to all memories (run periodically, e.g., daily).
   */
  applyDecay(): void {
    this.db.updateDecay();
  }

  /**
   * Simplified consolidation using a local LLM via Ollama.
   * Generates an insight from recent episodic memories.
   */
  async consolidate(recentMemoryIds: number[]): Promise<Memory | null> {
    if (recentMemoryIds.length === 0) return null;

    const memories = recentMemoryIds
      .map((id) => this.db.getById(id))
      .filter((m): m is Memory => m !== null);

    if (memories.length < 2) return null;

    const context = memories.map((m) => `- ${m.summary}`).join('\n');
    const prompt = `Given these recent memories:\n${context}\n\nWhat is the single most important insight or pattern? Reply with one concise sentence.`;

    try {
      const insight = await this.callLocalLLM(prompt);
      if (!insight) return null;

      const id = await this.db.insert({
        type: 'semantic',
        summary: insight,
        content: `Consolidated from ${memories.length} memories. Sources: ${memories.map((m) => m.id).join(', ')}`,
        importance: Math.max(...memories.map((m) => m.importance)) * 0.9,
        tags: [...new Set(memories.flatMap((m) => m.tags))].slice(0, 5),
      });

      return this.db.getById(id);
    } catch (err) {
      console.error('[LocalMemory] Consolidation failed:', err);
      return null;
    }
  }

  private async callLocalLLM(prompt: string): Promise<string | null> {
    try {
      const res = await fetch(`${this.config.ollamaUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.llmModel,
          prompt,
          stream: false,
          options: { temperature: 0.3, num_predict: 100 },
        }),
      });
      const data = (await res.json()) as { response: string };
      return data.response?.trim() ?? null;
    } catch (err) {
      console.error('[LocalMemory] Local LLM call failed:', err);
      console.error('  Is Ollama running? Try: ollama serve');
      return null;
    }
  }

  close(): void {
    this.db.close();
  }
}

// Re-export types for convenience
export type { LocalMemoryConfig, Memory, MemoryLink, MemoryType, RecallOptions, RecallResult };
export { DECAY_RATES };
