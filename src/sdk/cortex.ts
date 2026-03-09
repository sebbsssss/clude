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
import { HttpTransport } from './http-transport';

export class Cortex {
  private db: SupabaseClient | null = null;
  private http: HttpTransport | null = null;
  private hostedMode: boolean;
  private initialized = false;
  private dreamActive = false;

  constructor(private config: CortexConfig) {
    if (config.hosted) {
      // Hosted mode — all calls go through HTTP API
      if (!config.hosted.apiKey) {
        throw new Error('Cortex hosted mode requires an API key');
      }
      this.hostedMode = true;
      this.http = new HttpTransport(config.hosted);
    } else if (config.supabase?.url && config.supabase?.serviceKey) {
      // Self-hosted mode (existing behavior)
      this.hostedMode = false;
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
    } else {
      throw new Error('Cortex requires either hosted config or supabase config');
    }
  }

  /** Initialize database schema, encryption, and on-chain registry. Call before store/recall. */
  async init(): Promise<void> {
    if (this.hostedMode) {
      // Verify API key is valid by pinging stats
      try {
        await this.http!.get('/api/cortex/stats');
      } catch (err) {
        throw new Error(`Cortex hosted init failed — check your API key. ${(err as Error).message}`);
      }
      this.initialized = true;
      return;
    }

    // Self-hosted: run DB migrations
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
    if (this.hostedMode) {
      const result = await this.http!.post<{ stored: boolean; memory_id: number | null }>(
        '/api/cortex/store',
        {
          content: opts.content,
          summary: opts.summary,
          type: opts.type,
          tags: opts.tags,
          concepts: opts.concepts,
          importance: opts.importance,
          emotional_valence: opts.emotionalValence,
          source: opts.source,
          source_id: opts.sourceId,
          metadata: opts.metadata,
        },
      );
      return result.memory_id;
    }
    const { storeMemory } = require('../core/memory');
    return storeMemory(opts);
  }

  /** Recall memories with hybrid vector + keyword + graph scoring. */
  async recall(opts: RecallOptions = {}): Promise<Memory[]> {
    this.guard();
    if (this.hostedMode) {
      const result = await this.http!.post<{ memories: Memory[]; count: number }>(
        '/api/cortex/recall',
        {
          query: opts.query,
          tags: opts.tags,
          memory_types: opts.memoryTypes,
          limit: opts.limit,
          min_importance: opts.minImportance,
          min_decay: opts.minDecay,
        },
      );
      return result.memories;
    }
    const { recallMemories } = require('../core/memory');
    return recallMemories(opts);
  }

  /** Recall lightweight summaries (progressive disclosure). */
  async recallSummaries(opts: RecallOptions = {}): Promise<MemorySummary[]> {
    this.guard();
    if (this.hostedMode) {
      const result = await this.http!.post<{ summaries: MemorySummary[]; count: number }>(
        '/api/cortex/recall/summaries',
        {
          query: opts.query,
          tags: opts.tags,
          memory_types: opts.memoryTypes,
          limit: opts.limit,
          min_importance: opts.minImportance,
          min_decay: opts.minDecay,
        },
      );
      return result.summaries;
    }
    const { recallMemorySummaries } = require('../core/memory');
    return recallMemorySummaries(opts);
  }

  /** Hydrate full memory content for specific IDs. */
  async hydrate(ids: number[]): Promise<Memory[]> {
    this.guard();
    if (this.hostedMode) {
      const result = await this.http!.post<{ memories: Memory[] }>(
        '/api/cortex/hydrate',
        { ids },
      );
      return result.memories;
    }
    const { hydrateMemories } = require('../core/memory');
    return hydrateMemories(ids);
  }

  /** Apply type-specific memory decay. Self-hosted only. */
  async decay(): Promise<number> {
    this.guard();
    this.requireSelfHosted('decay');
    const { decayMemories } = require('../core/memory');
    return decayMemories();
  }

  /** Get memory system statistics. */
  async stats(): Promise<MemoryStats> {
    this.guard();
    if (this.hostedMode) {
      return this.http!.get<MemoryStats>('/api/cortex/stats');
    }
    const { getMemoryStats } = require('../core/memory');
    return getMemoryStats();
  }

  /** Get recent memories from the last N hours. */
  async recent(hours: number, types?: MemoryType[], limit?: number): Promise<Memory[]> {
    this.guard();
    if (this.hostedMode) {
      const result = await this.http!.get<{ memories: Memory[]; count: number }>(
        '/api/cortex/recent',
        {
          hours: String(hours),
          types: types?.join(','),
          limit: limit ? String(limit) : undefined,
        },
      );
      return result.memories;
    }
    const { getRecentMemories } = require('../core/memory');
    return getRecentMemories(hours, types, limit);
  }

  /** Get current self-model memories. */
  async selfModel(): Promise<Memory[]> {
    this.guard();
    if (this.hostedMode) {
      const result = await this.http!.get<{ memories: Memory[] }>('/api/cortex/self-model');
      return result.memories;
    }
    const { getSelfModel } = require('../core/memory');
    return getSelfModel();
  }

  /** Create a typed link between two memories. */
  async link(sourceId: number, targetId: number, type: MemoryLinkType, strength?: number): Promise<void> {
    this.guard();
    if (this.hostedMode) {
      await this.http!.post('/api/cortex/link', {
        source_id: sourceId,
        target_id: targetId,
        link_type: type,
        strength,
      });
      return;
    }
    const { createMemoryLink } = require('../core/memory');
    return createMemoryLink(sourceId, targetId, type, strength);
  }

  /** Run one full dream cycle. Self-hosted only — requires anthropic config. */
  async dream(opts?: DreamOptions): Promise<void> {
    this.guard();
    this.requireSelfHosted('dream');
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

  /** Start cron-based dream schedule. Self-hosted only — requires anthropic config. */
  startDreamSchedule(): void {
    this.guard();
    this.requireSelfHosted('startDreamSchedule');
    if (!this.config.anthropic?.apiKey) {
      throw new Error('Dream schedule requires anthropic config');
    }
    const { startDreamCycle } = require('../features/dream-cycle');
    startDreamCycle();
    this.dreamActive = true;
  }

  /** Stop the dream schedule. */
  stopDreamSchedule(): void {
    if (this.hostedMode) return; // no-op in hosted mode
    const { stopDreamCycle } = require('../features/dream-cycle');
    stopDreamCycle();
    this.dreamActive = false;
  }

  /** Run a single active reflection (meditation) session. Self-hosted only. */
  async reflect(opts?: { onReflection?: (journal: any) => Promise<void> }): Promise<any> {
    this.requireSelfHosted('reflect');
    if (!this.config.anthropic?.apiKey) {
      throw new Error('Cortex.reflect() requires anthropic config');
    }

    const { setReflectionHandler, runReflectionOnce } = require('../features/active-reflection');

    if (opts?.onReflection) {
      setReflectionHandler(opts.onReflection);
    }

    try {
      return await runReflectionOnce();
    } finally {
      if (opts?.onReflection) {
        setReflectionHandler(null);
      }
    }
  }

  /** Start the active reflection (meditation) schedule. Self-hosted only. */
  startReflectionSchedule(): void {
    this.guard();
    this.requireSelfHosted('startReflectionSchedule');
    if (!this.config.anthropic?.apiKey) {
      throw new Error('Reflection schedule requires anthropic config');
    }
    const { startActiveReflection } = require('../features/active-reflection');
    startActiveReflection();
  }

  /** Stop the active reflection schedule. */
  stopReflectionSchedule(): void {
    if (this.hostedMode) return;
    const { stopActiveReflection } = require('../features/active-reflection');
    stopActiveReflection();
  }

  /** Score memory importance using LLM. Self-hosted only. */
  async scoreImportance(description: string): Promise<number> {
    this.requireSelfHosted('scoreImportance');
    const { scoreImportanceWithLLM } = require('../core/memory');
    return scoreImportanceWithLLM(description);
  }

  /** Format memories into context string for LLM prompts. Works in both modes. */
  formatContext(memories: Memory[]): string {
    const { formatMemoryContext } = require('../core/memory');
    return formatMemoryContext(memories);
  }

  /** Infer structured concepts from memory content. Works in both modes. */
  inferConcepts(summary: string, source: string, tags: string[]): string[] {
    const { inferConcepts } = require('../core/memory');
    return inferConcepts(summary, source, tags);
  }

  /** Listen for memory events. Self-hosted only. */
  on(event: 'memory:stored', handler: (payload: { importance: number; memoryType: string }) => void): void {
    if (this.hostedMode) {
      throw new Error('Event listeners are not available in hosted mode');
    }
    const { eventBus } = require('../events/event-bus');
    eventBus.on(event, handler);
  }

  /** Verify a memory exists in the on-chain registry by its ID. Self-hosted only. */
  async verifyOnChain(memoryId: number): Promise<boolean> {
    this.guard();
    this.requireSelfHosted('verifyOnChain');
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
    if (!this.hostedMode) {
      this.stopDreamSchedule();
      const { eventBus } = require('../events/event-bus');
      eventBus.removeAllListeners();
    }
    this.http = null;
  }

  private guard(): void {
    if (!this.initialized) {
      throw new Error('Cortex not initialized. Call await cortex.init() first.');
    }
  }

  private requireSelfHosted(method: string): void {
    if (this.hostedMode) {
      throw new Error(`Cortex.${method}() is not available in hosted mode. Use self-hosted mode.`);
    }
  }
}
