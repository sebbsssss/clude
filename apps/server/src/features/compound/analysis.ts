/**
 * Compound — Analysis Engine
 * LLM-powered probability estimation with memory-augmented reasoning.
 */

import { createChildLogger } from '../../core/logger';
import { recallMemories } from '../../core/memory';
import { buildAndGenerate } from '../../services/response.service';
import type { Market, CompoundAnalysis, CompoundConfig } from './types';

const log = createChildLogger('compound:analysis');

/** Format a market for LLM context */
function formatMarketContext(market: Market): string {
  return [
    `Question: ${market.question}`,
    `Source: ${market.source}`,
    `Current market odds: ${(market.currentOdds * 100).toFixed(1)}%`,
    `Volume: $${market.volume.toLocaleString()}`,
    `Liquidity: $${market.liquidity.toLocaleString()}`,
    `Close date: ${market.closeDate.toISOString().split('T')[0]}`,
    `Category: ${market.category}`,
    `URL: ${market.url}`,
  ].join('\n');
}

/** Format memories for analysis context */
function formatMemoryContext(memories: { summary: string; tags: string[]; importance: number }[]): string {
  if (memories.length === 0) return 'No relevant memories found.';
  return memories
    .map((m, i) => `[${i + 1}] (importance: ${m.importance.toFixed(2)}) ${m.summary}`)
    .join('\n');
}

const ANALYSIS_INSTRUCTION = `You are Compound, a prediction market analysis engine powered by accumulated memory and reasoning.

Analyze the given prediction market question and provide your independent probability estimate.

You MUST respond in EXACTLY this JSON format (no other text):
{
  "estimatedProbability": <number 0-1>,
  "confidence": <number 0-1>,
  "reasoning": "<2-3 sentence explanation>",
  "evidence": ["<key evidence point 1>", "<key evidence point 2>", ...]
}

Guidelines:
- Base your estimate on the question, current date, and any relevant memories/knowledge
- Confidence reflects how much evidence you have, NOT how extreme your estimate is
- A 50% estimate can have high confidence (if you're confident it's a coin flip)
- Consider base rates, historical precedents, and known biases
- Be specific in reasoning — cite what drives your estimate
- If you have little information, set confidence low (0.2-0.4)
- Never blindly anchor to the market price — that's the whole point of independent analysis`;

/**
 * Analyze a single market: recall relevant memories, run LLM estimation,
 * compute edge and value detection.
 */
export async function analyzeMarket(
  market: Market,
  config: Pick<CompoundConfig, 'valueThreshold'>,
): Promise<CompoundAnalysis> {
  // Recall memories relevant to this market's topic
  const memories = await recallMemories({
    query: market.question,
    tags: ['compound', market.category],
    limit: 10,
    trackAccess: true,
    skipExpansion: false,
  });

  const memoryContext = formatMemoryContext(
    memories.map(m => ({ summary: m.summary, tags: m.tags, importance: m.importance })),
  );

  const marketContext = formatMarketContext(market);
  const now = new Date();

  const prompt = [
    '## Market to Analyze',
    marketContext,
    '',
    `## Current Date: ${now.toISOString().split('T')[0]}`,
    '',
    '## Relevant Memories',
    memoryContext,
  ].join('\n');

  let estimatedProbability = 0.5;
  let confidence = 0.3;
  let reasoning = 'Analysis failed — using default estimate.';
  let evidence: string[] = [];

  try {
    const response = await buildAndGenerate({
      message: prompt,
      instruction: ANALYSIS_INSTRUCTION,
      maxTokens: 500,
      skipMood: true,
    });

    // Parse JSON from response (handle possible markdown code block wrapping)
    const jsonStr = response.replace(/```json?\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(jsonStr);

    estimatedProbability = Math.max(0, Math.min(1, parsed.estimatedProbability ?? 0.5));
    confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0.3));
    reasoning = parsed.reasoning || reasoning;
    evidence = Array.isArray(parsed.evidence) ? parsed.evidence : [];
  } catch (err) {
    log.error({ err, question: market.question }, 'Failed to parse analysis response');
  }

  const edge = Math.abs(estimatedProbability - market.currentOdds);
  const isValue = edge >= config.valueThreshold;

  const analysis: CompoundAnalysis = {
    market,
    estimatedProbability,
    confidence,
    reasoning,
    edge,
    isValue,
    evidence,
    analyzedAt: now,
  };

  if (isValue) {
    log.info({
      question: market.question.slice(0, 80),
      marketOdds: market.currentOdds,
      estimate: estimatedProbability,
      edge: edge.toFixed(3),
      confidence,
    }, 'Value opportunity detected');
  }

  return analysis;
}

/**
 * Batch analyze markets: run analysis on a list of markets.
 * Runs sequentially to avoid LLM rate limits.
 */
export async function analyzeMarkets(
  markets: Market[],
  config: Pick<CompoundConfig, 'valueThreshold'>,
): Promise<CompoundAnalysis[]> {
  const analyses: CompoundAnalysis[] = [];

  for (const market of markets) {
    try {
      const analysis = await analyzeMarket(market, config);
      analyses.push(analysis);
    } catch (err) {
      log.error({ err, question: market.question }, 'Market analysis failed');
    }
  }

  log.info({
    total: analyses.length,
    valueOpportunities: analyses.filter(a => a.isValue).length,
  }, 'Batch analysis complete');

  return analyses;
}
