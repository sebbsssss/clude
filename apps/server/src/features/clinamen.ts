/**
 * CLINAMEN — Anomaly Retrieval
 *
 * Named after Lucretius' concept of the "swerve" — the unpredictable deviation
 * that creates novelty. In atomic physics, clinamen is the slight random swerve
 * of atoms that prevents a deterministic universe. In memory, it's the unexpected
 * connection that produces creative insight.
 *
 * Algorithm:
 * Given a query context, find memories where importance and relevance diverge maximally.
 * Low relevance + high importance = "important but unrelated" = the interesting lateral connection.
 *
 * Use cases:
 * - Active reflection seed selection (replace pure random with intentional anomaly)
 * - Creative ideation (surface unexpected connections)
 * - Peripheral attention buffer (what's important but not currently in focus?)
 *
 * This is NOT random retrieval. It's structured serendipity.
 */

import { getDb } from '../core/database';
import {
  getOwnerWallet,
  scopeToOwner,
  scoreMemory,
  type Memory,
  type RecallOptions,
} from '../core/memory';
import { generateQueryEmbedding, getCachedEmbedding, setCachedEmbedding, isEmbeddingEnabled } from '../core/embeddings';
import { createChildLogger } from '../core/logger';

const log = createChildLogger('clinamen');

// ── Configuration ──────────────────────────────────────────

/** Minimum importance for a memory to be a clinamen candidate */
const MIN_IMPORTANCE = 0.6;

/** Maximum vector similarity — if it's too relevant, it's not anomalous */
const MAX_RELEVANCE_SIM = 0.35;

/** Minimum age in hours — very recent memories aren't surprising */
const MIN_AGE_HOURS = 24;

/** How many candidates to evaluate */
const CANDIDATE_POOL_SIZE = 100;

/** Default number of clinamen to return */
const DEFAULT_LIMIT = 3;

// ── Types ──────────────────────────────────────────────────

export interface ClinamenMemory extends Memory {
  /** The divergence score: how anomalous this memory is relative to the query */
  _divergence: number;
  /** Vector similarity to the query (low = more anomalous) */
  _relevanceSim: number;
}

export interface ClinamenOptions {
  /** The current context/query to find anomalies relative to */
  context: string;
  /** Max clinamen to return */
  limit?: number;
  /** Memory types to consider */
  memoryTypes?: string[];
  /** Minimum importance threshold (default: 0.6) */
  minImportance?: number;
  /** Maximum relevance similarity (default: 0.35) */
  maxRelevance?: number;
}

// ── Core Algorithm ─────────────────────────────────────────

/**
 * Find clinamen memories — high importance, low relevance to current context.
 *
 * The divergence score is: importance * (1 - vectorSimilarity)
 * Memories with high importance but low vector similarity to the query
 * score highest. These are the "swerves" — things the agent knows are
 * important but hasn't connected to the current thread.
 */
export async function findClinamen(opts: ClinamenOptions): Promise<ClinamenMemory[]> {
  const db = getDb();
  const limit = opts.limit || DEFAULT_LIMIT;
  const minImportance = opts.minImportance ?? MIN_IMPORTANCE;
  const maxRelevance = opts.maxRelevance ?? MAX_RELEVANCE_SIM;

  log.debug({ context: opts.context.slice(0, 60), limit }, 'Searching for clinamen');

  // Step 1: Get the context embedding
  let contextEmbedding: number[] | null = null;
  if (isEmbeddingEnabled()) {
    const cached = getCachedEmbedding(opts.context);
    if (cached) {
      contextEmbedding = cached;
    } else {
      contextEmbedding = await generateQueryEmbedding(opts.context);
      if (contextEmbedding) setCachedEmbedding(opts.context, contextEmbedding);
    }
  }

  if (!contextEmbedding) {
    log.debug('No embedding available — falling back to importance-only clinamen');
    return importanceOnlyClinamen(db, limit, minImportance, opts.memoryTypes);
  }

  // Step 2: Fetch high-importance candidates that are old enough
  const cutoff = new Date(Date.now() - MIN_AGE_HOURS * 60 * 60 * 1000).toISOString();

  let query = db
    .from('memories')
    .select('*')
    .gte('importance', minImportance)
    .gte('decay_factor', 0.2)
    .lt('created_at', cutoff)
    .not('source', 'in', '("demo","demo-maas","consolidation")')
    .order('importance', { ascending: false })
    .limit(CANDIDATE_POOL_SIZE);

  query = scopeToOwner(query);

  if (opts.memoryTypes && opts.memoryTypes.length > 0) {
    query = query.in('memory_type', opts.memoryTypes);
  }

  const { data: candidates, error } = await query;

  if (error || !candidates || candidates.length === 0) {
    log.debug({ error: error?.message }, 'No clinamen candidates found');
    return [];
  }

  // Step 3: Compute vector similarity for each candidate
  const scored: ClinamenMemory[] = [];

  for (const mem of candidates) {
    const rawEmb = mem.embedding;
    if (!rawEmb) continue;

    const emb: number[] = typeof rawEmb === 'string' ? JSON.parse(rawEmb) : rawEmb;

    if (emb.length !== contextEmbedding.length) continue;

    // Cosine similarity
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < emb.length; i++) {
      dot += contextEmbedding[i] * emb[i];
      magA += contextEmbedding[i] * contextEmbedding[i];
      magB += emb[i] * emb[i];
    }
    const sim = (magA > 0 && magB > 0) ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;

    // Only consider memories with LOW relevance to the current context
    if (sim > maxRelevance) continue;

    // Divergence = importance * (1 - similarity)
    // High importance + low similarity = high divergence = interesting anomaly
    const divergence = mem.importance * (1 - sim);

    scored.push({
      ...mem,
      _divergence: divergence,
      _relevanceSim: sim,
    });
  }

  // Step 4: Sort by divergence (highest first) and return top N
  scored.sort((a, b) => b._divergence - a._divergence);
  const results = scored.slice(0, limit);

  log.info({
    candidates: candidates.length,
    afterFilter: scored.length,
    returned: results.length,
    topDivergence: results[0]?._divergence?.toFixed(3),
    topSummary: results[0]?.summary?.slice(0, 50),
  }, 'Clinamen retrieval complete');

  return results;
}

/**
 * Fallback: when embeddings are unavailable, return high-importance
 * old memories that haven't been accessed recently.
 */
async function importanceOnlyClinamen(
  db: any,
  limit: number,
  minImportance: number,
  memoryTypes?: string[],
): Promise<ClinamenMemory[]> {
  const cutoff = new Date(Date.now() - MIN_AGE_HOURS * 60 * 60 * 1000).toISOString();
  const accessCutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  let query = db
    .from('memories')
    .select('*')
    .gte('importance', minImportance)
    .gte('decay_factor', 0.2)
    .lt('created_at', cutoff)
    .lt('last_accessed', accessCutoff)
    .not('source', 'in', '("demo","demo-maas","consolidation")')
    .order('importance', { ascending: false })
    .limit(limit * 3);

  query = scopeToOwner(query);

  if (memoryTypes && memoryTypes.length > 0) {
    query = query.in('memory_type', memoryTypes);
  }

  const { data, error } = await query;

  if (error || !data) return [];

  // Shuffle and take top N (since we can't compute divergence, add randomness)
  const shuffled = data.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit).map((m: any) => ({
    ...m,
    _divergence: m.importance,
    _relevanceSim: 0,
  }));
}
