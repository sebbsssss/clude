/** Generate a collision-resistant hash ID: clude-xxxxxxxx */
export function generateHashId(): string {
  const hex = Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `clude-${hex}`;
}

/** Cosine similarity between two vectors. */
export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return magA > 0 && magB > 0 ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

/** Human-readable time ago string. */
export function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Format recalled memories into prompt context. */
export function formatMemoryContext(memories: Array<{ memory_type: string; summary: string; created_at: string }>): string {
  if (memories.length === 0) return '';

  const lines: string[] = ['## Memory Recall'];
  const grouped: Record<string, typeof memories> = {};

  for (const m of memories) {
    const key = m.memory_type;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  }

  const labels: Record<string, string> = {
    episodic: '### Past Interactions',
    semantic: '### Things You Know',
    procedural: '### Behavioral Patterns',
    self_model: '### Self-Observations',
  };

  for (const [type, label] of Object.entries(labels)) {
    if (grouped[type]?.length) {
      lines.push(label);
      for (const m of grouped[type]) {
        lines.push(`- [${timeAgo(m.created_at)}] ${m.summary}`);
      }
    }
  }

  lines.push('');
  lines.push('Use these memories naturally. You REMEMBER these things.');
  return lines.join('\n');
}
