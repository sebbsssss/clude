import { createChildLogger } from './logger';
import { generateResponse as generateClaudeResponse } from './claude-client';
import { generateOpenRouterResponse, isOpenRouterEnabled, type OpenRouterMessage } from './openrouter-client';

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
//
// Priority in auto mode: OpenRouter > Anthropic
// ============================================================

export type InferenceProvider = 'anthropic' | 'openrouter' | 'auto';

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

function getProviderOrder(provider: InferenceProvider): Array<'anthropic' | 'openrouter'> {
  if (provider === 'auto') {
    const providers: Array<'anthropic' | 'openrouter'> = [];
    if (isOpenRouterEnabled()) {
      providers.push('openrouter');
    }
    providers.push('anthropic');
    return providers;
  }

  const providers: Array<'anthropic' | 'openrouter'> = [provider as 'anthropic' | 'openrouter'];
  if (inferenceConfig.fallback && inferenceConfig.fallback !== provider) {
    providers.push(inferenceConfig.fallback as 'anthropic' | 'openrouter');
  }
  return providers;
}

async function generateWithProvider(
  provider: InferenceProvider,
  opts: GenerateOptions
): Promise<string> {
  switch (provider) {
    case 'openrouter':
      return generateWithOpenRouter(opts);
    case 'anthropic':
      return generateWithAnthropic(opts);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
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
