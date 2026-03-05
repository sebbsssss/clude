// ============================================================
// CLUDE CORE TYPES
//
// These types define the memory model used across all providers
// (local SQLite, Supabase cloud, future IPFS/Arweave).
//
// 4 memory types (CoALA cognitive architecture):
//   episodic    — interaction records (conversations, events)
//   semantic    — distilled knowledge and beliefs
//   procedural  — behavioral patterns (what works, what doesn't)
//   self_model  — agent's evolving understanding of itself
// ============================================================

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model';

/** Full memory record. */
export interface Memory {
  id: string;                     // Collision-resistant hash ID (e.g. "clude-a1b2c3d4")
  uuid?: string;                  // Deterministic UUID for portability (wallet+content+timestamp)
  memory_type: MemoryType;
  content: string;
  summary: string;
  tags: string[];
  concepts: string[];
  emotional_valence: number;      // -1 to 1
  importance: number;             // 0 to 1
  access_count: number;
  source: string;                 // e.g. "conversation", "reflection", "consolidation"
  source_id?: string;
  related_user?: string;
  related_entity?: string;        // Wallet address, user ID, etc.
  metadata: Record<string, unknown>;
  created_at: string;             // ISO 8601
  last_accessed: string;          // ISO 8601
  decay_factor: number;           // 0 to 1, decreases over time
  owner_wallet?: string;

  // Portability
  compacted?: boolean;
  compacted_into?: string;        // hash_id of compacted summary
  solana_signature?: string;

  // Internal scoring (not persisted, added at recall time)
  _score?: number;
  _vector_sim?: number;
}

/** Lightweight summary for progressive disclosure. */
export interface MemorySummary {
  id: string;
  memory_type: MemoryType;
  summary: string;
  tags: string[];
  concepts: string[];
  importance: number;
  decay_factor: number;
  created_at: string;
  source: string;
}

// ── Store Options ────────────────────────────────────────────

export interface StoreOptions {
  type?: MemoryType;
  content: string;
  summary?: string;               // Auto-generated if omitted
  tags?: string[];
  concepts?: string[];
  emotional_valence?: number;
  importance?: number;
  source?: string;
  source_id?: string;
  related_user?: string;
  related_entity?: string;
  metadata?: Record<string, unknown>;
}

export interface RecallOptions {
  query?: string;
  tags?: string[];
  types?: MemoryType[];
  related_user?: string;
  related_entity?: string;
  limit?: number;
  min_importance?: number;
  min_decay?: number;
  /** Skip LLM query expansion (faster, narrower recall). */
  fast?: boolean;
  /** Skip access tracking (for internal processing like dream cycles). */
  track_access?: boolean;

  /** @internal Pre-computed vector scores. */
  _vector_scores?: Map<string, number>;
}

// ── Entity Graph ─────────────────────────────────────────────

export type EntityType =
  | 'person'
  | 'project'
  | 'concept'
  | 'token'
  | 'wallet'
  | 'location'
  | 'event';

export interface Entity {
  id: string;
  entity_type: EntityType;
  name: string;
  normalized_name: string;
  aliases: string[];
  description?: string;
  metadata: Record<string, unknown>;
  mention_count: number;
  first_seen: string;
  last_seen: string;
}

export interface EntityMention {
  entity_id: string;
  memory_id: string;
  context: string;
  salience: number;               // 0-1
}

export interface EntityRelation {
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;          // 'knows', 'created', 'co_mentioned', etc.
  strength: number;
  evidence_memory_ids: string[];
}

// ── Memory Links ─────────────────────────────────────────────

export type LinkType =
  | 'supports'
  | 'contradicts'
  | 'elaborates'
  | 'causes'
  | 'resolves'
  | 'relates'
  | 'follows';

export interface MemoryLink {
  source_id: string;
  target_id: string;
  link_type: LinkType;
  strength: number;               // 0-1
}

// ── Portability ──────────────────────────────────────────────

export interface MemoryPack {
  version: 1;
  created_at: string;
  identity: {
    wallet: string;
    name?: string;
    description?: string;
  };
  memories: Array<Memory & { uuid: string }>;
  links: MemoryLink[];
  entities: Entity[];
  relations: EntityRelation[];
  content_hash: string;           // SHA-256 of serialized memories
  signature?: string;             // HMAC-SHA256 or Solana signature
}

// ── Scoping ──────────────────────────────────────────────────

/**
 * Multi-tenant scoping (borrowed from Mem0).
 * All operations can be scoped to a specific user, agent, session, or run.
 */
export interface Scope {
  user_id?: string;
  agent_id?: string;
  session_id?: string;
  run_id?: string;
  owner_wallet?: string;
}

// ── Stats ────────────────────────────────────────────────────

export interface MemoryStats {
  total: number;
  by_type: Record<MemoryType, number>;
  avg_importance: number;
  avg_decay: number;
  oldest: string | null;
  newest: string | null;
  embedded_count: number;
  unique_users: number;
  top_tags: Array<{ tag: string; count: number }>;
  top_concepts: Array<{ concept: string; count: number }>;
}
