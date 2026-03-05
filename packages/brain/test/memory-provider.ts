/**
 * In-memory StorageProvider for testing.
 * No dependencies — pure JS arrays and maps.
 */
import type { Memory, MemoryType, Scope, MemoryLink } from '../src/types/memory.js';
import type { StorageProvider } from '../src/types/provider.js';
import { cosineSim } from '../src/utils.js';

export class InMemoryProvider implements StorageProvider {
  name = 'in-memory';
  private memories: Memory[] = [];
  private embeddings = new Map<string, number[]>();
  private links: MemoryLink[] = [];

  async insert(memory: Omit<Memory, '_score' | '_vector_sim'>): Promise<Memory> {
    const mem = { ...memory } as Memory;
    this.memories.push(mem);
    return mem;
  }

  async getById(id: string): Promise<Memory | null> {
    return this.memories.find(m => m.id === id) ?? null;
  }

  async getByIds(ids: string[]): Promise<Memory[]> {
    const set = new Set(ids);
    return this.memories.filter(m => set.has(m.id));
  }

  async update(id: string, patch: Partial<Memory>): Promise<void> {
    const idx = this.memories.findIndex(m => m.id === id);
    if (idx >= 0) Object.assign(this.memories[idx], patch);
  }

  async delete(id: string): Promise<boolean> {
    const len = this.memories.length;
    this.memories = this.memories.filter(m => m.id !== id);
    return this.memories.length < len;
  }

  async clear(): Promise<void> {
    this.memories = [];
    this.embeddings.clear();
    this.links = [];
  }

  async queryByImportance(opts: { limit: number; min_decay?: number; types?: MemoryType[]; tags?: string[]; related_user?: string; related_entity?: string; scope?: Scope }): Promise<Memory[]> {
    let results = this.scopeFilter(this.memories, opts.scope);
    if (opts.min_decay) results = results.filter(m => m.decay_factor >= opts.min_decay!);
    if (opts.types?.length) results = results.filter(m => opts.types!.includes(m.memory_type));
    if (opts.tags?.length) results = results.filter(m => m.tags.some(t => opts.tags!.includes(t)));
    if (opts.related_user) results = results.filter(m => m.related_user === opts.related_user);
    results.sort((a, b) => b.importance - a.importance);
    return results.slice(0, opts.limit);
  }

  async queryByText(opts: { keywords: string[]; limit: number; min_decay?: number; types?: MemoryType[]; scope?: Scope }): Promise<Memory[]> {
    let results = this.scopeFilter(this.memories, opts.scope);
    if (opts.min_decay) results = results.filter(m => m.decay_factor >= opts.min_decay!);
    if (opts.types?.length) results = results.filter(m => opts.types!.includes(m.memory_type));
    results = results.filter(m => {
      const text = `${m.summary} ${m.content}`.toLowerCase();
      return opts.keywords.some(k => text.includes(k));
    });
    return results.slice(0, opts.limit);
  }

  async queryBySource(opts: { source: string; limit?: number; min_decay?: number; types?: MemoryType[]; scope?: Scope }): Promise<Memory[]> {
    let results = this.scopeFilter(this.memories, opts.scope);
    results = results.filter(m => m.source === opts.source);
    if (opts.min_decay) results = results.filter(m => m.decay_factor >= opts.min_decay!);
    if (opts.types?.length) results = results.filter(m => opts.types!.includes(m.memory_type));
    return results.slice(0, opts.limit ?? 100);
  }

  async vectorSearch(opts: { embedding: number[]; threshold: number; limit: number; types?: MemoryType[]; scope?: Scope }): Promise<Array<{ id: string; similarity: number }>> {
    const results: Array<{ id: string; similarity: number }> = [];
    for (const [id, emb] of this.embeddings) {
      const sim = cosineSim(opts.embedding, emb);
      if (sim >= opts.threshold) {
        const mem = this.memories.find(m => m.id === id);
        if (mem && (!opts.types?.length || opts.types.includes(mem.memory_type))) {
          results.push({ id, similarity: sim });
        }
      }
    }
    results.sort((a, b) => b.similarity - a.similarity);
    return results.slice(0, opts.limit);
  }

  async storeEmbedding(memory_id: string, embedding: number[]): Promise<void> {
    this.embeddings.set(memory_id, embedding);
  }

  async batchTrackAccess(ids: string[]): Promise<void> {
    for (const id of ids) {
      const mem = this.memories.find(m => m.id === id);
      if (mem) { mem.access_count++; mem.last_accessed = new Date().toISOString(); }
    }
  }

  async batchDecay(opts: { type: MemoryType; rate: number; min_decay: number }): Promise<number> {
    let count = 0;
    for (const m of this.memories) {
      if (m.memory_type === opts.type && m.decay_factor > opts.min_decay) {
        m.decay_factor = Math.max(opts.min_decay, m.decay_factor * opts.rate);
        count++;
      }
    }
    return count;
  }

  async boostImportance(id: string, amount: number, max: number): Promise<void> {
    const mem = this.memories.find(m => m.id === id);
    if (mem) mem.importance = Math.min(max, mem.importance + amount);
  }

  async upsertLink(link: MemoryLink): Promise<void> {
    const idx = this.links.findIndex(l => l.source_id === link.source_id && l.target_id === link.target_id && l.link_type === link.link_type);
    if (idx >= 0) this.links[idx] = link;
    else this.links.push(link);
  }

  async getLinkedMemories(seed_ids: string[], min_strength: number, limit: number): Promise<Array<{ memory_id: string; link_type: string; strength: number }>> {
    const seedSet = new Set(seed_ids);
    return this.links
      .filter(l => seedSet.has(l.source_id) && l.strength >= min_strength && !seedSet.has(l.target_id))
      .map(l => ({ memory_id: l.target_id, link_type: l.link_type, strength: l.strength }))
      .slice(0, limit);
  }

  async boostLinkStrength(ids: string[], amount: number): Promise<number> {
    let boosted = 0;
    for (const l of this.links) {
      if (ids.includes(l.source_id) && ids.includes(l.target_id)) {
        l.strength = Math.min(1, l.strength + amount);
        boosted++;
      }
    }
    return boosted;
  }

  async count(): Promise<number> {
    return this.memories.length;
  }

  private scopeFilter(mems: Memory[], scope?: Scope): Memory[] {
    if (!scope?.owner_wallet) return [...mems];
    return mems.filter(m => m.owner_wallet === scope.owner_wallet);
  }
}
