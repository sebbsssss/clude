/**
 * Enhanced Recall Pipeline — Orchestrator
 *
 * Wires all experimental enhancements into a single drop-in replacement
 * for recallMemories(). Each enhancement is gated by feature flags
 * from config.ts so they can be individually toggled.
 *
 * Pipeline flow:
 *   1. Standard recall (memory.ts) — existing 7-phase pipeline
 *   2. [Exp 9] Temporal bond weights — already patched into Phase 6
 *   3. [Exp 3] Cross-encoder reranking — post-recall precision boost
 *   4. [Exp 6] Confidence gating — evidence sufficiency check
 *   5. [Exp 4] IRCoT — iterative retrieval for multi-hop queries
 *   6. [Exp 1] RRF merge — alternative scoring (replaces Phase 3-4)
 *
 * Usage:
 *   import { enhancedRecallMemories } from './experimental/enhanced-recall';
 *   const memories = await enhancedRecallMemories(opts);
 */

import { recallMemories, formatMemoryContext, type RecallOptions, type Memory } from '../memory';
import { getExperimentalConfig } from './config';
import { rerankWithCrossEncoder, rerankWithVoyage } from './reranker';
import { evaluateConfidence, filterLowConfidenceMemories, type ConfidenceResult } from './confidence-gate';
import { runIRCoT, isMultiHopQuery, type RecallFn, type LLMCallFn } from './ircot';
import { TEMPORAL_BOND_TYPE_WEIGHTS } from './temporal-bonds';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('enhanced-recall');

export interface EnhancedRecallResult {
  /** The final set of memories, sorted by score */
  memories: (Memory & { _score: number })[];
  /** Confidence assessment of the evidence quality */
  confidence: ConfidenceResult;
  /** Which experiments were active during this recall */
  activeExperiments: string[];
  /** If IRCoT was used, the number of iterations */
  ircotIterations?: number;
}

/**
 * Enhanced recallMemories with all experimental enhancements.
 *
 * Drop-in replacement for recallMemories() that applies:
 * - Cross-encoder reranking (Exp 3)
 * - Confidence gating (Exp 6)
 * - IRCoT multi-hop retrieval (Exp 4)
 *
 * Note: Temporal bonds (Exp 9) and RRF (Exp 1) require changes inside
 * the core recall pipeline itself. This orchestrator handles post-recall
 * enhancements that can wrap the existing pipeline.
 *
 * @param opts - Standard RecallOptions
 * @param llmCallFn - Optional LLM function for IRCoT reasoning
 * @returns Enhanced recall result with confidence metadata
 */
export async function enhancedRecallMemories(
  opts: RecallOptions,
  llmCallFn?: LLMCallFn,
): Promise<EnhancedRecallResult> {
  const config = getExperimentalConfig();
  const activeExperiments: string[] = [];
  const startTime = Date.now();

  // Step 1: Standard recall via existing pipeline
  // (Temporal bonds from Exp 9 are already integrated via TEMPORAL_BOND_TYPE_WEIGHTS
  //  when applied to the core pipeline — see integration guide)
  let memories = await recallMemories(opts) as (Memory & { _score: number })[];

  // Step 2: IRCoT for multi-hop queries (Exp 4)
  // Only activates when the query looks like it needs evidence chaining
  let ircotIterations: number | undefined;
  if (config.ircot && opts.query && llmCallFn && isMultiHopQuery(opts.query)) {
    activeExperiments.push('ircot');
    const ircotResult = await runIRCoT(
      opts.query,
      memories,
      recallMemories as unknown as RecallFn,
      llmCallFn,
      {
        maxSteps: config.ircotMaxSteps,
        recallLimit: opts.limit || 5,
        baseRecallOpts: {
          memoryTypes: opts.memoryTypes,
          relatedUser: opts.relatedUser,
          relatedWallet: opts.relatedWallet,
          tags: opts.tags,
        },
      },
    );
    memories = ircotResult.memories as (Memory & { _score: number })[];
    ircotIterations = ircotResult.iterations;
  }

  // Step 3: Cross-encoder reranking (Exp 3)
  // Skip reranking for preference-style queries — cross-encoders trained on factual Q&A
  // downrank soft preference signals ("I like", "I prefer"), causing SS-Pref regression.
  const isPreferenceQuery = opts.query && /prefer|favorite|like|opinion|recommend|dislike/i.test(opts.query);
  if (config.reranking && opts.query && memories.length > 1 && !isPreferenceQuery) {
    const useVoyage = config.rerankProvider === 'voyage' && config.voyageApiKey;
    const useCohere = config.rerankProvider === 'cohere' && config.cohereApiKey;

    if (useVoyage) {
      activeExperiments.push('reranking-voyage');
      memories = await rerankWithVoyage(memories, opts.query, {
        apiKey: config.voyageApiKey,
        topN: opts.limit || 10,
        model: 'rerank-2.5',
      }) as (Memory & { _score: number })[];
    } else if (useCohere) {
      activeExperiments.push('reranking-cohere');
      memories = await rerankWithCrossEncoder(memories, opts.query, {
        apiKey: config.cohereApiKey,
        topN: opts.limit || 10,
      }) as (Memory & { _score: number })[];
    }
  } else if (isPreferenceQuery && config.reranking) {
    log.info({ query: opts.query?.slice(0, 80) }, 'Skipped reranking for preference-style query');
  }

  // Step 4: Filter low-confidence memories (pre-gate cleanup)
  if (config.confidenceGate) {
    memories = filterLowConfidenceMemories(memories) as (Memory & { _score: number })[];
  }

  // Step 5: Confidence assessment (Exp 6)
  const confidence = evaluateConfidence(memories, {
    threshold: config.confidenceThreshold,
    minExpectedCount: Math.min(opts.limit || 5, 3),
  });
  if (config.confidenceGate) {
    activeExperiments.push('confidence-gate');
  }

  const elapsed = Date.now() - startTime;
  log.info({
    elapsed,
    memoriesCount: memories.length,
    confidence: confidence.score.toFixed(3),
    sufficient: confidence.sufficient,
    activeExperiments,
    ircotIterations,
  }, 'Enhanced recall complete');

  return {
    memories,
    confidence,
    activeExperiments,
    ircotIterations,
  };
}

/**
 * Enhanced buildAndGenerate that uses the experimental recall pipeline
 * and injects confidence-based hedging into the LLM prompt.
 *
 * This is a thin wrapper showing how to integrate with response.service.ts.
 * In production, you'd modify buildGenerateOptions() directly.
 */
export function buildEnhancedContext(
  memories: (Memory & { _score: number })[],
  confidence: ConfidenceResult,
): { memoryContext: string; hedgingInstruction?: string } {
  const memoryContext = formatMemoryContext(memories);

  return {
    memoryContext: memoryContext || '',
    hedgingInstruction: confidence.hedgingInstruction,
  };
}

/**
 * Get the enhanced BOND_TYPE_WEIGHTS for use in the core pipeline.
 * This is a convenience export for the integration step where you
 * patch memory.ts Phase 6 to use temporal weights.
 */
export { TEMPORAL_BOND_TYPE_WEIGHTS };
