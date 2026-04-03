import { generateResponse, generateThread, GenerateOptions } from '../core/claude-client';
import { getCurrentMood } from '../core/price-oracle';
import { getMoodModifier } from '../character/mood-modifiers';
import { recallMemories, formatMemoryContext, type RecallOptions } from '../memory';
import { enhancedRecallMemories, buildEnhancedContext } from '../experimental/enhanced-recall';
import { getExperimentalConfig } from '../experimental/config';
import { createChildLogger } from '../core/logger';

const log = createChildLogger('response-service');

/**
 * Response service — abstracts the repeated mood → modifier → memory → generate pattern.
 *
 * Every feature was doing this inline:
 *   1. getCurrentMood()
 *   2. getMoodModifier(mood)
 *   3. optionally recallMemories()
 *   4. generateResponse({ ...options, moodModifier, memoryContext })
 *
 * This service encapsulates that pipeline into a single call.
 */

export interface ContextOptions {
  message: string;
  context?: string;
  tierModifier?: string;
  agentModifier?: string;
  instruction: string;
  maxTokens?: number;
  memory?: RecallOptions;
  skipMood?: boolean;
  /** If true, adds Twitter/X response style instructions */
  forTwitter?: boolean;
}

export async function buildAndGenerate(opts: ContextOptions): Promise<string> {
  const generateOpts = await buildGenerateOptions(opts);
  return generateResponse(generateOpts);
}

export async function buildAndGenerateThread(opts: ContextOptions): Promise<string[]> {
  const generateOpts = await buildGenerateOptions(opts);
  return generateThread(generateOpts);
}

async function buildGenerateOptions(opts: ContextOptions): Promise<GenerateOptions> {
  const mood = opts.skipMood ? undefined : getCurrentMood();
  const moodModifier = mood ? getMoodModifier(mood) : undefined;

  let memoryContext: string | undefined;
  let hedgingInstruction: string | undefined;
  let activeExperiments: string[] = [];
  if (opts.memory) {
    const recallStart = Date.now();

    // Parallel recall: enhanced pipeline + top procedural strategies (guaranteed slots)
    const [enhancedResult, strategies] = await Promise.all([
      enhancedRecallMemories(opts.memory),
      recallMemories({
        memoryTypes: ['procedural'],
        limit: 3,
        minImportance: 0.5,
        trackAccess: true,
      }),
    ]);

    const mainMemories = enhancedResult.memories;
    activeExperiments = enhancedResult.activeExperiments;

    // Extract hedging instruction if confidence gate fired
    const config = getExperimentalConfig();
    if (config.confidenceGate && enhancedResult.confidence.hedgingInstruction) {
      hedgingInstruction = enhancedResult.confidence.hedgingInstruction;
    }

    // Merge procedural strategies into main results, deduplicating by ID
    const seen = new Set(mainMemories.map(m => m.id));
    const memories = [...mainMemories] as typeof strategies;
    for (const s of strategies) {
      if (!seen.has(s.id)) {
        memories.push(s);
        seen.add(s.id);
      }
    }

    const recallMs = Date.now() - recallStart;
    const formatted = formatMemoryContext(memories);
    if (formatted) memoryContext = formatted;
    log.info({
      recallMs,
      memoriesFound: memories.length,
      strategiesFound: strategies.length,
      activeExperiments,
      confidence: enhancedResult.confidence.score.toFixed(3),
      user: opts.memory.relatedUser || opts.memory.relatedWallet || 'none',
    }, 'Memory recall completed');
  }

  // If confidence gate produced a hedging instruction, append to feature instruction
  const instruction = hedgingInstruction
    ? `${opts.instruction}\n\n${hedgingInstruction}`
    : opts.instruction;

  return {
    userMessage: opts.message,
    context: opts.context,
    moodModifier,
    tierModifier: opts.tierModifier,
    agentModifier: opts.agentModifier,
    featureInstruction: instruction,
    memoryContext,
    maxTokens: opts.maxTokens,
    forTwitter: opts.forTwitter,
  };
}
