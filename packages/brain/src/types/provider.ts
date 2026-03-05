// ============================================================
// PROVIDER INTERFACES
//
// @clude/core is provider-agnostic. These interfaces define
// what a storage backend and embedding provider must implement.
//
// Built-in providers:
//   - local: SQLite + gte-small (zero config, @clude/local)
//   - supabase: Supabase + Voyage AI (@clude/cloud)
//
// Bring your own:
//   - Implement StorageProvider + EmbeddingProvider
//   - Pass to createEngine()
// ============================================================

import type { Memory, MemorySummary, MemoryType, Scope, Entity, EntityMention, EntityRelation, MemoryLink } from './memory.js';

// ── Storage Provider ─────────────────────────────────────────

export interface StorageProvider {
  name: string;

  // ── Memory CRUD ──
  insert(memory: Omit<Memory, '_score' | '_vector_sim'>): Promise<Memory>;
  getById(id: string, scope?: Scope): Promise<Memory | null>;
  getByIds(ids: string[], scope?: Scope): Promise<Memory[]>;
  update(id: string, patch: Partial<Memory>, scope?: Scope): Promise<void>;
  delete(id: string, scope?: Scope): Promise<boolean>;
  clear(scope?: Scope): Promise<void>;

  // ── Recall queries ──
  /** Fetch top candidates by importance/recency. */
  queryByImportance(opts: {
    limit: number;
    min_decay?: number;
    types?: MemoryType[];
    tags?: string[];
    related_user?: string;
    related_entity?: string;
    scope?: Scope;
  }): Promise<Memory[]>;

  /** Keyword/text search in summary and content. */
  queryByText(opts: {
    keywords: string[];
    limit: number;
    min_decay?: number;
    types?: MemoryType[];
    scope?: Scope;
  }): Promise<Memory[]>;

  /** Fetch memories by source tag (e.g. 'knowledge-seed'). */
  queryBySource(opts: {
    source: string;
    limit?: number;
    min_decay?: number;
    types?: MemoryType[];
    scope?: Scope;
  }): Promise<Memory[]>;

  // ── Vector search ──
  /** Run vector similarity search. Returns memory IDs + scores. */
  vectorSearch(opts: {
    embedding: number[];
    threshold: number;
    limit: number;
    types?: MemoryType[];
    scope?: Scope;
  }): Promise<Array<{ id: string; similarity: number }>>;

  /** Optional fragment-level vector search. */
  fragmentSearch?(opts: {
    embedding: number[];
    threshold: number;
    limit: number;
    scope?: Scope;
  }): Promise<Array<{ memory_id: string; similarity: number }>>;

  /** Store embedding for a memory. */
  storeEmbedding(memory_id: string, embedding: number[]): Promise<void>;

  // ── Batch ops ──
  /** Increment access_count, refresh last_accessed. */
  batchTrackAccess(ids: string[]): Promise<void>;

  /** Apply time-based decay to all memories. */
  batchDecay(opts: {
    type: MemoryType;
    rate: number;
    min_decay: number;
  }): Promise<number>;

  /** Boost importance for repeatedly accessed memories. */
  boostImportance(id: string, amount: number, max: number): Promise<void>;

  // ── Link graph ──
  upsertLink(link: MemoryLink): Promise<void>;
  getLinkedMemories(seed_ids: string[], min_strength: number, limit: number, scope?: Scope): Promise<Array<{ memory_id: string; link_type: string; strength: number }>>;
  boostLinkStrength(ids: string[], amount: number): Promise<number>;

  // ── Entity graph (optional) ──
  entities?: EntityStorageProvider;

  // ── Stats ──
  count(scope?: Scope): Promise<number>;
}

// ── Entity Storage (optional) ────────────────────────────────

export interface EntityStorageProvider {
  findOrCreate(name: string, type: string, opts?: { aliases?: string[]; description?: string }): Promise<Entity>;
  createMention(mention: EntityMention): Promise<void>;
  createRelation(relation: Omit<EntityRelation, 'evidence_memory_ids'> & { evidence_memory_id?: string }): Promise<void>;
  getMemoriesByEntity(entity_id: string, opts?: { limit?: number; types?: MemoryType[] }): Promise<Memory[]>;
  findSimilarEntities(embedding: number[], opts?: { limit?: number; types?: string[] }): Promise<Entity[]>;
  getCooccurrences(entity_id: string, opts?: { min_count?: number; limit?: number }): Promise<Array<{ related_entity_id: string; count: number }>>;
}

// ── Embedding Provider ───────────────────────────────────────

export interface EmbeddingProvider {
  name: string;
  dimensions: number;

  /** Generate a single embedding vector. */
  embed(text: string): Promise<number[]>;

  /** Batch embed multiple texts. */
  embedBatch(texts: string[]): Promise<(number[] | null)[]>;

  /** Optional: use a different model for queries (asymmetric embeddings). */
  embedQuery?(text: string): Promise<number[]>;
}

// ── LLM Provider (optional, for query expansion + importance scoring) ──

export interface LLMProvider {
  name: string;

  /** Generate a short response (for query expansion, importance scoring). */
  generate(opts: {
    system?: string;
    prompt: string;
    max_tokens?: number;
    temperature?: number;
  }): Promise<string>;
}

// ── Engine Config ────────────────────────────────────────────

export interface EngineConfig {
  storage: StorageProvider;
  embeddings: EmbeddingProvider;
  llm?: LLMProvider;

  /** Default scope applied to all operations. */
  scope?: Scope;

  /** Scoring weights (all optional, sensible defaults). */
  weights?: {
    recency?: number;
    relevance?: number;
    importance?: number;
    vector?: number;
    graph?: number;
  };

  /** Decay rates per memory type (multiplied per day). */
  decay_rates?: Partial<Record<MemoryType, number>>;

  /** Vector similarity threshold for recall. */
  vector_threshold?: number;

  /** Enable query expansion via LLM. */
  query_expansion?: boolean;

  /** Enable entity extraction. */
  entity_extraction?: boolean;

  /** Scoring config for knowledge-seed boosts, consolidation penalties. */
  scoring?: {
    seed_boost?: { base: number; vectorScale: number; fallback: number };
    consolidation_penalty?: { low: number; high: number };
  };
}
