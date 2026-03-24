import type { ChatModel, Conversation, Message, MemoryStats, MemorySummary, CompoundMarketsResponse, CompoundAccuracy, CompoundTimeline, MarketCategory, MarketDetailResponse, CompoundPredictionsResponse } from './types';

const API_BASE = '';

class ChatAPI {
  private cortexKey: string | null = null;
  private modelsCache: ChatModel[] | null = null;

  setKey(key: string | null) {
    this.cortexKey = key;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.cortexKey) {
      h['Authorization'] = `Bearer ${this.cortexKey}`;
    }
    return h;
  }

  async getModels(): Promise<ChatModel[]> {
    if (this.modelsCache) return this.modelsCache;
    const res = await fetch(`${API_BASE}/api/chat/models`);
    if (!res.ok) throw new Error('Failed to fetch models');
    const models = await res.json();
    this.modelsCache = models;
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
    const res = await fetch(`${API_BASE}/api/chat/conversations`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `Failed to create conversation (HTTP ${res.status})`);
    }
    return res.json();
  }

  async listConversations(limit = 50): Promise<Conversation[]> {
    const res = await fetch(`${API_BASE}/api/chat/conversations?limit=${limit}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Failed to list conversations');
    return res.json();
  }

  async getConversation(id: string, before?: string): Promise<Conversation & { messages: Message[]; hasMore: boolean }> {
    const url = before
      ? `${API_BASE}/api/chat/conversations/${id}?before=${encodeURIComponent(before)}`
      : `${API_BASE}/api/chat/conversations/${id}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) throw new Error('Failed to get conversation');
    return res.json();
  }

  async deleteConversation(id: string): Promise<void> {
    const res = await fetch(`${API_BASE}/api/chat/conversations/${id}`, {
      method: 'DELETE',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error('Failed to delete conversation');
  }

  async greet(onChunk: (text: string) => void, onDone: (data: any) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${API_BASE}/api/chat/greet`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({}),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Greeting failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await this.readSSE(res, onChunk, onDone);
  }

  async sendMessage(conversationId: string, content: string, model: string, onChunk: (text: string) => void, onDone: (data: any) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${API_BASE}/api/chat/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ content, model }),
      signal,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    await this.readSSE(res, onChunk, onDone);
  }

  async getMemoryStats(): Promise<MemoryStats> {
    const res = await fetch(`${API_BASE}/api/cortex/stats`, { headers: this.headers() });
    if (!res.ok) throw new Error('Failed to fetch memory stats');
    return res.json();
  }

  async getRecentMemories(limit = 20): Promise<MemorySummary[]> {
    const res = await fetch(`${API_BASE}/api/cortex/recent?limit=${limit}`, { headers: this.headers() });
    if (!res.ok) throw new Error('Failed to fetch recent memories');
    const data = await res.json();
    return data.memories || data;
  }

  async importMemoryPack(pack: any): Promise<{ imported: number }> {
    const res = await fetch(`${API_BASE}/api/cortex/packs/import`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ pack }),
    });
    if (!res.ok) throw new Error('Failed to import memory pack');
    return res.json();
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
    const res = await fetch(`${API_BASE}/api/chat/balance`, { headers: this.headers() });
    if (!res.ok) throw new Error(`Failed to fetch balance (HTTP ${res.status})`);
    return res.json();
  }

  async createTopupIntent(amountUsdc: number, chain: 'solana' | 'base'): Promise<{
    id: string;
    wallet_address: string;
    amount_usdc: number;
    chain: string;
    dest_address: string;
  }> {
    const res = await fetch(`${API_BASE}/api/chat/topup/intent`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ amount_usdc: amountUsdc, chain }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `Failed to create top-up intent (HTTP ${res.status})`);
    }
    return res.json();
  }

  async confirmTopup(txHash: string, intentId: string): Promise<{ status: string; balance_usdc: number }> {
    const res = await fetch(`${API_BASE}/api/chat/topup/confirm`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ tx_hash: txHash, intent_id: intentId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(err.error || `Failed to confirm top-up (HTTP ${res.status})`);
    }
    return res.json();
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
