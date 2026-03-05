export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model';

export interface Memory {
  id: number;
  hash_id: string;
  memory_type: MemoryType;
  content: string;
  summary: string;
  tags: string[];
  concepts: string[];
  emotional_valence: number;
  importance: number;
  access_count: number;
  source: string;
  source_id: string | null;
  related_user: string | null;
  related_wallet: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  last_accessed: string;
  decay_factor: number;
  evidence_ids: number[];
  solana_signature: string | null;
  compacted: boolean;
  compacted_into: string | null;
}

export interface Entity {
  id: number;
  entity_type: string;
  name: string;
  normalized_name: string;
  aliases: string[];
  description: string | null;
  mention_count: number;
  first_seen: string;
  last_seen: string;
}

export interface EntityRelation {
  source_entity_id: number;
  target_entity_id: number;
  relation_type: string;
  strength: number;
}

export interface MemoryLink {
  source_id: number;
  target_id: number;
  link_type: string;
  strength: number;
}

export interface MemoryStats {
  total: number;
  byType: Record<MemoryType, number>;
  avgImportance: number;
  avgDecay: number;
  oldestMemory: string | null;
  newestMemory: string | null;
  totalDreamSessions: number;
  uniqueUsers: number;
  topTags: { tag: string; count: number }[];
  topConcepts: { concept: string; count: number }[];
  embeddedCount: number;
}

export interface MemoryPack {
  id: string;
  name: string;
  description: string;
  memories: Memory[];
  entities: Entity[];
  links: MemoryLink[];
  created_at: string;
  created_by: string; // wallet address
  memory_count: number;
  entity_count: number;
}

export interface Agent {
  id: string;
  name: string;
  wallet_address: string;
  api_endpoint: string;
  created_at: string;
  memory_count: number;
  last_active: string;
}

export interface KnowledgeGraph {
  nodes: Array<{ id: string; type: string; label: string; size: number }>;
  edges: Array<{ source: string; target: string; type: string; weight: number }>;
}
