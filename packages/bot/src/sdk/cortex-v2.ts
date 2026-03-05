/**
 * CLUDE Cortex v2 — The Integration Layer
 * 
 * Extends the existing Cortex SDK with:
 * - Cognitive model router (right model for the right task)
 * - Memory Packs (portable memory bundles for cross-agent sharing)
 * - Multi-backend support (local SQLite → Supabase → custom)
 * - Privacy controls (Venice integration, selective sharing)
 * - Token metering hooks ($CLUDE gas tracking)
 * 
 * The 5 P's: Private, Portable, Permissionless, Poly-model, Persistent
 */

import { Cortex } from './cortex';
import type { CortexConfig, Memory, RecallOptions, StoreMemoryOptions, MemoryType } from './types';

// ── Cognitive Function Router ────────────────────────────

export type CognitiveFunction = 
  | 'embed'        // Generate embeddings
  | 'recall'       // Memory retrieval + scoring
  | 'store'        // Memory ingestion + classification
  | 'consolidate'  // Dream cycle Phase I
  | 'reflect'      // Dream cycle Phase II (self-model)
  | 'emerge'       // Dream cycle Phase III (creative)
  | 'classify'     // Memory type / importance classification
  | 'summarize'    // Content summarization
  | 'search'       // Web/external search
  ;

export interface ModelRoute {
  provider: string;  // 'venice' | 'anthropic' | 'openai' | 'local'
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface RouterConfig {
  routes: Partial<Record<CognitiveFunction, ModelRoute>>;
  fallback: ModelRoute;
}

const DEFAULT_ROUTES: RouterConfig = {
  routes: {
    embed: { provider: 'voyage', model: 'voyage-4-large' },
    consolidate: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    reflect: { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
    emerge: { provider: 'venice', model: 'qwen-2.5-coder-32b' },
    classify: { provider: 'venice', model: 'llama-3.2-3b' },
    summarize: { provider: 'venice', model: 'llama-3.2-3b' },
  },
  fallback: { provider: 'venice', model: 'llama-3.3-70b' },
};

// ── Memory Packs ─────────────────────────────────────────

export interface MemoryPack {
  id: string;
  name: string;
  description: string;
  memories: PackedMemory[];
  created_at: string;
  created_by: string;      // wallet address
  signature?: string;      // Solana signature for verification
  format_version: number;
}

export interface PackedMemory {
  content: string;
  summary: string;
  type: MemoryType;
  importance: number;
  tags: string[];
  concepts: string[];
  created_at: string;
}

// ── Privacy Controls ─────────────────────────────────────

export type PrivacyLevel = 'private' | 'shared' | 'public';

export interface PrivacyPolicy {
  /** Default privacy for new memories */
  default: PrivacyLevel;
  /** Types that are always private regardless of default */
  alwaysPrivate: MemoryType[];
  /** Whether to use Venice (private inference) for all LLM calls */
  veniceOnly: boolean;
  /** Whether to encrypt memories at rest */
  encryptAtRest: boolean;
}

const DEFAULT_PRIVACY: PrivacyPolicy = {
  default: 'private',
  alwaysPrivate: ['self_model'],
  veniceOnly: false,
  encryptAtRest: false,
};

// ── Token Metering ───────────────────────────────────────

export interface MeteringEvent {
  operation: 'store' | 'recall' | 'dream' | 'export' | 'import';
  tokens_used: number;
  memory_count: number;
  timestamp: string;
}

export type MeteringHandler = (event: MeteringEvent) => void | Promise<void>;

// ── CortexV2 ────────────────────────────────────────────

export interface CortexV2Config extends CortexConfig {
  /** Cognitive model router configuration */
  router?: Partial<RouterConfig>;
  /** Privacy policy */
  privacy?: Partial<PrivacyPolicy>;
  /** Token metering callback (for $CLUDE gas tracking) */
  onMeter?: MeteringHandler;
}

export class CortexV2 extends Cortex {
  private router: RouterConfig;
  private privacy: PrivacyPolicy;
  private onMeter: MeteringHandler | null;
  private meterLog: MeteringEvent[] = [];

  constructor(config: CortexV2Config) {
    super(config);
    this.router = {
      routes: { ...DEFAULT_ROUTES.routes, ...config.router?.routes },
      fallback: config.router?.fallback || DEFAULT_ROUTES.fallback,
    };
    this.privacy = { ...DEFAULT_PRIVACY, ...config.privacy };
    this.onMeter = config.onMeter || null;
  }

  // ── Model Router ─────────────────────────────────────

  /** Get the configured model for a cognitive function */
  getRoute(fn: CognitiveFunction): ModelRoute {
    return this.router.routes[fn] || this.router.fallback;
  }

  /** Update a route at runtime */
  setRoute(fn: CognitiveFunction, route: ModelRoute): void {
    this.router.routes[fn] = route;
  }

  // ── Memory Packs ─────────────────────────────────────

  /** Export selected memories as a portable pack */
  async exportPack(opts: {
    name: string;
    description: string;
    memoryIds?: number[];
    types?: MemoryType[];
    query?: string;
    limit?: number;
  }): Promise<MemoryPack> {
    let memories: Memory[];

    if (opts.memoryIds) {
      memories = await this.hydrate(opts.memoryIds);
    } else {
      memories = await this.recall({
        query: opts.query,
        memoryTypes: opts.types,
        limit: opts.limit || 50,
      });
    }

    // Filter by privacy - never export private memories unless explicitly selected by ID
    if (!opts.memoryIds) {
      memories = memories.filter(m => {
        if (this.privacy.alwaysPrivate.includes(m.memory_type)) return false;
        return true;
      });
    }

    const pack: MemoryPack = {
      id: crypto.randomUUID(),
      name: opts.name,
      description: opts.description,
      memories: memories.map(m => ({
        content: m.content,
        summary: m.summary,
        type: m.memory_type,
        importance: m.importance,
        tags: m.tags || [],
        concepts: m.concepts || [],
        created_at: m.created_at,
      })),
      created_at: new Date().toISOString(),
      created_by: '', // Would be filled by wallet
      format_version: 1,
    };

    await this.meter({ operation: 'export', tokens_used: 0, memory_count: pack.memories.length });
    return pack;
  }

  /** Import a memory pack into this agent's memory */
  async importPack(pack: MemoryPack, opts?: {
    /** Override importance for imported memories */
    importanceMultiplier?: number;
    /** Prefix for imported memory tags */
    tagPrefix?: string;
    /** Only import specific types */
    types?: MemoryType[];
  }): Promise<{ imported: number; skipped: number }> {
    let imported = 0;
    let skipped = 0;

    for (const mem of pack.memories) {
      if (opts?.types && !opts.types.includes(mem.type)) {
        skipped++;
        continue;
      }

      const importance = mem.importance * (opts?.importanceMultiplier ?? 0.8);
      const tags = opts?.tagPrefix 
        ? [...mem.tags, `${opts.tagPrefix}:${pack.name}`]
        : [...mem.tags, `pack:${pack.name}`];

      await this.store({
        content: mem.content,
        summary: mem.summary,
        type: mem.type,
        importance,
        tags,
        source: `pack:${pack.id}`,
      });
      imported++;
    }

    await this.meter({ operation: 'import', tokens_used: 0, memory_count: imported });
    return { imported, skipped };
  }

  /** Serialize a pack to JSON string */
  serializePack(pack: MemoryPack): string {
    return JSON.stringify(pack, null, 2);
  }

  /** Serialize a pack to Markdown (human-readable) */
  serializePackMarkdown(pack: MemoryPack): string {
    const lines: string[] = [
      `# Memory Pack: ${pack.name}`,
      '',
      `> ${pack.description}`,
      '',
      `- **Created**: ${pack.created_at}`,
      `- **Memories**: ${pack.memories.length}`,
      `- **Format**: v${pack.format_version}`,
      '',
      '---',
      '',
    ];

    for (const mem of pack.memories) {
      lines.push(`## [${mem.type}] ${mem.summary}`);
      lines.push('');
      lines.push(mem.content);
      lines.push('');
      if (mem.tags.length) lines.push(`Tags: ${mem.tags.join(', ')}`);
      lines.push(`Importance: ${mem.importance.toFixed(2)}`);
      lines.push('');
      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  /** Parse a pack from JSON string */
  parsePack(json: string): MemoryPack {
    const pack = JSON.parse(json) as MemoryPack;
    if (!pack.format_version || !pack.memories) {
      throw new Error('Invalid memory pack format');
    }
    return pack;
  }

  // ── Privacy ──────────────────────────────────────────

  /** Get current privacy policy */
  getPrivacyPolicy(): PrivacyPolicy {
    return { ...this.privacy };
  }

  /** Update privacy policy */
  setPrivacyPolicy(policy: Partial<PrivacyPolicy>): void {
    Object.assign(this.privacy, policy);
  }

  // ── Metering ─────────────────────────────────────────

  /** Get all metering events */
  getMeterLog(): MeteringEvent[] {
    return [...this.meterLog];
  }

  /** Get total operations by type */
  getMeterSummary(): Record<string, { count: number; totalMemories: number }> {
    const summary: Record<string, { count: number; totalMemories: number }> = {};
    for (const event of this.meterLog) {
      if (!summary[event.operation]) {
        summary[event.operation] = { count: 0, totalMemories: 0 };
      }
      summary[event.operation].count++;
      summary[event.operation].totalMemories += event.memory_count;
    }
    return summary;
  }

  private async meter(event: Omit<MeteringEvent, 'timestamp'>): Promise<void> {
    const full: MeteringEvent = { ...event, timestamp: new Date().toISOString() };
    this.meterLog.push(full);
    if (this.onMeter) {
      try { await this.onMeter(full); } catch { /* metering should never break the flow */ }
    }
  }
}
