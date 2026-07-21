import { createChildLogger } from './logger';
import { generateResponse as generateClaudeResponse } from './claude-client';
import {
  generateOpenRouterResponse,
  isOpenRouterEnabled,
  type CognitiveFunction,
} from './openrouter-client';
import { generateOllamaResponse } from './ollama-client';
import { isOllamaEnabled } from './inference';
import { getMemoryModelConfig } from './memory-model-config';

const log = createChildLogger('memory-ops');

// ============================================================
// MEMORY-OPS ROUTER
//
// Routes memory-operation cognitive functions to the local memory model
// (CludeMem via Ollama) when it is enabled, otherwise to the frontier path.
// Personality functions (reply/reflect/emergence/dream) are NOT memory ops
// and never route here. Structured ops pass a JSON schema (`format`) to the
// local model. On a local failure the router falls back to the frontier path
// (graceful — deliberately distinct from the raw generate({provider:'ollama'})
// path, which surfaces errors). See specs design Sections 5 and 9.
// ============================================================

/** Cognitive functions that are memory operations (eligible for the local model). */
export const MEMORY_OP_FUNCTIONS: ReadonlySet<CognitiveFunction> = new Set([
  'classify',
  'extract',
  'entity',
  'temporal',
  'importance',
  'summarize',
  'reconcile',
  'query',
]);

export function isMemoryOp(fn: CognitiveFunction): boolean {
  return MEMORY_OP_FUNCTIONS.has(fn);
}

export interface MemoryOpOptions {
  cognitiveFunction: CognitiveFunction;
  userMessage: string;
  systemPrompt?: string;
  context?: string;
  /** JSON schema for structured output. Applied on the local path only. */
  format?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}

function buildUserContent(opts: MemoryOpOptions): string {
  return opts.context ? `${opts.context}\n\n---\n\n${opts.userMessage}` : opts.userMessage;
}

/**
 * Run a memory operation. Uses the local memory model when it is enabled AND
 * the function is a memory op; otherwise the frontier path (OpenRouter cognitive
 * routing, or the Claude client). Falls back to frontier if the local call fails.
 */
export async function generateMemoryOp(opts: MemoryOpOptions): Promise<string> {
  if (isOllamaEnabled() && isMemoryOp(opts.cognitiveFunction)) {
    const mm = getMemoryModelConfig();
    try {
      return await generateOllamaResponse({
        ollamaUrl: mm.ollamaUrl,
        model: mm.model,
        systemPrompt: opts.systemPrompt,
        messages: [{ role: 'user', content: buildUserContent(opts) }],
        format: opts.format,
        options: {
          temperature: opts.temperature ?? 0,
          ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}),
        },
        timeoutMs: mm.timeoutMs,
      });
    } catch (err) {
      log.warn(
        { cognitiveFunction: opts.cognitiveFunction, err: (err as Error).message },
        'Local memory-op failed; falling back to frontier',
      );
    }
  }

  return generateFrontier(opts);
}

async function generateFrontier(opts: MemoryOpOptions): Promise<string> {
  if (isOpenRouterEnabled()) {
    return generateOpenRouterResponse({
      messages: [{ role: 'user', content: buildUserContent(opts) }],
      systemPrompt: opts.systemPrompt,
      cognitiveFunction: opts.cognitiveFunction,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
    });
  }
  return generateClaudeResponse({
    userMessage: opts.userMessage,
    context: opts.context,
    featureInstruction: opts.systemPrompt,
    maxTokens: opts.maxTokens,
  });
}
