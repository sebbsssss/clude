export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model';

export interface Memory {
  id?: number;
  type: MemoryType;
  summary: string;
  content: string;
  importance: number; // 0-1
  tags: string[];
  embedding?: number[];
  decayFactor?: number;
  accessCount?: number;
  createdAt?: string;
  updatedAt?: string;
  eventDate?: string;
}

export interface RecallOptions {
  limit?: number;
  minImportance?: number;
  types?: MemoryType[];
  tags?: string[];
  skipEmbedding?: boolean;
}

export interface RecallResult extends Memory {
  score: number;
  recencyScore: number;
  relevanceScore: number;
  importanceScore: number;
}

export interface MemoryLink {
  sourceId: number;
  targetId: number;
  linkType: LinkType;
  strength: number;
}

export type LinkType =
  | 'supports'
  | 'contradicts'
  | 'elaborates'
  | 'causes'
  | 'follows'
  | 'relates'
  | 'resolves'
  | 'happens_before'
  | 'happens_after'
  | 'concurrent_with';

export const LINK_TYPE_WEIGHTS: Record<LinkType, number> = {
  causes: 1.0,
  supports: 0.9,
  concurrent_with: 0.8,
  resolves: 0.8,
  happens_before: 0.7,
  happens_after: 0.7,
  elaborates: 0.7,
  contradicts: 0.6,
  relates: 0.4,
  follows: 0.3,
};

export const DECAY_RATES: Record<MemoryType, number> = {
  episodic: 0.93,
  semantic: 0.98,
  procedural: 0.97,
  self_model: 0.99,
};

export interface LocalMemoryConfig {
  dbPath: string;
  ollamaUrl?: string; // defaults to http://localhost:11434
  embeddingModel?: string; // defaults to nomic-embed-text
  llmModel?: string; // defaults to llama3.2:3b
  embeddingDimensions?: number; // defaults to 768
  useEmbeddings?: boolean; // defaults to true, falls back to BM25 if Ollama unavailable
}
