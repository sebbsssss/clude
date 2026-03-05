import { generateResponse, generateThread, GenerateOptions } from '../core/claude-client';
import { getCurrentMood } from '../core/price-oracle';
import { getMoodModifier } from '../character/mood-modifiers';
import { recallMemories, formatMemoryContext, type RecallOptions } from '../core/memory';
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
  /** If true, adds instruction to keep response under 270 chars for Twitter */
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
  if (opts.memory) {
    const recallStart = Date.now();
    const memories = await recallMemories(opts.memory);
    const recallMs = Date.now() - recallStart;
    const formatted = formatMemoryContext(memories);
    if (formatted) memoryContext = formatted;
    log.info({ recallMs, memoriesFound: memories.length, user: opts.memory.relatedUser || opts.memory.relatedWallet || 'none' }, 'Memory recall completed');
  }

  return {
    userMessage: opts.message,
    context: opts.context,
    moodModifier,
    tierModifier: opts.tierModifier,
    agentModifier: opts.agentModifier,
    featureInstruction: opts.instruction,
    memoryContext,
    maxTokens: opts.maxTokens,
    forTwitter: opts.forTwitter,
  };
}
