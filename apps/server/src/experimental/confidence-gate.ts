/**
 * Experiment 6: Confidence-Gated Response Generation (FAIR-RAG inspired)
 *
 * Problem: The LLM always generates a response regardless of how relevant
 * the retrieved memories are. When evidence is weak or absent, the LLM
 * confabulates — producing claims that sound plausible but aren't grounded
 * in actual memories.
 *
 * Fix: Compute an evidence sufficiency score from retrieval quality signals
 * (coverage, top score, type diversity). When below threshold, inject a
 * hedging instruction into the system prompt so the LLM acknowledges
 * uncertainty rather than hallucinating.
 *
 * Expected improvement: -30-45% hallucination rate on low-evidence queries.
 * Effort: Low — pure computation on existing retrieval outputs.
 */

import { createChildLogger } from '../core/logger';

const log = createChildLogger('exp-confidence');

export interface ScoredMemory {
  id: number;
  memory_type: string;
  _score: number;
  [key: string]: any;
}

export interface ConfidenceResult {
  /** Overall evidence confidence (0-1) */
  score: number;
  /** Whether the evidence clears the threshold */
  sufficient: boolean;
  /** Breakdown of component scores */
  components: {
    coverage: number;
    topScore: number;
    diversity: number;
    agreement: number;
  };
  /** If insufficient, a hedging instruction to prepend to the prompt */
  hedgingInstruction?: string;
}

/**
 * Evaluate evidence sufficiency from retrieved memories.
 *
 * Uses four signals:
 * 1. Coverage: How many memories were retrieved vs expected minimum
 * 2. Top score: How confident the best match is
 * 3. Diversity: How many memory types are represented
 * 4. Agreement: How tightly clustered the top scores are
 */
export function evaluateConfidence(
  memories: ScoredMemory[],
  opts: {
    threshold?: number;
    minExpectedCount?: number;
    maxPossibleScore?: number;
  } = {},
): ConfidenceResult {
  const threshold = opts.threshold ?? 0.4;
  const minExpected = opts.minExpectedCount ?? 3;
  const maxScore = opts.maxPossibleScore ?? 2.0;

  if (memories.length === 0) {
    return {
      score: 0,
      sufficient: false,
      components: { coverage: 0, topScore: 0, diversity: 0, agreement: 0 },
      hedgingInstruction: HEDGING_INSTRUCTIONS.noEvidence,
    };
  }

  const coverage = Math.min(memories.length / minExpected, 1.0);
  const topScore = Math.min(memories[0]._score / maxScore, 1.0);

  const typeSet = new Set(memories.map(m => m.memory_type));
  const diversity = Math.min(typeSet.size / 4, 1.0);

  const top3 = memories.slice(0, Math.min(3, memories.length)).map(m => m._score);
  const mean = top3.reduce((a, b) => a + b, 0) / top3.length;
  const variance = top3.reduce((a, s) => a + (s - mean) ** 2, 0) / top3.length;
  const stdDev = Math.sqrt(variance);
  const agreement = mean > 0 ? Math.max(0, 1 - stdDev / mean) : 0;

  const score =
    0.30 * coverage +
    0.35 * topScore +
    0.15 * diversity +
    0.20 * agreement;

  const sufficient = score >= threshold;

  const result: ConfidenceResult = {
    score,
    sufficient,
    components: { coverage, topScore, diversity, agreement },
  };

  if (!sufficient) {
    result.hedgingInstruction = score < 0.15
      ? HEDGING_INSTRUCTIONS.noEvidence
      : HEDGING_INSTRUCTIONS.weakEvidence;

    log.info({
      score: score.toFixed(3),
      threshold,
      components: {
        coverage: coverage.toFixed(2),
        topScore: topScore.toFixed(2),
        diversity: diversity.toFixed(2),
        agreement: agreement.toFixed(2),
      },
      memoriesCount: memories.length,
    }, 'Low confidence — hedging instruction applied');
  }

  return result;
}

/**
 * Filter memories below a minimum score threshold.
 */
export function filterLowConfidenceMemories(
  memories: ScoredMemory[],
  minScore: number = 0.15,
): ScoredMemory[] {
  const filtered = memories.filter(m => m._score >= minScore);
  if (filtered.length < memories.length) {
    log.debug({
      before: memories.length,
      after: filtered.length,
      minScore,
    }, 'Low-confidence memories filtered');
  }
  return filtered;
}

const HEDGING_INSTRUCTIONS = {
  noEvidence: `IMPORTANT: Your memory retrieval returned no strong matches for this query.
You MUST NOT fabricate or guess information. Instead:
- Acknowledge that you don't have clear memories about this topic
- If you have partial information, clearly mark it as uncertain
- Suggest what information would help you answer more confidently
Do NOT make up facts, dates, names, or events.`,

  weakEvidence: `CAUTION: Your memory retrieval returned weak matches — the retrieved context
may not directly answer the query. When responding:
- Only state facts that are directly supported by the retrieved memories
- For any inference or connection you make, flag it as "I think" or "based on what I recall"
- If the retrieved memories seem tangential, acknowledge the gap
- Prefer "I'm not certain about..." over confidently wrong statements`,
} as const;
