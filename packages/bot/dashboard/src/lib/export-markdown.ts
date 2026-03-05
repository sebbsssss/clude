import type { Memory, MemoryPack, MemoryType } from '../types/memory';

const TYPE_EMOJI: Record<MemoryType, string> = {
  episodic: '📝',
  semantic: '🧠',
  procedural: '⚙️',
  self_model: '🪞',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export function memoryToMarkdown(memory: Memory): string {
  const lines: string[] = [];
  lines.push(`### ${TYPE_EMOJI[memory.memory_type]} ${memory.summary}`);
  lines.push('');
  if (memory.content && memory.content !== memory.summary) {
    lines.push(memory.content);
    lines.push('');
  }
  const meta: string[] = [
    `**Type:** ${memory.memory_type}`,
    `**Importance:** ${memory.importance.toFixed(2)}`,
    `**Decay:** ${memory.decay_factor.toFixed(2)}`,
    `**Created:** ${formatDate(memory.created_at)}`,
  ];
  if (memory.tags.length) meta.push(`**Tags:** ${memory.tags.join(', ')}`);
  if (memory.concepts.length) meta.push(`**Concepts:** ${memory.concepts.join(', ')}`);
  if (memory.source) meta.push(`**Source:** ${memory.source}`);
  if (memory.related_user) meta.push(`**User:** ${memory.related_user}`);
  if (memory.solana_signature) {
    meta.push(`**On-chain:** [${memory.solana_signature.slice(0, 12)}...](https://solscan.io/tx/${memory.solana_signature})`);
  }
  lines.push(meta.join('  \n'));
  lines.push('');
  return lines.join('\n');
}

export function packToMarkdown(pack: MemoryPack): string {
  const lines: string[] = [];

  lines.push(`# ${pack.name}`);
  lines.push('');
  if (pack.description) {
    lines.push(`> ${pack.description}`);
    lines.push('');
  }
  lines.push(`**Memories:** ${pack.memories.length} | **Entities:** ${pack.entities.length} | **Exported:** ${formatDate(pack.created_at)}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Group by type
  const grouped = pack.memories.reduce((acc, m) => {
    (acc[m.memory_type] ||= []).push(m);
    return acc;
  }, {} as Record<string, Memory[]>);

  for (const [type, memories] of Object.entries(grouped)) {
    lines.push(`## ${TYPE_EMOJI[type as MemoryType] || ''} ${type.replace('_', ' ').toUpperCase()} (${memories.length})`);
    lines.push('');
    for (const m of memories) {
      lines.push(memoryToMarkdown(m));
    }
  }

  // Entities section
  if (pack.entities.length) {
    lines.push('## 🔗 Entities');
    lines.push('');
    for (const e of pack.entities) {
      lines.push(`- **${e.name}** (${e.entity_type}) — ${e.mention_count} mentions`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push(`*Exported from [Clude](https://clude.io) memory system*`);

  return lines.join('\n');
}

export function downloadMarkdown(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
