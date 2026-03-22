/**
 * Compound — Memory Loop
 * Store predictions as episodic memories, track resolutions, compute accuracy.
 * Uses the existing Clude memory system (storeMemory, recallMemories, createMemoryLink).
 */

import { createChildLogger } from '../../core/logger';
import { storeMemory, recallMemories, createMemoryLink } from '../../core/memory';
import type { CompoundAnalysis, MarketResolution, PredictionRecord } from './types';

const log = createChildLogger('compound:memory');

/**
 * Store a prediction analysis as an episodic memory.
 * Tags with [compound, prediction, {category}, {source}] for later recall.
 */
export async function storePrediction(analysis: CompoundAnalysis): Promise<number | null> {
  const { market, estimatedProbability, confidence, reasoning, edge, isValue, evidence } = analysis;

  const content = [
    `Prediction for: ${market.question}`,
    `Source: ${market.source} (${market.sourceId})`,
    `Market odds: ${(market.currentOdds * 100).toFixed(1)}%`,
    `Compound estimate: ${(estimatedProbability * 100).toFixed(1)}%`,
    `Edge: ${(edge * 100).toFixed(1)}pp`,
    `Confidence: ${(confidence * 100).toFixed(0)}%`,
    `Value opportunity: ${isValue ? 'YES' : 'no'}`,
    `Category: ${market.category}`,
    `Close date: ${market.closeDate.toISOString().split('T')[0]}`,
    '',
    `Reasoning: ${reasoning}`,
    '',
    evidence.length > 0 ? `Evidence:\n${evidence.map(e => `- ${e}`).join('\n')}` : '',
  ].filter(Boolean).join('\n');

  const summary = `Predicted ${(estimatedProbability * 100).toFixed(0)}% on "${market.question.slice(0, 100)}" (market: ${(market.currentOdds * 100).toFixed(0)}%, edge: ${(edge * 100).toFixed(0)}pp)`;

  const memoryId = await storeMemory({
    type: 'episodic',
    content,
    summary,
    tags: ['compound', 'prediction', market.category, market.source],
    importance: calculatePredictionImportance(analysis),
    source: 'compound',
    sourceId: `${market.source}:${market.sourceId}`,
    metadata: {
      compound_type: 'prediction',
      source_platform: market.source,
      source_id: market.sourceId,
      market_odds: market.currentOdds,
      estimated_probability: estimatedProbability,
      confidence,
      edge,
      is_value: isValue,
      category: market.category,
      close_date: market.closeDate.toISOString(),
      market_url: market.url,
    },
  });

  if (memoryId) {
    log.info({ memoryId, question: market.question.slice(0, 60) }, 'Prediction stored');
  }

  return memoryId;
}

/**
 * Calculate importance for a prediction memory.
 * Higher edge + higher confidence + higher volume = more important.
 */
function calculatePredictionImportance(analysis: CompoundAnalysis): number {
  const { edge, confidence, market } = analysis;

  // Base: edge is the primary signal (0-1 scale, but typically 0-0.3)
  const edgeScore = Math.min(edge * 3, 1); // 33pp edge = max
  // Confidence weight
  const confScore = confidence;
  // Volume signals market significance
  const volScore = Math.min(market.volume / 1_000_000, 1); // $1M = max

  // Weighted combination
  const importance = edgeScore * 0.5 + confScore * 0.3 + volScore * 0.2;
  return Math.max(0.3, Math.min(0.95, importance));
}

/**
 * When a market resolves, find the original prediction memory and:
 * 1. Store the outcome as a new episodic memory
 * 2. Link the outcome to the original prediction
 * 3. Compute accuracy metrics (Brier score, correct/incorrect)
 */
export async function storeResolution(
  resolution: MarketResolution,
): Promise<PredictionRecord['resolution'] | null> {
  // Find the original prediction memory
  const predictionMemories = await recallMemories({
    query: resolution.question,
    tags: ['compound', 'prediction'],
    limit: 5,
    trackAccess: false,
    skipExpansion: true,
  });

  // Match by sourceId in metadata
  const predMemory = predictionMemories.find(m => {
    const meta = m.metadata as Record<string, unknown>;
    return meta?.source_id === resolution.sourceId && meta?.source_platform === resolution.source;
  });

  if (!predMemory) {
    log.warn({ sourceId: resolution.sourceId, question: resolution.question }, 'No matching prediction found for resolution');
    return null;
  }

  const meta = predMemory.metadata as Record<string, unknown>;
  const estimatedProbability = (meta?.estimated_probability as number) ?? 0.5;
  const brierScore = Math.pow(estimatedProbability - resolution.outcome, 2);
  // Directional: was Compound on the right side of 50%?
  const correct = (estimatedProbability >= 0.5) === (resolution.outcome >= 0.5);

  const content = [
    `Resolution: ${resolution.question}`,
    `Outcome: ${resolution.outcome >= 0.5 ? 'YES' : 'NO'} (${(resolution.outcome * 100).toFixed(0)}%)`,
    `Compound predicted: ${(estimatedProbability * 100).toFixed(1)}%`,
    `Brier score: ${brierScore.toFixed(4)} (lower is better)`,
    `Correct direction: ${correct ? 'YES' : 'NO'}`,
    `Resolved: ${resolution.resolvedAt.toISOString().split('T')[0]}`,
    `Source: ${resolution.source} (${resolution.sourceId})`,
  ].join('\n');

  const summary = `${correct ? 'Correct' : 'Wrong'}: "${resolution.question.slice(0, 80)}" resolved ${resolution.outcome >= 0.5 ? 'YES' : 'NO'}, Brier: ${brierScore.toFixed(3)}`;

  const outcomeImportance = correct ? 0.6 : 0.8; // Wrong predictions are more important to learn from

  const outcomeId = await storeMemory({
    type: 'episodic',
    content,
    summary,
    tags: ['compound', 'resolution', correct ? 'correct' : 'incorrect', (meta?.category as string) || 'other'],
    importance: outcomeImportance,
    source: 'compound',
    sourceId: `resolution:${resolution.source}:${resolution.sourceId}`,
    metadata: {
      compound_type: 'resolution',
      source_platform: resolution.source,
      source_id: resolution.sourceId,
      outcome: resolution.outcome,
      estimated_probability: estimatedProbability,
      brier_score: brierScore,
      correct,
      resolved_at: resolution.resolvedAt.toISOString(),
      prediction_memory_id: predMemory.id,
    },
    evidenceIds: [predMemory.id],
  });

  // Link outcome → prediction
  if (outcomeId) {
    await createMemoryLink(outcomeId, predMemory.id, 'follows', 0.9).catch(err =>
      log.warn({ err }, 'Failed to create prediction→resolution link'),
    );
    log.info({ outcomeId, predictionId: predMemory.id, brierScore, correct }, 'Resolution stored and linked');
  }

  return { outcome: resolution.outcome, resolvedAt: resolution.resolvedAt, brierScore, correct };
}

/**
 * Get Compound's historical accuracy stats from stored resolution memories.
 */
export async function getAccuracyStats(): Promise<{
  totalPredictions: number;
  totalResolved: number;
  correctCount: number;
  accuracy: number;
  avgBrierScore: number;
  byCategory: Record<string, { count: number; correct: number; avgBrier: number }>;
}> {
  const resolutions = await recallMemories({
    tags: ['compound', 'resolution'],
    limit: 50,
    trackAccess: false,
    skipExpansion: true,
  });

  const predictions = await recallMemories({
    tags: ['compound', 'prediction'],
    limit: 50,
    trackAccess: false,
    skipExpansion: true,
  });

  const byCategory: Record<string, { count: number; correct: number; totalBrier: number }> = {};
  let correctCount = 0;
  let totalBrier = 0;

  for (const r of resolutions) {
    const meta = r.metadata as Record<string, unknown>;
    const correct = meta?.correct as boolean;
    const brier = (meta?.brier_score as number) ?? 0.25;
    const category = (meta?.category as string) || 'other';

    if (correct) correctCount++;
    totalBrier += brier;

    if (!byCategory[category]) byCategory[category] = { count: 0, correct: 0, totalBrier: 0 };
    byCategory[category].count++;
    if (correct) byCategory[category].correct++;
    byCategory[category].totalBrier += brier;
  }

  const categoryStats: Record<string, { count: number; correct: number; avgBrier: number }> = {};
  for (const [cat, stats] of Object.entries(byCategory)) {
    categoryStats[cat] = {
      count: stats.count,
      correct: stats.correct,
      avgBrier: stats.count > 0 ? stats.totalBrier / stats.count : 0,
    };
  }

  return {
    totalPredictions: predictions.length,
    totalResolved: resolutions.length,
    correctCount,
    accuracy: resolutions.length > 0 ? correctCount / resolutions.length : 0,
    avgBrierScore: resolutions.length > 0 ? totalBrier / resolutions.length : 0,
    byCategory: categoryStats,
  };
}
