/**
 * SupabaseProvider — implements @clude/brain StorageProvider for Supabase + pgvector.
 *
 * Maps to the existing cludebot `memories` table schema:
 *   - id (BIGSERIAL) as string
 *   - hash_id as portable ID
 *   - embedding vector(1024)
 *   - memory_links table for graph
 *   - entity_* tables for entity graph
 *   - match_memories / match_memory_fragments RPCs for vector search
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ── Brain types (inline to avoid import issues before npm publish) ──

type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model';

interface Memory {
  id: string;
  uuid?: string;
  memory_type: MemoryType;
  content: string;
  summary: string;
  tags: string[];
  concepts: string[];
  emotional_valence: number;
  importance: number;
  access_count: number;
  source: string;
  source_id?: string;
  related_user?: string;
  related_entity?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  last_accessed: string;
  decay_factor: number;
  owner_wallet?: string;
  compacted?: boolean;
  compacted_into?: string;
  solana_signature?: string;
  _score?: number;
  _vector_sim?: number;
}

interface Scope {
  user_id?: string;
  agent_id?: string;
  session_id?: string;
  run_id?: string;
  owner_wallet?: string;
}

interface MemoryLink {
  source_id: string;
  target_id: string;
  link_type: string;
  strength: number;
}

interface Entity {
  id: string;
  entity_type: string;
  name: string;
  normalized_name: string;
  aliases: string[];
  description?: string;
  metadata: Record<string, unknown>;
  mention_count: number;
  first_seen: string;
  last_seen: string;
}

interface EntityMention {
  entity_id: string;
  memory_id: string;
  context: string;
  salience: number;
}

interface EntityRelation {
  source_entity_id: string;
  target_entity_id: string;
  relation_type: string;
  strength: number;
  evidence_memory_ids: string[];
}

// ── StorageProvider interface (duplicated to avoid cross-package import) ──

interface StorageProvider {
  name: string;
  insert(memory: Omit<Memory, '_score' | '_vector_sim'>): Promise<Memory>;
  getById(id: string, scope?: Scope): Promise<Memory | null>;
  getByIds(ids: string[], scope?: Scope): Promise<Memory[]>;
  update(id: string, patch: Partial<Memory>, scope?: Scope): Promise<void>;
  delete(id: string, scope?: Scope): Promise<boolean>;
  clear(scope?: Scope): Promise<void>;
  queryByImportance(opts: { limit: number; min_decay?: number; types?: MemoryType[]; tags?: string[]; related_user?: string; related_entity?: string; scope?: Scope }): Promise<Memory[]>;
  queryByText(opts: { keywords: string[]; limit: number; min_decay?: number; types?: MemoryType[]; scope?: Scope }): Promise<Memory[]>;
  queryBySource(opts: { source: string; limit?: number; min_decay?: number; types?: MemoryType[]; scope?: Scope }): Promise<Memory[]>;
  vectorSearch(opts: { embedding: number[]; threshold: number; limit: number; types?: MemoryType[]; scope?: Scope }): Promise<Array<{ id: string; similarity: number }>>;
  fragmentSearch?(opts: { embedding: number[]; threshold: number; limit: number; scope?: Scope }): Promise<Array<{ memory_id: string; similarity: number }>>;
  storeEmbedding(memory_id: string, embedding: number[]): Promise<void>;
  batchTrackAccess(ids: string[]): Promise<void>;
  batchDecay(opts: { type: MemoryType; rate: number; min_decay: number }): Promise<number>;
  boostImportance(id: string, amount: number, max: number): Promise<void>;
  upsertLink(link: MemoryLink): Promise<void>;
  getLinkedMemories(seed_ids: string[], min_strength: number, limit: number, scope?: Scope): Promise<Array<{ memory_id: string; link_type: string; strength: number }>>;
  boostLinkStrength(ids: string[], amount: number): Promise<number>;
  entities?: EntityStorageProvider;
  count(scope?: Scope): Promise<number>;
}

interface EntityStorageProvider {
  findOrCreate(name: string, type: string, opts?: { aliases?: string[]; description?: string }): Promise<Entity>;
  createMention(mention: EntityMention): Promise<void>;
  createRelation(relation: Omit<EntityRelation, 'evidence_memory_ids'> & { evidence_memory_id?: string }): Promise<void>;
  getMemoriesByEntity(entity_id: string, opts?: { limit?: number; types?: MemoryType[] }): Promise<Memory[]>;
  findSimilarEntities(embedding: number[], opts?: { limit?: number; types?: string[] }): Promise<Entity[]>;
  getCooccurrences(entity_id: string, opts?: { min_count?: number; limit?: number }): Promise<Array<{ related_entity_id: string; count: number }>>;
}

// ── Config ───────────────────────────────────────────────────

export interface SupabaseProviderConfig {
  url: string;
  serviceKey: string;
  /** Pre-configured client (overrides url/serviceKey). */
  client?: SupabaseClient;
}

// ── Helpers ──────────────────────────────────────────────────

function scopeFilter<T>(query: T, scope?: Scope): T {
  const q = query as any;
  if (scope?.owner_wallet) q.eq('owner_wallet', scope.owner_wallet);
  return q;
}

/** Map Supabase row to Memory. */
function rowToMemory(row: any): Memory {
  return {
    id: String(row.id),
    uuid: row.uuid || undefined,
    memory_type: row.memory_type,
    content: row.content,
    summary: row.summary,
    tags: row.tags || [],
    concepts: row.concepts || [],
    emotional_valence: row.emotional_valence ?? 0,
    importance: row.importance ?? 0.5,
    access_count: row.access_count ?? 0,
    source: row.source || '',
    source_id: row.source_id || undefined,
    related_user: row.related_user || undefined,
    related_entity: row.related_wallet || row.related_entity || undefined,
    metadata: row.metadata || {},
    created_at: row.created_at,
    last_accessed: row.last_accessed || row.created_at,
    decay_factor: row.decay_factor ?? 1.0,
    owner_wallet: row.owner_wallet || undefined,
    compacted: row.compacted || false,
    compacted_into: row.compacted_into || undefined,
    solana_signature: row.solana_signature || undefined,
  };
}

// ── Provider ─────────────────────────────────────────────────

export class SupabaseProvider implements StorageProvider {
  readonly name = 'supabase';
  private db: SupabaseClient;
  entities?: EntityStorageProvider;

  constructor(config: SupabaseProviderConfig) {
    this.db = config.client || createClient(config.url, config.serviceKey);
    this.entities = new SupabaseEntityProvider(this.db);
  }

  // ── CRUD ───────────────────────────────────────────────────

  async insert(memory: Omit<Memory, '_score' | '_vector_sim'>): Promise<Memory> {
    const { data, error } = await this.db
      .from('memories')
      .insert({
        memory_type: memory.memory_type,
        content: memory.content,
        summary: memory.summary,
        tags: memory.tags,
        concepts: memory.concepts || [],
        emotional_valence: memory.emotional_valence,
        importance: memory.importance,
        access_count: memory.access_count || 0,
        source: memory.source,
        source_id: memory.source_id,
        related_user: memory.related_user,
        related_wallet: memory.related_entity,
        metadata: memory.metadata || {},
        decay_factor: memory.decay_factor ?? 1.0,
        owner_wallet: memory.owner_wallet,
        hash_id: memory.id,
        uuid: memory.uuid,
        compacted: memory.compacted || false,
        compacted_into: memory.compacted_into,
        solana_signature: memory.solana_signature,
      })
      .select('*')
      .single();

    if (error) throw new Error(`Supabase insert failed: ${error.message}`);
    return rowToMemory(data);
  }

  async getById(id: string, scope?: Scope): Promise<Memory | null> {
    // Try numeric ID first, then hash_id
    const isNumeric = /^\d+$/.test(id);
    let query = this.db.from('memories').select('*');
    if (isNumeric) {
      query = query.eq('id', id);
    } else {
      query = query.eq('hash_id', id);
    }
    query = scopeFilter(query, scope);
    const { data } = await query.single();
    return data ? rowToMemory(data) : null;
  }

  async getByIds(ids: string[], scope?: Scope): Promise<Memory[]> {
    if (ids.length === 0) return [];
    const numericIds = ids.filter(id => /^\d+$/.test(id));
    const hashIds = ids.filter(id => !/^\d+$/.test(id));
    const results: Memory[] = [];

    if (numericIds.length > 0) {
      let q = this.db.from('memories').select('*').in('id', numericIds);
      q = scopeFilter(q, scope);
      const { data } = await q;
      if (data) results.push(...data.map(rowToMemory));
    }
    if (hashIds.length > 0) {
      let q = this.db.from('memories').select('*').in('hash_id', hashIds);
      q = scopeFilter(q, scope);
      const { data } = await q;
      if (data) results.push(...data.map(rowToMemory));
    }
    return results;
  }

  async update(id: string, patch: Partial<Memory>, scope?: Scope): Promise<void> {
    const isNumeric = /^\d+$/.test(id);
    const updates: Record<string, any> = {};
    if (patch.summary !== undefined) updates.summary = patch.summary;
    if (patch.content !== undefined) updates.content = patch.content;
    if (patch.tags !== undefined) updates.tags = patch.tags;
    if (patch.concepts !== undefined) updates.concepts = patch.concepts;
    if (patch.importance !== undefined) updates.importance = patch.importance;
    if (patch.decay_factor !== undefined) updates.decay_factor = patch.decay_factor;
    if (patch.access_count !== undefined) updates.access_count = patch.access_count;
    if (patch.last_accessed !== undefined) updates.last_accessed = patch.last_accessed;
    if (patch.compacted !== undefined) updates.compacted = patch.compacted;
    if (patch.compacted_into !== undefined) updates.compacted_into = patch.compacted_into;
    if (patch.solana_signature !== undefined) updates.solana_signature = patch.solana_signature;
    if (patch.metadata !== undefined) updates.metadata = patch.metadata;
    if (patch.emotional_valence !== undefined) updates.emotional_valence = patch.emotional_valence;
    if (patch.owner_wallet !== undefined) updates.owner_wallet = patch.owner_wallet;

    let q = this.db.from('memories').update(updates);
    if (isNumeric) q = q.eq('id', id);
    else q = q.eq('hash_id', id);
    q = scopeFilter(q, scope);
    const { error } = await q;
    if (error) throw new Error(`Supabase update failed: ${error.message}`);
  }

  async delete(id: string, scope?: Scope): Promise<boolean> {
    const isNumeric = /^\d+$/.test(id);
    // Verify exists first (Supabase delete doesn't reliably return count)
    const exists = await this.getById(id, scope);
    if (!exists) return false;

    let q = this.db.from('memories').delete();
    if (isNumeric) q = q.eq('id', id);
    else q = q.eq('hash_id', id);
    q = scopeFilter(q, scope);
    const { error } = await q;
    if (error) throw new Error(`Supabase delete failed: ${error.message}`);
    return true;
  }

  async clear(scope?: Scope): Promise<void> {
    if (!scope?.owner_wallet) throw new Error('clear() requires owner_wallet scope for safety');
    const { error } = await this.db
      .from('memories')
      .delete()
      .eq('owner_wallet', scope.owner_wallet);
    if (error) throw new Error(`Supabase clear failed: ${error.message}`);
  }

  // ── Query ──────────────────────────────────────────────────

  async queryByImportance(opts: {
    limit: number; min_decay?: number; types?: MemoryType[];
    tags?: string[]; related_user?: string; related_entity?: string; scope?: Scope;
  }): Promise<Memory[]> {
    let q = this.db.from('memories').select('*')
      .gte('decay_factor', opts.min_decay ?? 0.1)
      .not('source', 'in', '("demo","demo-maas")')
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(opts.limit);

    q = scopeFilter(q, opts.scope);
    if (opts.types?.length) q = q.in('memory_type', opts.types);
    if (opts.related_user) q = q.eq('related_user', opts.related_user);
    if (opts.related_entity) q = q.eq('related_wallet', opts.related_entity);
    if (opts.tags?.length) q = q.overlaps('tags', opts.tags);

    const { data, error } = await q;
    if (error) throw new Error(`queryByImportance failed: ${error.message}`);
    return (data || []).map(rowToMemory);
  }

  async queryByText(opts: {
    keywords: string[]; limit: number; min_decay?: number;
    types?: MemoryType[]; scope?: Scope;
  }): Promise<Memory[]> {
    if (opts.keywords.length === 0) return [];

    // Use ilike on summary for each keyword (OR match)
    const pattern = opts.keywords.map(k => `%${k}%`);
    let q = this.db.from('memories').select('*')
      .gte('decay_factor', opts.min_decay ?? 0.1)
      .not('source', 'in', '("demo","demo-maas")')
      .or(pattern.map((_, i) => `summary.ilike.${pattern[i]}`).join(','))
      .order('importance', { ascending: false })
      .limit(opts.limit);

    q = scopeFilter(q, opts.scope);
    if (opts.types?.length) q = q.in('memory_type', opts.types);

    const { data, error } = await q;
    if (error) throw new Error(`queryByText failed: ${error.message}`);
    return (data || []).map(rowToMemory);
  }

  async queryBySource(opts: {
    source: string; limit?: number; min_decay?: number;
    types?: MemoryType[]; scope?: Scope;
  }): Promise<Memory[]> {
    let q = this.db.from('memories').select('*')
      .eq('source', opts.source)
      .gte('decay_factor', opts.min_decay ?? 0)
      .order('importance', { ascending: false })
      .limit(opts.limit || 100);

    q = scopeFilter(q, opts.scope);
    if (opts.types?.length) q = q.in('memory_type', opts.types);

    const { data, error } = await q;
    if (error) throw new Error(`queryBySource failed: ${error.message}`);
    return (data || []).map(rowToMemory);
  }

  // ── Vector search ──────────────────────────────────────────

  async vectorSearch(opts: {
    embedding: number[]; threshold: number; limit: number;
    types?: MemoryType[]; scope?: Scope;
  }): Promise<Array<{ id: string; similarity: number }>> {
    // RPC signature: match_memories(query_embedding, match_threshold, match_count, filter_types, filter_user, min_decay)
    // Note: filter_owner may or may not exist depending on migration state
    const rpcParams: Record<string, any> = {
      query_embedding: JSON.stringify(opts.embedding),
      match_threshold: opts.threshold,
      match_count: opts.limit,
      filter_types: opts.types || null,
      filter_user: null,
      min_decay: 0.1,
    };

    // Try with filter_owner first, fall back without it
    let data: any, error: any;
    if (opts.scope?.owner_wallet) {
      const r1 = await this.db.rpc('match_memories', { ...rpcParams, filter_owner: opts.scope.owner_wallet });
      if (r1.error?.message?.includes('schema cache')) {
        // Fallback: function doesn't have filter_owner param
        const r2 = await this.db.rpc('match_memories', rpcParams);
        data = r2.data; error = r2.error;
      } else {
        data = r1.data; error = r1.error;
      }
    } else {
      const r = await this.db.rpc('match_memories', rpcParams);
      data = r.data; error = r.error;
    }

    if (error) throw new Error(`vectorSearch RPC failed: ${error.message}`);
    return (data || []).map((r: any) => ({
      id: String(r.id),
      similarity: r.similarity,
    }));
  }

  async fragmentSearch(opts: {
    embedding: number[]; threshold: number; limit: number; scope?: Scope;
  }): Promise<Array<{ memory_id: string; similarity: number }>> {
    const { data, error } = await this.db.rpc('match_memory_fragments', {
      query_embedding: JSON.stringify(opts.embedding),
      match_threshold: opts.threshold,
      match_count: opts.limit,
      filter_owner: opts.scope?.owner_wallet || null,
    });

    if (error) throw new Error(`fragmentSearch RPC failed: ${error.message}`);
    return (data || []).map((r: any) => ({
      memory_id: String(r.memory_id),
      similarity: r.max_similarity,
    }));
  }

  async storeEmbedding(memory_id: string, embedding: number[]): Promise<void> {
    // Use RPC to store embedding since Supabase REST can't handle vector type directly
    const { error } = await this.db.rpc('store_memory_embedding', {
      p_memory_id: parseInt(memory_id, 10),
      p_embedding: JSON.stringify(embedding),
    });

    // Fallback: direct update if RPC doesn't exist
    if (error?.message?.includes('function') || error?.message?.includes('does not exist')) {
      const { error: err2 } = await this.db
        .from('memories')
        .update({ embedding: JSON.stringify(embedding) } as any)
        .eq('id', memory_id);
      if (err2) throw new Error(`storeEmbedding failed: ${err2.message}`);
    } else if (error) {
      throw new Error(`storeEmbedding RPC failed: ${error.message}`);
    }
  }

  // ── Batch ops ──────────────────────────────────────────────

  async batchTrackAccess(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const numIds = ids.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
    if (numIds.length === 0) return;

    // Increment access_count and update last_accessed
    for (const id of numIds) {
      await this.db.rpc('boost_memory_importance', {
        p_memory_id: id,
        p_boost_amount: 0, // Just track access, don't boost importance
        p_max_importance: 1.0,
      }).then(() => {
        // Update last_accessed separately
        return this.db.from('memories')
          .update({
            last_accessed: new Date().toISOString(),
            access_count: this.db.rpc('', {}) as any, // Can't increment in REST
          })
          .eq('id', id);
      });
    }

    // Simpler: batch update last_accessed
    await this.db.from('memories')
      .update({ last_accessed: new Date().toISOString() })
      .in('id', numIds);
  }

  async batchDecay(opts: {
    type: MemoryType; rate: number; min_decay: number;
  }): Promise<number> {
    // Use RPC if available, otherwise manual
    const { data, error } = await this.db.rpc('apply_memory_decay', {
      p_memory_type: opts.type,
      p_decay_rate: opts.rate,
      p_min_decay: opts.min_decay,
    });

    if (error) {
      // Fallback: no-op, decay handled by dream cycle
      return 0;
    }
    return data || 0;
  }

  async boostImportance(id: string, amount: number, max: number): Promise<void> {
    const numId = parseInt(id, 10);
    if (isNaN(numId)) return;

    const { error } = await this.db.rpc('boost_memory_importance', {
      p_memory_id: numId,
      p_boost_amount: amount,
      p_max_importance: max,
    });
    if (error) throw new Error(`boostImportance failed: ${error.message}`);
  }

  // ── Link graph ─────────────────────────────────────────────

  async upsertLink(link: MemoryLink): Promise<void> {
    const { error } = await this.db
      .from('memory_links')
      .upsert({
        source_id: parseInt(link.source_id, 10),
        target_id: parseInt(link.target_id, 10),
        link_type: link.link_type,
        strength: link.strength,
      }, { onConflict: 'source_id,target_id,link_type' });
    if (error) throw new Error(`upsertLink failed: ${error.message}`);
  }

  async getLinkedMemories(
    seed_ids: string[], min_strength: number, limit: number, scope?: Scope,
  ): Promise<Array<{ memory_id: string; link_type: string; strength: number }>> {
    const numIds = seed_ids.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
    if (numIds.length === 0) return [];

    const { data, error } = await this.db.rpc('get_linked_memories', {
      seed_ids: numIds,
      min_strength,
      max_results: limit,
      filter_owner: scope?.owner_wallet || null,
    });

    if (error) throw new Error(`getLinkedMemories failed: ${error.message}`);
    return (data || []).map((r: any) => ({
      memory_id: String(r.memory_id),
      link_type: r.link_type,
      strength: r.strength,
    }));
  }

  async boostLinkStrength(ids: string[], amount: number): Promise<number> {
    const numIds = ids.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
    if (numIds.length === 0) return 0;

    const { data, error } = await this.db.rpc('boost_link_strength', {
      memory_ids: numIds,
      boost_amount: amount,
    });

    if (error) return 0;
    return data || 0;
  }

  // ── Stats ──────────────────────────────────────────────────

  async count(scope?: Scope): Promise<number> {
    let q = this.db.from('memories').select('id', { count: 'exact', head: true });
    q = scopeFilter(q, scope);
    const { count } = await q;
    return count || 0;
  }
}

// ── Entity Storage ───────────────────────────────────────────

class SupabaseEntityProvider implements EntityStorageProvider {
  constructor(private db: SupabaseClient) {}

  async findOrCreate(name: string, type: string, opts?: { aliases?: string[]; description?: string }): Promise<Entity> {
    const normalized = name.toLowerCase().trim();

    // Try find existing
    const { data: existing } = await this.db
      .from('entities')
      .select('*')
      .eq('normalized_name', normalized)
      .single();

    if (existing) return this.rowToEntity(existing);

    // Create new
    const { data, error } = await this.db
      .from('entities')
      .insert({
        entity_type: type,
        name,
        normalized_name: normalized,
        aliases: opts?.aliases || [],
        description: opts?.description || '',
        metadata: {},
        mention_count: 1,
      })
      .select('*')
      .single();

    if (error) {
      // Race condition: another process created it
      const { data: retry } = await this.db
        .from('entities')
        .select('*')
        .eq('normalized_name', normalized)
        .single();
      if (retry) return this.rowToEntity(retry);
      throw new Error(`findOrCreate entity failed: ${error.message}`);
    }
    return this.rowToEntity(data);
  }

  async createMention(mention: EntityMention): Promise<void> {
    await this.db.from('entity_mentions').insert({
      entity_id: parseInt(mention.entity_id, 10),
      memory_id: parseInt(mention.memory_id, 10),
      context: mention.context,
      salience: mention.salience,
    });
  }

  async createRelation(rel: Omit<EntityRelation, 'evidence_memory_ids'> & { evidence_memory_id?: string }): Promise<void> {
    const { error } = await this.db.from('entity_relations').upsert({
      source_entity_id: parseInt(rel.source_entity_id, 10),
      target_entity_id: parseInt(rel.target_entity_id, 10),
      relation_type: rel.relation_type,
      strength: rel.strength,
    }, { onConflict: 'source_entity_id,target_entity_id,relation_type' });
    if (error) throw new Error(`createRelation failed: ${error.message}`);
  }

  async getMemoriesByEntity(entity_id: string, opts?: { limit?: number; types?: MemoryType[] }): Promise<Memory[]> {
    const { data, error } = await this.db
      .from('entity_mentions')
      .select('memory_id, memories(*)')
      .eq('entity_id', parseInt(entity_id, 10))
      .order('salience', { ascending: false })
      .limit(opts?.limit || 10);

    if (error) return [];
    return (data || [])
      .filter((r: any) => r.memories)
      .map((r: any) => rowToMemory(r.memories))
      .filter(m => !opts?.types?.length || opts.types.includes(m.memory_type));
  }

  async findSimilarEntities(embedding: number[], opts?: { limit?: number; types?: string[] }): Promise<Entity[]> {
    // Use RPC if available
    const { data, error } = await this.db.rpc('match_entities', {
      query_embedding: JSON.stringify(embedding),
      match_count: opts?.limit || 5,
    });

    if (error) return [];
    return (data || []).map((r: any) => this.rowToEntity(r));
  }

  async getCooccurrences(entity_id: string, opts?: { min_count?: number; limit?: number }): Promise<Array<{ related_entity_id: string; count: number }>> {
    const numId = parseInt(entity_id, 10);
    const { data, error } = await this.db.rpc('get_entity_cooccurrences', {
      p_entity_id: numId,
      p_min_count: opts?.min_count || 2,
      p_limit: opts?.limit || 10,
    });

    if (error) return [];
    return (data || []).map((r: any) => ({
      related_entity_id: String(r.related_entity_id),
      count: r.count,
    }));
  }

  private rowToEntity(row: any): Entity {
    return {
      id: String(row.id),
      entity_type: row.entity_type,
      name: row.name,
      normalized_name: row.normalized_name,
      aliases: row.aliases || [],
      description: row.description || undefined,
      metadata: row.metadata || {},
      mention_count: row.mention_count || 0,
      first_seen: row.first_seen || row.created_at,
      last_seen: row.last_seen || row.created_at,
    };
  }
}
