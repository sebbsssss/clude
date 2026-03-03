import { getDb } from './database';
import { createChildLogger } from './logger';
import {
  clamp,
  timeAgo,
  MEMORY_MIN_DECAY,
  MEMORY_MAX_CONTENT_LENGTH,
  MEMORY_MAX_SUMMARY_LENGTH,
  RECENCY_DECAY_BASE,
  RETRIEVAL_WEIGHT_RECENCY,
  RETRIEVAL_WEIGHT_RELEVANCE,
  RETRIEVAL_WEIGHT_IMPORTANCE,
  RETRIEVAL_WEIGHT_VECTOR,
  RETRIEVAL_WEIGHT_GRAPH,
  RETRIEVAL_WEIGHT_COOCCURRENCE,
  VECTOR_MATCH_THRESHOLD,
  KNOWLEDGE_TYPE_BOOST,
  DECAY_RATES,
  EMBEDDING_FRAGMENT_MAX_LENGTH,
  LINK_SIMILARITY_THRESHOLD,
  MAX_AUTO_LINKS,
  LINK_CO_RETRIEVAL_BOOST,
} from '../utils';
import type { MemoryLinkType } from '../utils/constants';
import { generateImportanceScore } from './claude-client';
import { writeMemo, isRegistryEnabled, registerMemoryOnChain } from './solana-client';
import { generateEmbedding, generateQueryEmbedding, generateEmbeddings, isEmbeddingEnabled } from './embeddings';
import { isEncryptionEnabled, getEncryptionPubkey, encryptContent, decryptMemoryBatch } from './encryption';
import { eventBus } from '../events/event-bus';
import { createHash, randomBytes } from 'crypto';
import { extractAndLinkEntities, findSimilarEntities, getMemoriesByEntity, getEntityCooccurrences } from './memory-graph';
import { getContextOwnerWallet } from './owner-context';

// ---- OWNER WALLET ---- //
let _ownerWallet: string | null = null;

/** @internal Set the owner wallet address for tagging memories. */
export function _setOwnerWallet(wallet: string): void {
  _ownerWallet = wallet;
}

/** Get the configured owner wallet, if any. Checks async context first (hosted API), then module-level (SDK/bot). */
export function getOwnerWallet(): string | null {
  // AsyncLocalStorage takes priority (request-scoped for hosted API)
  const contextWallet = getContextOwnerWallet();
  if (contextWallet !== undefined) return contextWallet;
  // Fallback to module-level (SDK / main bot)
  return _ownerWallet;
}

/**
 * Apply owner_wallet scoping to a Supabase query builder.
 * When an owner wallet is set, filters to only that wallet's memories.
 * When null, no filter is applied (backward-compatible).
 */
function scopeToOwner<T>(query: T): T {
  const wallet = getOwnerWallet();
  if (wallet) {
    return (query as any).eq('owner_wallet', wallet);
  }
  return query;
}

// ============================================================
// HASH-BASED IDs (Beads-inspired)
//
// Generate short, collision-resistant IDs like "clude-a1b2c3d4"
// instead of sequential integers. Benefits:
// - No merge conflicts when multiple agents create memories
// - IDs remain stable across database migrations
// - Human-readable and URL-safe
// ============================================================

const HASH_ID_PREFIX = 'clude';

/**
 * Generate a collision-resistant hash ID for a memory.
 * Format: clude-xxxxxxxx (8 hex chars = 4 bytes = 4 billion possibilities)
 */
export function generateHashId(): string {
  return `${HASH_ID_PREFIX}-${randomBytes(4).toString('hex')}`;
}

/**
 * Validate a hash ID format.
 */
export function isValidHashId(id: string): boolean {
  return /^clude-[a-f0-9]{8}$/.test(id);
}

const log = createChildLogger('memory');

// ============================================================
// THE CORTEX — Clude's Memory System
//
// Inspired by:
// - Stanford's Generative Agents (recency + importance + relevance scoring)
// - MemGPT/Letta (multi-tier self-managed memory)
// - CoALA cognitive architecture (episodic/semantic/procedural)
// - Memp (procedural memory that improves from trajectories)
// - Anthropic's introspective awareness research
//
// Enhancements beyond Generative Agents:
// - Hybrid retrieval: vector similarity + keyword + tag scoring
// - Granular vector decomposition: per-fragment embeddings for precision
// - Type-specific decay: episodic fades fast, identity persists
// - Structured concept ontology: controlled vocabulary for cross-cutting knowledge
// - Progressive disclosure: lightweight summaries → full hydration on demand
//
// 4 memory types:
//   episodic    — individual interaction records (conversations, events)
//   semantic    — distilled knowledge and beliefs (learned patterns)
//   procedural  — behavioral patterns (what works, what doesn't)
//   self_model  — Clude's evolving understanding of itself
// ============================================================

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model';

export interface Memory {
  id: number;
  hash_id: string;              // Collision-resistant ID like "clude-a1b2c3d4"
  memory_type: MemoryType;
  content: string;
  summary: string;
  tags: string[];
  concepts: string[];
  emotional_valence: number;
  importance: number;
  access_count: number;
  source: string;
  source_id: string | null;
  related_user: string | null;
  related_wallet: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  last_accessed: string;
  decay_factor: number;
  evidence_ids: number[];
  solana_signature: string | null;
  // Compaction fields
  compacted: boolean;           // True if this memory has been compacted
  compacted_into: string | null; // hash_id of the compacted summary memory
  // Encryption fields
  encrypted: boolean;
  encryption_pubkey: string | null;
}

/** Lightweight memory summary for progressive disclosure (no content field). */
export interface MemorySummary {
  id: number;
  memory_type: MemoryType;
  summary: string;
  tags: string[];
  concepts: string[];
  importance: number;
  decay_factor: number;
  created_at: string;
  source: string;
}

export interface StoreMemoryOptions {
  type: MemoryType;
  content: string;
  summary: string;
  tags?: string[];
  concepts?: string[];
  emotionalValence?: number;
  importance?: number;
  source: string;
  sourceId?: string;
  relatedUser?: string;
  relatedWallet?: string;
  metadata?: Record<string, unknown>;
  evidenceIds?: number[];
}

export interface RecallOptions {
  query?: string;
  tags?: string[];
  relatedUser?: string;
  relatedWallet?: string;
  memoryTypes?: MemoryType[];
  limit?: number;
  minImportance?: number;
  minDecay?: number;
  /** Skip access tracking (prevents decay reset). Use for internal processing like dream cycles. */
  trackAccess?: boolean;
  /** Pre-computed vector similarity scores from hybrid search (internal use). */
  _vectorScores?: Map<number, number>;
}

// ---- CONCEPT ONTOLOGY ---- //

/**
 * Auto-classify memories into structured concepts using keyword heuristics.
 * Provides consistent cross-cutting knowledge labels without LLM cost.
 * Concepts are additive to freeform tags, not a replacement.
 */
export function inferConcepts(summary: string, source: string, tags: string[]): string[] {
  const concepts: string[] = [];
  const lower = summary.toLowerCase();
  const tagSet = new Set(tags.map(t => t.toLowerCase()));

  if (source === 'market' || tagSet.has('price') || /price|pump|dump|ath|market|volume/.test(lower))
    concepts.push('market_event');
  if (/whale|holder|seller|buyer|exit|accumula/.test(lower))
    concepts.push('holder_behavior');
  if (source === 'reflection' || source === 'emergence' || /myself|i am|i feel|identity|who i/.test(lower))
    concepts.push('self_insight');
  if (source === 'mention' || /tweet|reply|said|asked|mentioned|dm/.test(lower))
    concepts.push('social_interaction');
  if (/pattern|trend|recurring|always|usually|community/.test(lower))
    concepts.push('community_pattern');
  if (/token|sol|mint|swap|transfer|liquidity|staking/.test(lower))
    concepts.push('token_economics');
  if (/mood|sentiment|feel|vibe|energy|atmosphere/.test(lower))
    concepts.push('sentiment_shift');
  if (tagSet.has('first_interaction') || /returning|regular|again|came back/.test(lower))
    concepts.push('recurring_user');
  if (/whale|large|massive|huge|big (buy|sell)/.test(lower))
    concepts.push('whale_activity');
  if (/price|chart|candle|volume|mcap|cap/.test(lower))
    concepts.push('price_action');
  if (/engagement|likes|retweet|viral|reach|impressions/.test(lower))
    concepts.push('engagement_pattern');
  if (source === 'emergence' || /becoming|evolving|changed|grew|identity/.test(lower))
    concepts.push('identity_evolution');

  return [...new Set(concepts)];
}

// ---- STORE ---- //

export async function storeMemory(opts: StoreMemoryOptions): Promise<number | null> {
  const db = getDb();

  // Auto-classify concepts if not explicitly provided
  const concepts = opts.concepts || inferConcepts(opts.summary, opts.source, opts.tags || []);

  // Generate collision-resistant hash ID (Beads-inspired)
  const hashId = generateHashId();

  try {
    // Encrypt content if encryption is enabled (content only — summary/tags/metadata stay plaintext)
    const plaintextContent = opts.content.slice(0, MEMORY_MAX_CONTENT_LENGTH);
    const shouldEncrypt = isEncryptionEnabled();
    const storedContent = shouldEncrypt ? encryptContent(plaintextContent) : plaintextContent;

    const { data, error } = await db
      .from('memories')
      .insert({
        hash_id: hashId,
        memory_type: opts.type,
        content: storedContent,
        summary: opts.summary.slice(0, MEMORY_MAX_SUMMARY_LENGTH),
        tags: opts.tags || [],
        concepts,
        emotional_valence: clamp(opts.emotionalValence ?? 0, -1, 1),
        importance: clamp(opts.importance ?? 0.5, 0, 1),
        source: opts.source,
        source_id: opts.sourceId || null,
        related_user: opts.relatedUser || null,
        related_wallet: opts.relatedWallet || null,
        metadata: opts.metadata || {},
        evidence_ids: opts.evidenceIds || [],
        compacted: false,
        encrypted: shouldEncrypt,
        encryption_pubkey: shouldEncrypt ? getEncryptionPubkey() : null,
        owner_wallet: _ownerWallet || null,
      })
      .select('id, hash_id')
      .single();

    if (error) {
      log.error({ error: error.message }, 'Failed to store memory');
      return null;
    }

    log.debug({
      id: data.id,
      hashId: data.hash_id,
      type: opts.type,
      summary: opts.summary.slice(0, 60),
      importance: opts.importance,
      concepts,
    }, 'Memory stored');

    // Notify reflection trigger system (Park et al. 2023 — event-driven reflection)
    eventBus.emit('memory:stored', {
      importance: clamp(opts.importance ?? 0.5, 0, 1),
      memoryType: opts.type,
    });

    // Commit memory to Solana (fire-and-forget)
    commitMemoryToChain(data.id, opts).catch(err => log.warn({ err }, 'On-chain memory commit failed'));

    // Generate embeddings and store fragments (fire-and-forget)
    embedMemory(data.id, opts).catch(err => log.warn({ err }, 'Embedding generation failed'));

    // Auto-link to related memories (fire-and-forget, runs after embedding is available)
    autoLinkMemory(data.id, opts).catch(err => log.warn({ err }, 'Auto-linking failed'));

    // Extract entities and build knowledge graph (fire-and-forget)
    extractAndLinkEntitiesForMemory(data.id, opts).catch(err => log.debug({ err }, 'Entity extraction failed'));

    return data.id;
  } catch (err) {
    log.error({ err }, 'Memory store failed');
    return null;
  }
}

// ---- ON-CHAIN COMMIT ---- //

async function commitMemoryToChain(memoryId: number, opts: StoreMemoryOptions): Promise<void> {
  // Skip mainnet commits for demo memories (they use devnet instead)
  if (opts.source === 'demo' || opts.source === 'demo-maas') return;

  const contentHashBuf = createHash('sha256').update(opts.content).digest();
  let signature: string | null = null;

  // Try on-chain registry first, fall back to memo
  if (isRegistryEnabled()) {
    const encrypted = isEncryptionEnabled();
    signature = await registerMemoryOnChain(
      contentHashBuf,
      opts.type,
      opts.importance ?? 0.5,
      memoryId,
      encrypted,
    );
  }

  // Fallback to memo if registry unavailable or failed
  if (!signature) {
    const contentHashHex = contentHashBuf.toString('hex');
    const memo = `clude-memory | id: ${memoryId} | type: ${opts.type} | hash: ${contentHashHex.slice(0, 16)} | ${opts.summary.slice(0, 400)}`;
    signature = await writeMemo(memo);
  }

  if (!signature) return;

  const db = getDb();
  await db
    .from('memories')
    .update({ solana_signature: signature })
    .eq('id', memoryId);

  log.debug({ memoryId, signature: signature.slice(0, 16) }, 'Memory committed on-chain');
}

// ---- EMBEDDING & GRANULAR DECOMPOSITION ---- //

/**
 * Generate vector embedding for a memory and decompose into semantic fragments.
 * Each fragment gets its own embedding for precise sub-memory retrieval.
 *
 * Fragment types:
 *   summary     — the memory's summary (always stored)
 *   content_chunk — content split at natural boundaries
 *   tag_context — tags + concepts as a descriptive sentence
 */
async function embedMemory(memoryId: number, opts: StoreMemoryOptions): Promise<void> {
  if (!isEmbeddingEnabled()) return;

  const db = getDb();

  // Build fragment texts for granular decomposition
  const fragments: { type: string; text: string }[] = [];

  // Fragment 1: Summary (always)
  fragments.push({ type: 'summary', text: opts.summary });

  // Fragment 2+: Content chunks (split at sentence/paragraph boundaries)
  const content = opts.content.slice(0, MEMORY_MAX_CONTENT_LENGTH);
  if (content.length > EMBEDDING_FRAGMENT_MAX_LENGTH) {
    const sentences = content.match(/[^.!?\n]+[.!?\n]+/g) || [content];
    let chunk = '';
    for (const sentence of sentences) {
      if (chunk.length + sentence.length > EMBEDDING_FRAGMENT_MAX_LENGTH && chunk.length > 0) {
        fragments.push({ type: 'content_chunk', text: chunk.trim() });
        chunk = '';
      }
      chunk += sentence;
    }
    if (chunk.trim()) fragments.push({ type: 'content_chunk', text: chunk.trim() });
  } else {
    fragments.push({ type: 'content_chunk', text: content });
  }

  // Fragment 3: Tag/concept context as natural language
  const allLabels = [...(opts.tags || []), ...(opts.concepts || inferConcepts(opts.summary, opts.source, opts.tags || []))];
  if (allLabels.length > 0) {
    fragments.push({ type: 'tag_context', text: `Context: ${allLabels.join(', ')}. ${opts.summary}` });
  }

  // Batch-generate all embeddings
  const embeddings = await generateEmbeddings(fragments.map(f => f.text));

  // Store primary embedding on the memory itself (summary embedding)
  const summaryEmbedding = embeddings[0];
  if (summaryEmbedding) {
    await db
      .from('memories')
      .update({ embedding: JSON.stringify(summaryEmbedding) })
      .eq('id', memoryId);
  }

  // Store all fragments with their embeddings
  const fragmentRows = fragments.map((f, i) => ({
    memory_id: memoryId,
    fragment_type: f.type,
    content: f.text.slice(0, EMBEDDING_FRAGMENT_MAX_LENGTH),
    embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
  })).filter(r => r.embedding !== null);

  if (fragmentRows.length > 0) {
    const { error } = await db.from('memory_fragments').insert(fragmentRows);
    if (error) {
      log.warn({ error: error.message, memoryId }, 'Failed to store memory fragments');
    }
  }

  log.debug({ memoryId, fragments: fragmentRows.length }, 'Memory embedded with fragments');
}

// ---- RECALL ---- //

/**
 * Hybrid retrieval combining vector similarity, keyword matching, and structured scoring.
 *
 * When embeddings are available:
 *   1. Generate query embedding
 *   2. Run vector search (memory-level + fragment-level) for semantic candidates
 *   3. Merge with metadata-filtered candidates from Supabase
 *   4. Score all candidates with enhanced composite formula
 *
 * When embeddings are unavailable:
 *   Falls back to existing keyword + tag + importance scoring.
 *
 * score = (w_recency * recency + w_relevance * relevance + w_importance * importance
 *          + w_vector * vector_similarity) * decay_factor
 */
export async function recallMemories(opts: RecallOptions): Promise<Memory[]> {
  const db = getDb();
  const limit = opts.limit || 5;
  const minDecay = opts.minDecay ?? 0.1;

  try {
    // Phase 1: Vector search for semantic candidates (if available)
    let vectorScores = opts._vectorScores || new Map<number, number>();

    if (opts.query && isEmbeddingEnabled() && !opts._vectorScores) {
      const queryEmbedding = await generateQueryEmbedding(opts.query);
      if (queryEmbedding) {
        // Search both memory-level and fragment-level embeddings
        try {
          const [memoryMatches, fragmentMatches] = await Promise.all([
            db.rpc('match_memories', {
              query_embedding: JSON.stringify(queryEmbedding),
              match_threshold: VECTOR_MATCH_THRESHOLD,
              match_count: limit * 8,
              filter_types: opts.memoryTypes || null,
              filter_user: opts.relatedUser || null,
              min_decay: minDecay,
              filter_owner: getOwnerWallet() || null,
            }).then(r => r.data || []),
            db.rpc('match_memory_fragments', {
              query_embedding: JSON.stringify(queryEmbedding),
              match_threshold: VECTOR_MATCH_THRESHOLD,
              match_count: limit * 3,
              filter_owner: getOwnerWallet() || null,
            }).then(r => r.data || []),
          ]);

          // Merge: take highest similarity per memory_id across both sources
          for (const m of memoryMatches) {
            const current = vectorScores.get(m.id) || 0;
            vectorScores.set(m.id, Math.max(current, m.similarity));
          }
          for (const f of fragmentMatches) {
            const current = vectorScores.get(f.memory_id) || 0;
            vectorScores.set(f.memory_id, Math.max(current, f.max_similarity));
          }

          log.debug({
            memoryHits: memoryMatches.length,
            fragmentHits: fragmentMatches.length,
            uniqueMemories: vectorScores.size,
          }, 'Vector search completed');
        } catch (err) {
          log.warn({ err }, 'Vector search RPC failed, falling back to keyword retrieval');
        }
      } else {
        log.debug('Query embedding generation returned null, using keyword-only retrieval');
      }
    }

    // Phase 2: Metadata-filtered candidates from Supabase
    let query = db
      .from('memories')
      .select('*')
      .gte('decay_factor', minDecay)
      .not('source', 'in', '("demo","demo-maas")')
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit * 3);

    query = scopeToOwner(query);

    if (opts.memoryTypes && opts.memoryTypes.length > 0) {
      query = query.in('memory_type', opts.memoryTypes);
    }
    if (opts.relatedUser) {
      query = query.eq('related_user', opts.relatedUser);
    }
    if (opts.relatedWallet) {
      query = query.eq('related_wallet', opts.relatedWallet);
    }
    if (opts.minImportance) {
      query = query.gte('importance', opts.minImportance);
    }
    if (opts.tags && opts.tags.length > 0) {
      query = query.overlaps('tags', opts.tags);
    }

    const { data, error } = await query;

    if (error) {
      log.error({ error: error.message }, 'Memory recall query failed');
      return [];
    }

    // Phase 3: Merge vector candidates with metadata candidates
    let candidates: Memory[] = decryptMemoryBatch(data || []);

    // If vector search found memories not in the metadata set, fetch them
    if (vectorScores.size > 0) {
      const metadataIds = new Set(candidates.map(m => m.id));
      const missingIds = [...vectorScores.keys()].filter(id => !metadataIds.has(id));

      if (missingIds.length > 0) {
        let vectorQuery = db
          .from('memories')
          .select('*')
          .in('id', missingIds);
        vectorQuery = scopeToOwner(vectorQuery);
        // Respect memoryTypes filter even for vector-matched results
        if (opts.memoryTypes && opts.memoryTypes.length > 0) {
          vectorQuery = vectorQuery.in('memory_type', opts.memoryTypes);
        }
        const { data: vectorOnly } = await vectorQuery;
        if (vectorOnly) candidates = [...candidates, ...decryptMemoryBatch(vectorOnly)];
      }
    }

    if (candidates.length === 0) return [];

    // Phase 4: Score and rank with enhanced composite formula
    const scoredOpts = vectorScores.size > 0 ? { ...opts, _vectorScores: vectorScores } : opts;
    const scored = candidates.map((mem: Memory) => ({
      ...mem,
      _score: scoreMemory(mem, scoredOpts),
    }));

    scored.sort((a: { _score: number }, b: { _score: number }) => b._score - a._score);
    let results = scored.slice(0, limit);

    // Phase 5: Entity-aware recall — find memories via entity graph + co-occurrence
    if (opts.query && results.length > 0) {
      try {
        const entities = await findSimilarEntities(opts.query, { limit: 3 });
        if (entities.length > 0) {
          const resultIdSet = new Set(results.map((m: Memory) => m.id));

          // Phase 5a: Direct entity memories
          for (const entity of entities) {
            const entityMemories = await getMemoriesByEntity(entity.id, {
              limit: Math.ceil(limit / 2),
              memoryTypes: opts.memoryTypes,
            });
            for (const mem of entityMemories) {
              if (!resultIdSet.has(mem.id)) {
                results.push({
                  ...mem,
                  _score: scoreMemory(mem, scoredOpts) + RETRIEVAL_WEIGHT_GRAPH * 0.6,
                } as Memory & { _score: number });
                resultIdSet.add(mem.id);
              }
            }
          }

          log.debug({ entities: entities.map(e => e.name) }, 'Entity-aware recall applied');

          // Phase 5b: Co-occurring entity memories
          let cooccurrenceAdded = 0;
          const cooccurrenceNames: string[] = [];
          for (const entity of entities) {
            const cooccurrences = await getEntityCooccurrences(entity.id, { minCooccurrence: 2, maxResults: 3 });
            for (const cooc of cooccurrences) {
              if (cooccurrenceAdded >= limit) break;
              const coMems = await getMemoriesByEntity(cooc.related_entity_id, {
                limit: 3,
                memoryTypes: opts.memoryTypes,
              });
              for (const mem of coMems) {
                if (cooccurrenceAdded >= limit) break;
                if (!resultIdSet.has(mem.id)) {
                  const normalizedStrength = Math.min(cooc.cooccurrence_count / 5, 1);
                  results.push({
                    ...mem,
                    _score: scoreMemory(mem, scoredOpts) + RETRIEVAL_WEIGHT_GRAPH * RETRIEVAL_WEIGHT_COOCCURRENCE * normalizedStrength,
                  } as Memory & { _score: number });
                  resultIdSet.add(mem.id);
                  cooccurrenceAdded++;
                }
              }
            }
            if (cooccurrences.length > 0) {
              cooccurrenceNames.push(...cooccurrences.map(c => String(c.related_entity_id)));
            }
          }

          if (cooccurrenceAdded > 0) {
            log.debug({ cooccurrenceAdded, cooccurrenceEntities: cooccurrenceNames.length }, 'Entity co-occurrence recall applied');
          }
        }
      } catch (err) {
        log.debug({ err }, 'Entity-aware recall skipped');
      }
    }

    // Phase 6: Bond-typed graph traversal — follow strong bonds first
    // Bond weight multipliers: causal/supports > elaborates > relates > follows
    const BOND_TYPE_WEIGHTS: Record<string, number> = {
      causes: 1.0,
      supports: 0.9,
      resolves: 0.8,
      elaborates: 0.7,
      contradicts: 0.6,
      relates: 0.4,
      follows: 0.3,
    };

    if (results.length > 0) {
      try {
        const seedIds = results.map((m: Memory) => m.id);
        const { data: linked } = await db.rpc('get_linked_memories', {
          seed_ids: seedIds,
          min_strength: 0.2,
          max_results: limit,
          filter_owner: getOwnerWallet() || null,
        });

        if (linked && linked.length > 0) {
          const resultIdSet = new Set(seedIds);
          const graphCandidateIds = linked
            .filter((l: { memory_id: number }) => !resultIdSet.has(l.memory_id))
            .map((l: { memory_id: number }) => l.memory_id);

          if (graphCandidateIds.length > 0) {
            let graphQuery = db
              .from('memories')
              .select('*')
              .in('id', graphCandidateIds);
            graphQuery = scopeToOwner(graphQuery);
            const { data: graphMemories } = await graphQuery;

            if (graphMemories && graphMemories.length > 0) {
              decryptMemoryBatch(graphMemories);
              // Build link map with bond-type-weighted strength
              const linkBoostMap = new Map<number, number>();
              for (const l of linked) {
                const bondWeight = BOND_TYPE_WEIGHTS[l.link_type] ?? 0.4;
                const weightedStrength = (l.strength || 0.5) * bondWeight;
                const current = linkBoostMap.get(l.memory_id) || 0;
                linkBoostMap.set(l.memory_id, Math.max(current, weightedStrength));
              }

              const graphScored = (graphMemories as Memory[]).map(mem => ({
                ...mem,
                _score: scoreMemory(mem, scoredOpts) + RETRIEVAL_WEIGHT_GRAPH * (linkBoostMap.get(mem.id) || 0),
              }));

              results = [...results, ...graphScored]
                .sort((a: { _score: number }, b: { _score: number }) => b._score - a._score)
                .slice(0, limit);

              log.debug({
                graphExpanded: graphMemories.length,
                linkedTotal: linked.length,
                bondTypes: [...new Set(linked.map((l: { link_type: string }) => l.link_type))],
              }, 'Bond-typed graph traversal applied');
            }
          }
        }
      } catch (err) {
        log.debug({ err }, 'Graph expansion skipped (RPC unavailable)');
      }
    }

    // Phase 7: Type diversity — ensure results span multiple memory types
    // If all results are one type, pull in top candidates from other types
    if (results.length >= 3) {
      const typeSet = new Set(results.map((m: Memory) => m.memory_type));
      if (typeSet.size === 1) {
        const dominantType = [...typeSet][0];
        const otherTypes = ['episodic', 'semantic', 'procedural', 'self_model'].filter(t => t !== dominantType);
        const resultIdSet = new Set(results.map((m: Memory) => m.id));

        // Find scored candidates from other types that didn't make the cut
        const diverseCandidates = scored
          .filter((m: Memory & { _score: number }) => otherTypes.includes(m.memory_type) && !resultIdSet.has(m.id))
          .slice(0, Math.ceil(limit / 3));

        if (diverseCandidates.length > 0) {
          // Replace lowest-scored same-type results with diverse candidates
          const replaceCount = Math.min(diverseCandidates.length, Math.ceil(results.length / 3));
          results = [
            ...results.slice(0, results.length - replaceCount),
            ...diverseCandidates.slice(0, replaceCount),
          ].sort((a: { _score: number }, b: { _score: number }) => b._score - a._score)
           .slice(0, limit);

          log.debug({ injectedTypes: diverseCandidates.map((m: Memory) => m.memory_type) }, 'Type diversity applied');
        }
      }
    }

    // Update access counts in parallel (skip for internal processing like dream cycles)
    if (opts.trackAccess !== false) {
      const ids = results.map((m: Memory) => m.id);
      updateMemoryAccess(ids).catch(err => log.warn({ err }, 'Memory access tracking failed'));
      // Hebbian: reinforce links between co-retrieved memories
      reinforceCoRetrievedLinks(ids).catch(err => log.debug({ err }, 'Link reinforcement failed'));
    }

    log.debug({
      recalled: results.length,
      topScore: results[0]?._score?.toFixed(3),
      query: opts.query?.slice(0, 40),
      vectorAssisted: vectorScores.size > 0,
      typeSpread: [...new Set(results.map((m: Memory) => m.memory_type))].join(','),
    }, 'Memories recalled');

    return results;
  } catch (err) {
    log.error({ err }, 'Memory recall failed');
    return [];
  }
}

// Stopwords to exclude from keyword matching — common words that cause false positives
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'it', 'its', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'can', 'shall',
  'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'that', 'this',
  'what', 'which', 'who', 'whom', 'how', 'when', 'where', 'why',
  'all', 'each', 'every', 'both', 'few', 'more', 'most', 'some', 'any',
  'about', 'into', 'through', 'just', 'also', 'very', 'much', 'like',
  'get', 'got', 'your', 'you', 'my', 'me', 'his', 'her', 'our', 'their',
]);

/**
 * Check if a word matches within text using word boundary logic.
 * Avoids false positives like "sol" matching "solution".
 */
function wordBoundaryMatch(word: string, text: string): boolean {
  // Escape regex special chars, then wrap with word boundaries
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'i');
  return re.test(text);
}

/**
 * Extract meaningful query terms: lowercase, filter stopwords and short words.
 */
function extractQueryTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Enhanced scoring function with optional vector similarity component.
 *
 * When vector similarity is available:
 *   score = (w_recency * recency + w_relevance * keyword_relevance
 *            + w_importance * importance + w_vector * vector_sim) * decay
 *
 * When not available (graceful fallback):
 *   score = (w_recency * recency + w_relevance * keyword_relevance
 *            + w_importance * importance) * decay
 */
export function scoreMemory(mem: Memory, opts: RecallOptions): number {
  const now = Date.now();

  // Recency: exponential decay from last access (paper: 0.995^hours)
  const hoursSinceAccess = (now - new Date(mem.last_accessed).getTime()) / (1000 * 60 * 60);
  const recency = Math.pow(RECENCY_DECAY_BASE, hoursSinceAccess);

  // Text similarity (keyword overlap with word boundaries + stopword filtering)
  let textScore = 0.5;
  if (opts.query) {
    const queryTerms = extractQueryTerms(opts.query);
    if (queryTerms.length > 0) {
      const summaryLower = mem.summary.toLowerCase();
      // Summary matches are worth more than content matches
      let summaryHits = 0;
      let contentHits = 0;
      for (const term of queryTerms) {
        if (wordBoundaryMatch(term, summaryLower)) {
          summaryHits++;
        } else if (mem.content && wordBoundaryMatch(term, mem.content.toLowerCase())) {
          contentHits++;
        }
      }
      // Summary matches count full, content matches count half
      const effectiveMatches = summaryHits + contentHits * 0.5;
      textScore = 0.3 + 0.7 * Math.min(effectiveMatches / queryTerms.length, 1);
    }
  }

  // Tag + concept overlap score
  let tagScore = 0.5;
  if (opts.tags && opts.tags.length > 0) {
    const memLabels = [...(mem.tags || []), ...(mem.concepts || [])];
    const overlap = memLabels.filter(t => opts.tags!.includes(t)).length;
    tagScore = 0.5 + 0.5 * Math.min(overlap / opts.tags.length, 1);
  }

  // Relevance: average of text and tag similarity
  const relevance = (textScore + tagScore) / 2;

  // Vector similarity component (0 if not available)
  const vectorSim = opts._vectorScores?.get(mem.id) || 0;

  // Additive formula, normalized so vector vs non-vector scores are comparable
  let rawScore =
    RETRIEVAL_WEIGHT_RECENCY * recency +
    RETRIEVAL_WEIGHT_RELEVANCE * relevance +
    RETRIEVAL_WEIGHT_IMPORTANCE * mem.importance;

  if (vectorSim > 0) {
    rawScore += RETRIEVAL_WEIGHT_VECTOR * vectorSim;
    rawScore /= (RETRIEVAL_WEIGHT_RECENCY + RETRIEVAL_WEIGHT_RELEVANCE + RETRIEVAL_WEIGHT_IMPORTANCE + RETRIEVAL_WEIGHT_VECTOR);
  } else {
    rawScore /= (RETRIEVAL_WEIGHT_RECENCY + RETRIEVAL_WEIGHT_RELEVANCE + RETRIEVAL_WEIGHT_IMPORTANCE);
  }

  // Knowledge type boost: semantic/procedural/self_model rank above raw episodic
  const typeBoost = KNOWLEDGE_TYPE_BOOST[mem.memory_type] || 0;
  rawScore += typeBoost;

  // Knowledge-seed memories are curated facts — boost above other sources
  // Vector similarity still determines ranking among seeds
  if (mem.source === 'knowledge-seed') {
    const vecBonus = vectorSim > 0 ? vectorSim * 2.0 : 0;
    rawScore += 2.0 + vecBonus;
  }

  // Consolidation memories are self-referential meta-observations, not factual answers
  // Strong penalty to prevent them from dominating factual queries
  if (mem.source === 'consolidation') {
    rawScore *= 0.40;
  }

  return rawScore * mem.decay_factor;
}

// ---- PROGRESSIVE DISCLOSURE ---- //

/**
 * Lightweight recall that returns only summaries (~50 tokens each).
 * Use for dream cycle focal point generation, overview scans, and
 * anywhere full content isn't needed. 10x more token-efficient than full recall.
 *
 * Call hydrateMemories() to fetch full content for selected IDs.
 */
export async function recallMemorySummaries(opts: RecallOptions): Promise<MemorySummary[]> {
  const db = getDb();
  const limit = opts.limit || 10;
  const minDecay = opts.minDecay ?? 0.1;

  try {
    let query = db
      .from('memories')
      .select('id, memory_type, summary, tags, concepts, importance, decay_factor, created_at, source')
      .gte('decay_factor', minDecay)
      .not('source', 'in', '("demo","demo-maas")')
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    query = scopeToOwner(query);

    if (opts.memoryTypes && opts.memoryTypes.length > 0) {
      query = query.in('memory_type', opts.memoryTypes);
    }
    if (opts.relatedUser) {
      query = query.eq('related_user', opts.relatedUser);
    }
    if (opts.relatedWallet) {
      query = query.eq('related_wallet', opts.relatedWallet);
    }
    if (opts.minImportance) {
      query = query.gte('importance', opts.minImportance);
    }
    if (opts.tags && opts.tags.length > 0) {
      query = query.overlaps('tags', opts.tags);
    }

    const { data, error } = await query;
    if (error) {
      log.error({ error: error.message }, 'Memory summary recall failed');
      return [];
    }

    return (data || []) as MemorySummary[];
  } catch (err) {
    log.error({ err }, 'Memory summary recall failed');
    return [];
  }
}

/**
 * Fetch full memory content for specific IDs (second stage of progressive disclosure).
 * Use after recallMemorySummaries() to hydrate only the memories you actually need.
 */
export async function hydrateMemories(ids: number[]): Promise<Memory[]> {
  if (ids.length === 0) return [];
  const db = getDb();

  try {
    let query = db
      .from('memories')
      .select('*')
      .in('id', ids);
    query = scopeToOwner(query);

    const { data, error } = await query;

    if (error) {
      log.error({ error: error.message }, 'Memory hydration failed');
      return [];
    }

    return decryptMemoryBatch((data || []) as Memory[]);
  } catch (err) {
    log.error({ err }, 'Memory hydration failed');
    return [];
  }
}

// ---- ACCESS TRACKING ---- //

async function updateMemoryAccess(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();

  // Single batch query: increment access_count, refresh last_accessed, boost decay
  const { error } = await db.rpc('batch_boost_memory_access', { memory_ids: ids });
  if (error) {
    log.warn({ error: error.message, ids }, 'Batch memory access update failed');
  }

  // Importance re-scoring: memories retrieved often become more important over time.
  // Small boost per retrieval, capped at 1.0. Mirrors "rehearsal effect" in human memory.
  try {
    for (const id of ids) {
      await db.rpc('boost_memory_importance', {
        memory_id: id,
        boost_amount: 0.02,  // +2% per retrieval
        max_importance: 1.0,
      });
    }
  } catch (err) {
    // Non-critical — RPC may not exist yet, will be created in next migration
    log.debug({ err }, 'Importance re-scoring skipped (RPC may not exist)');
  }
}

// ---- ASSOCIATION GRAPH ---- //

/**
 * Create a typed, weighted link between two memories.
 * Idempotent — upserts on (source_id, target_id, link_type).
 */
export async function createMemoryLink(
  sourceId: number,
  targetId: number,
  linkType: MemoryLinkType,
  strength = 0.5
): Promise<void> {
  if (sourceId === targetId) return;
  const db = getDb();

  const { error } = await db
    .from('memory_links')
    .upsert({
      source_id: sourceId,
      target_id: targetId,
      link_type: linkType,
      strength: clamp(strength, 0, 1),
    }, { onConflict: 'source_id,target_id,link_type' });

  if (error) {
    log.debug({ error: error.message, sourceId, targetId, linkType }, 'Link creation failed');
  }
}

/**
 * Auto-link a new memory to related existing memories.
 * Uses vector similarity, concept overlap, and user overlap to find candidates.
 * Classifies link type via lightweight heuristics.
 */
async function autoLinkMemory(memoryId: number, opts: StoreMemoryOptions): Promise<void> {
  const db = getDb();

  // 1. Link evidence_ids as 'supports' links
  if (opts.evidenceIds && opts.evidenceIds.length > 0) {
    for (const evidenceId of opts.evidenceIds) {
      await createMemoryLink(memoryId, evidenceId, 'supports', 0.8);
    }
  }

  // 2. Find candidates via vector similarity (if embeddings available)
  const candidates: Array<{ id: number; similarity: number; memory_type: string; concepts: string[]; related_user: string | null; emotional_valence: number; created_at: string }> = [];

  if (isEmbeddingEnabled()) {
    const embedding = await generateEmbedding(opts.summary);
    if (embedding) {
      const { data: similar } = await db.rpc('match_memories', {
        query_embedding: JSON.stringify(embedding),
        match_threshold: LINK_SIMILARITY_THRESHOLD,
        match_count: MAX_AUTO_LINKS * 2,
        filter_owner: getOwnerWallet() || null,
      });

      if (similar) {
        // Fetch metadata for link classification
        const similarIds = similar.map((s: { id: number }) => s.id).filter((id: number) => id !== memoryId);
        if (similarIds.length > 0) {
          let metaQuery = db
            .from('memories')
            .select('id, memory_type, concepts, related_user, emotional_valence, created_at')
            .in('id', similarIds);
          metaQuery = scopeToOwner(metaQuery);
          const { data: metas } = await metaQuery;

          if (metas) {
            const simMap = new Map<number, number>(similar.map((s: Record<string, unknown>) => [Number(s.id), Number(s.similarity)]));
            for (const m of metas as Array<Record<string, unknown>>) {
              const mid = Number(m.id);
              candidates.push({
                id: mid,
                similarity: simMap.get(mid) || 0,
                memory_type: String(m.memory_type),
                concepts: (m.concepts || []) as string[],
                related_user: m.related_user ? String(m.related_user) : null,
                emotional_valence: Number(m.emotional_valence || 0),
                created_at: String(m.created_at),
              });
            }
          }
        }
      }
    }
  }

  // 3. Also find by concept overlap (fallback when no embeddings)
  if (candidates.length < MAX_AUTO_LINKS && opts.concepts && opts.concepts.length > 0) {
    let conceptQuery = db
      .from('memories')
      .select('id, memory_type, concepts, related_user, emotional_valence, created_at')
      .overlaps('concepts', opts.concepts)
      .neq('id', memoryId)
      .order('created_at', { ascending: false })
      .limit(MAX_AUTO_LINKS);
    conceptQuery = scopeToOwner(conceptQuery);
    const { data: conceptMatches } = await conceptQuery;

    if (conceptMatches) {
      const existingIds = new Set(candidates.map(c => c.id));
      for (const m of conceptMatches) {
        if (!existingIds.has(m.id)) {
          candidates.push({ ...m, similarity: 0.4 });
        }
      }
    }
  }

  // 4. Classify link types and create links (limit to MAX_AUTO_LINKS)
  const concepts = opts.concepts || [];
  let linksCreated = 0;

  for (const candidate of candidates.slice(0, MAX_AUTO_LINKS)) {
    if (candidate.id === memoryId) continue;

    const linkType = classifyLinkType(opts, candidate, concepts);
    const strength = candidate.similarity > 0 ? clamp(candidate.similarity, 0.3, 0.9) : 0.5;

    await createMemoryLink(memoryId, candidate.id, linkType, strength);
    linksCreated++;
  }

  if (linksCreated > 0) {
    log.debug({ memoryId, linksCreated }, 'Auto-linked memory');
  }
}

/**
 * Classify the relationship type between a new memory and an existing candidate.
 */
function classifyLinkType(
  newMem: StoreMemoryOptions,
  candidate: { memory_type: string; concepts: string[]; related_user: string | null; emotional_valence: number; created_at: string },
  newConcepts: string[]
): MemoryLinkType {
  const sameUser = newMem.relatedUser && newMem.relatedUser === candidate.related_user;
  const recentCandidate = (Date.now() - new Date(candidate.created_at).getTime()) < 6 * 60 * 60 * 1000; // within 6h
  const conceptOverlap = (candidate.concepts || []).filter(c => newConcepts.includes(c)).length;
  const valenceFlip = Math.abs((newMem.emotionalValence || 0) - candidate.emotional_valence) > 1.0;

  // Same user + recent = temporal sequence
  if (sameUser && recentCandidate) return 'follows';

  // Large emotional valence difference = potential contradiction
  if (valenceFlip && conceptOverlap > 0) return 'contradicts';

  // Semantic memory building on episodic = elaboration
  if (newMem.type === 'semantic' && candidate.memory_type === 'episodic') return 'elaborates';

  // High concept overlap = related
  if (conceptOverlap >= 2) return 'relates';

  return 'relates';
}

/**
 * Hebbian reinforcement: boost link strength between co-retrieved memories.
 * "Memories that fire together wire together."
 */
async function reinforceCoRetrievedLinks(ids: number[]): Promise<void> {
  if (ids.length < 2) return;
  const db = getDb();

  const { data, error } = await db.rpc('boost_link_strength', {
    memory_ids: ids,
    boost_amount: LINK_CO_RETRIEVAL_BOOST,
  });

  if (error) {
    log.debug({ error: error.message }, 'Link reinforcement RPC failed');
  } else if (data && data > 0) {
    log.debug({ boosted: data }, 'Co-retrieval link reinforcement applied');
  }
}

// ---- ENTITY EXTRACTION ---- //

/**
 * Extract entities from a stored memory and link them to the knowledge graph.
 * Called as fire-and-forget after storeMemory().
 */
async function extractAndLinkEntitiesForMemory(memoryId: number, opts: StoreMemoryOptions): Promise<void> {
  try {
    await extractAndLinkEntities(memoryId, opts.content, opts.summary, opts.relatedUser);
  } catch (err) {
    log.debug({ err, memoryId }, 'Entity extraction failed');
  }
}

// ---- DECAY ---- //

/**
 * Apply type-specific memory decay.
 * Episodic memories fade fastest (0.93/day), self-model slowest (0.99/day).
 * This mirrors human cognition: events are forgotten but identity persists.
 */
export async function decayMemories(): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    let totalDecayed = 0;

    // Batch decay per memory type (4 queries instead of N)
    for (const [memType, rate] of Object.entries(DECAY_RATES)) {
      const { data, error } = await db.rpc('batch_decay_memories', {
        decay_type: memType,
        decay_rate: rate,
        min_decay: MEMORY_MIN_DECAY,
        cutoff,
      });

      if (error) {
        log.warn({ error: error.message, memType }, 'Batch decay failed for type');
        continue;
      }

      totalDecayed += (data as number) || 0;
    }

    if (totalDecayed > 0) {
      log.info({ decayed: totalDecayed }, 'Type-specific memory decay applied');
    }

    return totalDecayed;
  } catch (err) {
    log.error({ err }, 'Memory decay failed');
    return 0;
  }
}

// ---- STATS ---- //

export interface MemoryStats {
  total: number;
  byType: Record<MemoryType, number>;
  avgImportance: number;
  avgDecay: number;
  oldestMemory: string | null;
  newestMemory: string | null;
  totalDreamSessions: number;
  uniqueUsers: number;
  topTags: { tag: string; count: number }[];
  topConcepts: { concept: string; count: number }[];
  embeddedCount: number;
}

export async function getMemoryStats(): Promise<MemoryStats> {
  const db = getDb();
  const stats: MemoryStats = {
    total: 0,
    byType: { episodic: 0, semantic: 0, procedural: 0, self_model: 0 },
    avgImportance: 0,
    avgDecay: 0,
    oldestMemory: null,
    newestMemory: null,
    totalDreamSessions: 0,
    uniqueUsers: 0,
    topTags: [],
    topConcepts: [],
    embeddedCount: 0,
  };

  try {
    let statsQuery = db
      .from('memories')
      .select('memory_type, importance, decay_factor, created_at, related_user, tags, concepts, embedding')
      .gt('decay_factor', MEMORY_MIN_DECAY);
    statsQuery = scopeToOwner(statsQuery);
    const { data: memories } = await statsQuery;

    if (memories && memories.length > 0) {
      stats.total = memories.length;

      let impSum = 0;
      let decaySum = 0;
      const tagCounts: Record<string, number> = {};
      const conceptCounts: Record<string, number> = {};
      const users = new Set<string>();

      for (const m of memories) {
        const type = m.memory_type as MemoryType;
        if (type in stats.byType) stats.byType[type]++;
        impSum += m.importance;
        decaySum += m.decay_factor;
        if (m.related_user) users.add(m.related_user);
        if (m.embedding) stats.embeddedCount++;
        if (m.tags) {
          for (const tag of m.tags) {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          }
        }
        if (m.concepts) {
          for (const concept of m.concepts) {
            conceptCounts[concept] = (conceptCounts[concept] || 0) + 1;
          }
        }
      }

      stats.avgImportance = impSum / memories.length;
      stats.avgDecay = decaySum / memories.length;
      stats.uniqueUsers = users.size;

      stats.topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }));

      stats.topConcepts = Object.entries(conceptCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([concept, count]) => ({ concept, count }));

      const sorted = memories.map(m => m.created_at).sort();
      stats.oldestMemory = sorted[0] || null;
      stats.newestMemory = sorted[sorted.length - 1] || null;
    }

    const { count, error: dreamError } = await db
      .from('dream_logs')
      .select('id', { count: 'exact', head: true });
    if (dreamError) {
      log.warn({ error: dreamError.message }, 'Failed to count dream logs');
    }
    stats.totalDreamSessions = count || 0;

  } catch (err) {
    log.error({ err }, 'Failed to get memory stats');
  }

  return stats;
}

// ---- RECENT MEMORIES ---- //

export async function getRecentMemories(
  hours: number,
  types?: MemoryType[],
  limit?: number
): Promise<Memory[]> {
  const db = getDb();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  let query = db
    .from('memories')
    .select('*')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(limit || 50);

  query = scopeToOwner(query);

  if (types && types.length > 0) {
    query = query.in('memory_type', types);
  }

  const { data, error } = await query;
  if (error) {
    log.error({ error: error.message }, 'Failed to get recent memories');
    return [];
  }

  return decryptMemoryBatch(data || []);
}

// ---- SELF-MODEL ---- //

export async function getSelfModel(): Promise<Memory[]> {
  const db = getDb();

  let query = db
    .from('memories')
    .select('*')
    .eq('memory_type', 'self_model')
    .gt('decay_factor', 0.2)
    .order('importance', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(5);

  query = scopeToOwner(query);

  const { data, error } = await query;

  if (error) {
    log.error({ error: error.message }, 'Failed to get self model');
    return [];
  }

  return decryptMemoryBatch(data || []);
}

// ---- STORE DREAM LOG ---- //

export async function storeDreamLog(
  sessionType: 'consolidation' | 'reflection' | 'emergence' | 'compaction' | 'contradiction_resolution',
  inputMemoryIds: number[],
  output: string,
  newMemoryIds: number[]
): Promise<void> {
  const db = getDb();

  const { error } = await db
    .from('dream_logs')
    .insert({
      session_type: sessionType,
      input_memory_ids: inputMemoryIds,
      output: output.slice(0, MEMORY_MAX_CONTENT_LENGTH),
      new_memories_created: newMemoryIds,
    });

  if (error) {
    log.error({ error: error.message }, 'Failed to store dream log');
  }
}

// ---- HELPERS ---- //

export function formatMemoryContext(memories: Memory[]): string {
  if (memories.length === 0) return '';

  const lines: string[] = ['## Memory Recall'];

  const episodic = memories.filter(m => m.memory_type === 'episodic');
  const semantic = memories.filter(m => m.memory_type === 'semantic');
  const procedural = memories.filter(m => m.memory_type === 'procedural');
  const selfModel = memories.filter(m => m.memory_type === 'self_model');

  if (episodic.length > 0) {
    lines.push('### Past Interactions');
    for (const m of episodic) {
      lines.push(`- [${timeAgo(m.created_at)}] ${m.summary}`);
    }
  }

  if (semantic.length > 0) {
    lines.push('### Things You Know');
    for (const m of semantic) {
      lines.push(`- ${m.summary}`);
    }
  }

  if (procedural.length > 0) {
    lines.push('### Behavioral Patterns');
    for (const m of procedural) {
      lines.push(`- ${m.summary}`);
    }
  }

  if (selfModel.length > 0) {
    lines.push('### Self-Observations');
    for (const m of selfModel) {
      lines.push(`- ${m.summary}`);
    }
  }

  lines.push('');
  lines.push('Use these memories naturally. You REMEMBER these things. Reference them if relevant but do not force it.');

  return lines.join('\n');
}

export function calculateImportance(opts: {
  tier?: string;
  feature?: string;
  mood?: string;
  isFirstInteraction?: boolean;
}): number {
  let score = 0.4;

  if (opts.tier === 'WHALE') score += 0.3;
  else if (opts.tier === 'SMALL') score += 0.1;
  else if (opts.tier === 'SELLER') score += 0.2;

  if (opts.feature === 'wallet-roast') score += 0.1;
  else if (opts.feature === 'question') score += 0.15;
  else if (opts.feature === 'exit-interview') score += 0.25;

  if (opts.mood === 'PUMPING' || opts.mood === 'DUMPING') score += 0.1;
  if (opts.mood === 'NEW_ATH' || opts.mood === 'WHALE_SELL') score += 0.15;

  if (opts.isFirstInteraction) score += 0.1;

  return clamp(score, 0, 1);
}

/**
 * Score importance using LLM (Park et al. 2023).
 * Falls back to rule-based calculateImportance() on failure.
 */
export async function scoreImportanceWithLLM(
  description: string,
  fallbackOpts?: Parameters<typeof calculateImportance>[0]
): Promise<number> {
  try {
    const response = await generateImportanceScore(description);
    const parsed = parseInt(response.trim(), 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
      return parsed / 10;
    }
    log.warn({ response }, 'LLM importance score unparseable, using fallback');
    return calculateImportance(fallbackOpts || {});
  } catch (err) {
    log.warn({ err }, 'LLM importance scoring failed, using fallback');
    return calculateImportance(fallbackOpts || {});
  }
}

export function moodToValence(mood: string): number {
  switch (mood) {
    case 'PUMPING': return 0.3;
    case 'NEW_ATH': return 0.5;
    case 'DUMPING': return -0.4;
    case 'WHALE_SELL': return -0.6;
    case 'SIDEWAYS': return -0.1;
    default: return 0;
  }
}
