// packages/brain/src/storage/types.ts

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model' | 'introspective';

export interface SqliteMemory {
  id: string;              // "clude-xxxxxxxx"
  memory_type: MemoryType;
  content: string;
  summary: string;
  importance: number;
  decay_factor: number;
  emotional_valence: number;
  tags: string[];
  concepts: string[];
  source: string;
  source_id: string | null;
  related_user: string | null;
  related_wallet: string | null;
  owner: string | null;
  metadata: Record<string, unknown>;
  access_count: number;
  created_at: string;
  updated_at: string;
  last_accessed: string;
}

export interface StoreOpts {
  type: MemoryType;
  content: string;
  summary: string;
  tags?: string[];
  concepts?: string[];
  importance?: number;
  emotional_valence?: number;
  source?: string;
  source_id?: string;
  related_user?: string;
  related_wallet?: string;
  owner?: string;
  metadata?: Record<string, unknown>;
}

export interface RecallOpts {
  query: string;
  tags?: string[];
  memory_types?: MemoryType[];
  limit?: number;
  min_importance?: number;
  min_decay?: number;
  related_user?: string;
  related_wallet?: string;
  owner?: string;
}

export interface RecallResult {
  count: number;
  memories: Array<SqliteMemory & { relevance_score: number }>;
}

export interface ListOpts {
  page?: number;
  page_size?: number;
  memory_type?: MemoryType;
  min_importance?: number;
  order?: 'created_at' | 'importance' | 'last_accessed';
  owner?: string;
}

export interface MemoryStats {
  total: number;
  by_type: Record<MemoryType, number>;
  avg_importance: number;
  avg_decay: number;
  oldest: string | null;
  newest: string | null;
}

export interface Embedder {
  embed(text: string): Promise<Float32Array>;
  readonly dimensions: number;
  readonly model: string;
}
