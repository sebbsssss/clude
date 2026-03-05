import { createChildLogger } from './logger';
import { generateResponse as generateClaudeResponse } from './claude-client';
import { generateVeniceResponse, isVeniceEnabled, type VeniceMessage } from './venice-client';

const log = createChildLogger('inference');

// ============================================================
// UNIFIED INFERENCE LAYER
//
// Abstracts LLM providers behind a common interface.
// Supports automatic fallback for resilience.
//
// Providers:
// - anthropic: Claude (centralized, high quality)
// - venice: Permissionless (decentralized, private)
//
// Philosophy: Clude uses decentralized memory (Solana).
// Inference should match — Venice as primary, Anthropic as fallback.
// ============================================================

export type InferenceProvider = 'anthropic' | 'venice' | 'auto';

export interface InferenceConfig {
  /** Primary provider (default: 'auto' — tries Venice first, falls back to Anthropic) */
  primary?: InferenceProvider;
  
  /** Fallback provider if primary fails */
  fallback?: InferenceProvider;
  
  /** Venice model override */
  veniceModel?: string;
  
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

function getProviderOrder(provider: InferenceProvider): Array<'anthropic' | 'venice'> {
  if (provider === 'auto') {
    // Prefer Venice (decentralized) if available, fall back to Anthropic
    const providers: Array<'anthropic' | 'venice'> = [];
    if (isVeniceEnabled()) {
      providers.push('venice');
    }
    providers.push('anthropic');
    return providers;
  }
  
  const providers: Array<'anthropic' | 'venice'> = [provider as 'anthropic' | 'venice'];
  if (inferenceConfig.fallback && inferenceConfig.fallback !== provider) {
    providers.push(inferenceConfig.fallback as 'anthropic' | 'venice');
  }
  return providers;
}

async function generateWithProvider(
  provider: InferenceProvider,
  opts: GenerateOptions
): Promise<string> {
  switch (provider) {
    case 'venice':
      return generateWithVenice(opts);
    case 'anthropic':
      return generateWithAnthropic(opts);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

async function generateWithVenice(opts: GenerateOptions): Promise<string> {
  if (!isVeniceEnabled()) {
    throw new Error('Venice not configured');
  }

  const messages: VeniceMessage[] = [];
  
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

  return generateVeniceResponse({
    messages,
    systemPrompt,
    maxTokens: opts.maxTokens,
    model: inferenceConfig.veniceModel,
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
