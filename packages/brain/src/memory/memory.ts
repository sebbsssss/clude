import { getDb } from '@clude/shared/core/database';
import { config } from '@clude/shared/config';
import { createChildLogger } from '@clude/shared/core/logger';
import { renderGroundedLine, byMemoryDateAsc } from '@clude/shared/core/memory-grounding';
import {
  clamp,
  timeAgo,
  MEMORY_MIN_DECAY,
  MEMORY_MAX_CONTENT_LENGTH,
  EMBEDDING_FRAGMENT_MAX_LENGTH,
  MEMORY_MAX_SUMMARY_LENGTH,
  RECENCY_DECAY_BASE,
  RETRIEVAL_WEIGHT_RECENCY,
  RETRIEVAL_WEIGHT_RELEVANCE,
  RETRIEVAL_WEIGHT_IMPORTANCE,
  RETRIEVAL_WEIGHT_VECTOR,
  RETRIEVAL_WEIGHT_BM25,
  RETRIEVAL_WEIGHT_GRAPH,
  RETRIEVAL_WEIGHT_COOCCURRENCE,
  VECTOR_MATCH_THRESHOLD,
  KNOWLEDGE_TYPE_BOOST,
  DECAY_RATES,
  LINK_SIMILARITY_THRESHOLD,
  MAX_AUTO_LINKS,
  LINK_CO_RETRIEVAL_BOOST,
  INTERNAL_MEMORY_SOURCES,
  BOND_TYPE_WEIGHTS,
} from '@clude/shared/utils';
import type { MemoryLinkType } from '@clude/shared/utils/constants';
import { generateImportanceScore } from '@clude/shared/core/claude-client';
import { writeMemo, isRegistryEnabled, registerMemoryOnChain } from '@clude/shared/core/solana-client';
import { memoryContentHash } from '@clude/tokenization';
import { generateEmbedding, generateQueryEmbedding, generateEmbeddings, isEmbeddingEnabled, generateVertexEmbeddings, generateQueryEmbeddingForSpace, isVertexConfigured } from '@clude/shared/core/embeddings';
import { activeEmbeddingSpace, vectorRpcName } from '@clude/shared/core/migration-profile';
import {
  autoCategorizeTags,
  DEFAULT_PACK_ID,
  topicEmbedSources,
  semanticTagMatches,
} from '@clude/shared/wiki-packs';
import { getExperimentalConfig } from '../experimental/config';
import { bm25SearchMemories } from '../experimental/bm25-search';
import { setContentTokens } from './content-tokens';
import { runReconcileShadow } from './reconcile-shadow';
import { encryptForStorage, delegationStateForWrite } from './memory-encryption';
import { isOpenRouterEnabled } from '@clude/shared/core/openrouter-client';
import { generateMemoryOp } from '@clude/shared/core/memory-ops';
import { isMemoryModelEnabled, isOllamaEnabled } from '@clude/shared/core/inference';
import { isEncryptionEnabled, getEncryptionPubkey, encryptContent } from '@clude/shared/core/encryption';
import { decryptMemories } from './memory-decryption';
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
import { extractAndLinkEntities, findSimilarEntities, getMemoriesByEntity, getEntityCooccurrences } from './graph';
import { getContextOwnerWallet } from '@clude/shared/core/owner-context';

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

/**
 * Owner-scope fail-closed flag (Memory 3.0 C0). Read live so benchmarks and
 * staged rollouts can flip it without a rebuild. When ON, "no owner in scope"
 * resolves to SCOPE_BOT_OWN (the bot's own memories) instead of null (no
 * filter = every tenant's memories, the fail-open half of the PR #290 class).
 */
export function isOwnerScopeFailClosed(): boolean {
  return process.env.OWNER_SCOPE_FAILCLOSED === 'true';
}

/**
 * Effective owner scope for READ paths: a tenant wallet, SCOPE_BOT_OWN, or null.
 * Null (legacy fail-open) survives only while the flag is off. Migration 019
 * teaches the recall RPCs the sentinel; against an older RPC the sentinel
 * matches zero rows, so an early flip fails CLOSED, never cross-tenant.
 *
 * WRITE paths must keep using getOwnerWallet() (the sentinel is a filter,
 * never a value to store — bot rows stay owner_wallet NULL).
 */
export function getOwnerScope(): string | null {
  const wallet = getOwnerWallet();
  if (wallet) return wallet;
  return isOwnerScopeFailClosed() ? SCOPE_BOT_OWN : null;
}

export function scopeToOwner<T>(query: T): T {
  const scope = getOwnerScope();
  if (scope === SCOPE_BOT_OWN) {
    return (query as any).is('owner_wallet', null);
  }
  if (scope) {
    return (query as any).eq('owner_wallet', scope);
  }
  return query;
}

/**
 * Owner post-guard (defense-in-depth, Memory 3.0 C0): strips rows that escaped
 * RPC-level scoping via the entity / graph / fragment expansion paths. Pure so
 * it is directly testable; recallMemories applies it after every phase merged.
 */
export function applyOwnerPostGuard<T extends { owner_wallet?: string | null }>(
  results: T[],
  scope: string | null,
): { kept: T[]; stripped: number } {
  if (!scope) return { kept: results, stripped: 0 };
  const kept =
    scope === SCOPE_BOT_OWN
      ? results.filter((m) => m.owner_wallet == null)
      : results.filter((m) => m.owner_wallet === scope);
  return { kept, stripped: results.length - kept.length };
}

/**
 * BENCH_MODE (Memory 3.0 C0): read-only recall. Benchmarks must observe the
 * corpus, not mutate it — access boosts (access_count / last_accessed /
 * decay_factor bumps) and Hebbian link reinforcement change retrieval state on
 * every read, which is why a reused seeded wallet drifts (+2.6pp measured from
 * data freshness alone). The harness preflight asserts this is set; prod never
 * sets it.
 */
export function isBenchMode(): boolean {
  return process.env.BENCH_MODE === 'true';
}

/**
 * Should this recall mutate read-state? Callers pass RecallOptions; BENCH_MODE
 * overrides everything. Pure, exported for tests.
 */
export function shouldTrackAccess(opts: { trackAccess?: boolean }): boolean {
  if (isBenchMode()) return false;
  return opts.trackAccess !== false;
}

/**
 * Fragment-lane RPC args (Memory 3.0 C0 / P0.3 fragment parity). The extended
 * filters (min_decay, filter_types) exist only in the migration-043 signature
 * of match_memory_fragments; PostgREST matches RPCs by named args, so sending
 * them to the old 4-arg function finds no match and the lane dies. Flip
 * MEMORY_FRAGMENT_FILTERS=true only AFTER 043 is applied. The reverse is safe:
 * old-style 4-arg calls keep working against the new function via parameter
 * defaults, so the flip is one-way and the flag can be retired later.
 */
export function buildFragmentRpcArgs(opts: {
  embeddingJson: string;
  matchThreshold: number;
  matchCount: number;
  minDecay: number;
  memoryTypes?: string[] | null;
}): Record<string, unknown> {
  const args: Record<string, unknown> = {
    query_embedding: opts.embeddingJson,
    match_threshold: opts.matchThreshold,
    match_count: opts.matchCount,
    filter_owner: getOwnerScope(),
  };
  if (process.env.MEMORY_FRAGMENT_FILTERS === 'true') {
    args.min_decay = opts.minDecay;
    args.filter_types = opts.memoryTypes && opts.memoryTypes.length > 0 ? opts.memoryTypes : null;
  }
  return args;
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
  // Recall instrumentation — populated during recallMemories(), not persisted to DB
  link_path?: Array<'vector' | 'bm25' | 'entity' | 'jepa'>;
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

// Heuristic importance when caller omits it. Replaces the old flat-0.5 default
// (41% of all rows were exactly 0.5). Tunable; explicit importance always wins.
export function scoreImportanceOnWrite(opts: StoreMemoryOptions): number {
  const base: Record<string, number> = {
    self_model: 0.75, semantic: 0.70, procedural: 0.65, introspective: 0.60, episodic: 0.45,
  };
  let score = base[opts.type] ?? 0.5;
  const len = (opts.content ?? '').trim().length;
  score += Math.min(len / 1000, 0.15);            // longer = a bit more important (cap +0.15)
  if (opts.tags && opts.tags.length) score += 0.05;
  // Score the concept bonus source-blind for internal sources: inferConcepts()
  // grants 'self_insight'/'identity_evolution' from the source alone, which would
  // cancel the internal-source nudge below. (Stored concepts keep the real source.)
  const conceptSource = INTERNAL_MEMORY_SOURCES.has(opts.source) ? '' : opts.source;
  const concepts = opts.concepts ?? inferConcepts(opts.summary, conceptSource, opts.tags || []);
  if (concepts.length) score += 0.05;
  if (INTERNAL_MEMORY_SOURCES.has(opts.source)) score -= 0.05;  // dream/reflection slightly lower
  return Math.max(0, Math.min(1, score));
}

// ---- STORE DEDUP ---- //
//
// Prevents high-frequency external agents (e.g. Shiro trading cycles) from
// flooding the DB with identical memories every few seconds.
// Keyed by source+normalizedSummary; TTL = 10 minutes.

const DEDUP_TTL_MS = 10 * 60 * 1000;
const dedupCache = new Map<string, number>(); // key -> last write timestamp

/**
 * Normalize a summary for dedup comparison.
 * Strips UUIDs and ISO timestamps so "Mission cycle <uuid>: hold" de-dupes correctly.
 */
function normalizeSummary(summary: string): string {
  return summary
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*/g, '<ts>')
    .toLowerCase()
    .trim();
}

function isDuplicateWrite(source: string, summary: string): boolean {
  const key = `${source}::${normalizeSummary(summary)}`;
  const last = dedupCache.get(key);
  if (last && Date.now() - last < DEDUP_TTL_MS) return true;
  dedupCache.set(key, Date.now());
  // Evict stale entries periodically to prevent unbounded growth
  if (dedupCache.size > 500) {
    const cutoff = Date.now() - DEDUP_TTL_MS;
    for (const [k, ts] of dedupCache) {
      if (ts < cutoff) dedupCache.delete(k);
    }
  }
  return false;
}

// ─────────── Installed wiki packs cache ───────────
//
// storeMemory() runs on every memory write. Querying wiki_pack_installations
// every time would be wasteful — pack lists change rarely. Cache per wallet
// for 60s. Workspace pack is implicit so a missing/empty cache still
// triggers default-pack categorisation.

interface InstalledPacksCacheEntry {
  ids: string[];
  expiresAt: number;
}
const installedPacksCache = new Map<string, InstalledPacksCacheEntry>();
const INSTALLED_PACKS_TTL_MS = 60_000;

async function getInstalledPackIdsCached(ownerWallet: string | null): Promise<string[]> {
  const key = ownerWallet ?? '__no_owner__';
  const now = Date.now();
  const cached = installedPacksCache.get(key);
  if (cached && cached.expiresAt > now) return cached.ids;

  let ids: string[] = [DEFAULT_PACK_ID];
  if (ownerWallet) {
    try {
      const db = getDb();
      const { data, error } = await db
        .from('wiki_pack_installations')
        .select('pack_id')
        .eq('owner_wallet', ownerWallet);
      if (!error && data) {
        const fromDb = data.map((r) => r.pack_id);
        ids = Array.from(new Set([DEFAULT_PACK_ID, ...fromDb]));
      }
    } catch (err) {
      log.debug({ err }, 'Failed to fetch installed packs (using default only)');
    }
  }

  installedPacksCache.set(key, { ids, expiresAt: now + INSTALLED_PACKS_TTL_MS });

  // Bound cache size — evict expired entries when we cross 200 wallets.
  if (installedPacksCache.size > 200) {
    for (const [k, v] of installedPacksCache) {
      if (v.expiresAt <= now) installedPacksCache.delete(k);
    }
  }

  return ids;
}

/** Test/admin helper: clear the installed-packs cache (e.g. after install/uninstall). */
export function invalidateInstalledPacksCache(ownerWallet?: string): void {
  if (ownerWallet) installedPacksCache.delete(ownerWallet);
  else installedPacksCache.clear();
}

// ─────────── Topic embeddings cache (semantic tagger) ───────────
//
// We embed each pack topic's name + summary + section titles ONCE (per
// process lifetime) and cosine against incoming memory embeddings. The
// cache is module-level since the manifests are static across requests.

const topicEmbeddingCache = new Map<string, number[]>(); // topicId → embedding
let topicEmbeddingPopulationLock: Promise<void> | null = null;

async function ensureTopicEmbeddings(installedPackIds: string[]): Promise<Map<string, number[]>> {
  const sources = topicEmbedSources(installedPackIds);
  const missing = sources.filter((s) => !topicEmbeddingCache.has(s.topicId));

  if (missing.length === 0) {
    return new Map(sources.map((s) => [s.topicId, topicEmbeddingCache.get(s.topicId)!]));
  }

  // Single-flight: if another request is already populating, await it.
  if (topicEmbeddingPopulationLock) {
    await topicEmbeddingPopulationLock;
  }
  // Re-check after the lock — peer may have populated what we need.
  const stillMissing = sources.filter((s) => !topicEmbeddingCache.has(s.topicId));
  if (stillMissing.length === 0) {
    return new Map(sources.map((s) => [s.topicId, topicEmbeddingCache.get(s.topicId)!]));
  }

  topicEmbeddingPopulationLock = (async () => {
    try {
      const texts = stillMissing.map((s) => s.text);
      const embeddings = await generateEmbeddings(texts);
      stillMissing.forEach((s, i) => {
        const emb = embeddings[i];
        if (emb) topicEmbeddingCache.set(s.topicId, emb);
      });
    } catch (err) {
      log.warn({ err }, 'Failed to populate topic embeddings cache');
    } finally {
      topicEmbeddingPopulationLock = null;
    }
  })();
  await topicEmbeddingPopulationLock;

  return new Map(
    sources
      .filter((s) => topicEmbeddingCache.has(s.topicId))
      .map((s) => [s.topicId, topicEmbeddingCache.get(s.topicId)!]),
  );
}

// ---- STORE ---- //

export async function storeMemory(opts: StoreMemoryOptions): Promise<number | null> {
  // Reject empty-content memories outright — they skip embedding yet still surface in
  // recall, wasting compute on nothing (see migration 022). The DB CHECK is defense-in-depth.
  const trimmedContent = (opts.content ?? '').trim();
  if (!trimmedContent) { log.warn({ source: opts.source }, 'Rejected empty-content memory'); return null; }

  // Skip duplicate writes from high-frequency external agent sources.
  // Applies to any source whose writes are repetitive by nature (shiro_* trading cycles, etc.)
  if (opts.source.startsWith('shiro_') && isDuplicateWrite(opts.source, opts.summary)) {
    log.debug({ source: opts.source, summary: opts.summary.slice(0, 60) }, 'Skipping duplicate memory write');
    return null;
  }

  const db = getDb();
  const ownerWallet = getOwnerWallet();

  // Heuristic auto-score when caller omits importance; explicit value always wins.
  const importance = clamp(opts.importance ?? scoreImportanceOnWrite(opts), 0, 1);

  // Auto-classify concepts if not explicitly provided
  const concepts = opts.concepts || inferConcepts(opts.summary, opts.source, opts.tags || []);

  // Auto-route memory to wiki-pack topics whose keyword rules match.
  // Workspace pack runs implicitly; additional packs come from the
  // owner's wiki_pack_installations row (cached briefly to avoid
  // hammering the DB on every store).
  const installedPackIds = await getInstalledPackIdsCached(ownerWallet);
  const taggedTags = autoCategorizeTags({
    content: opts.content,
    summary: opts.summary,
    existingTags: opts.tags || [],
    installedPackIds,
  });

  // Generate collision-resistant hash ID (Beads-inspired)
  const hashId = generateHashId();

  try {
    // Encrypt content (content only — summary/tags/metadata stay plaintext). Precedence:
    // envelope (PMP §5) → legacy SDK scheme (configureEncryption, cortex.ts) → plaintext.
    // Store the trimmed text (see empty-content guard above).
    const plaintextContent = trimmedContent.slice(0, MEMORY_MAX_CONTENT_LENGTH);
    const envelope = await encryptForStorage(plaintextContent, ownerWallet || null);
    const legacyEncrypt = !envelope && isEncryptionEnabled();
    const storedContent = envelope
      ? envelope.ciphertext
      : legacyEncrypt
      ? encryptContent(plaintextContent)
      : plaintextContent;

    const { data, error } = await db
      .from('memories')
      .insert({
        hash_id: hashId,
        memory_type: opts.type,
        content: storedContent,
        summary: opts.summary.slice(0, MEMORY_MAX_SUMMARY_LENGTH),
        tags: taggedTags,
        concepts,
        emotional_valence: clamp(opts.emotionalValence ?? 0, -1, 1),
        importance,
        source: opts.source,
        source_id: opts.sourceId || null,
        related_user: opts.relatedUser || null,
        related_wallet: opts.relatedWallet || null,
        metadata: opts.metadata || {},
        evidence_ids: opts.evidenceIds || [],
        compacted: false,
        encrypted: envelope !== null || legacyEncrypt,
        encryption_pubkey: envelope ? envelope.ownerPubkey : legacyEncrypt ? getEncryptionPubkey() : null,
        provider_delegated: delegationStateForWrite(envelope !== null), // true|null at write; false is revoke-only (§7)
        owner_wallet: ownerWallet || null,
      })
      .select('id, hash_id, content, memory_type, owner_wallet, created_at, tags, source, related_user, related_wallet')
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
      importance,
      concepts,
    }, 'Memory stored');

    // Lexical index over plaintext content (keyword/BM25 recall; cleared on revoke — encryption §9).
    await setContentTokens(db, data.id, plaintextContent);

    // Persist the wrapped DEKs (owner + provider). Must never be logged (§14).
    if (envelope) {
      const { error: wrapErr } = await db.from('memory_dek_wraps').insert(
        envelope.wraps.map(w => ({ memory_id: data.id, ...w })),
      );
      if (wrapErr) {
        // Without wraps the ciphertext is permanently undecryptable (the DEK is discarded).
        // Revert to plaintext-at-rest so no data is lost — plaintextContent is still in scope.
        log.error({ id: data.id, error: wrapErr.message }, 'DEK wrap write failed — reverting memory to plaintext');
        await db.from('memories').update({
          content: plaintextContent,
          encrypted: false,
          encryption_pubkey: null,
          provider_delegated: null,
        }).eq('id', data.id);
      }
    }

    // Notify reflection trigger system (Park et al. 2023 — event-driven reflection)
    eventBus.emit('memory:stored', {
      importance,
      memoryType: opts.type,
      source: opts.source,
    });

    // Commit memory to Solana (fire-and-forget). ALWAYS runs, independent of the outbox flag —
    // it has its own durability story (tokenization_status) and is NOT an outbox job. v0.1:
    // dual-writes the legacy solana_signature AND the PMP tokenisation columns. v0.2 will drop
    // the legacy path once verifiers are on PMP exclusively.
    commitMemoryToChain(data.id, opts, data as MemoryRowForTokenisation, plaintextContent, envelope !== null || legacyEncrypt).catch(err =>
      log.warn({ err }, 'On-chain memory commit failed'),
    );

    // Enrichment (embed → link → extract). Memory 3.0 C2: when MEMORY_OUTBOX is on AND the
    // enqueue lands, a single durable 'enrich' job replaces the fire-and-forget triad (whose
    // errors were swallowed with no retry — 429s at scale silently dropped enrichment). If the
    // flag is off, or the enqueue degrades (migration 044 unapplied), fall back to fire-and-forget
    // so behavior is never worse than today.
    let enqueued = false;
    if (config.memory.outboxEnabled) {
      enqueued = await enqueueEnrichJob(db, data.id);
    }
    if (!enqueued) {
      const embedP = embedMemory(data.id, opts);
      embedP.catch(err => log.warn({ err }, 'Embedding generation failed'));
      autoLinkMemory(data.id, opts).catch(err => log.warn({ err }, 'Auto-linking failed'));
      extractAndLinkEntitiesForMemory(data.id, opts).catch(err => log.debug({ err }, 'Entity extraction failed'));
      // Memory 3.0 C1 SHADOW: record a proposed reconcile op AFTER the embedding is persisted (it
      // reads memories.embedding — no re-embed). Scope captured eagerly (getOwnerScope() can be
      // null / fail-open when the C0 fence flag is off, so pass the write's own resolved owner).
      // Fully detached — chained on embedP but never awaited before return; runReconcileShadow
      // never throws, so the .catch only swallows an embed rejection.
      if (config.memory.reconcileEnabled) {
        const reconcileScope = ownerWallet || SCOPE_BOT_OWN;
        embedP.then(() => runReconcileShadow(data.id, reconcileScope)).catch(() => {});
      }
    }

    return data.id;
  } catch (err) {
    log.error({ err }, 'Memory store failed');
    return null;
  }
}

// ---- ON-CHAIN COMMIT ---- //

/**
 * Subset of memory row fields needed to compute the PMP canonical content
 * hash. Returned by the post-insert `.select()` in storeMemory().
 */
interface MemoryRowForTokenisation {
  id: number;
  hash_id: string;
  content: string;
  memory_type: MemoryType;
  owner_wallet: string | null;
  created_at: string;
  tags: string[] | null;
  source: string | null;
  related_user: string | null;
  related_wallet: string | null;
}

const TOKENISATION_SKIP_SOURCES = new Set([
  'demo',
  'demo-maas',
  'locomo-benchmark',
  'longmemeval-benchmark',
]);

async function commitMemoryToChain(
  memoryId: number,
  opts: StoreMemoryOptions,
  row: MemoryRowForTokenisation,
  plaintextContent: string,
  encrypted: boolean,
): Promise<void> {
  // Skip mainnet commits for demo / benchmark memories
  if (TOKENISATION_SKIP_SOURCES.has(opts.source)) return;

  // 1. Canonical PMP hash — what verifiers recompute on /v1/memories/:id/verify.
  //    Hashed over the PLAINTEXT content (never the stored column, which may be
  //    ciphertext) so the commitment is a stable identity; VERIFY recomputes over
  //    decrypted content (PMP §8).
  const canonicalHash = memoryContentHash({
    content: plaintextContent,
    memory_type: row.memory_type,
    owner_wallet: row.owner_wallet,
    created_at: row.created_at,
    tags: row.tags ?? [],
    source: row.source,
    related_user: row.related_user,
    related_wallet: row.related_wallet,
  });

  // 2. Chain write — legacy registry program first, memo fallback. The
  //    registry program still takes a 32-byte content hash; we use the
  //    canonical hash (same bytes) so on-chain and off-chain agree.
  const contentHashBuf = Buffer.from(canonicalHash, 'hex');
  let signature: string | null = null;

  if (isRegistryEnabled()) {
    signature = await registerMemoryOnChain(
      contentHashBuf,
      opts.type,
      opts.importance ?? 0.5,
      memoryId,
      encrypted,
    );
  }

  // Fallback to memo if registry unavailable or failed.
  //
  // Format `clude:v1:sha256:<hex>` matches the MemoryPack v0.1 spec
  // `memo-v1` anchor. Replaces the legacy `clude-memory | v2 | <hex>`
  // so third-party readers can parse our anchors against the public
  // spec. Existing on-chain memos are unaffected; only new writes
  // use the new format.
  if (!signature) {
    const memo = `clude:v1:sha256:${canonicalHash}`;
    signature = await writeMemo(memo);
  }

  const db = getDb();

  if (!signature) {
    // Mark failed so the PMP backfill worker retries later.
    await db
      .from('memories')
      .update({ content_hash: canonicalHash, tokenization_status: 'failed' })
      .eq('id', memoryId);
    return;
  }

  // 3. Dual-write: legacy solana_signature + new PMP columns.
  //    cnft_address records the registry PDA / memo-prefixed sig so the
  //    /v1/memories/:id/verify endpoint can return a real attestation.
  await db
    .from('memories')
    .update({
      solana_signature: signature,
      content_hash: canonicalHash,
      cnft_address: signature, // PDA-based v0.1 — assetId = tx sig; LightMintClient (v0.2) will use real cNFT mints
      cnft_tx_sig: signature,
      cnft_tree: null,
      cnft_leaf_index: null,
      tokenization_status: 'minted',
      tokenized_at: new Date().toISOString(),
    })
    .eq('id', memoryId);

  log.debug({ memoryId, signature: signature.slice(0, 16) }, 'Memory committed on-chain (PMP + legacy)');
}

// ---- EMBEDDING & GRANULAR DECOMPOSITION ---- //

/**
 * Generate vector embedding for a memory's summary and store it.
 */
// ── Memory 3.0 C2: durable enrichment outbox enqueue ────────────────────────
// storeMemory enqueues ONE 'enrich' job (embed → link → extract run in order by the worker)
// when MEMORY_OUTBOX is on. Never throws: any error (e.g. relation-missing 42P01 when migration
// 044 is unapplied) returns false so the caller falls back to fire-and-forget — behavior is never
// worse than today. The degrade is logged exactly once to avoid log spam.
let outboxDegradeLogged = false;
function logOutboxDegradeOnce(err: unknown, memoryId: number): void {
  if (outboxDegradeLogged) return;
  outboxDegradeLogged = true;
  const e = err as { code?: string; message?: string };
  log.warn(
    { code: e?.code, message: e?.message, memoryId },
    'Outbox enqueue degraded — falling back to fire-and-forget (migration 044 unapplied?)',
  );
}

async function enqueueEnrichJob(db: ReturnType<typeof getDb>, memoryId: number): Promise<boolean> {
  try {
    const { error } = await db.from('memory_write_jobs').insert({ memory_id: memoryId, job_type: 'enrich' });
    if (error) {
      logOutboxDegradeOnce(error, memoryId);
      return false;
    }
    return true;
  } catch (err) {
    logOutboxDegradeOnce(err, memoryId);
    return false;
  }
}

/** @internal test-only reset for the once-guard. */
export function _resetOutboxDegradeLog(): void {
  outboxDegradeLogged = false;
}

/**
 * Memory 3.0 C2: the enrichment pipeline the outbox worker runs for an 'enrich' job, in
 * dependency order (autoLinkMemory reads the memory's own embedding, written by embedMemory).
 * Sequential + awaited (unlike the fire-and-forget triad) so a whole-job retry re-runs all three;
 * each step is idempotent (embed delete-before-insert, link unique-index upsert, extract
 * upsert-RPC). The caller (outbox-worker) wraps this in withOwnerWallet(job owner) so the
 * ambient owner scope is correct off the poller tick.
 */
export async function runEnrichPipeline(memoryId: number, opts: StoreMemoryOptions): Promise<void> {
  await embedMemory(memoryId, opts, { replaceFragments: true });
  await autoLinkMemory(memoryId, opts);
  await extractAndLinkEntitiesForMemory(memoryId, opts);
  // Memory 3.0 C1 SHADOW: the outbox path's reconcile home — after embedMemory persisted the
  // vector this reads. The worker wraps this in withOwnerWallet(job owner), so getOwnerWallet() is
  // the job's owner; fall back to the bot-own sentinel (never null → always owner-fenced). Never
  // throws; never mutates a memory row.
  if (config.memory.reconcileEnabled) {
    await runReconcileShadow(memoryId, getOwnerWallet() || SCOPE_BOT_OWN);
  }
}

/**
 * storeMemory + outbox status, for callers that want the {hash_id, jobs_queued} shape (the design
 * contract). storeMemory itself keeps its number|null signature (zero call-site churn); this thin
 * wrapper reads the ground truth back: jobs_queued counts the memory's outbox rows (1 when the
 * enrich job enqueued, 0 when the flag is off or the enqueue degraded to fire-and-forget).
 */
export async function storeMemoryWithOutbox(
  opts: StoreMemoryOptions,
): Promise<{ id: number; hash_id: string; jobs_queued: number } | null> {
  const id = await storeMemory(opts);
  if (id === null) return null;
  const db = getDb();
  const { data: row } = await db.from('memories').select('hash_id').eq('id', id).maybeSingle();
  const { count } = await db
    .from('memory_write_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('memory_id', id);
  return { id, hash_id: (row?.hash_id as string) ?? '', jobs_queued: count ?? 0 };
}

async function embedMemory(
  memoryId: number,
  opts: StoreMemoryOptions,
  embedOpts: { replaceFragments?: boolean } = {},
): Promise<void> {
  if (!isEmbeddingEnabled()) return;

  const db = getDb();

  // ── Fragment decomposition ─────────────────────────────────────────
  // Restored from commit b7624c25^ (deleted Apr 2 2026, restored 2026-05-23).
  // Each memory generates multiple embedding fragments so that retrieval
  // can hit any of:
  //   - summary  (the same text we keep on `memories.embedding` for back-compat)
  //   - content_chunk × N  (content split at sentence boundaries, max
  //                          EMBEDDING_FRAGMENT_MAX_LENGTH chars each)
  //   - tag_context  (tags + concepts written as a natural sentence)
  //
  // Removing fragments was the single largest LongMemEval-S regression we
  // ever measured (-17.5pp; SS-Pref 100→53, SS-User 97→64). The schema
  // (memory_fragments table, HNSW index, match_memory_fragments RPC) was
  // kept intact through the deletion, so we restore by writing again.
  const fragments: { type: 'summary' | 'content_chunk' | 'tag_context'; text: string }[] = [];

  fragments.push({ type: 'summary', text: opts.summary });

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

  const allLabels = [...(opts.tags || []), ...(opts.concepts || inferConcepts(opts.summary, opts.source, opts.tags || []))];
  if (allLabels.length > 0) {
    fragments.push({ type: 'tag_context', text: `Context: ${allLabels.join(', ')}. ${opts.summary}` });
  }

  // Batch-generate all embeddings in a single call.
  const embeddings = await generateEmbeddings(fragments.map(f => f.text));
  const summaryEmbedding = embeddings[0];

  if (!summaryEmbedding) {
    log.debug({ memoryId }, 'No embedding generated; skipping semantic tagging');
    return;
  }

  // Shadow-space dual-write (GCP migration Slice 3b): when Vertex is configured
  // (VERTEX_PROJECT set), embed the SAME fragment texts into the Vertex space and
  // store them in the embedding_vertex column alongside the Voyage vectors. Keeping
  // both spaces current is what lets recall flip via EMBEDDING_ACTIVE and roll back
  // instantly. Non-fatal and never blocks the Voyage write; a no-op (zero cost) when
  // VERTEX_PROJECT is unset. Only writes the column when a vector exists, so it is
  // safe on a DB where migration 040 has not yet added embedding_vertex.
  const vertexEmbeddings = isVertexConfigured()
    ? await generateVertexEmbeddings(fragments.map(f => f.text))
    : [];
  const vertexSummary = vertexEmbeddings[0];

  // Persist the summary embedding on the memory row first — primary recall depends on it.
  await db
    .from('memories')
    .update({
      embedding: JSON.stringify(summaryEmbedding),
      ...(vertexSummary ? { embedding_vertex: JSON.stringify(vertexSummary) } : {}),
    })
    .eq('id', memoryId);

  // Persist all fragments with their own embeddings. Failures here are
  // non-fatal: the summary embedding is already saved, so recall continues
  // to work — just without the precision boost.
  const fragmentRows = fragments
    .map((f, i) => ({
      memory_id: memoryId,
      fragment_type: f.type,
      content: f.text.slice(0, EMBEDDING_FRAGMENT_MAX_LENGTH),
      embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
      ...(vertexEmbeddings[i] ? { embedding_vertex: JSON.stringify(vertexEmbeddings[i]) } : {}),
    }))
    .filter(r => r.embedding !== null);

  if (fragmentRows.length > 0) {
    // Memory 3.0 C2: the outbox worker re-runs enrichment on retry, so it passes
    // replaceFragments to make this idempotent (delete-before-insert). Embeddings are already
    // computed above, so the destructive gap is the ms between delete and insert — no network
    // call sits inside it. The fire-and-forget path (flag off) keeps the plain insert.
    if (embedOpts.replaceFragments) {
      await db.from('memory_fragments').delete().eq('memory_id', memoryId);
    }
    const { error } = await db.from('memory_fragments').insert(fragmentRows);
    if (error) {
      log.warn({ err: error.message, memoryId }, 'Failed to store memory fragments (summary embedding intact)');
    }
  }

  // Semantic tagging layer: cosine the new memory's embedding against the
  // cached topic embeddings for this owner's installed packs. Tags whose
  // similarity exceeds the threshold get APPENDED to the memory's tag
  // column. The keyword layer (autoCategorizeTags) already ran inline at
  // store time; this is the precision-improving second pass.
  try {
    const ownerWallet = getOwnerWallet();
    const installedPacks = await getInstalledPackIdsCached(ownerWallet);
    const topicEmbeddings = await ensureTopicEmbeddings(installedPacks);

    if (topicEmbeddings.size > 0) {
      const semantic = semanticTagMatches(
        summaryEmbedding,
        Array.from(topicEmbeddings, ([topicId, embedding]) => ({ topicId, embedding })),
      );

      if (semantic.length > 0) {
        // Read current tags so we can merge — Supabase doesn't have a
        // native array-union update without RPC. The embedding write
        // above already touched this row, so the read is warm.
        const { data: row } = await db
          .from('memories')
          .select('tags')
          .eq('id', memoryId)
          .maybeSingle();

        const existing = (row?.tags ?? []) as string[];
        const merged = Array.from(new Set([...existing, ...semantic]));

        if (merged.length !== existing.length) {
          await db
            .from('memories')
            .update({ tags: merged })
            .eq('id', memoryId);
          log.debug({
            memoryId,
            added: semantic.filter((t) => !existing.includes(t)),
          }, 'Semantic pack tags appended');
        }
      }
    }
  } catch (err) {
    log.debug({ err, memoryId }, 'Semantic tagging skipped');
  }

  log.debug({ memoryId }, 'Memory embedded');
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
  // Need at least one generation backend: the local memory model or a frontier router.
  if (!isOpenRouterEnabled() && !isMemoryModelEnabled()) return [query];

  try {
    const response = await Promise.race([
      generateMemoryOp({
        cognitiveFunction: 'query', // memory op → local model when enabled, else fast frontier slot
        systemPrompt: 'You are a search query expander. Given a question, output 3 alternative phrasings that would help find relevant information in a memory database. Output ONLY the 3 alternatives, one per line. No numbering, no explanations.',
        userMessage: query,
        maxTokens: 150,
        temperature: 0.3,
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
        // Embed the query in the ACTIVE space (Voyage by default, Vertex when flipped)
        // so the query vector matches the column the (base or _vertex) match RPC reads.
        // activeEmbeddingSpace() is fixed per process (env-frozen), so the text-keyed
        // cache never mixes spaces within a deployment.
        const space = activeEmbeddingSpace();
        const queryEmbeddings = await Promise.all(
          queries.map(async q => {
            const cached = getCachedEmbedding(q);
            if (cached) return cached;
            const emb = await generateQueryEmbeddingForSpace(space, q);
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
          // Two searches per query embedding:
          //   1. match_memories       — memory-level similarity (always)
          //   2. match_memory_fragments — fragment-level (only when not in --skipExpansion fast mode)
          // Fragment search restored 2026-05-23 to recover from b7624c25 regression.
          // Fragments find facts buried in long memory bodies that the summary embedding misses.
          const allSearches = validEmbeddings.flatMap(emb => {
            const searches: Promise<any[]>[] = [
              Promise.resolve(db.rpc(vectorRpcName('match_memories'), {
                query_embedding: JSON.stringify(emb),
                match_threshold: VECTOR_MATCH_THRESHOLD,
                match_count: limit * (opts.skipExpansion ? 12 : 4),
                filter_types: opts.memoryTypes || null,
                filter_user: opts.relatedUser || null,
                min_decay: minDecay,
                filter_owner: getOwnerScope(),
                filter_tags: opts.tags && opts.tags.length > 0 ? opts.tags : null,
              })).then(r => r.data || []),
            ];
            if (!opts.skipExpansion) {
              searches.push(
                Promise.resolve(db.rpc(vectorRpcName('match_memory_fragments'), buildFragmentRpcArgs({
                  embeddingJson: JSON.stringify(emb),
                  matchThreshold: VECTOR_MATCH_THRESHOLD,
                  matchCount: limit * 2,
                  minDecay,
                  memoryTypes: opts.memoryTypes,
                }))).then(r => r.data || []),
              );
            }
            return searches;
          });

          const results = await Promise.all(allSearches);

          // Merge: take highest similarity per memory_id across ALL queries.
          // In !skipExpansion mode the results array is interleaved
          // [memory_search_q1, fragment_search_q1, memory_search_q2, fragment_search_q2, …].
          // Fragment results carry {memory_id, max_similarity} instead of {id, similarity}.
          let fragmentHits = 0;
          if (opts.skipExpansion) {
            for (const batch of results) {
              for (const m of batch) {
                const current = vectorScores.get(m.id) || 0;
                vectorScores.set(m.id, Math.max(current, m.similarity));
              }
            }
          } else {
            for (let i = 0; i < results.length; i++) {
              const isFragmentBatch = i % 2 === 1;
              for (const r of results[i]) {
                const id = isFragmentBatch ? r.memory_id : r.id;
                const sim = isFragmentBatch ? r.max_similarity : r.similarity;
                if (!id) continue;
                const current = vectorScores.get(id) || 0;
                vectorScores.set(id, Math.max(current, sim));
                if (isFragmentBatch) fragmentHits++;
              }
            }
          }

          log.debug({
            queryVariants: validEmbeddings.length,
            uniqueMemories: vectorScores.size,
            fragmentHits,
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
      .not('provider_delegated', 'is', false) // exclude revoked (encryption §7); vector + BM25 self-exclude via sealing
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

    // Phase 2c: BM25 full-text search (Exp 8) — stemming + TF-IDF ranking
    const expConfig = getExperimentalConfig();
    const bm25Promise = (expConfig.bm25Search && opts.query && opts.query.length > 3) ? (async () => {
      try {
        return await bm25SearchMemories(opts.query!, {
          limit: limit * 2,
          minDecay: minDecay,
          // Use getOwnerWallet() (AsyncLocalStorage-aware), NOT the bare module-level
          // _ownerWallet. withOwnerWallet() sets the async context, not the module var,
          // so the bare var is null under hosted/wrapped calls and BM25 would search the
          // ENTIRE table unscoped — burying the owner's exact-match facts. This is why
          // BM25 silently never surfaced bench facts even after the RPC was fixed.
          filterOwner: getOwnerScope() || undefined,
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

    const [importanceResult, knowledgeSeeds, , bm25Results] = await Promise.all([
      importanceQuery,
      (async () => { try { const r = await knowledgeSeedQuery; return (r as any).data || []; } catch { return []; } })(),
      vectorSearchPromise, // Ensure vector search completes before merge
      bm25Promise,
    ]);

    const { data, error } = importanceResult as { data: any; error: any };
    
    // Merge knowledge seeds into data
    if (data) {
      const existingIds = new Set((data as any[]).map((m: any) => m.id));
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
    let candidates: Memory[] = await decryptMemories(data || []);

    // If vector search found memories not in the metadata set, fetch them
    if (vectorScores.size > 0) {
      const metadataIds = new Set(candidates.map(m => m.id));
      const missingIds = [...vectorScores.keys()].filter(id => !metadataIds.has(id));

      if (missingIds.length > 0) {
        let vectorQuery = db
          .from('memories')
          .select('*')
          .in('id', missingIds)
          // P0.3: the backfill used to trust upstream filtering. The memory-level
          // lane does filter by decay, but the FRAGMENT lane (pre-migration-043)
          // does not — so decayed parents could re-enter here. Filter explicitly.
          .gte('decay_factor', minDecay)
          // Revoked-memory resurrection guard: every missing ID came from vector
          // similarity, and fragments are only written after the parent summary
          // embedding is stored — so a parent with a NULL embedding here means it
          // was revoked (revoke clears the embedding but pre-043 left fragments
          // live). Never resurrect it through the fragment lane.
          .not('embedding', 'is', null);
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
        if (vectorOnly) candidates = [...candidates, ...(await decryptMemories(vectorOnly))];
      }
    }

    if (candidates.length === 0) return [];

    // Build link_path map — tracks which retrieval signals surfaced each memory
    const linkPathMap = new Map<number, Set<'vector' | 'bm25' | 'entity' | 'jepa'>>();
    const addLinkPath = (id: number, path: 'vector' | 'bm25' | 'entity' | 'jepa') => {
      if (!linkPathMap.has(id)) linkPathMap.set(id, new Set());
      linkPathMap.get(id)!.add(path);
    };
    for (const id of vectorScores.keys()) addLinkPath(id, 'vector');
    for (const id of bm25Scores.keys()) addLinkPath(id, 'bm25');

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
            const entityMemories = await decryptMemories(await getMemoriesByEntity(entity.id, {
              limit: Math.ceil(limit / 2),
              memoryTypes: opts.memoryTypes,
            }));
            for (const mem of entityMemories) {
              addLinkPath(mem.id, 'entity');
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
              const coMems = await decryptMemories(await getMemoriesByEntity(cooc.related_entity_id, {
                limit: 3,
                memoryTypes: opts.memoryTypes,
              }));
              for (const mem of coMems) {
                if (cooccurrenceAdded >= limit) break;
                addLinkPath(mem.id, 'entity');
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
          filter_owner: getOwnerScope(),
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
              .in('id', graphCandidateIds)
              .not('provider_delegated', 'is', false); // exclude revoked linked rows (encryption §7)
            graphQuery = scopeToOwner(graphQuery);
            const { data: graphMemories } = await graphQuery;

            if (graphMemories && graphMemories.length > 0) {
              await decryptMemories(graphMemories);
              // Build link map with bond-type-weighted strength
              const linkBoostMap = new Map<number, number>();
              for (const l of linked) {
                const bondWeight = BOND_TYPE_WEIGHTS[l.link_type as MemoryLinkType] ?? 0.4;
                const weightedStrength = (l.strength || 0.5) * bondWeight;
                const current = linkBoostMap.get(l.memory_id) || 0;
                linkBoostMap.set(l.memory_id, Math.max(current, weightedStrength));
                // Tag memories surfaced via graph links as 'jepa' (JEPA dream cycle populates these links)
                addLinkPath(l.memory_id, 'jepa');
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

    // Final owner_wallet guard: strip any memories that don't belong to the current
    // scope. Catches leaks from entity/graph/fragment paths that may not filter by
    // owner. Sentinel-aware (Memory 3.0 C0): under SCOPE_BOT_OWN only null-owner
    // rows survive; under the fail-closed flag an unscoped context resolves to the
    // sentinel, so this guard now also runs for bot-context recalls.
    const finalScope = getOwnerScope();
    {
      const { kept, stripped } = applyOwnerPostGuard(results, finalScope);
      if (stripped > 0) {
        // No wallet addresses in logs — scope shape only.
        log.warn({ stripped, botOwn: finalScope === SCOPE_BOT_OWN }, 'Owner guard stripped foreign memories from recall results');
      }
      results = kept;
    }

    // Update access counts in parallel (skip for internal processing like dream cycles).
    // Access tracking only — importance is no longer boosted on read (see migration 019).
    // BENCH_MODE forces this off: reads must not mutate retrieval state under measurement.
    if (shouldTrackAccess(opts)) {
      const ids = results.map((m: Memory) => m.id);
      const sources = results.map((m: Memory) => m.source || '');
      updateMemoryAccess(ids, sources).catch(err => log.warn({ err }, 'Memory access tracking failed'));
      // Hebbian: reinforce links between co-retrieved memories
      reinforceCoRetrievedLinks(ids).catch(err => log.debug({ err }, 'Link reinforcement failed'));
    }

    // Attach link_path instrumentation to each result (mutate in place to preserve _score type)
    for (const m of results) {
      const paths = linkPathMap.get(m.id);
      if (paths && paths.size > 0) {
        m.link_path = [...paths] as Array<'vector' | 'bm25' | 'entity' | 'jepa'>;
      }
    }

    log.debug({
      recalled: results.length,
      topScore: results[0]?._score?.toFixed(3),
      query: opts.query?.slice(0, 40),
      vectorAssisted: vectorScores.size > 0,
      typeSpread: [...new Set(results.map((m: Memory) => m.memory_type))].join(','),
      jepaPaths: results.filter((m: Memory) => m.link_path?.includes('jepa')).length,
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

  // Recency: exponential decay from last access (paper: 0.995^hours).
  // Clamped at 0 hours: a future-dated last_accessed (clock skew, seeded/imported data)
  // makes the exponent negative and the recency term explode past 1.0, letting one memory
  // dominate recall regardless of query relevance (the HaluMem recency-overflow bug).
  const hoursSinceAccess = Math.max(0, (now - new Date(mem.last_accessed).getTime()) / (1000 * 60 * 60));
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

  // BM25 boost: when full-text search found this memory, boost by TF-IDF rank.
  // Weight is env-tunable (RETRIEVAL_WEIGHT_BM25, default 0.15 = prior behavior). For
  // near-identical-sentence corpora where exact lexical match must outrank topically-
  // similar vector hits, set it high so the BM25-found memory wins.
  const bm25Rank = opts._bm25Scores?.get(mem.id) || 0;
  if (bm25Rank > 0) {
    rawScore += RETRIEVAL_WEIGHT_BM25 * Math.min(bm25Rank, 1);
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
      .not('provider_delegated', 'is', false) // exclude revoked (encryption §7); vector + BM25 self-exclude via sealing
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

    return await decryptMemories((data || []) as Memory[]);
  } catch (err) {
    log.error({ err }, 'Memory hydration failed');
    return [];
  }
}

// ---- ACCESS TRACKING ---- //

// `sources` is retained for call-site signature stability (recall passes it positionally);
// it is no longer read here now that importance is not boosted on read.
async function updateMemoryAccess(ids: number[], _sources: string[] = []): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();

  // Single RPC: increment access_count, refresh last_accessed, reactivate decay.
  // Importance is NOT boosted on read — see migration 019 (read->rank->read feedback loop).
  const { error } = await db.rpc('batch_boost_memory_access', {
    memory_ids: ids,
  });
  if (error) {
    log.warn({ error: error.message, ids }, 'Batch memory access update failed');
  }
}

// ---- ASSOCIATION GRAPH ---- //

export type MemoryLinkRow = {
  source_id: number;
  target_id: number;
  link_type: MemoryLinkType;
  strength: number;
};

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
 * Batch-create multiple memory links in a single upsert.
 * Filters out self-links and deduplicates by (source, target, type).
 */
export async function createMemoryLinksBatch(links: MemoryLinkRow[]): Promise<void> {
  // Filter self-links and deduplicate
  const seen = new Set<string>();
  const rows: Array<{ source_id: number; target_id: number; link_type: string; strength: number }> = [];
  for (const link of links) {
    if (link.source_id === link.target_id) continue;
    const key = `${link.source_id}:${link.target_id}:${link.link_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      source_id: link.source_id,
      target_id: link.target_id,
      link_type: link.link_type,
      strength: clamp(link.strength, 0, 1),
    });
  }

  if (rows.length === 0) return;

  const db = getDb();
  const { error } = await db
    .from('memory_links')
    .upsert(rows, { onConflict: 'source_id,target_id,link_type' });

  if (error) {
    log.debug({ error: error.message, count: rows.length }, 'Batch link creation failed');
  }
}

/**
 * Auto-link a new memory to related existing memories.
 * Uses vector similarity, concept overlap, and user overlap to find candidates.
 * Classifies link type via lightweight heuristics.
 */
async function autoLinkMemory(memoryId: number, opts: StoreMemoryOptions): Promise<void> {
  const db = getDb();

  // Collect all links to batch-upsert at the end
  const pendingLinks: MemoryLinkRow[] = [];

  // 1. Link evidence_ids as 'supports' links
  if (opts.evidenceIds && opts.evidenceIds.length > 0) {
    for (const evidenceId of opts.evidenceIds) {
      pendingLinks.push({ source_id: memoryId, target_id: evidenceId, link_type: 'supports', strength: 0.8 });
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
        filter_owner: getOwnerScope(),
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

  // 4. Classify link types and collect links (limit to MAX_AUTO_LINKS)
  const concepts = opts.concepts || [];

  for (const candidate of candidates.slice(0, MAX_AUTO_LINKS)) {
    if (candidate.id === memoryId) continue;

    const linkType = classifyLinkType(opts, candidate, concepts);
    const strength = candidate.similarity > 0 ? clamp(candidate.similarity, 0.3, 0.9) : 0.5;

    pendingLinks.push({ source_id: memoryId, target_id: candidate.id, link_type: linkType, strength });
  }

  // 5. Batch-upsert all links in a single DB call
  if (pendingLinks.length > 0) {
    await createMemoryLinksBatch(pendingLinks);
    log.debug({ memoryId, linksCreated: pendingLinks.length }, 'Auto-linked memory');
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
  return { memories: await decryptMemories(data || []), total: count ?? 0 };
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
    // Stats reflect what the user OWNS — not what's high-priority recallable.
    // Decay-filtering belongs in retrieval, not counts. Older memories that
    // have decayed below MEMORY_MIN_DECAY still exist; the wiki and timeline
    // continue to surface them, so stats must too.
    let countQuery = db
      .from('memories')
      .select('id', { count: 'exact', head: true });
    countQuery = scopeToOwner(countQuery);
    const { count: totalCount } = await countQuery;
    stats.total = totalCount || 0;

    // Embedded count — also unfiltered by decay.
    let embeddedQuery = db
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .not('embedding', 'is', null);
    embeddedQuery = scopeToOwner(embeddedQuery);
    const { count: embCount } = await embeddedQuery;
    stats.embeddedCount = embCount || 0;

    // Per-type counts via head queries — one per type. Cheap (no row fetch),
    // and immune to the row-cap pagination bug that previously zeroed byType
    // for users whose memories paginated past Supabase REST's 1000-row default.
    const TYPES: MemoryType[] = ['episodic', 'semantic', 'procedural', 'self_model', 'introspective'];
    await Promise.all(TYPES.map(async (type) => {
      let q = db
        .from('memories')
        .select('id', { count: 'exact', head: true })
        .eq('memory_type', type);
      q = scopeToOwner(q);
      const { count } = await q;
      stats.byType[type] = count || 0;
    }));

    // Fetch rows for aggregation (importance avg, decay avg, tags, concepts,
    // unique users). Order explicitly so pagination is deterministic; bound
    // to a sane upper limit since these are aggregations, not exhaustive.
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 20;
    let allMemories: any[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      let pageQuery = db
        .from('memories')
        .select('importance, decay_factor, created_at, related_user, owner_wallet, tags, concepts')
        .order('id', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      pageQuery = scopeToOwner(pageQuery);
      const { data: pageData } = await pageQuery;
      if (!pageData || pageData.length === 0) break;
      allMemories = allMemories.concat(pageData);
      if (pageData.length < PAGE_SIZE) break;
    }

    if (allMemories.length > 0) {
      let impSum = 0;
      let decaySum = 0;
      const tagCounts: Record<string, number> = {};
      const conceptCounts: Record<string, number> = {};
      const users = new Set<string>();

      for (const m of allMemories) {
        // byType is computed separately above via head:true counts; don't
        // double-count it from the paginated row sample.
        impSum += m.importance;
        decaySum += m.decay_factor;
        if (m.related_user) users.add(m.related_user);
        // MCP writes leave related_user null; count the owner so a fresh owner with
        // memories yields uniqueUsers >= 1 instead of 0.
        if (m.owner_wallet) users.add(m.owner_wallet);
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

    // Scope to the current owner (dream_logs.owner_wallet — migration 021); otherwise a
    // brand-new owner sees the GLOBAL dream count (thousands of dreams on an empty store).
    let dreamQuery = db.from('dream_logs').select('id', { count: 'exact', head: true });
    dreamQuery = scopeToOwner(dreamQuery);
    const { count, error: dreamError } = await dreamQuery;
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

  return await decryptMemories(data || []);
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

  return await decryptMemories(data || []);
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
      // Stamp owner so getMemoryStats can scope the dream count (migration 021).
      owner_wallet: getOwnerWallet() === SCOPE_BOT_OWN ? null : getOwnerWallet(),
    });

  if (error) {
    log.error({ error: error.message }, 'Failed to store dream log');
  }
}

// ---- HELPERS ---- //

/**
 * Temporal-scoped grounding rules for the recalled-memory block — the read-side
 * hallucination defense for the bot AND every external clude SDK consumer
 * (Cortex.formatContext). Mirrors apps/server/src/lib/memory-prompt.ts: the
 * dominant remaining hallucination class is wrong-date / superseded-fact, so the
 * conflict rule is scoped to the question's tense (latest-for-now, as-of-for-past)
 * rather than blunt latest-wins. Disambiguation, not abstention.
 */
const CONTEXT_GROUNDING_RULES =
  "Ground specific claims — facts, preferences, history, dates, numbers, names — in the memories above; if a detail isn't written here, say you don't remember it rather than guessing. Each line is dated: when two memories disagree, read them as a timeline — use the most recent value for a question about now, and the value that was in effect at the time for a question about a specific past date (\"as of …\"); never blend conflicting values. Don't invent memories or details that aren't above. General knowledge is unaffected — answer those normally.";

export function formatMemoryContext(memories: Memory[]): string {
  if (memories.length === 0) return '';

  const lines: string[] = ['## Memory Recall'];

  // Order each tier oldest→newest so conflicting facts render as a dated timeline.
  // filter() returns fresh arrays, so sorting them never mutates the caller's input.
  const episodic = memories.filter(m => m.memory_type === 'episodic').sort(byMemoryDateAsc);
  const semantic = memories.filter(m => m.memory_type === 'semantic').sort(byMemoryDateAsc);
  const procedural = memories.filter(m => m.memory_type === 'procedural').sort(byMemoryDateAsc);
  const selfModel = memories.filter(m => m.memory_type === 'self_model').sort(byMemoryDateAsc);
  const introspective = memories.filter(m => m.memory_type === 'introspective').sort(byMemoryDateAsc);

  if (episodic.length > 0) {
    lines.push('### Past Interactions');
    for (const m of episodic) lines.push(renderGroundedLine(m));
  }

  if (semantic.length > 0) {
    lines.push('### Things You Know');
    for (const m of semantic) lines.push(renderGroundedLine(m));
  }

  if (procedural.length > 0) {
    lines.push('### Learned Strategies (from past outcomes)');
    for (const m of procedural) {
      const meta = m.metadata as Record<string, any> | undefined;
      const confidence = meta?.positiveRate != null
        ? ` [${Math.round(meta.positiveRate * 100)}% success rate, based on ${meta.basedOn || '?'} interactions]`
        : '';
      lines.push(renderGroundedLine(m, confidence));
    }
  }

  if (introspective.length > 0) {
    lines.push('### Your Own Reflections');
    for (const m of introspective) lines.push(renderGroundedLine(m));
  }

  if (selfModel.length > 0) {
    lines.push('### Self-Observations');
    for (const m of selfModel) lines.push(renderGroundedLine(m));
  }

  lines.push('');
  lines.push(CONTEXT_GROUNDING_RULES);
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
    // Local memory model (CludeMem) when enabled, else the existing Anthropic-direct path.
    const response = isOllamaEnabled()
      ? await generateMemoryOp({
          cognitiveFunction: 'importance',
          systemPrompt:
            'You rate the importance of events for an AI agent. Respond with ONLY a single integer from 1 to 10. 1 = purely mundane. 5 = moderately important. 10 = extremely significant.',
          userMessage: `Rate the importance of this event:\n"${description.slice(0, 500)}"\nRating (1-10):`,
          maxTokens: 10,
          temperature: 0,
        })
      : await generateImportanceScore(description);
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

// ---- JEPA PHASE 4.5 HELPERS ---- //

/**
 * Returns the set of memory IDs already linked FROM the given memory
 * (i.e. rows in memory_links where memory_a_id = memoryId).
 */
export async function fetchExistingLinkTargets(memoryId: number): Promise<Set<number>> {
  const db = getDb();
  const { data } = await db
    .from('memory_links')
    .select('memory_b_id')
    .eq('memory_a_id', memoryId);
  return new Set((data ?? []).map((r: { memory_b_id: number }) => r.memory_b_id));
}

/**
 * Upserts a row in jepa_queried_memories marking this memory as queried now.
 */
export async function markJepaQueried(memoryId: number): Promise<void> {
  const db = getDb();
  await db
    .from('jepa_queried_memories')
    .upsert({ memory_id: memoryId, queried_at: new Date().toISOString() });
}

/**
 * Returns the set of memory IDs that have been JEPA-queried at or after sinceMs (epoch ms).
 */
export async function fetchJepaQueriedSince(sinceMs: number): Promise<Set<number>> {
  const db = getDb();
  const { data } = await db
    .from('jepa_queried_memories')
    .select('memory_id')
    .gte('queried_at', new Date(sinceMs).toISOString());
  return new Set((data ?? []).map((r: { memory_id: number }) => r.memory_id));
}

/**
 * Vector similarity search via the match_memories RPC.
 * NOTE: query_embedding must be JSON-stringified per existing RPC convention.
 * ownerWallet filtering is not forwarded to the RPC (no matching param in this
 * codebase's match_memories signature); callers should filter client-side if needed.
 */
export async function matchByEmbedding(opts: {
  embedding: number[]
  threshold: number
  limit: number
  ownerWallet?: string
}): Promise<Array<{ id: number; similarity: number }>> {
  const db = getDb();
  const { data } = await db.rpc('match_memories', {
    query_embedding: JSON.stringify(opts.embedding),
    match_threshold: opts.threshold,
    match_count: opts.limit,
    // Explicit ownerWallet wins; otherwise the ambient scope (sentinel-aware, C0).
    filter_owner: opts.ownerWallet ?? getOwnerScope(),
  });
  return (data ?? []).map((r: { id: number; similarity: number }) => ({
    id: r.id,
    similarity: r.similarity,
  }));
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
