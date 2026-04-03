import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import { generateEmbedding, isEmbeddingEnabled } from '@clude/shared/core/embeddings';
import type { Memory, MemoryType } from './memory';

const log = createChildLogger('memory-graph');

// ============================================================
// MEMORY GRAPH — Entity-Centric Knowledge Graph
//
// Extends Clude's memory system with explicit entity tracking.
// Instead of just memory→memory links, we now have:
//   Entity ←→ Memory (entity mentions)
//   Entity ←→ Entity (relationships)
//
// This enables:
//   - "Tell me about Seb" → find all memories mentioning Seb
//   - "How are X and Y related?" → traverse entity relationships
//   - Visual knowledge graph for clude.io
// ============================================================

export type EntityType = 
  | 'person'      // People (users, mentions)
  | 'project'     // Projects, products, companies
  | 'concept'     // Abstract concepts, topics
  | 'token'       // Crypto tokens
  | 'wallet'      // Wallet addresses
  | 'location'    // Places
  | 'event';      // Named events

export interface Entity {
  id: number;
  entity_type: EntityType;
  name: string;
  normalized_name: string;  // lowercase, trimmed for matching
  aliases: string[];        // alternative names
  description: string | null;
  metadata: Record<string, unknown>;
  mention_count: number;
  first_seen: string;
  last_seen: string;
  embedding: number[] | null;
}

export interface EntityMention {
  id: number;
  entity_id: number;
  memory_id: number;
  context: string;        // snippet around the mention
  salience: number;       // 0-1, how central is this entity to the memory
  created_at: string;
}

export interface EntityRelation {
  id: number;
  source_entity_id: number;
  target_entity_id: number;
  relation_type: string;  // 'knows', 'created', 'owns', 'part_of', etc.
  strength: number;
  evidence_memory_ids: number[];
  created_at: string;
}

// ---- ENTITY CRUD ---- //

/**
 * Find or create an entity by name.
 * Deduplicates by normalized_name.
 */
export async function findOrCreateEntity(
  name: string,
  entityType: EntityType,
  opts?: {
    aliases?: string[];
    description?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<Entity | null> {
  const db = getDb();
  const normalizedName = name.toLowerCase().trim();

  try {
    // Check if entity exists (by name or alias)
    const { data: existing } = await db
      .from('entities')
      .select('*')
      .or(`normalized_name.eq.${normalizedName},aliases.cs.{${normalizedName}}`)
      .limit(1)
      .single();

    if (existing) {
      // Update last_seen and increment mention_count
      await db
        .from('entities')
        .update({ 
          last_seen: new Date().toISOString(),
          mention_count: existing.mention_count + 1,
        })
        .eq('id', existing.id);
      return existing as Entity;
    }

    // Create new entity
    const { data: newEntity, error } = await db
      .from('entities')
      .insert({
        entity_type: entityType,
        name,
        normalized_name: normalizedName,
        aliases: opts?.aliases || [],
        description: opts?.description || null,
        metadata: opts?.metadata || {},
        mention_count: 1,
      })
      .select()
      .single();

    if (error) {
      log.error({ error: error.message, name }, 'Failed to create entity');
      return null;
    }

    log.debug({ id: newEntity.id, name, type: entityType }, 'Entity created');

    // Generate embedding for the entity (fire-and-forget)
    embedEntity(newEntity.id, name, opts?.description).catch(err => 
      log.debug({ err }, 'Entity embedding failed')
    );

    return newEntity as Entity;
  } catch (err) {
    log.error({ err, name }, 'Entity findOrCreate failed');
    return null;
  }
}

async function embedEntity(entityId: number, name: string, description?: string | null): Promise<void> {
  if (!isEmbeddingEnabled()) return;
  const db = getDb();

  const text = description ? `${name}: ${description}` : name;
  const embedding = await generateEmbedding(text);
  
  if (embedding) {
    await db
      .from('entities')
      .update({ embedding: JSON.stringify(embedding) })
      .eq('id', entityId);
  }
}

// ---- ENTITY MENTIONS ---- //

/**
 * Link an entity to a memory with context and salience.
 */
export async function createEntityMention(
  entityId: number,
  memoryId: number,
  context: string,
  salience: number = 0.5
): Promise<void> {
  const db = getDb();

  const { error } = await db
    .from('entity_mentions')
    .upsert({
      entity_id: entityId,
      memory_id: memoryId,
      context: context.slice(0, 500),
      salience: Math.max(0, Math.min(1, salience)),
    }, { onConflict: 'entity_id,memory_id' });

  if (error) {
    log.debug({ error: error.message, entityId, memoryId }, 'Entity mention failed');
  }
}

/**
 * Get all memories that mention an entity.
 */
export async function getMemoriesByEntity(
  entityId: number,
  opts?: { limit?: number; memoryTypes?: MemoryType[] }
): Promise<Memory[]> {
  const db = getDb();

  let query = db
    .from('entity_mentions')
    .select(`
      memory_id,
      salience,
      memories (*)
    `)
    .eq('entity_id', entityId)
    .order('salience', { ascending: false })
    .limit(opts?.limit || 20);

  const { data, error } = await query;

  if (error) {
    log.error({ error: error.message, entityId }, 'Failed to get memories by entity');
    return [];
  }

  const { getOwnerWallet } = require('./memory');
  const ownerWallet = getOwnerWallet();

  const memories = (data || [])
    .map((d: any) => d.memories)
    .filter((m: any) => m !== null)
    .filter((m: any) => !opts?.memoryTypes || opts.memoryTypes.includes(m.memory_type))
    .filter((m: any) => !ownerWallet || m.owner_wallet === ownerWallet);

  return memories as Memory[];
}

/**
 * Get all entities mentioned in a memory.
 */
export async function getEntitiesInMemory(memoryId: number): Promise<Entity[]> {
  const db = getDb();

  const { data, error } = await db
    .from('entity_mentions')
    .select(`
      entity_id,
      salience,
      entities (*)
    `)
    .eq('memory_id', memoryId)
    .order('salience', { ascending: false });

  if (error) {
    log.error({ error: error.message, memoryId }, 'Failed to get entities in memory');
    return [];
  }

  return (data || []).map((d: any) => d.entities).filter((e: any) => e !== null) as Entity[];
}

/**
 * Find entities that frequently co-occur with a given entity across memories.
 * Uses the get_entity_cooccurrence RPC to find related entities.
 */
export async function getEntityCooccurrences(
  entityId: number,
  opts?: { minCooccurrence?: number; maxResults?: number }
): Promise<Array<{ related_entity_id: number; cooccurrence_count: number; avg_salience: number }>> {
  const db = getDb();

  try {
    const { data, error } = await db.rpc('get_entity_cooccurrence', {
      entity_id: entityId,
      min_cooccurrence: opts?.minCooccurrence ?? 2,
      max_results: opts?.maxResults ?? 10,
    });

    if (error || !data) {
      log.debug({ error: error?.message, entityId }, 'Entity co-occurrence lookup failed');
      return [];
    }

    return data as Array<{ related_entity_id: number; cooccurrence_count: number; avg_salience: number }>;
  } catch (err) {
    log.debug({ err, entityId }, 'Entity co-occurrence skipped (RPC unavailable)');
    return [];
  }
}

// ---- ENTITY RELATIONS ---- //

/**
 * Create or strengthen a relationship between two entities.
 */
export async function createEntityRelation(
  sourceEntityId: number,
  targetEntityId: number,
  relationType: string,
  evidenceMemoryId?: number,
  strength: number = 0.5
): Promise<void> {
  if (sourceEntityId === targetEntityId) return;
  const db = getDb();

  // Check if relation exists
  const { data: existing } = await db
    .from('entity_relations')
    .select('id, strength, evidence_memory_ids')
    .eq('source_entity_id', sourceEntityId)
    .eq('target_entity_id', targetEntityId)
    .eq('relation_type', relationType)
    .single();

  if (existing) {
    // Update strength and add evidence
    const newEvidence = evidenceMemoryId && !existing.evidence_memory_ids.includes(evidenceMemoryId)
      ? [...existing.evidence_memory_ids, evidenceMemoryId]
      : existing.evidence_memory_ids;

    await db
      .from('entity_relations')
      .update({
        strength: Math.min(1, existing.strength + 0.1),
        evidence_memory_ids: newEvidence,
      })
      .eq('id', existing.id);
  } else {
    // Create new relation
    await db
      .from('entity_relations')
      .insert({
        source_entity_id: sourceEntityId,
        target_entity_id: targetEntityId,
        relation_type: relationType,
        strength,
        evidence_memory_ids: evidenceMemoryId ? [evidenceMemoryId] : [],
      });
  }
}

// ---- ENTITY EXTRACTION ---- //

/**
 * Simple rule-based entity extraction.
 * For production, replace with NER model or LLM extraction.
 */
export function extractEntitiesFromText(text: string): Array<{ name: string; type: EntityType }> {
  const entities: Array<{ name: string; type: EntityType }> = [];
  const seen = new Set<string>();

  // Twitter handles → person
  const handles = text.match(/@(\w+)/g);
  if (handles) {
    for (const handle of handles) {
      const name = handle.slice(1);
      if (!seen.has(name.toLowerCase())) {
        entities.push({ name, type: 'person' });
        seen.add(name.toLowerCase());
      }
    }
  }

  // Wallet addresses (Solana base58)
  const wallets = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
  if (wallets) {
    for (const wallet of wallets) {
      if (wallet.length >= 32 && !seen.has(wallet)) {
        entities.push({ name: wallet, type: 'wallet' });
        seen.add(wallet);
      }
    }
  }

  // Token tickers ($XXX)
  const tickers = text.match(/\$([A-Z]{2,10})/g);
  if (tickers) {
    for (const ticker of tickers) {
      const name = ticker.slice(1);
      if (!seen.has(name.toLowerCase())) {
        entities.push({ name, type: 'token' });
        seen.add(name.toLowerCase());
      }
    }
  }

  // Capitalized multi-word names (simple heuristic)
  const properNouns = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g);
  if (properNouns) {
    for (const noun of properNouns) {
      if (!seen.has(noun.toLowerCase()) && noun.length > 3) {
        entities.push({ name: noun, type: 'concept' });
        seen.add(noun.toLowerCase());
      }
    }
  }

  return entities;
}

/**
 * Extract and link entities from a memory.
 * Call this after storeMemory().
 */
export async function extractAndLinkEntities(
  memoryId: number,
  content: string,
  summary: string,
  relatedUser?: string
): Promise<void> {
  const combined = `${summary} ${content}`;
  const extracted = extractEntitiesFromText(combined);

  // Also add related_user as a person entity if provided
  if (relatedUser && !extracted.find(e => e.name.toLowerCase() === relatedUser.toLowerCase())) {
    extracted.push({ name: relatedUser, type: 'person' });
  }

  for (const { name, type } of extracted) {
    const entity = await findOrCreateEntity(name, type);
    if (entity) {
      // Calculate salience based on position and frequency
      const firstPos = combined.toLowerCase().indexOf(name.toLowerCase());
      const positionScore = firstPos < 100 ? 0.8 : firstPos < 300 ? 0.6 : 0.4;
      const frequency = (combined.toLowerCase().match(new RegExp(name.toLowerCase(), 'g')) || []).length;
      const frequencyScore = Math.min(frequency * 0.1, 0.3);
      const salience = Math.min(1, positionScore + frequencyScore);

      await createEntityMention(entity.id, memoryId, summary.slice(0, 200), salience);
    }
  }

  // Create co-occurrence relations between entities found in the same memory
  const entityIds: Array<{ id: number; name: string; type: string }> = [];
  for (const { name, type } of extracted) {
    const entity = await findOrCreateEntity(name, type);
    if (entity) entityIds.push({ id: entity.id, name, type });
  }

  // Link co-occurring entities with 'co_mentioned' relation
  for (let i = 0; i < entityIds.length; i++) {
    for (let j = i + 1; j < entityIds.length; j++) {
      try {
        await createEntityRelation(
          entityIds[i].id,
          entityIds[j].id,
          'co_mentioned',
          memoryId,
          0.3 // base co-occurrence strength
        );
      } catch (err) {
        // Non-critical, don't fail the whole extraction
        log.debug({ err, source: entityIds[i].name, target: entityIds[j].name }, 'Failed to create entity relation');
      }
    }
  }

  log.debug({ memoryId, entityCount: extracted.length, relations: Math.max(0, entityIds.length * (entityIds.length - 1) / 2) }, 'Entities extracted, linked, and related');
}

// ---- GRAPH QUERIES ---- //

/**
 * Get the full knowledge graph for visualization.
 * Returns nodes (entities + optionally memories) and edges.
 */
export async function getKnowledgeGraph(opts?: {
  entityTypes?: EntityType[];
  minMentions?: number;
  includeMemories?: boolean;
  limit?: number;
}): Promise<{
  nodes: Array<{ id: string; type: string; label: string; size: number }>;
  edges: Array<{ source: string; target: string; type: string; weight: number }>;
}> {
  const db = getDb();
  const limit = opts?.limit || 100;

  // Get entities
  let entityQuery = db
    .from('entities')
    .select('id, entity_type, name, mention_count')
    .gte('mention_count', opts?.minMentions || 1)
    .order('mention_count', { ascending: false })
    .limit(limit);

  if (opts?.entityTypes) {
    entityQuery = entityQuery.in('entity_type', opts.entityTypes);
  }

  const { data: entities } = await entityQuery;

  const nodes: Array<{ id: string; type: string; label: string; size: number }> = [];
  const edges: Array<{ source: string; target: string; type: string; weight: number }> = [];

  // Add entity nodes
  for (const e of entities || []) {
    nodes.push({
      id: `entity-${e.id}`,
      type: e.entity_type,
      label: e.name,
      size: Math.log2(e.mention_count + 1) * 10 + 5,
    });
  }

  // Get entity relations
  const entityIds = (entities || []).map(e => e.id);
  if (entityIds.length > 0) {
    const { data: relations } = await db
      .from('entity_relations')
      .select('source_entity_id, target_entity_id, relation_type, strength')
      .in('source_entity_id', entityIds)
      .in('target_entity_id', entityIds);

    for (const r of relations || []) {
      edges.push({
        source: `entity-${r.source_entity_id}`,
        target: `entity-${r.target_entity_id}`,
        type: r.relation_type,
        weight: r.strength,
      });
    }
  }

  // Optionally include memories
  if (opts?.includeMemories && entityIds.length > 0) {
    const { data: mentions } = await db
      .from('entity_mentions')
      .select(`
        entity_id,
        memory_id,
        salience,
        memories (id, memory_type, summary, importance)
      `)
      .in('entity_id', entityIds)
      .gte('salience', 0.3)
      .limit(limit * 2);

    const seenMemories = new Set<number>();
    for (const m of mentions || []) {
      // Supabase returns joined record as object (not array) for single relations
      const mem = m.memories as unknown as { id: number; memory_type: string; summary: string; importance: number } | null;
      if (mem && !seenMemories.has(m.memory_id)) {
        nodes.push({
          id: `memory-${m.memory_id}`,
          type: `memory-${mem.memory_type}`,
          label: mem.summary.slice(0, 50),
          size: mem.importance * 15 + 3,
        });
        seenMemories.add(m.memory_id);
      }

      edges.push({
        source: `entity-${m.entity_id}`,
        target: `memory-${m.memory_id}`,
        type: 'mentioned_in',
        weight: m.salience,
      });
    }
  }

  return { nodes, edges };
}

/**
 * Find entities similar to a query using vector search.
 */
export async function findSimilarEntities(
  query: string,
  opts?: { limit?: number; entityTypes?: EntityType[] }
): Promise<Entity[]> {
  if (!isEmbeddingEnabled()) return [];
  const db = getDb();

  const embedding = await generateEmbedding(query);
  if (!embedding) return [];

  const { data, error } = await db.rpc('match_entities', {
    query_embedding: JSON.stringify(embedding),
    match_threshold: 0.3,
    match_count: opts?.limit || 10,
    filter_types: opts?.entityTypes || null,
  });

  if (error) {
    log.debug({ error: error.message }, 'Entity vector search failed');
    return [];
  }

  // Fetch full entity data
  const ids = (data || []).map((d: { id: number }) => d.id);
  if (ids.length === 0) return [];

  const { data: entities } = await db
    .from('entities')
    .select('*')
    .in('id', ids);

  return (entities || []) as Entity[];
}

// ---- STATS ---- //

export async function getGraphStats(): Promise<{
  entityCount: number;
  relationCount: number;
  mentionCount: number;
  topEntities: Array<{ name: string; type: string; mentions: number }>;
}> {
  const db = getDb();

  const [
    { count: entityCount },
    { count: relationCount },
    { count: mentionCount },
    { data: topEntities },
  ] = await Promise.all([
    db.from('entities').select('*', { count: 'exact', head: true }),
    db.from('entity_relations').select('*', { count: 'exact', head: true }),
    db.from('entity_mentions').select('*', { count: 'exact', head: true }),
    db.from('entities')
      .select('name, entity_type, mention_count')
      .order('mention_count', { ascending: false })
      .limit(10),
  ]);

  return {
    entityCount: entityCount || 0,
    relationCount: relationCount || 0,
    mentionCount: mentionCount || 0,
    topEntities: (topEntities || []).map((e: any) => ({
      name: e.name,
      type: e.entity_type,
      mentions: e.mention_count,
    })),
  };
}
