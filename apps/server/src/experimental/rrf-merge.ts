/**
 * Experiment 1: Reciprocal Rank Fusion (RRF)
 *
 * Problem: Phase 3 merges vector and metadata candidates by deduplication,
 * then Phase 4 uses a manually-tuned weighted additive formula
 * (RETRIEVAL_WEIGHT_VECTOR=4.0 is fragile).
 *
 * Fix: Replace additive merge with RRF (Cormack et al. 2009):
 *   RRF(d) = Σ_i  1 / (k + rank_i(d))
 * RRF is robust, parameter-free (k=60 is standard), and +8-18% MRR.
 *
 * Expected improvement: +5-10pp overall
 * Effort: Low — simple rank-based formula.
 */

import { createChildLogger } from '../core/logger';

const log = createChildLogger('exp-rrf');

export interface RankableMemory {
  id: number;
  _score: number;
  [key: string]: any;
}

/**
 * Compute RRF scores for memories across multiple ranked lists.
 * Each list represents a different retrieval signal.
 */
export function computeRRFScores(
  rankedLists: RankableMemory[][],
  k: number = 60,
): Map<number, number> {
  const rrfScores = new Map<number, number>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const memId = list[rank].id;
      const current = rrfScores.get(memId) || 0;
      rrfScores.set(memId, current + 1 / (k + rank + 1));
    }
  }

  return rrfScores;
}

/**
 * Merge and rerank memories from multiple retrieval sources using RRF.
 * Drop-in replacement for Phase 3-4 merge+score in memory.ts.
 */
export function rrfMerge(
  vectorResults: RankableMemory[],
  keywordResults: RankableMemory[],
  importanceResults: RankableMemory[],
  limit: number = 10,
  k: number = 60,
): RankableMemory[] {
  const rankedLists = [vectorResults, keywordResults, importanceResults].filter(l => l.length > 0);

  if (rankedLists.length === 0) return [];
  if (rankedLists.length === 1) return rankedLists[0].slice(0, limit);

  const rrfScores = computeRRFScores(rankedLists, k);

  // Deduplicate: keep the full memory object from whichever list had it
  const memoryMap = new Map<number, RankableMemory>();
  for (const list of rankedLists) {
    for (const mem of list) {
      if (!memoryMap.has(mem.id)) {
        memoryMap.set(mem.id, mem);
      }
    }
  }

  const fused = Array.from(memoryMap.values()).map(mem => ({
    ...mem,
    _score: rrfScores.get(mem.id) || 0,
    _originalScore: mem._score,
  }));

  fused.sort((a, b) => b._score - a._score);
  const result = fused.slice(0, limit);

  log.info({
    lists: rankedLists.length,
    totalCandidates: memoryMap.size,
    outputCount: result.length,
    topRRF: result[0]?._score?.toFixed(4),
  }, 'RRF merge complete');

  return result;
}

/**
 * Weighted RRF variant — gives different retrieval systems different influence.
 */
export function computeWeightedRRFScores(
  rankedLists: RankableMemory[][],
  weights: number[],
  k: number = 60,
): Map<number, number> {
  const rrfScores = new Map<number, number>();

  for (let i = 0; i < rankedLists.length; i++) {
    const list = rankedLists[i];
    const weight = weights[i] ?? 1.0;
    for (let rank = 0; rank < list.length; rank++) {
      const memId = list[rank].id;
      const current = rrfScores.get(memId) || 0;
      rrfScores.set(memId, current + weight / (k + rank + 1));
    }
  }

  return rrfScores;
}
