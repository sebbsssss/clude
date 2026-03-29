/**
 * Experimental feature flags — controls which research experiments are active.
 * All default to env vars so they can be toggled without code changes.
 *
 * Based on Researcher report (CLU-8): 10 experiments for improving
 * persistent memory retrieval accuracy and reducing hallucinations.
 */

export interface ExperimentalConfig {
  /** Exp 9: Temporal bond weights in graph traversal + temporal RPC routing */
  temporalBonds: boolean;
  /** Exp 3: Cross-encoder reranking (Cohere Rerank) after Phase 7 */
  reranking: boolean;
  /** Exp 6: Confidence-gated response generation */
  confidenceGate: boolean;
  /** Exp 1: Reciprocal Rank Fusion replacing weighted additive scoring */
  rrfMerge: boolean;
  /** Exp 8: PostgreSQL tsvector/tsquery full-text search */
  bm25Search: boolean;
  /** Exp 4: IRCoT iterative retrieval for multi-hop questions */
  ircot: boolean;
  /** Phase 2: Multi-prompt ensemble answering (3 specialists + aggregator) */
  ensembleAnswer: boolean;

  /** Reranking provider: 'voyage' (preferred — same account as embeddings) or 'cohere' */
  rerankProvider: 'voyage' | 'cohere';
  /** Cohere API key for cross-encoder reranking (fallback) */
  cohereApiKey: string;
  /** Voyage API key for reranking (preferred — reuses EMBEDDING_API_KEY if Voyage) */
  voyageApiKey: string;
  /** Confidence threshold (0-1) for evidence sufficiency gate */
  confidenceThreshold: number;
  /** Max IRCoT iterations */
  ircotMaxSteps: number;
}

function envBool(key: string, fallback: boolean): boolean {
  const val = process.env[key];
  if (val === undefined) return fallback;
  return val === 'true' || val === '1';
}

export function getExperimentalConfig(): ExperimentalConfig {
  return {
    temporalBonds: envBool('EXP_TEMPORAL_BONDS', true),
    reranking: envBool('EXP_RERANKING', false),
    confidenceGate: envBool('EXP_CONFIDENCE_GATE', false),
    rrfMerge: envBool('EXP_RRF_MERGE', false),
    bm25Search: envBool('EXP_BM25_SEARCH', false),
    ircot: envBool('EXP_IRCOT', false),
    ensembleAnswer: envBool('EXP_ENSEMBLE_ANSWER', false),

    rerankProvider: (process.env.EXP_RERANK_PROVIDER || 'voyage') as 'voyage' | 'cohere',
    cohereApiKey: process.env.COHERE_API_KEY || '',
    voyageApiKey: process.env.EMBEDDING_API_KEY || process.env.VOYAGE_API_KEY || '',
    confidenceThreshold: parseFloat(process.env.EXP_CONFIDENCE_THRESHOLD || '0.4'),
    ircotMaxSteps: parseInt(process.env.EXP_IRCOT_MAX_STEPS || '3', 10),
  };
}
