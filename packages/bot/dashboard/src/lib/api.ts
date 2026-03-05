import type { Memory, MemoryStats, Entity, KnowledgeGraph, MemoryPack } from '../types/memory';

const API_BASE = import.meta.env.VITE_API_BASE || 'https://clude.io';

type ApiMode = 'legacy' | 'cortex';

class CludeAPI {
  private token: string | null = null;
  private agentEndpoint: string = API_BASE;
  private mode: ApiMode = 'legacy';

  setToken(token: string) {
    this.token = token;
  }

  setAgentEndpoint(endpoint: string) {
    this.agentEndpoint = endpoint;
  }

  setMode(mode: ApiMode) {
    this.mode = mode;
  }

  getMode(): ApiMode {
    return this.mode;
  }

  private async fetch<T>(path: string, opts?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const res = await fetch(`${this.agentEndpoint}${path}`, {
      ...opts,
      headers: { ...headers, ...opts?.headers },
    });

    if (!res.ok) {
      throw new Error(`API error: ${res.status} ${res.statusText}`);
    }

    return res.json();
  }

  /** Validate a Cortex API key by pinging stats. */
  async validateApiKey(): Promise<boolean> {
    try {
      await this.fetch('/api/cortex/stats');
      return true;
    } catch {
      return false;
    }
  }

  // Memory Stats
  async getStats(): Promise<MemoryStats> {
    if (this.mode === 'cortex') {
      return this.fetch('/api/cortex/stats');
    }
    return this.fetch('/api/memory-stats');
  }

  // Recent Memories
  async getMemories(opts?: { hours?: number; limit?: number }): Promise<Memory[]> {
    if (this.mode === 'cortex') {
      const params = new URLSearchParams();
      if (opts?.hours) params.set('hours', String(opts.hours));
      if (opts?.limit) params.set('limit', String(opts.limit));
      const result = await this.fetch<{ memories: Memory[]; count: number }>(
        `/api/cortex/recent?${params}`,
      );
      return result.memories;
    }
    const params = new URLSearchParams();
    if (opts?.hours) params.set('hours', String(opts.hours));
    if (opts?.limit) params.set('limit', String(opts.limit));
    return this.fetch(`/api/memories?${params}`);
  }

  // Brain / Consciousness
  async getBrain(): Promise<{
    memories: Memory[];
    consciousness: {
      selfModel: Memory[];
      recentDreams: any[];
      stats: MemoryStats;
    };
  }> {
    if (this.mode === 'cortex') {
      const [selfModelResult, stats] = await Promise.all([
        this.fetch<{ memories: Memory[] }>('/api/cortex/self-model'),
        this.fetch<MemoryStats>('/api/cortex/stats'),
      ]);
      return {
        memories: selfModelResult.memories,
        consciousness: {
          selfModel: selfModelResult.memories,
          recentDreams: [], // Not available in cortex mode
          stats,
        },
      };
    }
    const [memories, consciousness] = await Promise.all([
      this.fetch<Memory[]>('/api/brain?hours=168&limit=50'),
      this.fetch('/api/brain/consciousness'),
    ]);
    return { memories, consciousness: consciousness as any };
  }

  // Knowledge Graph
  async getKnowledgeGraph(opts?: {
    includeMemories?: boolean;
    minMentions?: number;
  }): Promise<KnowledgeGraph> {
    if (this.mode === 'cortex') {
      return { nodes: [], edges: [] };
    }
    const params = new URLSearchParams();
    if (opts?.includeMemories) params.set('includeMemories', 'true');
    if (opts?.minMentions) params.set('minMentions', String(opts.minMentions));
    return this.fetch(`/api/graph?${params}`);
  }

  // Graph Stats
  async getGraphStats(): Promise<{
    entityCount: number;
    relationCount: number;
    mentionCount: number;
    topEntities: Array<{ name: string; type: string; mentions: number }>;
  }> {
    if (this.mode === 'cortex') {
      return { entityCount: 0, relationCount: 0, mentionCount: 0, topEntities: [] };
    }
    return this.fetch('/api/graph/stats');
  }

  // Venice Stats
  async getVeniceStats(): Promise<{
    venice: {
      totalInferenceCalls: number;
      totalTokensProcessed: number;
      callsByFunction: Record<string, number>;
    };
    decentralization: {
      inference: string;
      memory: string;
      totalMemoriesOnChain: number;
      embeddedCount: number;
    };
  } | null> {
    if (this.mode === 'cortex') {
      return null;
    }
    return this.fetch('/api/venice-stats');
  }

  // Memory Recall
  async recall(query: string, opts?: { limit?: number; types?: string[] }): Promise<Memory[]> {
    if (this.mode === 'cortex') {
      const result = await this.fetch<{ memories: Memory[]; count: number }>(
        '/api/cortex/recall',
        {
          method: 'POST',
          body: JSON.stringify({
            query,
            limit: opts?.limit || 10,
            memory_types: opts?.types,
          }),
        },
      );
      return result.memories;
    }
    return this.fetch('/api/demo/recall', {
      method: 'POST',
      body: JSON.stringify({
        query,
        limit: opts?.limit || 10,
        memoryTypes: opts?.types,
      }),
    });
  }

  // Export Memory Pack
  async exportMemoryPack(opts: {
    name: string;
    description: string;
    memoryIds?: number[];
    entityIds?: number[];
    tags?: string[];
    types?: string[];
  }): Promise<MemoryPack> {
    if (this.mode === 'cortex') {
      throw new Error('Memory packs require self-hosted mode');
    }
    return this.fetch('/api/memory-packs/export', {
      method: 'POST',
      body: JSON.stringify(opts),
    });
  }

  // Import Memory Pack
  async importMemoryPack(pack: MemoryPack): Promise<{ imported: number }> {
    if (this.mode === 'cortex') {
      throw new Error('Memory packs require self-hosted mode');
    }
    return this.fetch('/api/memory-packs/import', {
      method: 'POST',
      body: JSON.stringify(pack),
    });
  }

  // List available packs
  async listMemoryPacks(): Promise<MemoryPack[]> {
    if (this.mode === 'cortex') {
      return [];
    }
    return this.fetch('/api/memory-packs');
  }
}

export const api = new CludeAPI();
