/**
 * Experiment: Multi-Prompt Ensemble Answering Pipeline
 *
 * Problem: Single-prompt answering misses information that requires different
 * reasoning strategies (factual lookup vs temporal reasoning vs synthesis).
 *
 * Fix: Run 3 specialist prompts in parallel, each with a different interpretation
 * lens on the same recalled memories, then aggregate answers via majority vote
 * or confidence-weighted selection.
 *
 * Architecture:
 *   Question + Memories → [Fact | Temporal | Context] → Aggregator → Answer
 *
 * Expected improvement: +3-5pp on LongMemEval by capturing answers that
 * require different reasoning strategies.
 */

import { createChildLogger } from '../core/logger';
import type { LLMCallFn } from './ircot';

const log = createChildLogger('exp-ensemble');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecialistResult {
  role: 'fact' | 'temporal' | 'context';
  answer: string;
  confidence: number; // 0-1 parsed from specialist output
  insufficient: boolean;
}

export interface EnsembleResult {
  /** Final aggregated answer */
  answer: string;
  /** Overall confidence score */
  confidence: number;
  /** Individual specialist results */
  specialists: SpecialistResult[];
  /** How the answer was chosen */
  strategy: 'majority' | 'highest_confidence' | 'single_sufficient';
  /** Number of LLM calls made (specialists + aggregator) */
  llmCalls: number;
  /** Estimated cost in USD */
  estimatedCostUsd: number;
}

// ---------------------------------------------------------------------------
// Specialist Prompts
// ---------------------------------------------------------------------------

const FACT_SPECIALIST_SYSTEM = `You answer questions using only direct facts from the provided memories. Be precise and literal.

Rules:
- Only state facts that are explicitly present in the memories.
- Use exact names, dates, numbers, and details from the text.
- Do NOT infer, generalize, or add information not present.
- If the answer is not explicitly stated in the memories, respond with exactly: INSUFFICIENT

Format your response as:
CONFIDENCE: [0.0-1.0]
ANSWER: [your answer]`;

const TEMPORAL_SPECIALIST_SYSTEM = `You answer questions by constructing a chronological timeline of relevant events from the memories, then reasoning temporally.

Rules:
- First, identify all date/time references in the memories.
- Build a timeline ordering events chronologically.
- Pay attention to: dates, "before/after" relationships, recency, ordering.
- For "which came first" questions, compare dates directly.
- For "how many days" questions, calculate exact differences.
- If temporal reasoning cannot answer the question, respond with exactly: INSUFFICIENT

Format your response as:
CONFIDENCE: [0.0-1.0]
ANSWER: [your answer]`;

const CONTEXT_SYNTHESIZER_SYSTEM = `You answer questions by synthesizing information across multiple conversation sessions. Identify preferences, patterns, and implicit knowledge.

Rules:
- Look across ALL provided memories for relevant patterns.
- Identify preferences, habits, and implicit knowledge.
- Connect information from different sessions that relates to the question.
- For preference questions, identify what the user specifically likes/dislikes.
- If the memories contain nothing relevant, respond with exactly: INSUFFICIENT

Format your response as:
CONFIDENCE: [0.0-1.0]
ANSWER: [your answer]`;

const AGGREGATOR_SYSTEM = `You are an answer aggregator. You receive multiple specialist answers to the same question and must select or synthesize the best final answer.

Rules:
- If 2+ specialists agree on the same answer, use that answer.
- If all specialists disagree, prefer the one with highest confidence.
- Ignore any specialist that said "INSUFFICIENT".
- If all specialists said INSUFFICIENT, respond with "I don't have information about that."
- Keep the final answer concise (1-3 sentences).
- Do NOT mention the specialists, confidence scores, or aggregation process.
- Output ONLY the final answer, nothing else.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse CONFIDENCE: and ANSWER: from specialist output */
export function parseSpecialistResponse(raw: string): { answer: string; confidence: number; insufficient: boolean } {
  const insufficient = raw.trim().toUpperCase().includes('INSUFFICIENT');

  // Extract confidence
  const confMatch = raw.match(/CONFIDENCE:\s*(-?[\d.]+)/i);
  const confidence = confMatch ? Math.min(1, Math.max(0, parseFloat(confMatch[1]))) : 0.5;

  // Extract answer
  const ansMatch = raw.match(/ANSWER:\s*([\s\S]*)/i);
  let answer = ansMatch ? ansMatch[1].trim() : raw.trim();

  // If the answer itself is just INSUFFICIENT, mark it
  if (answer.toUpperCase() === 'INSUFFICIENT') {
    return { answer: '', confidence: 0, insufficient: true };
  }

  return { answer, confidence, insufficient };
}

// Haiku input/output pricing (per token)
const HAIKU_INPUT_COST = 0.80 / 1_000_000;
const HAIKU_OUTPUT_COST = 4.00 / 1_000_000;
// Rough estimate: 1 token ≈ 4 chars
function estimateCost(inputChars: number, outputChars: number): number {
  const inputTokens = inputChars / 4;
  const outputTokens = outputChars / 4;
  return inputTokens * HAIKU_INPUT_COST + outputTokens * HAIKU_OUTPUT_COST;
}

// ---------------------------------------------------------------------------
// Core Pipeline
// ---------------------------------------------------------------------------

/**
 * Run the ensemble answering pipeline.
 *
 * @param context - Formatted memory context string
 * @param question - The user's question
 * @param llmCallFn - Function to call LLM (system, user) → response
 * @param questionType - Optional question type for logging
 * @param questionDate - Optional date context for temporal reasoning
 */
export async function ensembleAnswer(
  context: string,
  question: string,
  llmCallFn: LLMCallFn,
  questionType?: string,
  questionDate?: string,
): Promise<EnsembleResult> {
  const dateContext = questionDate
    ? `\nThe question is being asked on: ${questionDate}. Use this to resolve relative time references.`
    : '';

  const userMessage = `Memory context:\n${context}\n\nQuestion: ${question}`;
  let totalCost = 0;

  // Step 1: Run 3 specialists in parallel
  log.info('Running ensemble specialists in parallel for: %s', question.slice(0, 80));

  const specialistConfigs: Array<{ role: 'fact' | 'temporal' | 'context'; system: string }> = [
    { role: 'fact', system: FACT_SPECIALIST_SYSTEM + dateContext },
    { role: 'temporal', system: TEMPORAL_SPECIALIST_SYSTEM + dateContext },
    { role: 'context', system: CONTEXT_SYNTHESIZER_SYSTEM + dateContext },
  ];

  const specialistResults = await Promise.all(
    specialistConfigs.map(async ({ role, system }): Promise<SpecialistResult> => {
      try {
        const raw = await llmCallFn(system, userMessage);
        const parsed = parseSpecialistResponse(raw);
        totalCost += estimateCost(system.length + userMessage.length, raw.length);
        log.debug('Specialist %s: conf=%.2f insufficient=%s answer=%s',
          role, parsed.confidence, parsed.insufficient, parsed.answer.slice(0, 60));
        return { role, ...parsed };
      } catch (err) {
        log.warn('Specialist %s failed: %s', role, (err as Error).message);
        return { role, answer: '', confidence: 0, insufficient: true };
      }
    }),
  );

  // Step 2: Determine strategy and aggregate
  const sufficient = specialistResults.filter(s => !s.insufficient);
  let llmCalls = 3;

  if (sufficient.length === 0) {
    // All insufficient — no answer
    log.info('All specialists returned INSUFFICIENT');
    return {
      answer: "I don't have information about that.",
      confidence: 0,
      specialists: specialistResults,
      strategy: 'single_sufficient',
      llmCalls,
      estimatedCostUsd: totalCost,
    };
  }

  if (sufficient.length === 1) {
    // Only one has an answer — use it directly
    const winner = sufficient[0];
    log.info('Single sufficient specialist: %s (conf=%.2f)', winner.role, winner.confidence);
    return {
      answer: winner.answer,
      confidence: winner.confidence,
      specialists: specialistResults,
      strategy: 'single_sufficient',
      llmCalls,
      estimatedCostUsd: totalCost,
    };
  }

  // 2+ specialists have answers — use aggregator
  const aggregatorInput = sufficient
    .map((s, i) => `Specialist ${i + 1} (${s.role}, confidence ${s.confidence.toFixed(2)}):\n${s.answer}`)
    .join('\n\n');

  const aggregatorUserMsg = `Question: ${question}\n\n${aggregatorInput}\n\nProvide the best final answer:`;

  try {
    const aggregated = await llmCallFn(AGGREGATOR_SYSTEM, aggregatorUserMsg);
    totalCost += estimateCost(AGGREGATOR_SYSTEM.length + aggregatorUserMsg.length, aggregated.length);
    llmCalls++;

    // Determine strategy
    const strategy = sufficient.length >= 2 ? 'majority' : 'highest_confidence';
    const maxConf = Math.max(...sufficient.map(s => s.confidence));

    log.info('Aggregated answer from %d specialists (strategy=%s, conf=%.2f)',
      sufficient.length, strategy, maxConf);

    return {
      answer: aggregated.trim(),
      confidence: maxConf,
      specialists: specialistResults,
      strategy,
      llmCalls,
      estimatedCostUsd: totalCost,
    };
  } catch (err) {
    // Aggregator failed — fall back to highest-confidence specialist
    log.warn('Aggregator failed: %s — falling back to highest confidence', (err as Error).message);
    const best = sufficient.reduce((a, b) => a.confidence >= b.confidence ? a : b);
    return {
      answer: best.answer,
      confidence: best.confidence,
      specialists: specialistResults,
      strategy: 'highest_confidence',
      llmCalls,
      estimatedCostUsd: totalCost,
    };
  }
}
