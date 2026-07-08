/**
 * Ansem Guest API adapter — hits /api/ansem/* endpoints without auth.
 * Public no-auth page — mirror of lotr-api.ts, repointed to the Ansem endpoints.
 */

const API_BASE = import.meta.env.VITE_API_BASE || '';

export interface AnsemNode {
  id: number;
  type: string;
  summary: string;
  content: string;
  tags: string[];
  importance: number;
  likes: number;
  source: string;
  createdAt: string;
}

export interface AnsemLink {
  source_id: number;
  target_id: number;
  link_type: string;
  strength: number;
}

export interface AnsemFeedPost {
  id: string;
  name: string;
  handle: string;
  avatar: string;
  text: string;
  likes: number;
  retweets: number;
  replies: number;
  created_at: string;
  url: string;
}

export const ansemApi = {
  async getMemoryGraph(): Promise<{
    nodes: AnsemNode[];
    links: AnsemLink[];
    total: number;
  }> {
    const res = await fetch(`${API_BASE}/api/ansem/graph`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  /** Derive/relate the context of a clicked node (its source X post + what it replied to). */
  async getNodeContext(body: { id?: number; text: string; live?: boolean; url?: string }): Promise<{
    context: string;
    parent: { handle: string; name: string; text: string } | null;
    url: string | null;
    replyHandle: string | null;
  }> {
    const res = await fetch(`${API_BASE}/api/ansem/context`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  /** On-chain live-stream log: sha256 hashes of ingested posts + their Solana memo txs. */
  async getAttestations(): Promise<{
    enabled: boolean;
    wallet: string | null;
    pending: number;
    attestations: Array<{
      sig: string;
      ts: number;
      hashes: Array<{ hash: string; tweetId: string; handle: string; ts: string }>;
    }>;
  }> {
    const res = await fetch(`${API_BASE}/api/ansem/attestations`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  /**
   * "$ANSEM LIVE" ranked social feed. Returns { enabled:false } when the server
   * has no X_SEARCH_BEARER configured — the caller hides the panel in that case.
   */
  async getFeed(signal?: AbortSignal): Promise<{
    enabled: boolean;
    posts: AnsemFeedPost[];
  }> {
    const res = await fetch(`${API_BASE}/api/ansem/feed`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },

  async exploreChat(
    content: string,
    history: Array<{ role: string; content: string }>,
    onChunk: (text: string) => void,
    onRecalled: (ids: number[]) => void,
    onDone: (data: { memory_ids: number[]; clean_content: string }) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`${API_BASE}/api/ansem/explore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, history }),
      signal,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    if (!res.body) throw new Error('No response body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith(':')) continue;
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
  },
};
