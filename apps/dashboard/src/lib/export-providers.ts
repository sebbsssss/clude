import type { Memory } from '../types/memory';

// ─── Helpers ──────────────────────────────────────────────

function groupByType(memories: Memory[]): Record<string, Memory[]> {
  const byType: Record<string, Memory[]> = {};
  for (const m of memories) {
    const t = m.memory_type || 'episodic';
    (byType[t] ??= []).push(m);
  }
  return byType;
}

function sortByImportance(mems: Memory[]): Memory[] {
  return [...mems].sort((a, b) => (b.importance || 0) - (a.importance || 0));
}

function sortByRecent(mems: Memory[]): Memory[] {
  return [...mems].sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}



function memText(m: Memory): string {
  return m.summary || m.content;
}

function datedMemText(m: Memory): string {
  const date = m.created_at ? formatDate(m.created_at) : '';
  const prefix = date ? `[${date}] ` : '';
  return `${prefix}${memText(m)}`;
}

// ─── ChatGPT Format ───────────────────────────────────────

export function formatChatGPT(memories: Memory[]): string {
  const byType = groupByType(memories);
  const lines: string[] = [
    'You have persistent memory from a previous system. Here are your memories:',
    '',
  ];

  const semantic = sortByImportance(byType['semantic'] || []);
  if (semantic.length) {
    lines.push('## Key Facts (semantic memories)');
    for (const m of semantic) lines.push(`- ${memText(m)}`);
    lines.push('');
  }

  const procedural = sortByImportance(byType['procedural'] || []);
  if (procedural.length) {
    lines.push('## Learned Behaviors (procedural memories)');
    for (const m of procedural) lines.push(`- ${memText(m)}`);
    lines.push('');
  }

  const selfModel = sortByImportance(byType['self_model'] || []);
  if (selfModel.length) {
    lines.push('## Self Model');
    for (const m of selfModel) lines.push(`- ${memText(m)}`);
    lines.push('');
  }

  const episodic = sortByRecent(byType['episodic'] || []);
  if (episodic.length) {
    lines.push('## Personal Context (episodic memories, most recent)');
    for (const m of episodic) lines.push(`- ${datedMemText(m)}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Gemini Format ────────────────────────────────────────

export function formatGemini(memories: Memory[]): string {
  const byType = groupByType(memories);
  const lines: string[] = [
    '# Memory Context',
    '',
    'You are continuing a relationship with a user. Below is everything you know about them from previous interactions.',
    '',
  ];

  const semantic = sortByImportance(byType['semantic'] || []);
  if (semantic.length) {
    lines.push('## What I Know');
    for (const m of semantic) lines.push(`• ${memText(m)}`);
    lines.push('');
  }

  const procedural = sortByImportance(byType['procedural'] || []);
  if (procedural.length) {
    lines.push('## How I Work');
    for (const m of procedural) lines.push(`• ${memText(m)}`);
    lines.push('');
  }

  const selfModel = sortByImportance(byType['self_model'] || []);
  if (selfModel.length) {
    lines.push('## About Myself');
    for (const m of selfModel) lines.push(`• ${memText(m)}`);
    lines.push('');
  }

  const episodic = sortByRecent(byType['episodic'] || []);
  if (episodic.length) {
    lines.push('## Recent History');
    for (const m of episodic) lines.push(`• ${datedMemText(m)}`);
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Claude Format ────────────────────────────────────────

export function formatClaude(memories: Memory[]): string {
  const byType = groupByType(memories);
  const typeCounts = Object.entries(byType).map(([t, arr]) => `${t}: ${arr.length}`).join(', ');
  const lines: string[] = [
    '<context>',
    `You have persistent memory from a system called Clude (${memories.length} memories: ${typeCounts}).`,
    'Use this context to maintain continuity across conversations.',
    '</context>',
    '',
  ];

  const semantic = sortByImportance(byType['semantic'] || []);
  if (semantic.length) {
    lines.push('<knowledge>');
    for (const m of semantic) lines.push(`- ${memText(m)}`);
    lines.push('</knowledge>');
    lines.push('');
  }

  const procedural = sortByImportance(byType['procedural'] || []);
  if (procedural.length) {
    lines.push('<behaviors>');
    for (const m of procedural) lines.push(`- ${memText(m)}`);
    lines.push('</behaviors>');
    lines.push('');
  }

  const selfModel = sortByImportance(byType['self_model'] || []);
  if (selfModel.length) {
    lines.push('<self_model>');
    for (const m of selfModel) lines.push(`- ${memText(m)}`);
    lines.push('</self_model>');
    lines.push('');
  }

  const episodic = sortByRecent(byType['episodic'] || []);
  if (episodic.length) {
    lines.push('<recent_history>');
    for (const m of episodic) lines.push(`- ${datedMemText(m)}`);
    lines.push('</recent_history>');
    lines.push('');
  }

  const introspective = sortByRecent(byType['introspective'] || []);
  if (introspective.length) {
    lines.push('<introspection>');
    for (const m of introspective) lines.push(`- ${datedMemText(m)}`);
    lines.push('</introspection>');
    lines.push('');
  }

  return lines.join('\n');
}

// ─── Download & Clipboard ─────────────────────────────────

export function downloadText(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function copyToClipboard(content: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch {
    return false;
  }
}

export function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

export type ProviderFormat = 'chatgpt' | 'claude' | 'gemini';
export type ExportFormat = 'json' | 'md' | 'smart' | ProviderFormat;

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  smart: 'Smart Export (AI-synthesized)',
  json: 'JSON (agents)',
  md: 'Markdown',
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
};

export const PROVIDER_FORMATS: ProviderFormat[] = ['chatgpt', 'claude', 'gemini'];
export const DATA_FORMATS: ExportFormat[] = ['smart', 'json', 'md'];

export function isProviderFormat(fmt: ExportFormat): fmt is ProviderFormat {
  return PROVIDER_FORMATS.includes(fmt as ProviderFormat);
}

export function formatForProvider(memories: Memory[], format: ProviderFormat): string {
  switch (format) {
    case 'chatgpt': return formatChatGPT(memories);
    case 'claude': return formatClaude(memories);
    case 'gemini': return formatGemini(memories);
  }
}

export function getFileExtension(format: ExportFormat): string {
  switch (format) {
    case 'smart': return '.context-brief.txt';
    case 'json': return '.clude-pack.json';
    case 'md': return '.clude-pack.md';
    case 'chatgpt': return '.chatgpt-prompt.txt';
    case 'claude': return '.claude-prompt.txt';
    case 'gemini': return '.gemini-prompt.txt';
  }
}
