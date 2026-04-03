/**
 * Experimental Memory Enhancements
 *
 * All exports from the experimental module.
 * Import from here for the public API.
 */

// Main orchestrator
export { enhancedRecallMemories, buildEnhancedContext, type EnhancedRecallResult } from './enhanced-recall';

// Individual experiments
export { TEMPORAL_BOND_TYPE_WEIGHTS, detectTemporalConstraints, matchMemoriesTemporal } from './temporal-bonds';
export { rerankWithCrossEncoder, rerankWithVoyage, type RerankableMemory } from './reranker';
export { evaluateConfidence, filterLowConfidenceMemories, type ConfidenceResult, type ScoredMemory } from './confidence-gate';
export { computeRRFScores, rrfMerge, computeWeightedRRFScores, type RankableMemory } from './rrf-merge';
export { bm25SearchMemories } from './bm25-search';
export { runIRCoT, isMultiHopQuery, type IRCoTResult } from './ircot';
export { ensembleAnswer, parseSpecialistResponse, type EnsembleResult, type SpecialistResult } from './ensemble-answer';

// Config
export { getExperimentalConfig, type ExperimentalConfig } from './config';
