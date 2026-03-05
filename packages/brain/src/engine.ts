// ============================================================
// CLUDE ENGINE — The brain
//
// Provider-agnostic memory engine. Pass in a StorageProvider
// and EmbeddingProvider, get a fully featured cognitive memory
// system with:
//   - Hybrid retrieval (vector + keyword + metadata)
//   - Query expansion via LLM
//   - Entity-aware recall
//   - Bond-typed graph traversal
//   - Type diversity injection
//   - Hebbian reinforcement
//   - Time-based decay
//   - Progressive disclosure
//
// This is what gets extracted from the bot monolith.
// ============================================================

import type { Memory, MemoryType, StoreOptions, RecallOptions, Scope, MemoryStats, MemoryLink, LinkType } from './types/memory.js';
import type { EngineConfig, StorageProvider, EmbeddingProvider, LLMProvider } from './types/provider.js';
import { scoreMemory, DEFAULT_WEIGHTS, DECAY_RATES, type ScoringWeights, type ScoringConfig, type SimRange } from './scoring.js';
import { inferConcepts } from './concepts.js';
import { extractEntitiesFromText, classifyLinkType } from './entities.js';
import { generateHashId, cosineSim } from './utils.js';

// ── Bond-typed graph weights ─────────────────────────────────

const BOND_TYPE_WEIGHTS: Record<string, number> = {
  causes: 1.0,
  supports: 0.9,
  resolves: 0.8,
  elaborates: 0.7,
  contradicts: 0.6,
  relates: 0.4,
  follows: 0.3,
};

// ── Embedding cache ──────────────────────────────────────────

const CACHE_MAX = 200;
const CACHE_TTL = 5 * 60 * 1000;

class EmbeddingCache {
  private cache = new Map<string, { embedding: number[]; ts: number }>();

  get(text: string): number[] | null {
    const key = text.slice(0, 500).toLowerCase().trim();
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) { this.cache.delete(key); return null; }
    return entry.embedding;
  }

  set(text: string, embedding: number[]): void {
    const key = text.slice(0, 500).toLowerCase().trim();
    if (this.cache.size >= CACHE_MAX) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { embedding, ts: Date.now() });
  }
}

// ── Engine ───────────────────────────────────────────────────

export class CludeEngine {
  readonly storage: StorageProvider;
  readonly embeddings: EmbeddingProvider;
  readonly llm?: LLMProvider;
  readonly scope?: Scope;

  private weights: ScoringWeights;
  private decayRates: Record<MemoryType, number>;
  private vectorThreshold: number;
  private queryExpansion: boolean;
  private entityExtraction: boolean;
  private embeddingCache = new EmbeddingCache();
  private scoringConfig?: ScoringConfig;

  constructor(config: EngineConfig) {
    this.storage = config.storage;
    this.embeddings = config.embeddings;
    this.llm = config.llm;
    this.scope = config.scope;
    this.weights = { ...DEFAULT_WEIGHTS, ...config.weights };
    this.decayRates = { ...DECAY_RATES, ...config.decay_rates };
    this.vectorThreshold = config.vector_threshold ?? 0.25;
    this.queryExpansion = config.query_expansion ?? true;
    this.entityExtraction = config.entity_extraction ?? true;
    this.scoringConfig = config.scoring;
  }

  // ── Store ────────────────────────────────────────────────

  async store(opts: StoreOptions, scope?: Scope): Promise<Memory> {
    const s = scope ?? this.scope;
    const concepts = opts.concepts ?? inferConcepts(opts.summary ?? opts.content, opts.source ?? 'user', opts.tags ?? []);
    const summary = opts.summary ?? opts.content.slice(0, 200);
    const hashId = generateHashId();

    const memory: Omit<Memory, '_score' | '_vector_sim'> = {
      id: hashId,
      memory_type: opts.type ?? 'episodic',
      content: opts.content.slice(0, 10_000),
      summary: summary.slice(0, 500),
      tags: opts.tags ?? [],
      concepts,
      emotional_valence: clamp(opts.emotional_valence ?? 0, -1, 1),
      importance: clamp(opts.importance ?? 0.5, 0, 1),
      access_count: 0,
      source: opts.source ?? 'user',
      source_id: opts.source_id,
      related_user: opts.related_user,
      related_entity: opts.related_entity,
      metadata: opts.metadata ?? {},
      created_at: new Date().toISOString(),
      last_accessed: new Date().toISOString(),
      decay_factor: 1.0,
      owner_wallet: s?.owner_wallet,
    };

    const stored = await this.storage.insert(memory);

    // Fire-and-forget: embed + entity extraction + auto-link
    this.embedAndLink(stored).catch(() => {});

    return stored;
  }

  private async embedAndLink(mem: Memory): Promise<void> {
    // Generate and store embedding
    try {
      const embedding = await this.embeddings.embed(mem.summary);
      await this.storage.storeEmbedding(mem.id, embedding);
      this.embeddingCache.set(mem.summary, embedding);
    } catch {}

    // Entity extraction
    if (this.entityExtraction && this.storage.entities) {
      try {
        const extracted = extractEntitiesFromText(`${mem.summary} ${mem.content}`);
        if (mem.related_user && !extracted.find(e => e.name.toLowerCase() === mem.related_user!.toLowerCase())) {
          extracted.push({ name: mem.related_user, type: 'person' });
        }

        const entityIds: string[] = [];
        for (const { name, type } of extracted) {
          const entity = await this.storage.entities.findOrCreate(name, type);
          entityIds.push(entity.id);
          await this.storage.entities.createMention({
            entity_id: entity.id,
            memory_id: mem.id,
            context: mem.summary.slice(0, 200),
            salience: 0.5,
          });
        }

        // Co-occurrence relations
        for (let i = 0; i < entityIds.length; i++) {
          for (let j = i + 1; j < entityIds.length; j++) {
            await this.storage.entities.createRelation({
              source_entity_id: entityIds[i],
              target_entity_id: entityIds[j],
              relation_type: 'co_mentioned',
              strength: 0.3,
              evidence_memory_id: mem.id,
            });
          }
        }
      } catch {}
    }

    // Auto-link to similar memories
    try {
      const embedding = await this.getEmbedding(mem.summary);
      if (embedding) {
        const similar = await this.storage.vectorSearch({
          embedding,
          threshold: 0.6,
          limit: 5,
          scope: this.scope,
        });
        for (const { id, similarity } of similar) {
          if (id === mem.id) continue;
          await this.storage.upsertLink({
            source_id: mem.id,
            target_id: id,
            link_type: 'relates',
            strength: clamp(similarity, 0.3, 0.9),
          });
        }
      }
    } catch {}
  }

  // ── Recall ───────────────────────────────────────────────

  async recall(opts: RecallOptions, scope?: Scope): Promise<Memory[]> {
    const s = scope ?? this.scope;
    const limit = opts.limit ?? 5;
    const minDecay = opts.min_decay ?? 0.1;

    // Phase 0: Query expansion
    const queries = opts.query && !opts.fast && this.queryExpansion
      ? await this.expandQuery(opts.query)
      : opts.query ? [opts.query] : [];

    // Phase 1+2: Vector search + metadata query IN PARALLEL
    const vectorScores = opts._vector_scores ?? new Map<string, number>();
    const embeddingHolder: { primary: number[] | null } = { primary: null };

    const vectorPromise = queries.length > 0
      ? (async () => {
          const embeddings = await Promise.all(
            queries.map(q => this.getEmbedding(q))
          );
          const valid = embeddings.filter((e): e is number[] => e !== null);
          if (valid.length > 0) embeddingHolder.primary = valid[0];

          for (const emb of valid) {
            const results = await this.storage.vectorSearch({
              embedding: emb,
              threshold: this.vectorThreshold,
              limit: limit * (opts.fast ? 12 : 4),
              types: opts.types,
              scope: s,
            });
            for (const { id, similarity } of results) {
              vectorScores.set(id, Math.max(vectorScores.get(id) ?? 0, similarity));
            }
          }
        })()
      : Promise.resolve();

    // Phase 2: Metadata candidates
    const metadataPromise = this.storage.queryByImportance({
      limit: limit * 3,
      min_decay: minDecay,
      types: opts.types,
      tags: opts.tags,
      related_user: opts.related_user,
      related_entity: opts.related_entity,
      scope: s,
    });

    // Phase 2b: Knowledge seeds
    const seedPromise = this.storage.queryBySource({
      source: 'knowledge-seed',
      min_decay: minDecay,
      types: opts.types,
      scope: s,
    });

    // Text search
    const textPromise = opts.query && opts.query.length > 3
      ? this.storage.queryByText({
          keywords: opts.query.toLowerCase().split(/\s+/).filter(w => w.length > 2).slice(0, 4),
          limit: limit * 2,
          min_decay: minDecay,
          types: opts.types,
          scope: s,
        })
      : Promise.resolve([]);

    // Wait for all
    const [_, metadataResults, seeds, textResults] = await Promise.all([
      vectorPromise, metadataPromise, seedPromise, textPromise,
    ]);

    // Merge all candidates (dedup by id)
    const candidateMap = new Map<string, Memory>();
    for (const mem of [...metadataResults, ...textResults, ...seeds]) {
      candidateMap.set(mem.id, mem);
    }

    // Compute in-memory cosine sim for seeds missing vector scores
    const pEmb = embeddingHolder.primary;
    if (pEmb && seeds.length > 0) {
      for (const seed of seeds) {
        if (!vectorScores.has(seed.id) && seed.metadata?._embedding) {
          const emb = seed.metadata._embedding as number[];
          if (emb.length === pEmb.length) {
            const sim = cosineSim(pEmb, emb);
            if (sim > 0) vectorScores.set(seed.id, sim);
          }
        }
      }
    }

    // Fetch vector-only memories not in metadata set
    const missingIds = [...vectorScores.keys()].filter(id => !candidateMap.has(id));
    if (missingIds.length > 0) {
      const vectorOnly = await this.storage.getByIds(missingIds, s);
      for (const mem of vectorOnly) candidateMap.set(mem.id, mem);
    }

    let candidates = [...candidateMap.values()];
    if (candidates.length === 0) return [];

    // Phase 4: Score and rank
    const scoredOpts = vectorScores.size > 0 ? { ...opts, _vector_scores: vectorScores } : opts;

    // Compute similarity range for normalization (helps with compressed embedding spaces)
    let simRange: SimRange | undefined;
    if (vectorScores.size > 1) {
      const sims = [...vectorScores.values()];
      simRange = { min: Math.min(...sims), max: Math.max(...sims) };
    }

    let scored: Memory[] = candidates.map(mem => ({
      ...mem,
      _score: scoreMemory(mem, scoredOpts, this.weights, this.scoringConfig, simRange),
      _vector_sim: vectorScores.get(mem.id),
    }));
    scored.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
    let results: Memory[] = scored.slice(0, limit);

    // Phase 5: Entity-aware recall
    if (opts.query && this.storage.entities) {
      try {
        const qEmbedding = embeddingHolder.primary ?? await this.getEmbedding(opts.query);
        if (qEmbedding) {
          const entities = await this.storage.entities.findSimilarEntities(qEmbedding, { limit: 3 });
          const resultIds = new Set(results.map(m => m.id));

          for (const entity of entities) {
            const entityMems = await this.storage.entities.getMemoriesByEntity(entity.id, {
              limit: Math.ceil(limit / 2),
              types: opts.types,
            });
            for (const mem of entityMems) {
              if (!resultIds.has(mem.id)) {
                results.push({
                  ...mem,
                  _score: scoreMemory(mem, scoredOpts, this.weights, this.scoringConfig, simRange) + this.weights.graph * 0.6,
                });
                resultIds.add(mem.id);
              }
            }
          }
        }
      } catch {}
    }

    // Phase 6: Bond-typed graph traversal
    if (results.length > 0) {
      try {
        const seedIds = results.map(m => m.id);
        const linked = await this.storage.getLinkedMemories(seedIds, 0.2, limit, s);

        const resultIds = new Set(seedIds);
        const newIds = linked.filter(l => !resultIds.has(l.memory_id)).map(l => l.memory_id);

        if (newIds.length > 0) {
          const graphMems = await this.storage.getByIds(newIds, s);
          const linkBoostMap = new Map<string, number>();
          for (const l of linked) {
            const bondWeight = BOND_TYPE_WEIGHTS[l.link_type] ?? 0.4;
            const weighted = (l.strength || 0.5) * bondWeight;
            linkBoostMap.set(l.memory_id, Math.max(linkBoostMap.get(l.memory_id) ?? 0, weighted));
          }

          for (const mem of graphMems) {
            results.push({
              ...mem,
              _score: scoreMemory(mem, scoredOpts, this.weights, this.scoringConfig, simRange) + this.weights.graph * (linkBoostMap.get(mem.id) ?? 0),
            });
          }
        }
      } catch {}
    }

    // Phase 7: Type diversity
    if (results.length >= 3) {
      const typeSet = new Set(results.map(m => m.memory_type));
      if (typeSet.size === 1) {
        const dominant = [...typeSet][0];
        const others = (['episodic', 'semantic', 'procedural', 'self_model'] as MemoryType[]).filter(t => t !== dominant);
        const resultIds = new Set(results.map(m => m.id));
        const diverse = scored
          .filter(m => others.includes(m.memory_type) && !resultIds.has(m.id))
          .slice(0, Math.ceil(limit / 3));

        if (diverse.length > 0) {
          const replaceCount = Math.min(diverse.length, Math.ceil(results.length / 3));
          results = [
            ...results.slice(0, results.length - replaceCount),
            ...diverse.slice(0, replaceCount),
          ];
        }
      }
    }

    // Final sort and trim
    results.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
    results = results.slice(0, limit);

    // Track access + Hebbian reinforcement
    if (opts.track_access !== false) {
      const ids = results.map(m => m.id);
      this.storage.batchTrackAccess(ids).catch(() => {});
      this.storage.boostLinkStrength(ids, 0.05).catch(() => {});
      // Importance rehearsal
      for (const id of ids) {
        this.storage.boostImportance(id, 0.02, 1.0).catch(() => {});
      }
    }

    return results;
  }

  // ── Query Expansion ──────────────────────────────────────

  private async expandQuery(query: string): Promise<string[]> {
    if (!this.llm) return [query];

    try {
      const response = await Promise.race([
        this.llm.generate({
          system: 'You are a search query expander. Given a question, output 3 alternative phrasings that would help find relevant information in a memory database. Output ONLY the 3 alternatives, one per line. No numbering, no explanations.',
          prompt: query,
          max_tokens: 150,
          temperature: 0.3,
        }),
        new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);

      const expansions = response
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 5 && l.length < 200)
        .slice(0, 3);

      return [query, ...expansions];
    } catch {
      return [query];
    }
  }

  // ── Embedding helper ─────────────────────────────────────

  private async getEmbedding(text: string): Promise<number[] | null> {
    const cached = this.embeddingCache.get(text);
    if (cached) return cached;

    try {
      const fn = this.embeddings.embedQuery ?? this.embeddings.embed;
      const emb = await fn.call(this.embeddings, text);
      this.embeddingCache.set(text, emb);
      return emb;
    } catch {
      return null;
    }
  }

  // ── Decay ────────────────────────────────────────────────

  async applyDecay(): Promise<number> {
    let total = 0;
    for (const [type, rate] of Object.entries(this.decayRates) as [MemoryType, number][]) {
      total += await this.storage.batchDecay({ type, rate, min_decay: 0.01 });
    }
    return total;
  }

  // ── Stats ────────────────────────────────────────────────

  async count(scope?: Scope): Promise<number> {
    return this.storage.count(scope ?? this.scope);
  }

  // ── Forget ───────────────────────────────────────────────

  async forget(id: string, scope?: Scope): Promise<boolean> {
    return this.storage.delete(id, scope ?? this.scope);
  }

  // ── Links ────────────────────────────────────────────────

  async link(sourceId: string, targetId: string, type: LinkType, strength = 0.5): Promise<void> {
    await this.storage.upsertLink({ source_id: sourceId, target_id: targetId, link_type: type, strength });
  }
}

// ── Helpers ──────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
