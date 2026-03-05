// ============================================================
// @clude/brain — Cognitive memory engine for AI agents
//
// Usage:
//   import { CludeEngine } from '@clude/brain'
//   import { LocalProvider } from '@clude/brain/providers/local'
//   import { GteSmallEmbeddings } from '@clude/local'
//
//   const engine = new CludeEngine({
//     storage: new LocalProvider('./memory.db'),
//     embeddings: new GteSmallEmbeddings(),
//   })
//
//   await engine.store({ content: "User prefers dark mode" })
//   const memories = await engine.recall({ query: "theme preferences" })
// ============================================================

export { CludeEngine } from './engine.js';
export { scoreMemory, DEFAULT_WEIGHTS, DECAY_RATES, KNOWLEDGE_TYPE_BOOST } from './scoring.js';
export { inferConcepts } from './concepts.js';
export { extractEntitiesFromText, classifyLinkType } from './entities.js';
export { generateHashId, cosineSim, timeAgo, formatMemoryContext } from './utils.js';

// Types
export type {
  Memory,
  MemorySummary,
  MemoryType,
  StoreOptions,
  RecallOptions,
  Scope,
  MemoryStats,
  MemoryPack,
  MemoryLink,
  LinkType,
  Entity,
  EntityType,
  EntityMention,
  EntityRelation,
} from './types/memory.js';

export type {
  StorageProvider,
  EntityStorageProvider,
  EmbeddingProvider,
  LLMProvider,
  EngineConfig,
} from './types/provider.js';
