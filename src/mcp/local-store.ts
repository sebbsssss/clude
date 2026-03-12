/**
 * Local JSON-file memory store for MCP local mode.
 * Zero dependencies. No API keys. Stores memories in ~/.clude/memories.json
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'fs';
import { join } from 'path';

const CLUDE_DIR = join(process.env.HOME || process.env.USERPROFILE || '.', '.clude');
const MEMORIES_FILE = join(CLUDE_DIR, 'memories.json');

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model' | 'introspective';

export interface LocalMemory {
  id: number;
  memory_type: MemoryType;
  content: string;
  summary: string;
  tags: string[];
  concepts: string[];
  importance: number;
  decay_factor: number;
  access_count: number;
  emotional_valence: number;
  source: string;
  source_id?: string;
  related_user?: string;
  related_wallet?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  last_accessed: string;
}

interface Store {
  version: 1;
  next_id: number;
  memories: LocalMemory[];
}

function ensureDir(): void {
  if (!existsSync(CLUDE_DIR)) {
    mkdirSync(CLUDE_DIR, { recursive: true });
  }
}

function loadStore(): Store {
  ensureDir();
  if (!existsSync(MEMORIES_FILE)) {
    return { version: 1, next_id: 1, memories: [] };
  }
  try {
    const raw = readFileSync(MEMORIES_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.memories)) {
      console.error('[clude-local] Warning: memories.json has invalid structure, starting fresh. Backup saved.');
      // Save backup before overwriting
      try { writeFileSync(MEMORIES_FILE + '.bak', raw); } catch {}
      return { version: 1, next_id: 1, memories: [] };
    }
    return data;
  } catch (err: any) {
    console.error('[clude-local] Warning: failed to parse memories.json:', err.message);
    // Try to preserve the corrupted file as backup
    try {
      const raw = readFileSync(MEMORIES_FILE, 'utf-8');
      writeFileSync(MEMORIES_FILE + '.bak', raw);
      console.error('[clude-local] Backup saved to memories.json.bak');
    } catch {}
    return { version: 1, next_id: 1, memories: [] };
  }
}

/** Atomic save: write to tmp file then rename (prevents corruption on crash) */
function saveStore(store: Store): void {
  ensureDir();
  const tmpFile = MEMORIES_FILE + '.tmp';
  writeFileSync(tmpFile, JSON.stringify(store, null, 2));
  renameSync(tmpFile, MEMORIES_FILE);
}

/** Simple keyword-based relevance scoring */
function scoreRelevance(query: string, memory: LocalMemory): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  if (queryTerms.length === 0) return 0.5;

  const text = `${memory.summary} ${memory.content} ${memory.tags.join(' ')}`.toLowerCase();

  let matches = 0;
  for (const term of queryTerms) {
    if (text.includes(term)) matches++;
  }

  const termScore = queryTerms.length > 0 ? matches / queryTerms.length : 0;

  // Factor in importance, decay, and recency (based on created_at, not last_accessed)
  const recency = Math.max(0, 1 - (Date.now() - new Date(memory.created_at).getTime()) / (30 * 86400000));
  const score = (termScore * 0.6) + (memory.importance * 0.2) + (memory.decay_factor * 0.1) + (recency * 0.1);

  return Math.min(1, score);
}

export function localRecall(opts: {
  query?: string;
  tags?: string[];
  memory_types?: MemoryType[];
  limit?: number;
  min_importance?: number;
  min_decay?: number;
  related_user?: string;
  related_wallet?: string;
}): LocalMemory[] {
  const store = loadStore();
  let results = store.memories;

  // Filter by type
  if (opts.memory_types?.length) {
    results = results.filter(m => opts.memory_types!.includes(m.memory_type));
  }

  // Filter by tags
  if (opts.tags?.length) {
    results = results.filter(m => m.tags.some(t => opts.tags!.includes(t)));
  }

  // Filter by importance
  if (opts.min_importance !== undefined) {
    results = results.filter(m => m.importance >= opts.min_importance!);
  }

  // Filter by decay
  if (opts.min_decay !== undefined) {
    results = results.filter(m => m.decay_factor >= opts.min_decay!);
  }

  // Filter by related user
  if (opts.related_user) {
    results = results.filter(m => m.related_user === opts.related_user);
  }

  // Filter by related wallet
  if (opts.related_wallet) {
    results = results.filter(m => m.related_wallet === opts.related_wallet);
  }

  // Score and sort
  if (opts.query) {
    results = results
      .map(m => ({ ...m, _score: scoreRelevance(opts.query!, m) }))
      .filter(m => (m as any)._score > 0.1)
      .sort((a, b) => (b as any)._score - (a as any)._score);
  } else {
    // Sort by recency
    results = results.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  const limit = opts.limit || 5;
  const returned = results.slice(0, limit);

  // Update access counts (single load, no race condition)
  for (const r of returned) {
    const mem = store.memories.find(m => m.id === r.id);
    if (mem) {
      mem.access_count++;
      mem.last_accessed = new Date().toISOString();
      // Hebbian reinforcement: +1% importance per access, capped at 1.0
      mem.importance = Math.min(1, mem.importance + 0.01);
    }
  }
  saveStore(store);

  return returned;
}

export function localStore(opts: {
  type: MemoryType;
  content: string;
  summary: string;
  tags?: string[];
  concepts?: string[];
  importance?: number;
  emotional_valence?: number;
  source: string;
  source_id?: string;
  related_user?: string;
  related_wallet?: string;
  metadata?: Record<string, unknown>;
}): number {
  const store = loadStore();
  const now = new Date().toISOString();
  const id = store.next_id++;

  store.memories.push({
    id,
    memory_type: opts.type,
    content: opts.content,
    summary: opts.summary,
    tags: opts.tags || [],
    concepts: opts.concepts || [],
    importance: opts.importance ?? 0.5,
    decay_factor: 1.0,
    access_count: 0,
    emotional_valence: opts.emotional_valence ?? 0,
    source: opts.source,
    source_id: opts.source_id,
    related_user: opts.related_user,
    related_wallet: opts.related_wallet,
    metadata: opts.metadata || {},
    created_at: now,
    last_accessed: now,
  });

  saveStore(store);
  return id;
}

export function localStats(): object {
  const store = loadStore();
  const memories = store.memories;

  const byType: Record<string, number> = {};
  let totalImportance = 0;
  let totalDecay = 0;
  const tagCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  let oldest = '';
  let newest = '';
  let mostAccessed: { summary: string; access_count: number } | null = null;

  for (const m of memories) {
    byType[m.memory_type] = (byType[m.memory_type] || 0) + 1;
    totalImportance += m.importance;
    totalDecay += m.decay_factor;
    for (const t of m.tags) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
    if (m.source) {
      sourceCounts[m.source] = (sourceCounts[m.source] || 0) + 1;
    }
    if (!oldest || m.created_at < oldest) oldest = m.created_at;
    if (!newest || m.created_at > newest) newest = m.created_at;
    if (!mostAccessed || m.access_count > mostAccessed.access_count) {
      mostAccessed = { summary: m.summary, access_count: m.access_count };
    }
  }

  const topTags = Object.entries(tagCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  return {
    status: 'active',
    mode: 'local',
    storage: MEMORIES_FILE,
    total_memories: memories.length,
    by_type: byType,
    avg_importance: memories.length > 0 ? +(totalImportance / memories.length).toFixed(3) : 0,
    avg_decay: memories.length > 0 ? +(totalDecay / memories.length).toFixed(3) : 0,
    top_tags: topTags,
    sources: sourceCounts,
    oldest_memory: oldest || null,
    newest_memory: newest || null,
    most_accessed: mostAccessed,
  };
}

export function localClinamen(opts: {
  context: string;
  limit?: number;
  min_importance?: number;
  max_relevance?: number;
  memory_types?: MemoryType[];
}): LocalMemory[] {
  const store = loadStore();
  const minImp = opts.min_importance ?? 0.6;
  const maxRel = opts.max_relevance ?? 0.35;
  const limit = opts.limit ?? 3;

  // Get high-importance memories, optionally filtered by type
  let candidates = store.memories.filter(m => m.importance >= minImp);
  if (opts.memory_types?.length) {
    candidates = candidates.filter(m => opts.memory_types!.includes(m.memory_type));
  }

  // Score by divergence: high importance + low relevance to context
  const contextTerms = opts.context.toLowerCase().split(/\s+/).filter(t => t.length > 2);

  const scored = candidates.map(m => {
    const text = `${m.summary} ${m.content}`.toLowerCase();
    let matches = 0;
    for (const term of contextTerms) {
      if (text.includes(term)) matches++;
    }
    const relevance = contextTerms.length > 0 ? matches / contextTerms.length : 0;
    const divergence = m.importance * (1 - relevance);
    return { ...m, _divergence: divergence, _relevanceSim: relevance };
  });

  return scored
    .filter(m => m._relevanceSim < maxRel)
    .sort((a, b) => b._divergence - a._divergence)
    .slice(0, limit);
}
