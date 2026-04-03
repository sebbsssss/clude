/**
 * Memory module barrel export.
 *
 * Re-exports everything from the core memory module so existing imports
 * like `from '../core/memory'` can be redirected here with a single
 * path change.
 */
export {
  // Types
  type MemoryType,
  type Memory,
  type MemorySummary,
  type StoreMemoryOptions,
  type RecallOptions,
  type MemoryStats,

  // Store
  storeMemory,
  deleteMemory,
  updateMemory,

  // Recall
  recallMemories,
  recallMemorySummaries,
  hydrateMemories,
  scoreMemory,

  // Stats & queries
  getMemoryStats,
  getRecentMemories,
  getSelfModel,
  listMemories,

  // Links
  createMemoryLink,

  // Decay
  decayMemories,
  storeDreamLog,

  // Helpers
  formatMemoryContext,
  inferConcepts,
  generateHashId,
  isValidHashId,
  calculateImportance,
  scoreImportanceWithLLM,
  moodToValence,

  // Owner context
  _setOwnerWallet,
  getOwnerWallet,
  scopeToOwner,
  SCOPE_BOT_OWN,
} from './memory';
