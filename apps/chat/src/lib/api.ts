import type { ChatModel, Conversation, Message, MemoryStats, MemorySummary, CompoundMarketsResponse, CompoundAccuracy, CompoundTimeline, MarketCategory, MarketDetailResponse, CompoundPredictionsResponse, BYOKProvider } from './types';

const API_BASE = '';

type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: 'auth_expired' }
  | { ok: false; error: 'server'; status: number; message: string };

export class AuthExpiredError extends Error {
  constructor() { super('Session expired'); this.name = 'AuthExpiredError'; }
}

class ChatAPI {
  private cortexKey: string | null = null;
  private authExpiredCallback: (() => void) | null = null;
  private byokKeys: Partial<Record<BYOKProvider, string>> = {};
  private _modelsCache: ChatModel[] = [];

  setKey(key: string | null) {
    this.cortexKey = key;
  }

  onAuthExpired(fn: (() => void) | null) {
    this.authExpiredCallback = fn;
  }

  /** Store a decrypted BYOK key for a provider (null to remove). */
  setBYOKKey(provider: BYOKProvider, key: string | null) {
    if (key) this.byokKeys[provider] = key;
    else delete this.byokKeys[provider];
  }

  /** Remove all BYOK keys from memory. */
  clearBYOKKeys() {
    this.byokKeys = {};
  }

  /** Get the decrypted BYOK key for a provider, if any. */
  getBYOKKey(provider: BYOKProvider): string | undefined {
    return this.byokKeys[provider];
  }

  /** Resolve a BYOK API key for a given model ID (returns undefined for non-BYOK models). */
  private resolveBYOKKey(modelId: string): { key: string; provider: BYOKProvider } | undefined {
    const model = this._modelsCache.find(m => m.id === modelId);
    if (!model?.requiresByok || !model.byokProvider) return undefined;
    const key = this.byokKeys[model.byokProvider];
    if (!key) return undefined;
    return { key, provider: model.byokProvider };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cortexKey) {
      h['Authorization'] = `Bearer ${this.cortexKey}`;
    }
    return h;
  }

  private async request(url: string, init?: RequestInit): Promise<ApiResult<Response>> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      return { ok: false, error: 'server', status: 0, message: 'Network error' };
    }
    if (res.ok) return { ok: true, data: res };
    if (res.status === 401 && this.cortexKey) {
      this.authExpiredCallback?.();
      return { ok: false, error: 'auth_expired' };
    }
    return { ok: false, error: 'server', status: res.status, message: res.statusText };
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const result = await this.request(url, { ...init, headers: { ...this.headers(), ...init?.headers } });
    if (result.ok) return result.data.json();
    if (result.error === 'auth_expired') throw new AuthExpiredError();
    throw new Error(`API error: ${result.status} ${result.message}`);
  }

  private async fetchStream(url: string, init?: RequestInit): Promise<Response> {
    const result = await this.request(url, { ...init, headers: { ...this.headers(), ...init?.headers } });
    if (result.ok) return result.data;
    if (result.error === 'auth_expired') throw new AuthExpiredError();
    throw new Error(`HTTP ${result.status}: ${result.message}`);
  }

  async getModels(): Promise<ChatModel[]> {
    const res = await fetch(`${API_BASE}/api/chat/models`);
    if (!res.ok) throw new Error('Failed to fetch models');
    const models = await res.json();
    this._modelsCache = models;
    return models;
  }

  async autoRegister(privyToken: string, wallet: string): Promise<{ api_key: string; agent_id: string; created: boolean }> {
    const res = await fetch(`${API_BASE}/api/chat/auto-register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${privyToken}` },
      body: JSON.stringify({ wallet }),
    });
    if (!res.ok) throw new Error('Auto-register failed');
    return res.json();
  }

  async sendGuestMessage(content: string, history: Array<{ role: string; content: string }>, onChunk: (text: string) => void, onDone: (remaining?: number) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${API_BASE}/api/chat/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, history }),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await this.readSSE(res, onChunk, (data) => onDone(data?.remaining));
  }

  async createConversation(model?: string): Promise<Conversation> {
    return this.fetchJson(`${API_BASE}/api/chat/conversations`, {
      method: 'POST',
      body: JSON.stringify({ model }),
    });
  }

  async listConversations(limit = 50): Promise<Conversation[]> {
    return this.fetchJson(`${API_BASE}/api/chat/conversations?limit=${limit}`);
  }

  async getConversation(id: string, before?: string): Promise<Conversation & { messages: Message[]; hasMore: boolean }> {
    const url = before
      ? `${API_BASE}/api/chat/conversations/${id}?before=${encodeURIComponent(before)}`
      : `${API_BASE}/api/chat/conversations/${id}`;
    return this.fetchJson(url);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.fetchJson(`${API_BASE}/api/chat/conversations/${id}`, {
      method: 'DELETE',
    });
  }

  async greet(onChunk: (text: string) => void, onDone: (data: any) => void, signal?: AbortSignal): Promise<void> {
    const res = await this.fetchStream(`${API_BASE}/api/chat/greet`, {
      method: 'POST',
      body: JSON.stringify({}),
      signal,
    });
    await this.readSSE(res, onChunk, onDone);
  }

  async sendMessage(conversationId: string, content: string, model: string, onChunk: (text: string) => void, onDone: (data: any) => void, signal?: AbortSignal): Promise<void> {
    const extraHeaders: Record<string, string> = {};
    const byok = this.resolveBYOKKey(model);
    if (byok) {
      extraHeaders['X-BYOK-Key'] = byok.key;
      extraHeaders['X-BYOK-Provider'] = byok.provider;
    }
    const res = await this.fetchStream(`${API_BASE}/api/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: extraHeaders,
      body: JSON.stringify({ content, model }),
      signal,
    });
    await this.readSSE(res, onChunk, onDone);
  }

  async getMemoryStats(): Promise<MemoryStats> {
    return this.fetchJson(`${API_BASE}/api/cortex/stats`);
  }

  async getRecentMemories(limit = 20): Promise<MemorySummary[]> {
    const data = await this.fetchJson<any>(`${API_BASE}/api/cortex/recent?limit=${limit}`);
    return data.memories || data;
  }

  async importMemoryPack(pack: any): Promise<{ imported: number }> {
    return this.fetchJson(`${API_BASE}/api/cortex/packs/import`, {
      method: 'POST',
      body: JSON.stringify({ pack }),
    });
  }

  async getCompoundMarkets(params: {
    source?: 'memory' | 'live';
    category?: MarketCategory;
    limit?: number;
    minVolume?: number;
  } = {}): Promise<CompoundMarketsResponse> {
    const qs = new URLSearchParams();
    if (params.source) qs.set('source', params.source);
    if (params.category) qs.set('category', params.category);
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.minVolume) qs.set('minVolume', String(params.minVolume));
    const res = await fetch(`${API_BASE}/api/compound/markets?${qs}`);
    if (!res.ok) throw new Error('Failed to fetch markets');
    return res.json();
  }

  async getCompoundAccuracy(): Promise<CompoundAccuracy> {
    const res = await fetch(`${API_BASE}/api/compound/accuracy`);
    if (!res.ok) throw new Error('Failed to fetch accuracy');
    return res.json();
  }

  async getCompoundTimeline(params: {
    from?: string;
    to?: string;
    interval?: 'week' | 'month' | 'day';
  } = {}): Promise<CompoundTimeline> {
    const qs = new URLSearchParams();
    if (params.from) qs.set('from', params.from);
    if (params.to) qs.set('to', params.to);
    if (params.interval) qs.set('interval', params.interval);
    const res = await fetch(`${API_BASE}/api/compound/stats/timeline?${qs}`);
    if (!res.ok) throw new Error('Failed to fetch timeline');
    return res.json();
  }

  async getMarketDetail(memoryId: number): Promise<MarketDetailResponse> {
    const res = await fetch(`${API_BASE}/api/compound/markets/${memoryId}`);
    if (!res.ok) throw new Error('Failed to fetch market detail');
    return res.json();
  }

  async getCompoundPredictions(params: {
    category?: MarketCategory;
    limit?: number;
    offset?: number;
    resolved?: boolean;
  } = {}): Promise<CompoundPredictionsResponse> {
    const qs = new URLSearchParams();
    if (params.category) qs.set('category', params.category);
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    if (params.resolved != null) qs.set('resolved', String(params.resolved));
    const res = await fetch(`${API_BASE}/api/compound/predictions?${qs}`);
    if (!res.ok) throw new Error('Failed to fetch predictions');
    return res.json();
  }

  async getBalance(): Promise<{ balance_usdc: number; wallet_address: string; promo?: boolean; promo_credit_usdc?: number }> {
    return this.fetchJson(`${API_BASE}/api/chat/balance`);
  }

  async createTopupIntent(amountUsdc: number, chain: 'solana' | 'base'): Promise<{
    id: string;
    wallet_address: string;
    amount_usdc: number;
    chain: string;
    dest_address: string;
  }> {
    return this.fetchJson(`${API_BASE}/api/chat/topup/intent`, {
      method: 'POST',
      body: JSON.stringify({ amount_usdc: amountUsdc, chain }),
    });
  }

  async confirmTopup(txHash: string, intentId: string): Promise<{ status: string; balance_usdc: number }> {
    return this.fetchJson(`${API_BASE}/api/chat/topup/confirm`, {
      method: 'POST',
      body: JSON.stringify({ tx_hash: txHash, intent_id: intentId }),
    });
  }

  async checkTopupStatus(intentId: string): Promise<{ status: string; amount_usdc?: number; tx_hash?: string; balance_usdc?: number }> {
    return this.fetchJson(`${API_BASE}/api/chat/topup/status/${intentId}`);
  }

  async validateKey(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/api/cortex/stats`, { headers: this.headers() });
      return res.ok;
    } catch {
      return false;
    }
  }

  private async readSSE(res: Response, onChunk: (text: string) => void, onDone: (data?: any) => void): Promise<void> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedContent = false;

    const processLine = (line: string): { stop: boolean; data?: any } => {
      // Skip SSE comments (keepalive pings)
      if (line.startsWith(':')) return { stop: false };
      if (!line.startsWith('data: ')) return { stop: false };
      const raw = line.slice(6);
      if (raw === '[DONE]') return { stop: true };
      try {
        const data = JSON.parse(raw);
        if (data.error) throw new Error(data.error);
        if (data.done) return { stop: true, data };
        if (data.content) { onChunk(data.content); receivedContent = true; }
        if (data.chunk) { onChunk(data.chunk); receivedContent = true; }
      } catch (e) {
        if (e instanceof Error && e.message) throw e;
        /* skip malformed */
      }
      return { stop: false };
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const result = processLine(line);
          if (result.stop) { onDone(result.data); return; }
        }
      }

      // Flush any data remaining in buffer when stream ends without an explicit done event
      for (const line of buffer.split('\n')) {
        const result = processLine(line);
        if (result.stop) { onDone(result.data); return; }
      }

      onDone();
    } catch (e) {
      // Re-throw errors with more context if stream was interrupted mid-content
      if (e instanceof Error && !e.message.includes('interrupted')) throw e;
      throw e;
    }
  }
}

export const api = new ChatAPI();
