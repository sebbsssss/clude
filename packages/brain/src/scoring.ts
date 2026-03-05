// ============================================================
// SCORING — Composite memory ranking
//
// score = (w_recency * recency + w_relevance * relevance
//        + w_importance * importance + w_vector * vectorSim) * decay
//
// Plus: knowledge-type boosts, consolidation penalties,
//       knowledge-seed pinning, bond-typed graph boosts.
// ============================================================

import type { Memory, MemoryType, RecallOptions } from './types/memory.js';

export interface ScoringWeights {
  recency: number;
  relevance: number;
  importance: number;
  vector: number;
  graph: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
  recency: 0.15,
  relevance: 0.25,
  importance: 0.20,
  vector: 0.40,
  graph: 0.10,
};

export const RECENCY_DECAY_BASE = 0.995;

export const KNOWLEDGE_TYPE_BOOST: Record<MemoryType, number> = {
  semantic: 0.15,
  procedural: 0.12,
  self_model: 0.10,
  episodic: 0,
};

export const DECAY_RATES: Record<MemoryType, number> = {
  episodic: 0.93,
  semantic: 0.97,
  procedural: 0.98,
  self_model: 0.99,
};

const STOPWORDS = new Set([
  'the','a','an','and','or','but','in','on','at','to','for','of','with','by',
  'from','is','it','its','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might','can',
  'shall','not','no','nor','so','if','then','than','that','this','what','which',
  'who','whom','how','when','where','why','all','each','every','both','few',
  'more','most','some','any','about','into','through','just','also','very',
  'much','like','get','got','your','you','my','me','his','her','our','their',
]);

function extractQueryTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function wordBoundaryMatch(word: string, text: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

export interface ScoringConfig {
  weights?: ScoringWeights;
  /** Boost for knowledge-seed memories. Default: { base: 2.0, vectorScale: 2.0, fallback: 0.5 } */
  seed_boost?: { base: number; vectorScale: number; fallback: number };
  /** Multiplier for consolidation memories. Default: { low: 0.30, high: 0.45 } */
  consolidation_penalty?: { low: number; high: number };
}

/**
 * When using small local models (gte-small), similarities cluster in 0.75-0.95.
 * Pass simRange to enable normalized relative similarity scoring.
 */
export interface SimRange {
  min: number;
  max: number;
}

export function scoreMemory(
  mem: Memory,
  opts: RecallOptions,
  weights: ScoringWeights = DEFAULT_WEIGHTS,
  config?: ScoringConfig,
  simRange?: SimRange,
): number {
  const now = Date.now();

  // Recency: exponential decay from last access
  const hoursSinceAccess = (now - new Date(mem.last_accessed).getTime()) / 3_600_000;
  const recency = Math.pow(RECENCY_DECAY_BASE, hoursSinceAccess);

  // Text similarity (keyword overlap with word boundaries)
  let textScore = 0.5;
  if (opts.query) {
    const terms = extractQueryTerms(opts.query);
    if (terms.length > 0) {
      const summaryLower = mem.summary.toLowerCase();
      let summaryHits = 0, contentHits = 0;
      for (const term of terms) {
        if (wordBoundaryMatch(term, summaryLower)) summaryHits++;
        else if (mem.content && wordBoundaryMatch(term, mem.content.toLowerCase())) contentHits++;
      }
      textScore = 0.3 + 0.7 * Math.min((summaryHits + contentHits * 0.5) / terms.length, 1);
    }
  }

  // Tag + concept overlap
  let tagScore = 0.5;
  if (opts.tags && opts.tags.length > 0) {
    const memLabels = [...(mem.tags || []), ...(mem.concepts || [])];
    const overlap = memLabels.filter(t => opts.tags!.includes(t)).length;
    tagScore = 0.5 + 0.5 * Math.min(overlap / opts.tags.length, 1);
  }

  const relevance = (textScore + tagScore) / 2;
  const vectorSim = opts._vector_scores?.get(mem.id) || 0;

  // Normalized similarity: spreads compressed embedding ranges to 0-1
  const normSim = (vectorSim > 0 && simRange && simRange.max > simRange.min)
    ? (vectorSim - simRange.min) / (simRange.max - simRange.min)
    : 0;

  // Composite score
  let raw = weights.recency * recency
          + weights.relevance * relevance
          + weights.importance * mem.importance;

  if (vectorSim > 0) {
    raw += weights.vector * vectorSim;
    // normSim bonus (helps with compressed embedding spaces like gte-small)
    if (normSim > 0) raw += 0.20 * normSim;
    raw /= (weights.recency + weights.relevance + weights.importance + weights.vector + (normSim > 0 ? 0.20 : 0));
  } else {
    raw /= (weights.recency + weights.relevance + weights.importance);
  }

  // Knowledge type boost
  raw += KNOWLEDGE_TYPE_BOOST[mem.memory_type] || 0;

  // Knowledge-seed pinning (vector-gated)
  const seedBoost = config?.seed_boost ?? { base: 2.0, vectorScale: 2.0, fallback: 0.5 };
  if (mem.source === 'knowledge-seed' && vectorSim > 0.25) {
    raw += seedBoost.base + vectorSim * seedBoost.vectorScale;
  } else if (mem.source === 'knowledge-seed') {
    raw += seedBoost.fallback;
  }

  // Consolidation penalty (dream cycle meta-observations)
  const consPenalty = config?.consolidation_penalty ?? { low: 0.30, high: 0.45 };
  if (mem.source === 'consolidation') {
    raw *= vectorSim > 0.5 ? consPenalty.high : consPenalty.low;
  }

  return raw * mem.decay_factor;
}
