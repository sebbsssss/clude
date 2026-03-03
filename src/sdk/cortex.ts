import './sdk-mode'; // Must be FIRST — sets global flag before config.ts evaluates
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import type {
  CortexConfig,
  DreamOptions,
  Memory,
  MemorySummary,
  MemoryType,
  StoreMemoryOptions,
  RecallOptions,
  MemoryStats,
} from './types';
import type { MemoryLinkType } from '../utils/constants';

export class Cortex {
  private db: SupabaseClient;
  private initialized = false;
  private dreamActive = false;

  constructor(private config: CortexConfig) {
    if (!config.supabase?.url || !config.supabase?.serviceKey) {
      throw new Error('Cortex requires supabase.url and supabase.serviceKey');
    }

    this.db = createClient(config.supabase.url, config.supabase.serviceKey);

    // Inject database client
    const { _setDb } = require('../core/database');
    _setDb(this.db);

    // Inject Anthropic client if provided
    if (config.anthropic?.apiKey) {
      const client = new Anthropic({ apiKey: config.anthropic.apiKey });
      const { _setAnthropicClient } = require('../core/claude-client');
      _setAnthropicClient(client, config.anthropic.model);
    }

    // Inject embedding config if provided
    if (config.embedding) {
      const { _configureEmbeddings } = require('../core/embeddings');
      _configureEmbeddings({
        provider: config.embedding.provider,
        apiKey: config.embedding.apiKey,
        model: config.embedding.model,
        dimensions: config.embedding.dimensions,
      });
    }

    // Inject Solana config if provided
    if (config.solana) {
      const { _configureSolana, _configureMemoryRegistry } = require('../core/solana-client');
      _configureSolana(
        config.solana.rpcUrl || 'https://api.mainnet-beta.solana.com',
        config.solana.botWalletPrivateKey,
      );
      if (config.solana.memoryRegistryProgramId) {
        _configureMemoryRegistry(config.solana.memoryRegistryProgramId);
      }
    }

    // Set owner wallet if provided
    if (config.ownerWallet) {
      const { _setOwnerWallet } = require('../core/memory');
      _setOwnerWallet(config.ownerWallet);
    }

    // Wire event bus for importance-driven dream triggers
    const { eventBus } = require('../events/event-bus');
    const { accumulateImportance } = require('../features/dream-cycle');
    eventBus.on('memory:stored', (payload: { importance: number; memoryType: string }) => {
      if (payload.memoryType === 'episodic') {
        accumulateImportance(payload.importance);
      }
    });
  }

  /** Initialize database schema, encryption, and on-chain registry. Call before store/recall. */
  async init(): Promise<void> {
    const { initDatabase } = require('../core/database');
    await initDatabase();

    // Configure encryption if provided (must be after DB init)
    if (this.config.encryption?.solanaSecretKey) {
      const { configureEncryption } = require('../core/encryption');
      await configureEncryption(this.config.encryption.solanaSecretKey);
    }

    // Initialize on-chain registry PDA if configured
    if (this.config.solana?.memoryRegistryProgramId) {
      const { initializeRegistry } = require('../core/solana-client');
      await initializeRegistry().catch((err: Error) => {
        // Non-fatal — registry just won't be available, falls back to memo
        const { createChildLogger } = require('../core/logger');
        createChildLogger('cortex').warn({ err }, 'Registry initialization failed, falling back to memo');
      });
    }

    this.initialized = true;
  }

  /** Store a new memory. Returns memory ID or null. */
  async store(opts: StoreMemoryOptions): Promise<number | null> {
    this.guard();
    const { storeMemory } = require('../core/memory');
    return storeMemory(opts);
  }

  /** Recall memories with hybrid vector + keyword + graph scoring. */
  async recall(opts: RecallOptions = {}): Promise<Memory[]> {
    this.guard();
    const { recallMemories } = require('../core/memory');
    return recallMemories(opts);
  }

  /** Recall lightweight summaries (progressive disclosure). */
  async recallSummaries(opts: RecallOptions = {}): Promise<MemorySummary[]> {
    this.guard();
    const { recallMemorySummaries } = require('../core/memory');
    return recallMemorySummaries(opts);
  }

  /** Hydrate full memory content for specific IDs. */
  async hydrate(ids: number[]): Promise<Memory[]> {
    this.guard();
    const { hydrateMemories } = require('../core/memory');
    return hydrateMemories(ids);
  }

  /** Apply type-specific memory decay. */
  async decay(): Promise<number> {
    this.guard();
    const { decayMemories } = require('../core/memory');
    return decayMemories();
  }

  /** Get memory system statistics. */
  async stats(): Promise<MemoryStats> {
    this.guard();
    const { getMemoryStats } = require('../core/memory');
    return getMemoryStats();
  }

  /** Get recent memories from the last N hours. */
  async recent(hours: number, types?: MemoryType[], limit?: number): Promise<Memory[]> {
    this.guard();
    const { getRecentMemories } = require('../core/memory');
    return getRecentMemories(hours, types, limit);
  }

  /** Get current self-model memories. */
  async selfModel(): Promise<Memory[]> {
    this.guard();
    const { getSelfModel } = require('../core/memory');
    return getSelfModel();
  }

  /** Create a typed link between two memories. */
  async link(sourceId: number, targetId: number, type: MemoryLinkType, strength?: number): Promise<void> {
    this.guard();
    const { createMemoryLink } = require('../core/memory');
    return createMemoryLink(sourceId, targetId, type, strength);
  }

  /** Run one full dream cycle (consolidation + reflection + emergence). Requires anthropic config. */
  async dream(opts?: DreamOptions): Promise<void> {
    this.guard();
    if (!this.config.anthropic?.apiKey) {
      throw new Error('Cortex.dream() requires anthropic config');
    }

    const { setEmergenceHandler, runDreamCycleOnce } = require('../features/dream-cycle');

    if (opts?.onEmergence) {
      setEmergenceHandler(opts.onEmergence);
    }

    try {
      await runDreamCycleOnce();
    } finally {
      if (opts?.onEmergence) {
        setEmergenceHandler(null);
      }
    }
  }

  /** Start cron-based dream schedule (6h cycles + daily decay). Requires anthropic config. */
  startDreamSchedule(): void {
    this.guard();
    if (!this.config.anthropic?.apiKey) {
      throw new Error('Dream schedule requires anthropic config');
    }
    const { startDreamCycle } = require('../features/dream-cycle');
    startDreamCycle();
    this.dreamActive = true;
  }

  /** Stop the dream schedule. */
  stopDreamSchedule(): void {
    const { stopDreamCycle } = require('../features/dream-cycle');
    stopDreamCycle();
    this.dreamActive = false;
  }

  /** Score memory importance using LLM (falls back to rules if no anthropic config). */
  async scoreImportance(description: string): Promise<number> {
    const { scoreImportanceWithLLM } = require('../core/memory');
    return scoreImportanceWithLLM(description);
  }

  /** Format memories into context string for LLM prompts. */
  formatContext(memories: Memory[]): string {
    const { formatMemoryContext } = require('../core/memory');
    return formatMemoryContext(memories);
  }

  /** Infer structured concepts from memory content. */
  inferConcepts(summary: string, source: string, tags: string[]): string[] {
    const { inferConcepts } = require('../core/memory');
    return inferConcepts(summary, source, tags);
  }

  /** Listen for memory events. */
  on(event: 'memory:stored', handler: (payload: { importance: number; memoryType: string }) => void): void {
    const { eventBus } = require('../events/event-bus');
    eventBus.on(event, handler);
  }

  /** Verify a memory exists in the on-chain registry by its ID. */
  async verifyOnChain(memoryId: number): Promise<boolean> {
    this.guard();
    const { hydrateMemories } = require('../core/memory');
    const { verifyMemoryOnChain } = require('../core/solana-client');
    const { createHash } = require('crypto');

    const memories = await hydrateMemories([memoryId]);
    if (memories.length === 0) return false;

    const contentHash = createHash('sha256').update(memories[0].content).digest();
    return verifyMemoryOnChain(contentHash);
  }

  /** Clean up resources and stop schedules. */
  destroy(): void {
    this.stopDreamSchedule();
    const { eventBus } = require('../events/event-bus');
    eventBus.removeAllListeners();
  }

  private guard(): void {
    if (!this.initialized) {
      throw new Error('Cortex not initialized. Call await cortex.init() first.');
    }
  }
}
