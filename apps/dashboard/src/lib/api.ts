import type { Memory, MemoryStats, KnowledgeGraph, MemoryPack, Agent } from '../types/memory';

const API_BASE = import.meta.env.VITE_API_BASE || '';

type ApiMode = 'legacy' | 'cortex';
type RefreshListener = () => void;

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: 'auth_expired' }
  | { ok: false; error: 'server'; status: number; message: string };

export class AuthExpiredError extends Error {
  constructor() { super('Session expired'); this.name = 'AuthExpiredError'; }
}

class CludeAPI {
  private token: string | null = null;
  private agentEndpoint: string = API_BASE;
  private mode: ApiMode = 'legacy';
  private walletAddress: string | null = null;
  private refreshListeners: Set<RefreshListener> = new Set();
  private authExpiredCallback: (() => void) | null = null;

  setToken(token: string) {
    this.token = token;
  }

  onAuthExpired(fn: (() => void) | null) {
    this.authExpiredCallback = fn;
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

  private async request(url: string, init: RequestInit): Promise<ApiResult<Response>> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      return { ok: false, error: 'server', status: 0, message: 'Network error' };
    }
    if (res.ok) return { ok: true, data: res };
    if (res.status === 401) {
      this.authExpiredCallback?.();
      return { ok: false, error: 'auth_expired' };
    }
    return { ok: false, error: 'server', status: res.status, message: res.statusText };
  }

  private async fetch<T>(path: string, opts?: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const result = await this.request(`${this.agentEndpoint}${path}`, {
      ...opts,
      headers: { ...headers, ...opts?.headers },
    });

    if (result.ok) return result.data.json();
    if (result.error === 'auth_expired') throw new AuthExpiredError();
    throw new Error(`API error: ${result.status} ${result.message}`);
  }

  /** Validate a Cortex API key by pinging stats. Bypasses request() to avoid triggering auth expiry. */
  async validateApiKey(): Promise<boolean> {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
      const res = await fetch(`${this.agentEndpoint}/api/cortex/stats`, { headers });
      return res.ok;
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

  // Inference Stats
  async getInferenceStats(): Promise<{
    inference: {
      totalInferenceCalls: number;
      totalTokensProcessed: number;
      callsByFunction: Record<string, number>;
    };
    webSearch: { provider: string | null };
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
    return this.fetch('/api/inference-stats');
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

  // Smart export — AI-synthesized context brief for a specific provider
  async smartExport(name: string, provider: 'chatgpt' | 'claude' | 'gemini' = 'claude'): Promise<{ content: string; memory_count: number; type_breakdown: Record<string, number> }> {
    if (this.mode === 'cortex') {
      return this.fetch('/api/cortex/packs/smart-export', {
        method: 'POST',
        body: JSON.stringify({ name, provider }),
      });
    }
    const url = this.appendWallet('/api/memory-packs/smart-export');
    return this.fetch(url, {
      method: 'POST',
      body: JSON.stringify({ name, provider }),
    });
  }

  // List available packs
  async listMemoryPacks(): Promise<MemoryPack[]> {
    if (this.mode === 'cortex') {
      return [];
    }
    return this.fetch('/api/memory-packs');
  }

  // ── Explore (Memory Graph + Search) ──

  /** Explore agent chat — SSE streaming with two-phase LLM */
  async exploreChat(
    content: string,
    history: Array<{ role: string; content: string }>,
    onChunk: (text: string) => void,
    onRecalled: (ids: number[]) => void,
    onDone: (data: { memory_ids: number[]; clean_content: string }) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const result = await this.request(`${this.agentEndpoint}/api/explore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
      body: JSON.stringify({ content, history, wallet: this.walletAddress }),
      signal,
    });

    if (!result.ok) {
      if (result.error === 'auth_expired') throw new AuthExpiredError();
      throw new Error(`HTTP ${result.status}: ${result.message}`);
    }

    const reader = result.data.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith(':')) continue; // keepalive
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        if (raw === '[DONE]') continue;

        try {
          const data = JSON.parse(raw);
          if (data.error) throw new Error(data.error);
          if (data.recalled_ids) onRecalled(data.recalled_ids);
          if (data.content) onChunk(data.content);
          if (data.done) { onDone(data); return; }
        } catch (e) {
          if (e instanceof Error && e.message) throw e;
        }
      }
    }

    onDone({ memory_ids: [], clean_content: '' });
  }

  /** Wallet-scoped recall for the explore page */
  async exploreSearch(query: string, opts?: { limit?: number; types?: string[] }): Promise<Memory[]> {
    if (this.mode === 'cortex') {
      const result = await this.fetch<any>('/api/cortex/recall', {
        method: 'POST',
        body: JSON.stringify({
          query,
          limit: opts?.limit || 20,
          memory_types: opts?.types,
        }),
      });
      return Array.isArray(result) ? result : (result?.memories || []);
    }
    const result = await this.fetch<any>(this.appendWallet('/api/graph/recall'), {
      method: 'POST',
      body: JSON.stringify({
        query,
        limit: opts?.limit || 20,
        memoryTypes: opts?.types,
        wallet: this.walletAddress,
      }),
    });
    return Array.isArray(result) ? result : (result?.memories || []);
  }

  // ── Memory Graph (3D Visualization) ──

  /** Fetch memories + their links for graph visualization */
  async getMemoryGraph(opts?: { limit?: number }): Promise<{
    nodes: Array<{
      id: number;
      type: string;
      summary: string;
      content: string;
      tags: string[];
      importance: number;
      decay: number;
      valence: number;
      accessCount: number;
      source: string;
      createdAt: string;
    }>;
    links: Array<{ source_id: number; target_id: number; link_type: string; strength: number }>;
    total: number;
  }> {
    const limit = opts?.limit || 50000;
    if (this.mode === 'cortex') {
      return this.fetch(`/api/cortex/brain/graph?limit=${limit}`);
    }
    return this.fetch(this.appendWallet(`/api/graph/memory-graph?limit=${limit}`));
  }

  // ── File Upload / Scene Extraction ──

  /** Check if current wallet has access to file upload feature */
  async checkUploadAccess(): Promise<boolean> {
    try {
      const url = this.appendWallet('/api/upload/check-access');
      const result = await this.fetch<{ allowed: boolean }>(url);
      return result.allowed;
    } catch {
      return false;
    }
  }

  /** Upload a file for node extraction → memory ingestion */
  async uploadFile(file: File, title: string): Promise<{ batch_id: string; status: string; file_name: string; document_title: string }> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    if (this.walletAddress) formData.append('wallet', this.walletAddress);

    const headers: Record<string, string> = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const result = await this.request(`${this.agentEndpoint}${this.appendWallet('/api/upload/process')}`, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!result.ok) {
      if (result.error === 'auth_expired') throw new AuthExpiredError();
      throw new Error(`Upload failed (HTTP ${result.status})`);
    }

    return result.data.json();
  }

  /** List upload batches */
  async listUploadBatches(): Promise<{ batches: Array<{
    batch_id: string;
    document_title: string;
    file_name: string;
    status: string;
    total_nodes: number;
    total_chunks: number;
    chunks_completed: number;
    chunks_failed: number;
    chunks_pending: number;
    chunks_processing: number;
    created_at: string;
    error_message?: string;
  }> }> {
    return this.fetch(this.appendWallet('/api/upload/batches'));
  }

  /** Get batch detail with memories */
  async getUploadBatch(batchId: string): Promise<{
    batch_id: string;
    document_title: string;
    file_name: string;
    status: string;
    chunks: Array<{ chunk_index: number; status: string; parsed_node_count: number; raw_response: string; error_message?: string }>;
    total_nodes: number;
    memories: Array<{ id: number; summary: string; tags: string[]; importance: number; created_at: string; metadata: any }>;
  }> {
    return this.fetch(this.appendWallet(`/api/upload/batch/${batchId}`));
  }

  // List agents (scoped to current user's wallet or API key)
  async listAgents(): Promise<Agent[]> {
    try {
      if (this.mode === 'cortex') {
        // Cortex mode: derive agent info from the authenticated key's stats
        const stats = await this.fetch<any>('/api/cortex/stats');
        if (stats?.agent_id) {
          return [{
            id: stats.agent_id,
            name: stats.agent_name || stats.agent_id,
            wallet_address: stats.owner_wallet || null,
            created_at: stats.registered_at || new Date().toISOString(),
            last_active: stats.last_used || null,
            memory_count: stats.total_memories || 0,
          }];
        }
        return [];
      }
      const url = this.appendWallet('/api/dashboard/agents');
      const result = await this.fetch<any>(url);
      return Array.isArray(result) ? result : (result?.agents || []);
    } catch {
      return [];
    }
  }
}

export const api = new CludeAPI();
