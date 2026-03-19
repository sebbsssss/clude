import type { Memory, MemoryStats, KnowledgeGraph, MemoryPack, Agent } from '../types/memory';

const API_BASE = import.meta.env.VITE_API_BASE || '';

type ApiMode = 'legacy' | 'cortex';
type RefreshListener = () => void;

class CludeAPI {
  private token: string | null = null;
  private agentEndpoint: string = API_BASE;
  private mode: ApiMode = 'legacy';
  private walletAddress: string | null = null;
  private refreshListeners: Set<RefreshListener> = new Set();

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

  setWalletAddress(wallet: string | null) {
    this.walletAddress = wallet;
  }

  /** Append wallet param to legacy endpoints for owner scoping */
  private appendWallet(url: string): string {
    if (this.mode !== 'legacy' || !this.walletAddress) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}wallet=${encodeURIComponent(this.walletAddress)}`;
  }

  /** Register a listener that fires when auth changes and data should be re-fetched. */
  onRefresh(listener: RefreshListener): () => void {
    this.refreshListeners.add(listener);
    return () => { this.refreshListeners.delete(listener); };
  }

  /** Signal all components to clear cached data and re-fetch. */
  emitRefresh() {
    this.refreshListeners.forEach(fn => fn());
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

  /**
   * Verify that the API response is scoped to the current user.
   * Returns true if scoped_to is present (data is user-specific),
   * or if we're in cortex mode (always scoped by API key).
   * Returns false if data is unscoped (global).
   */
  verifyScope(response: any): boolean {
    if (this.mode === 'cortex') return true;
    // In legacy mode, the server returns scoped_to when ?wallet= is provided.
    // Check scoped_to first — it's the authoritative signal that data is user-specific.
    if (response?.scoped_to != null) return true;
    return false;
  }

  // Memory Stats
  async getStats(): Promise<MemoryStats & { scoped_to?: string | null }> {
    if (this.mode === 'cortex') {
      return this.fetch('/api/cortex/stats');
    }
    return this.fetch(this.appendWallet('/api/memory-stats'));
  }

  // Recent Memories
  async getMemories(opts?: { hours?: number; limit?: number }): Promise<{ memories: Memory[]; scoped_to?: string | null }> {
    const params = new URLSearchParams();
    if (opts?.hours) params.set('hours', String(opts.hours));
    if (opts?.limit) params.set('limit', String(opts.limit));

    if (this.mode === 'cortex') {
      const result = await this.fetch<any>(`/api/cortex/recent?${params}`);
      const memories = Array.isArray(result) ? result : (result?.memories || []);
      return { memories, scoped_to: 'cortex' };
    }
    const result = await this.fetch<any>(this.appendWallet(`/api/memories?${params}`));
    const memories = Array.isArray(result) ? result : (result?.memories || []);
    return { memories, scoped_to: result?.scoped_to ?? null };
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
        this.fetch<any>('/api/cortex/self-model'),
        this.fetch<MemoryStats>('/api/cortex/stats'),
      ]);
      const selfMems = Array.isArray(selfModelResult) ? selfModelResult : (selfModelResult?.memories || []);
      return {
        memories: selfMems,
        consciousness: {
          selfModel: selfMems,
          recentDreams: [],
          stats,
        },
      };
    }
    const [memories, consciousness] = await Promise.all([
      this.fetch<any>(this.appendWallet('/api/brain?hours=168&limit=50')),
      this.fetch<any>(this.appendWallet('/api/brain/consciousness')),
    ]);
    const memArr = Array.isArray(memories) ? memories : (memories?.memories || []);
    return { memories: memArr, consciousness: consciousness || { selfModel: [], recentDreams: [], stats: null } };
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
    return this.fetch(this.appendWallet(`/api/graph?${params}`));
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
    return this.fetch(this.appendWallet('/api/graph/stats'));
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
      const result = await this.fetch<any>(
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
      return Array.isArray(result) ? result : (result?.memories || []);
    }
    const result = await this.fetch<any>('/api/demo/recall', {
      method: 'POST',
      body: JSON.stringify({
        query,
        limit: opts?.limit || 10,
        memoryTypes: opts?.types,
      }),
    });
    return Array.isArray(result) ? result : (result?.memories || []);
  }

  // Export Memory Pack (works in both cortex and legacy mode)
  async exportMemoryPack(opts: {
    name: string;
    description: string;
    memoryIds?: number[];
    entityIds?: number[];
    tags?: string[];
    types?: string[];
  }): Promise<MemoryPack> {
    if (this.mode === 'cortex') {
      // Use cortex pack export endpoint — no limit, server paginates
      const result = await this.fetch<any>('/api/cortex/packs/export', {
        method: 'POST',
        body: JSON.stringify({
          name: opts.name,
          description: opts.description,
          memory_ids: opts.memoryIds,
          types: opts.types,
        }),
      });
      // Normalize cortex response to MemoryPack shape
      return {
        ...result,
        memories: (result.memories || []).map((m: any) => ({
          ...m,
          memory_type: m.type || m.memory_type,
        })),
      };
    }
    const url = this.appendWallet('/api/memory-packs/export');
    return this.fetch(url, {
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

  // List agents (scoped to current user's wallet or API key)
  async listAgents(): Promise<Agent[]> {
    try {
      const url = this.appendWallet('/api/dashboard/agents');
      const result = await this.fetch<any>(url);
      return Array.isArray(result) ? result : (result?.agents || []);
    } catch {
      return [];
    }
  }
}

export const api = new CludeAPI();
