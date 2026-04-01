/**
 * LOTR Guest API adapter — hits /api/lotr/* endpoints without auth.
 * Campaign/temporary — delete this file when the campaign ends.
 */

const API_BASE = import.meta.env.VITE_API_BASE || '';

export const lotrApi = {
  async getMemoryGraph(): Promise<{
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
    const res = await fetch(`${API_BASE}/api/lotr/graph`);
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
    const res = await fetch(`${API_BASE}/api/lotr/explore`, {
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
