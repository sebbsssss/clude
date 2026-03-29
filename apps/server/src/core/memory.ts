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
  INTERNAL_MEMORY_SOURCES,
  INTERNAL_IMPORTANCE_BOOST,
  BOND_TYPE_WEIGHTS,
} from '../utils';
import type { MemoryLinkType } from '../utils/constants';
import { generateImportanceScore } from './claude-client';
import { writeMemo, isRegistryEnabled, registerMemoryOnChain } from './solana-client';
import { generateEmbedding, generateQueryEmbedding, generateEmbeddings, isEmbeddingEnabled } from './embeddings';
import { getExperimentalConfig } from '../experimental/config';
import { bm25SearchMemories } from '../experimental/bm25-search';
import { generateOpenRouterResponse, isOpenRouterEnabled } from './openrouter-client';
import { isEncryptionEnabled, getEncryptionPubkey, encryptContent, decryptMemoryBatch } from './encryption';
import { eventBus } from '../events/event-bus';

// ---- EMBEDDING CACHE ---- //
const EMBED_CACHE_MAX = 200;
const embeddingCache = new Map<string, { embedding: number[]; ts: number }>();

function getCachedEmbedding(query: string): number[] | null {
  const entry = embeddingCache.get(query);
  if (entry && Date.now() - entry.ts < 5 * 60 * 1000) return entry.embedding; // 5 min TTL
  return null;
}

function setCachedEmbedding(query: string, embedding: number[]): void {
  if (embeddingCache.size >= EMBED_CACHE_MAX) {
    // Evict oldest
    let oldest = Infinity, oldKey = '';
    for (const [k, v] of embeddingCache) { if (v.ts < oldest) { oldest = v.ts; oldKey = k; } }
    if (oldKey) embeddingCache.delete(oldKey);
  }
  embeddingCache.set(query, { embedding, ts: Date.now() });
}
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
/** Sentinel value: scope to memories where owner_wallet IS NULL (bot's own). */
export const SCOPE_BOT_OWN = '__BOT_OWN__';

export function scopeToOwner<T>(query: T): T {
  const wallet = getOwnerWallet();
  if (wallet === SCOPE_BOT_OWN) {
    return (query as any).is('owner_wallet', null);
  }
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

export type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model' | 'introspective';

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
  owner_wallet?: string | null;
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
  /** Pre-computed BM25 rank scores from full-text search (internal use). */
  _bm25Scores?: Map<number, number>;
  /** Skip LLM-based query expansion for faster recall (saves ~500-800ms). */
  skipExpansion?: boolean;
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
        owner_wallet: getOwnerWallet() || null,
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
  if (opts.source === 'demo' || opts.source === 'demo-maas' || opts.source === 'locomo-benchmark' || opts.source === 'longmemeval-benchmark') return;

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
    const memo = `clude-memory | v2 | ${contentHashHex}`;
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
// ---- QUERY EXPANSION ---- //

/**
 * Expand a query into multiple search angles using a fast LLM.
 * Returns the original query + 2-3 reformulations for broader vector coverage.
 * Falls back to just the original query if LLM is unavailable or slow.
 */
async function expandQuery(query: string): Promise<string[]> {
  if (!isOpenRouterEnabled()) return [query];

  try {
    const response = await Promise.race([
      generateOpenRouterResponse({
        systemPrompt: 'You are a search query expander. Given a question, output 3 alternative phrasings that would help find relevant information in a memory database. Output ONLY the 3 alternatives, one per line. No numbering, no explanations.',
        messages: [{ role: 'user', content: query }],
        model: 'meta-llama/llama-3.2-3b-instruct',
        maxTokens: 150,
        temperature: 0.3,
        cognitiveFunction: 'entity', // Use fast model slot
      }),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]) as string;

    const expansions = response
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 5 && l.length < 200)
      .slice(0, 3);

    log.debug({ original: query, expansions: expansions.length }, 'Query expanded');
    return [query, ...expansions];
  } catch (err) {
    log.debug({ err }, 'Query expansion failed, using original');
    return [query];
  }
}

export async function recallMemories(opts: RecallOptions): Promise<Memory[]> {
  const db = getDb();
  const limit = opts.limit || 5;
  const minDecay = opts.minDecay ?? 0.1;

  try {
    // Phase 0: Query expansion — generate alternative phrasings for broader recall
    const queries = opts.query && !opts._vectorScores && !opts.skipExpansion
      ? await expandQuery(opts.query)
      : opts.query ? [opts.query] : [];

    // Phase 1+2: Vector search + metadata query IN PARALLEL
    let vectorScores = opts._vectorScores || new Map<number, number>();
    let primaryQueryEmbedding: number[] | null = null; // Shared for Phase 2b seed scoring

    // Start embedding immediately (non-blocking)
    const vectorSearchPromise = (queries.length > 0 && isEmbeddingEnabled() && !opts._vectorScores) 
      ? (async () => {
        // Embed all query variants (with cache)
        const queryEmbeddings = await Promise.all(
          queries.map(async q => {
            const cached = getCachedEmbedding(q);
            if (cached) return cached;
            const emb = await generateQueryEmbedding(q);
            if (emb) setCachedEmbedding(q, emb);
            return emb;
          })
        );
        const validEmbeddings = queryEmbeddings.filter((e): e is number[] => e !== null);
        if (validEmbeddings.length > 0) primaryQueryEmbedding = validEmbeddings[0];

        if (validEmbeddings.length === 0) {
          log.debug('All query embeddings returned null, using keyword-only retrieval');
          return;
        }

        try {
          // Memory-level search only (skip fragments for speed when skipExpansion is set)
          const allSearches = validEmbeddings.flatMap(emb => {
            const searches: Promise<any[]>[] = [
              Promise.resolve(db.rpc('match_memories', {
                query_embedding: JSON.stringify(emb),
                match_threshold: VECTOR_MATCH_THRESHOLD,
                match_count: limit * (opts.skipExpansion ? 12 : 4),
                filter_types: opts.memoryTypes || null,
                filter_user: opts.relatedUser || null,
                min_decay: minDecay,
                filter_owner: getOwnerWallet() || null,
                filter_tags: opts.tags && opts.tags.length > 0 ? opts.tags : null,
              })).then(r => r.data || []),
            ];
            // Only search fragments when not in fast mode
            if (!opts.skipExpansion) {
              searches.push(
                Promise.resolve(db.rpc('match_memory_fragments', {
                  query_embedding: JSON.stringify(emb),
                  match_threshold: VECTOR_MATCH_THRESHOLD,
                  match_count: limit * 2,
                  filter_owner: getOwnerWallet() || null,
                })).then(r => r.data || []),
              );
            }
            return searches;
          });

          const results = await Promise.all(allSearches);
          
          // Merge: take highest similarity per memory_id across ALL queries
          if (opts.skipExpansion) {
            // All results are memory-level matches (no fragments)
            for (const batch of results) {
              for (const m of batch) {
                const current = vectorScores.get(m.id) || 0;
                vectorScores.set(m.id, Math.max(current, m.similarity));
              }
            }
          } else {
            for (let i = 0; i < results.length; i++) {
              const hasFragments = validEmbeddings.length > 0;
              const step = hasFragments ? 2 : 1;
              if (i % step === 0) {
                for (const m of results[i]) {
                  const current = vectorScores.get(m.id) || 0;
                  vectorScores.set(m.id, Math.max(current, m.similarity));
                }
              } else {
                for (const f of results[i]) {
                  const current = vectorScores.get(f.memory_id) || 0;
                  vectorScores.set(f.memory_id, Math.max(current, f.max_similarity));
                }
              }
            }
          }

          log.debug({
            queryVariants: validEmbeddings.length,
            uniqueMemories: vectorScores.size,
            fastMode: !!opts.skipExpansion,
          }, 'Vector search completed');
        } catch (err) {
          log.warn({ err }, 'Vector search RPC failed, falling back to keyword retrieval');
        }
      })() 
      : Promise.resolve();

    // Phase 2: Metadata-filtered candidates from Supabase (runs IN PARALLEL with vector search)
    // Run two queries in parallel: importance-ranked + text-search for diversity
    let importanceQuery = db
      .from('memories')
      .select('*')
      .gte('decay_factor', minDecay)
      .not('source', 'in', '("demo","demo-maas")')
      .order('importance', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit * 3);

    importanceQuery = scopeToOwner(importanceQuery);

    if (opts.memoryTypes && opts.memoryTypes.length > 0) {
      importanceQuery = importanceQuery.in('memory_type', opts.memoryTypes);
    }
    if (opts.relatedUser) {
      importanceQuery = importanceQuery.eq('related_user', opts.relatedUser);
    }
    if (opts.relatedWallet) {
      importanceQuery = importanceQuery.eq('related_wallet', opts.relatedWallet);
    }
    if (opts.minImportance) {
      importanceQuery = importanceQuery.gte('importance', opts.minImportance);
    }
    if (opts.tags && opts.tags.length > 0) {
      importanceQuery = importanceQuery.overlaps('tags', opts.tags);
    }

    // Text search: find memories whose summary/tags contain query keywords
    const textSearchPromise = (opts.query && opts.query.length > 3) ? (async () => {
      try {
        // Extract meaningful keywords (skip short/common words)
        const stopWords = new Set(['the','a','an','is','are','was','were','be','been','and','or','but','in','on','at','to','for','of','with','by','from','how','what','who','why','when','where','does','do','did','can','will','about','that','this','it']);
        const keywords = opts.query!.toLowerCase().split(/\s+/)
          .filter(w => w.length > 2 && !stopWords.has(w))
          .slice(0, 8);
        
        if (keywords.length === 0) return [];
        
        // Search summary AND content with ilike for each keyword
        let textQuery = db
          .from('memories')
          .select('*')
          .gte('decay_factor', minDecay)
          .not('source', 'in', '("demo","demo-maas")')
          .or(keywords.map(k => `summary.ilike.%${k}%,content.ilike.%${k}%`).join(','))
          .order('importance', { ascending: false })
          .limit(limit * 2);
        textQuery = scopeToOwner(textQuery);
        if (opts.memoryTypes && opts.memoryTypes.length > 0) {
          textQuery = textQuery.in('memory_type', opts.memoryTypes);
        }
        if (opts.tags && opts.tags.length > 0) {
          textQuery = textQuery.overlaps('tags', opts.tags);
        }
        const { data: textData } = await textQuery;
        return textData || [];
      } catch {
        return [];
      }
    })() : Promise.resolve([]);

    // Phase 2c: BM25 full-text search (Exp 8) — stemming + TF-IDF ranking
    const expConfig = getExperimentalConfig();
    const bm25Promise = (expConfig.bm25Search && opts.query && opts.query.length > 3) ? (async () => {
      try {
        return await bm25SearchMemories(opts.query!, {
          limit: limit * 2,
          minDecay: minDecay,
          filterOwner: _ownerWallet || undefined,
          filterTypes: opts.memoryTypes || undefined,
          filterTags: opts.tags || undefined,
        });
      } catch {
        return [];
      }
    })() : Promise.resolve([] as { id: number; rank: number }[]);

    // Phase 2b: Always fetch knowledge-seed memories (small fixed set, ~20 rows)
    // These are curated factual memories that must compete in scoring regardless of vector pool
    let knowledgeSeedQuery = db
      .from('memories')
      .select('*')
      .eq('source', 'knowledge-seed')
      .gte('decay_factor', minDecay);
    knowledgeSeedQuery = scopeToOwner(knowledgeSeedQuery);
    if (opts.memoryTypes && opts.memoryTypes.length > 0) {
      knowledgeSeedQuery = knowledgeSeedQuery.in('memory_type', opts.memoryTypes);
    }

    const [importanceResult, textResults, knowledgeSeeds, , bm25Results] = await Promise.all([
      importanceQuery,
      textSearchPromise,
      (async () => { try { const r = await knowledgeSeedQuery; return (r as any).data || []; } catch { return []; } })(),
      vectorSearchPromise, // Ensure vector search completes before merge
      bm25Promise,
    ]);

    const { data, error } = importanceResult as { data: any; error: any };
    
    // Merge text search results + knowledge seeds into data
    if (data) {
      const existingIds = new Set((data as any[]).map((m: any) => m.id));
      if (Array.isArray(textResults) && textResults.length > 0) {
        for (const m of textResults) {
          if (!existingIds.has(m.id)) {
            (data as any[]).push(m);
            existingIds.add(m.id);
          }
        }
        log.debug({ textHits: textResults.length }, 'Text search added candidates');
      }
      if (Array.isArray(knowledgeSeeds) && knowledgeSeeds.length > 0) {
        let seedsAdded = 0;
        for (const m of knowledgeSeeds) {
          if (!existingIds.has(m.id)) {
            (data as any[]).push(m);
            existingIds.add(m.id);
            seedsAdded++;
          }
          // Compute vector similarity for seeds that lack it (fetched via metadata, not vector search)
          const rawEmb = (m as any).embedding;
          if (primaryQueryEmbedding && rawEmb && !vectorScores.has(m.id)) {
            // Supabase returns embeddings as JSON strings from select('*')
            const emb: number[] = typeof rawEmb === 'string' ? JSON.parse(rawEmb) : rawEmb;
            const qEmb = primaryQueryEmbedding as number[];
            if (emb.length === qEmb.length) {
              let dot = 0, magA = 0, magB = 0;
              for (let i = 0; i < emb.length; i++) {
                dot += qEmb[i] * emb[i];
                magA += qEmb[i] * qEmb[i];
                magB += emb[i] * emb[i];
              }
              const sim = (magA > 0 && magB > 0) ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
              if (sim > 0) vectorScores.set(m.id, sim);
            }
          }
        }
        if (seedsAdded > 0) log.debug({ seedsAdded, seedsTotal: knowledgeSeeds.length }, 'Knowledge seeds added to candidates');
      }
    }

    // Merge BM25 results — store rank scores and fetch missing memory objects later
    const bm25Scores = new Map<number, number>();
    if (Array.isArray(bm25Results) && bm25Results.length > 0 && data) {
      const existingIds = new Set((data as any[]).map((m: any) => m.id));
      const bm25MissingIds: number[] = [];
      for (const r of bm25Results) {
        bm25Scores.set(r.id, r.rank);
        if (!existingIds.has(r.id)) bm25MissingIds.push(r.id);
      }
      if (bm25MissingIds.length > 0) {
        let bm25Query = db.from('memories').select('*').in('id', bm25MissingIds);
        bm25Query = scopeToOwner(bm25Query);
        const { data: bm25Data } = await bm25Query;
        if (bm25Data) {
          for (const m of bm25Data) {
            (data as any[]).push(m);
          }
        }
      }
      log.debug({ bm25Hits: bm25Results.length, bm25New: bm25MissingIds.length }, 'BM25 search added candidates');
    }

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
        // Respect tag filter — vector candidates from wrong sessions shouldn't enter the pool
        if (opts.tags && opts.tags.length > 0) {
          vectorQuery = vectorQuery.overlaps('tags', opts.tags);
        }
        const { data: vectorOnly } = await vectorQuery;
        if (vectorOnly) candidates = [...candidates, ...decryptMemoryBatch(vectorOnly)];
      }
    }

    if (candidates.length === 0) return [];

    // Phase 4: Score and rank with enhanced composite formula
    const scoredOpts = vectorScores.size > 0 || bm25Scores.size > 0
      ? { ...opts, _vectorScores: vectorScores, _bm25Scores: bm25Scores }
      : opts;
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
    // Bond weight multipliers include temporal link types (happens_before, happens_after, concurrent_with)

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
                const bondWeight = BOND_TYPE_WEIGHTS[l.link_type as MemoryLinkType] ?? 0.4;
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

    // Final owner_wallet guard: strip any memories that don't belong to the current owner
    // This catches leaks from entity/graph/fragment paths that may not filter by owner
    const finalOwner = getOwnerWallet();
    if (finalOwner) {
      const beforeCount = results.length;
      results = results.filter((m: Memory) => m.owner_wallet === finalOwner);
      if (results.length < beforeCount) {
        log.warn({ stripped: beforeCount - results.length, owner: finalOwner }, 'Owner guard stripped foreign memories from recall results');
      }
    }

    // Update access counts in parallel (skip for internal processing like dream cycles)
    // Source-aware reinforcement: internal signals get gated boost to prevent confabulation
    if (opts.trackAccess !== false) {
      const ids = results.map((m: Memory) => m.id);
      const sources = results.map((m: Memory) => m.source || '');
      updateMemoryAccess(ids, sources).catch(err => log.warn({ err }, 'Memory access tracking failed'));
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
 * Unified formula (vector weight always in denominator when search was performed):
 *   score = (w_recency * recency + w_relevance * keyword_rel
 *            + w_importance * importance + w_vector * vector_sim) / sum(weights) * decay
 *
 * When vector search wasn't performed (graceful fallback):
 *   score = (w_recency * recency + w_relevance * keyword_rel
 *            + w_importance * importance) / sum(weights_no_vector) * decay
 *
 * Key: memories not found by vector search score lower (vectorSim=0 in numerator,
 * but VECTOR weight still in denominator), naturally penalizing noise.
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

  // Unified weighted scoring — vector similarity is a FIRST-CLASS signal, not a bonus.
  //
  // RETRIEVAL_WEIGHT_VECTOR (4.0) is ALWAYS in the denominator when vector search was performed.
  // This means memories NOT found by vector search (vectorSim=0) are naturally penalized —
  // they score lower because they can't fill the vector slot. This prevents noise from
  // outranking semantically relevant memories.
  //
  // When vector search wasn't performed (embedding disabled, RPC failed), we exclude
  // the vector weight so keyword-only recall still works at full scale.
  const vectorSearchActive = opts._vectorScores && opts._vectorScores.size > 0;
  const denom = RETRIEVAL_WEIGHT_RECENCY + RETRIEVAL_WEIGHT_RELEVANCE + RETRIEVAL_WEIGHT_IMPORTANCE
    + (vectorSearchActive ? RETRIEVAL_WEIGHT_VECTOR : 0);
  let rawScore =
    (RETRIEVAL_WEIGHT_RECENCY * recency +
     RETRIEVAL_WEIGHT_RELEVANCE * relevance +
     RETRIEVAL_WEIGHT_IMPORTANCE * mem.importance +
     (vectorSearchActive ? RETRIEVAL_WEIGHT_VECTOR * vectorSim : 0)) / denom;

  // Hybrid agreement bonus: when keyword AND vector both agree, extra confidence
  if (vectorSim > 0 && textScore > 0.6) {
    rawScore += 0.10 * vectorSim; // small bonus for dual-signal agreement
  }

  // BM25 boost: when full-text search found this memory, boost by TF-IDF rank
  const bm25Rank = opts._bm25Scores?.get(mem.id) || 0;
  if (bm25Rank > 0) {
    rawScore += 0.15 * Math.min(bm25Rank, 1); // small BM25-found bonus
  }

  // Knowledge type boost: semantic/procedural/self_model rank above raw episodic
  const typeBoost = KNOWLEDGE_TYPE_BOOST[mem.memory_type] || 0;
  rawScore += typeBoost;

  // Knowledge-seed memories get boosted ONLY when vector-relevant to the query
  // High vector sim = strong boost; no vector match = no boost (don't pollute unrelated queries)
  if (mem.source === 'knowledge-seed' && vectorSim > 0.25) {
    rawScore += 2.0 + vectorSim * 2.0; // ranges from +2.5 (sim=0.25) to +4.0 (sim=1.0)
  } else if (mem.source === 'knowledge-seed') {
    rawScore += 0.5; // moderate boost for seeds without vector match
  }

  // Internal source penalty: agent-generated memories (dreams, reflections, consolidations)
  // get scored lower than external signals to prevent confabulation spirals.
  // Consolidation gets strongest penalty (2K+ exist); other internals get moderate penalty.
  if (mem.source === 'consolidation') {
    rawScore *= vectorSim > 0.5 ? 0.45 : 0.30;
  } else if (INTERNAL_MEMORY_SOURCES.has(mem.source)) {
    rawScore *= vectorSim > 0.5 ? 0.70 : 0.50;
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

async function updateMemoryAccess(ids: number[], sources: string[] = []): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();

  // Single batch query: increment access_count, refresh last_accessed, boost decay
  const { error } = await db.rpc('batch_boost_memory_access', { memory_ids: ids });
  if (error) {
    log.warn({ error: error.message, ids }, 'Batch memory access update failed');
  }

  // Source-aware importance re-scoring (internal/external signal differentiation).
  // External sources (user interactions, imports) get full reinforcement.
  // Internal sources (dreams, reflections, consolidations) get gated reinforcement
  // to prevent confabulation spirals where agent-generated memories self-amplify.
  // Based on Source Monitoring Framework (Johnson et al.) and validation-gated Hebbian learning.
  try {
    for (let i = 0; i < ids.length; i++) {
      const source = sources[i] || '';
      const isInternal = INTERNAL_MEMORY_SOURCES.has(source);
      const boostAmount = isInternal ? INTERNAL_IMPORTANCE_BOOST : 0.02;

      await db.rpc('boost_memory_importance', {
        memory_id: ids[i],
        boost_amount: boostAmount,
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

// ---- DELETE / UPDATE / LIST ---- //

export async function deleteMemory(id: number): Promise<boolean> {
  const db = getDb();
  let query = db.from('memories').delete().eq('id', id);
  query = scopeToOwner(query);
  const { error } = await query;
  if (error) {
    log.error({ error: error.message, id }, 'Failed to delete memory');
    return false;
  }
  return true;
}

export async function updateMemory(
  id: number,
  patches: {
    summary?: string;
    content?: string;
    tags?: string[];
    importance?: number;
    memory_type?: MemoryType;
  }
): Promise<boolean> {
  const db = getDb();
  const updates: Record<string, unknown> = {};
  if (patches.summary !== undefined) updates['summary'] = patches.summary.slice(0, 500);
  if (patches.content !== undefined) updates['content'] = patches.content.slice(0, 5000);
  if (patches.tags !== undefined) updates['tags'] = patches.tags;
  if (patches.importance !== undefined) updates['importance'] = Math.max(0, Math.min(1, patches.importance));
  if (patches.memory_type !== undefined) updates['memory_type'] = patches.memory_type;
  if (Object.keys(updates).length === 0) return true;

  let query = db.from('memories').update(updates).eq('id', id);
  query = scopeToOwner(query);
  const { error } = await query;
  if (error) {
    log.error({ error: error.message, id }, 'Failed to update memory');
    return false;
  }
  return true;
}

export async function listMemories(opts: {
  page?: number;
  page_size?: number;
  memory_type?: MemoryType;
  min_importance?: number;
  order?: 'created_at' | 'importance' | 'last_accessed';
}): Promise<{ memories: Memory[]; total: number }> {
  const db = getDb();
  const pageSize = Math.min(opts.page_size ?? 20, 100);
  const page = Math.max((opts.page ?? 1) - 1, 0);
  const orderCol = opts.order ?? 'created_at';

  let countQ = db.from('memories').select('id', { count: 'exact', head: true });
  countQ = scopeToOwner(countQ);
  if (opts.memory_type) countQ = countQ.eq('memory_type', opts.memory_type);
  if (opts.min_importance !== undefined) countQ = countQ.gte('importance', opts.min_importance);
  const { count } = await countQ;

  let dataQ = db.from('memories').select('*').order(orderCol, { ascending: false })
    .range(page * pageSize, (page + 1) * pageSize - 1);
  dataQ = scopeToOwner(dataQ);
  if (opts.memory_type) dataQ = dataQ.eq('memory_type', opts.memory_type);
  if (opts.min_importance !== undefined) dataQ = dataQ.gte('importance', opts.min_importance);
  const { data, error } = await dataQ;
  if (error) {
    log.error({ error: error.message }, 'Failed to list memories');
    return { memories: [], total: 0 };
  }
  return { memories: decryptMemoryBatch(data || []), total: count ?? 0 };
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
    byType: { episodic: 0, semantic: 0, procedural: 0, self_model: 0, introspective: 0 },
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
    // Get exact total count (Supabase defaults to max 1000 rows)
    let countQuery = db
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .gt('decay_factor', MEMORY_MIN_DECAY);
    countQuery = scopeToOwner(countQuery);
    const { count: totalCount } = await countQuery;
    stats.total = totalCount || 0;

    // Get embedded count separately
    let embeddedQuery = db
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .gt('decay_factor', MEMORY_MIN_DECAY)
      .not('embedding', 'is', null);
    embeddedQuery = scopeToOwner(embeddedQuery);
    const { count: embCount } = await embeddedQuery;
    stats.embeddedCount = embCount || 0;

    // Fetch rows for aggregation — paginate to get all (without embedding column to reduce payload)
    const PAGE_SIZE = 5000;
    let allMemories: any[] = [];
    let page = 0;
    while (true) {
      let pageQuery = db
        .from('memories')
        .select('memory_type, importance, decay_factor, created_at, related_user, tags, concepts')
        .gt('decay_factor', MEMORY_MIN_DECAY)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      pageQuery = scopeToOwner(pageQuery);
      const { data: pageData } = await pageQuery;
      if (!pageData || pageData.length === 0) break;
      allMemories = allMemories.concat(pageData);
      if (pageData.length < PAGE_SIZE) break;
      page++;
    }

    if (allMemories.length > 0) {
      let impSum = 0;
      let decaySum = 0;
      const tagCounts: Record<string, number> = {};
      const conceptCounts: Record<string, number> = {};
      const users = new Set<string>();

      for (const m of allMemories) {
        const type = m.memory_type as MemoryType;
        if (type in stats.byType) stats.byType[type]++;
        impSum += m.importance;
        decaySum += m.decay_factor;
        if (m.related_user) users.add(m.related_user);
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

      stats.avgImportance = impSum / allMemories.length;
      stats.avgDecay = decaySum / allMemories.length;
      stats.uniqueUsers = users.size;

      stats.topTags = Object.entries(tagCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([tag, count]) => ({ tag, count }));

      stats.topConcepts = Object.entries(conceptCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([concept, count]) => ({ concept, count }));

      const sorted = allMemories.map(m => m.created_at).sort();
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
  const introspective = memories.filter(m => m.memory_type === 'introspective');

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
    lines.push('### Learned Strategies (from past outcomes)');
    for (const m of procedural) {
      const meta = m.metadata as Record<string, any> | undefined;
      const confidence = meta?.positiveRate != null
        ? ` [${Math.round(meta.positiveRate * 100)}% success rate, based on ${meta.basedOn || '?'} interactions]`
        : '';
      lines.push(`- ${m.summary}${confidence}`);
    }
  }

  if (introspective.length > 0) {
    lines.push('### Your Own Reflections');
    for (const m of introspective) {
      lines.push(`- [${timeAgo(m.created_at)}] ${m.summary}`);
    }
  }

  if (selfModel.length > 0) {
    lines.push('### Self-Observations');
    for (const m of selfModel) {
      lines.push(`- ${m.summary}`);
    }
  }

  lines.push('');
  lines.push('You REMEMBER these interactions and facts. Reference them naturally if relevant.');
  if (procedural.length > 0) {
    lines.push('');
    lines.push('IMPORTANT: You MUST follow the Learned Strategies above. They are behavioral rules you derived from analyzing your own past successes and failures. Apply them to this response.');
  }

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

  if (opts.feature === 'question') score += 0.15;

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
