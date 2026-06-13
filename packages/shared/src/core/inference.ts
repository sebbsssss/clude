import { createChildLogger } from './logger';
import { generateResponse as generateClaudeResponse } from './claude-client';
import { generateOpenRouterResponse, isOpenRouterEnabled, type OpenRouterMessage } from './openrouter-client';
import { generateOllamaResponse } from './ollama-client';
import { getMemoryModelConfig } from './memory-model-config';

const log = createChildLogger('inference');

// ============================================================
// UNIFIED INFERENCE LAYER
//
// Abstracts LLM providers behind a common interface.
// Supports automatic fallback for resilience.
//
// Providers:
// - anthropic: Claude (direct Anthropic API)
// - openrouter: Unified router (all models via single key)
// - ollama: local memory model (CludeMem). Opt-in only — never selected
//   by 'auto', and an explicit ollama call surfaces failures rather than
//   silently falling back to a frontier provider (see specs design Section 9).
//
// Priority in auto mode: OpenRouter > Anthropic
// ============================================================

export type InferenceProvider = 'anthropic' | 'openrouter' | 'ollama' | 'auto';

/** True only when the local memory model is explicitly configured (opt-in). */
export function isOllamaEnabled(): boolean {
  const mm = getMemoryModelConfig();
  return mm.provider === 'ollama' && Boolean(mm.model);
}

/** True when any non-empty memory-model provider is configured (capability check). */
export function isMemoryModelEnabled(): boolean {
  return getMemoryModelConfig().provider !== '';
}

export interface InferenceConfig {
  /** Primary provider (default: 'auto' — tries OpenRouter first, falls back to Anthropic) */
  primary?: InferenceProvider;

  /** Fallback provider if primary fails */
  fallback?: InferenceProvider;

  /** OpenRouter model override */
  openrouterModel?: string;

  /** Anthropic model override */
  anthropicModel?: string;
}

export interface GenerateOptions {
  /** User message/prompt */
  userMessage: string;

  /** Additional context to include */
  context?: string;

  /** Feature-specific instructions */
  featureInstruction?: string;

  /** System prompt override */
  systemPrompt?: string;

  /** Max tokens */
  maxTokens?: number;

  /** Force a specific provider */
  provider?: InferenceProvider;
}

let inferenceConfig: InferenceConfig = {
  primary: 'auto',
  fallback: 'anthropic',
};

export function configureInference(config: InferenceConfig): void {
  inferenceConfig = { ...inferenceConfig, ...config };
  log.info({ primary: inferenceConfig.primary, fallback: inferenceConfig.fallback }, 'Inference configured');
}

export function getInferenceConfig(): InferenceConfig {
  return inferenceConfig;
}

/**
 * Generate a response using the configured inference provider(s).
 * Handles automatic fallback if primary fails.
 */
export async function generate(opts: GenerateOptions): Promise<string> {
  const provider = opts.provider || inferenceConfig.primary || 'auto';

  // Determine which providers to try
  const providers = getProviderOrder(provider);

  let lastError: Error | null = null;

  for (const p of providers) {
    try {
      const result = await generateWithProvider(p, opts);
      if (result) {
        log.debug({ provider: p }, 'Inference succeeded');
        return result;
      }
    } catch (err) {
      lastError = err as Error;
      log.warn({ provider: p, error: (err as Error).message }, 'Provider failed, trying next');
    }
  }

  throw lastError || new Error('All inference providers failed');
}

type ConcreteProvider = 'anthropic' | 'openrouter' | 'ollama';

function getProviderOrder(provider: InferenceProvider): Array<ConcreteProvider> {
  if (provider === 'auto') {
    // 'auto' never selects the local memory model — opt-in is explicit only.
    const providers: Array<ConcreteProvider> = [];
    if (isOpenRouterEnabled()) {
      providers.push('openrouter');
    }
    providers.push('anthropic');
    return providers;
  }

  // Explicit local memory model: surface failures, never silently fall back to
  // a frontier provider. Graceful fallback is added at the Spec 1b router level.
  if (provider === 'ollama') {
    return ['ollama'];
  }

  const providers: Array<ConcreteProvider> = [provider as ConcreteProvider];
  if (inferenceConfig.fallback && inferenceConfig.fallback !== provider) {
    providers.push(inferenceConfig.fallback as ConcreteProvider);
  }
  return providers;
}

async function generateWithProvider(
  provider: ConcreteProvider,
  opts: GenerateOptions
): Promise<string> {
  switch (provider) {
    case 'openrouter':
      return generateWithOpenRouter(opts);
    case 'anthropic':
      return generateWithAnthropic(opts);
    case 'ollama':
      return generateWithOllama(opts);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function generateWithOllama(opts: GenerateOptions): Promise<string> {
  if (!isOllamaEnabled()) {
    throw new Error(
      'Ollama memory model not configured — set MEMORY_MODEL_PROVIDER=ollama and MEMORY_MODEL',
    );
  }

  let systemPrompt = opts.systemPrompt || 'You are Clude, an AI with persistent memory.';
  if (opts.featureInstruction) {
    systemPrompt += `\n\n${opts.featureInstruction}`;
  }

  let userContent = opts.userMessage;
  if (opts.context) {
    userContent = `${opts.context}\n\n---\n\n${opts.userMessage}`;
  }

  const mm = getMemoryModelConfig();
  return generateOllamaResponse({
    ollamaUrl: mm.ollamaUrl,
    model: mm.model,
    systemPrompt,
    messages: [{ role: 'user', content: userContent }],
    timeoutMs: mm.timeoutMs,
    options: opts.maxTokens ? { num_predict: opts.maxTokens } : undefined,
  });
}

async function generateWithOpenRouter(opts: GenerateOptions): Promise<string> {
  if (!isOpenRouterEnabled()) {
    throw new Error('OpenRouter not configured');
  }

  const messages: OpenRouterMessage[] = [];

  // Build system prompt
  let systemPrompt = opts.systemPrompt || 'You are Clude, an AI with persistent memory.';
  if (opts.featureInstruction) {
    systemPrompt += `\n\n${opts.featureInstruction}`;
  }

  // Add context if provided
  let userContent = opts.userMessage;
  if (opts.context) {
    userContent = `${opts.context}\n\n---\n\n${opts.userMessage}`;
  }

  messages.push({ role: 'user', content: userContent });

  return generateOpenRouterResponse({
    messages,
    systemPrompt,
    maxTokens: opts.maxTokens,
    model: inferenceConfig.openrouterModel,
  });
}

async function generateWithAnthropic(opts: GenerateOptions): Promise<string> {
  // Use existing Claude client
  return generateClaudeResponse({
    userMessage: opts.userMessage,
    context: opts.context,
    featureInstruction: opts.featureInstruction,
    maxTokens: opts.maxTokens,
  });
}

/**
 * Quick helper for simple prompts.
 */
export async function ask(prompt: string, opts?: Partial<GenerateOptions>): Promise<string> {
  return generate({ userMessage: prompt, ...opts });
}
