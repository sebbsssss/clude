import { createChildLogger } from './logger';

const log = createChildLogger('openrouter');

// ============================================================
// OPENROUTER CLIENT — Unified LLM Router
//
// OpenRouter provides:
// - OpenAI-compatible API
// - Access to all major models (Claude, GPT, Llama, etc.)
// - Automatic fallbacks and load balancing
// - Single API key for all providers
//
// Replaces Venice as the inference routing layer.
// ============================================================

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';

export interface OpenRouterConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// OpenRouter model IDs — provider/model format
export const OPENROUTER_MODELS = {
  // Frontier (Anthropic)
  'claude-opus-4.6': 'anthropic/claude-opus-4-6',
  'claude-sonnet-4.6': 'anthropic/claude-sonnet-4-6',
  'claude-opus-4.5': 'anthropic/claude-opus-4-5-20250514',
  'claude-sonnet-4.5': 'anthropic/claude-sonnet-4-5-20250514',

  // Frontier (Other providers)
  'gpt-5.2': 'openai/gpt-5.2',
  'grok-4.1': 'x-ai/grok-4.1-fast',
  'gemini-3-pro': 'google/gemini-3-pro-preview',
  'deepseek-v3.2': 'deepseek/deepseek-chat-v3-0324',

  // Reasoning
  'qwen-thinking': 'qwen/qwen3-235b-a22b',
  'kimi-thinking': 'moonshotai/kimi-k2',

  // General
  'llama-70b': 'meta-llama/llama-3.3-70b-instruct',
  'qwen-235b': 'qwen/qwen3-235b-a22b-instruct',
  'glm-4': 'zhipuai/glm-4-plus',

  // Fast
  'llama-3b': 'meta-llama/llama-3.2-3b-instruct',
  'qwen-4b': 'qwen/qwen3-4b',
  'venice-medium': 'mistralai/mistral-small-3.1-24b-instruct-2503',

  // Code
  'qwen-coder': 'qwen/qwen3-coder-480b-a35b-instruct',

  // Uncensored — no direct equivalent; use llama-70b as fallback
  'venice-uncensored': 'meta-llama/llama-3.3-70b-instruct',
} as const;

export type OpenRouterModelAlias = keyof typeof OPENROUTER_MODELS;

// ============================================================
// COGNITIVE MODEL ROUTER
//
// Different brain functions use different models. Fast models for
// quick tasks, reasoning models for deep thought, general models
// for conversation. This mirrors how the brain allocates resources:
// System 1 (fast/intuitive) vs System 2 (slow/deliberate).
// ============================================================

export type CognitiveFunction =
  | 'reply'           // Responding to users (general, balanced)
  | 'dream'           // Dream cycle consolidation (deep reasoning)
  | 'reflect'         // Self-model reflection (highest quality)
  | 'emergence'       // Emergence thoughts (creative, introspective)
  | 'entity'          // Entity extraction (fast, lightweight)
  | 'importance'      // Importance scoring (fast, lightweight)
  | 'summarize'       // Memory compaction/summarization (general)
  | 'web_search';     // Web-augmented responses (general + search)

const COGNITIVE_MODEL_MAP: Record<CognitiveFunction, string> = {
  reply:       OPENROUTER_MODELS['claude-sonnet-4.6'],    // Quality matters for public replies
  dream:       OPENROUTER_MODELS['qwen-thinking'],        // Deep reasoning for consolidation, cheaper than Opus
  reflect:     OPENROUTER_MODELS['claude-opus-4.6'],      // Self-model updates deserve the best
  emergence:   OPENROUTER_MODELS['claude-opus-4.6'],      // Gets posted as tweets, deserves the best
  entity:      OPENROUTER_MODELS['llama-3b'],             // Fast, lightweight extraction
  importance:  OPENROUTER_MODELS['llama-3b'],             // Fast importance scoring
  summarize:   OPENROUTER_MODELS['llama-70b'],            // Good enough for compaction
  web_search:  OPENROUTER_MODELS['llama-70b'],            // Fast, good at synthesis
};

/**
 * Get the optimal OpenRouter model for a given cognitive function.
 * Uses reasoning models for deep thought, fast models for lightweight tasks.
 */
export function getModelForFunction(fn: CognitiveFunction): string {
  return COGNITIVE_MODEL_MAP[fn] || OPENROUTER_MODELS['llama-70b'];
}

// Track OpenRouter usage stats for the dashboard
// Stats are persisted to Supabase so they survive restarts
// NOTE: still uses the venice_stats table for backward compatibility
let _openrouterStats = {
  totalInferenceCalls: 0,
  totalTokensProcessed: 0,
  callsByFunction: {} as Record<string, number>,
  lastCallAt: null as string | null,
};

let _statsLoaded = false;

async function loadPersistedStats() {
  if (_statsLoaded) return;
  _statsLoaded = true;
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) return;

    const res = await fetch(`${supabaseUrl}/rest/v1/inference_stats?id=eq.1&select=*`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (!res.ok) return;
    const rows = await res.json() as Array<Record<string, any>>;
    if (rows.length > 0) {
      const row = rows[0];
      _openrouterStats.totalInferenceCalls = row.total_inference_calls || 0;
      _openrouterStats.totalTokensProcessed = row.total_tokens_processed || 0;
      _openrouterStats.callsByFunction = row.calls_by_function || {};
      _openrouterStats.lastCallAt = row.last_call_at || null;
      log.info({ calls: _openrouterStats.totalInferenceCalls }, 'Loaded persisted inference stats');
    }
  } catch (err) {
    log.warn({ err }, 'Failed to load persisted inference stats');
  }
}

// Debounce persistence to avoid hammering DB on every call
let _persistTimer: ReturnType<typeof setTimeout> | null = null;

async function persistStats() {
  try {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
    if (!supabaseUrl || !supabaseKey) return;

    const body = {
      id: 1,
      total_inference_calls: _openrouterStats.totalInferenceCalls,
      total_tokens_processed: _openrouterStats.totalTokensProcessed,
      calls_by_function: _openrouterStats.callsByFunction,
      last_call_at: _openrouterStats.lastCallAt,
      updated_at: new Date().toISOString(),
    };

    await fetch(`${supabaseUrl}/rest/v1/inference_stats`, {
      method: 'POST',
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    log.warn({ err }, 'Failed to persist inference stats');
  }
}

export async function getOpenRouterStats() {
  await loadPersistedStats();
  return { ..._openrouterStats };
}

function trackOpenRouterUsage(fn: CognitiveFunction | 'general', tokens: number) {
  _openrouterStats.totalInferenceCalls++;
  _openrouterStats.totalTokensProcessed += tokens;
  _openrouterStats.callsByFunction[fn] = (_openrouterStats.callsByFunction[fn] || 0) + 1;
  _openrouterStats.lastCallAt = new Date().toISOString();

  // Debounce: persist 5s after last update
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => persistStats(), 5000);
}

let config: OpenRouterConfig | null = null;

export function initOpenRouter(cfg: OpenRouterConfig): void {
  config = {
    ...cfg,
    model: cfg.model || OPENROUTER_MODELS['llama-70b'],
    maxTokens: cfg.maxTokens || 2000,
  };
  log.info({ model: config.model }, 'OpenRouter client initialized');
}

export function isOpenRouterEnabled(): boolean {
  return config !== null && !!config.apiKey;
}

export function getOpenRouterConfig(): OpenRouterConfig | null {
  return config;
}

/**
 * Generate a response using OpenRouter's unified LLM API.
 * OpenAI-compatible format.
 */
export async function generateOpenRouterResponse(opts: {
  messages: OpenRouterMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  cognitiveFunction?: CognitiveFunction;
}): Promise<string> {
  if (!config?.apiKey) {
    throw new Error('OpenRouter client not initialized');
  }

  const messages: OpenRouterMessage[] = [];

  // Add system prompt if provided
  if (opts.systemPrompt) {
    messages.push({ role: 'system', content: opts.systemPrompt });
  }

  messages.push(...opts.messages);

  const model = opts.cognitiveFunction
    ? getModelForFunction(opts.cognitiveFunction)
    : (opts.model || config.model || OPENROUTER_MODELS['llama-70b']);
  const maxTokens = opts.maxTokens || config.maxTokens || 2000;

  try {
    const response = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: opts.temperature ?? 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      log.error({ status: response.status, error: errorText }, 'OpenRouter API error');
      throw new Error(`OpenRouter API error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as OpenRouterResponse;

    if (!data.choices?.[0]?.message?.content) {
      throw new Error('Invalid OpenRouter response format');
    }

    const totalTokens = (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0);
    trackOpenRouterUsage(opts.cognitiveFunction || 'general', totalTokens);

    log.debug({
      model,
      cognitiveFunction: opts.cognitiveFunction || 'general',
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
    }, 'OpenRouter response generated');

    return data.choices[0].message.content;
  } catch (err) {
    log.error({ err, model }, 'OpenRouter request failed');
    throw err;
  }
}

/**
 * Simple helper for single-turn generation.
 */
export async function askOpenRouter(
  prompt: string,
  opts?: {
    model?: string;
    systemPrompt?: string;
    maxTokens?: number;
  }
): Promise<string> {
  return generateOpenRouterResponse({
    messages: [{ role: 'user', content: prompt }],
    ...opts,
  });
}

// ── Backward compatibility re-exports ──
// These allow Phase 2 consumers to import from either module during transition.
// They will be removed once all consumers are migrated (CLU-175).
export {
  type OpenRouterConfig as VeniceConfig,
  type OpenRouterMessage as VeniceMessage,
  type OpenRouterResponse as VeniceResponse,
  type OpenRouterModelAlias as VeniceModelAlias,
  OPENROUTER_MODELS as VENICE_MODELS,
  getOpenRouterStats as getVeniceStats,
  initOpenRouter as initVenice,
  isOpenRouterEnabled as isVeniceEnabled,
  generateOpenRouterResponse as generateVeniceResponse,
  askOpenRouter as askVenice,
  getOpenRouterConfig as getVeniceConfig,
};
