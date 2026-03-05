import { createChildLogger } from './logger';

const log = createChildLogger('venice');

// ============================================================
// VENICE CLIENT — Permissionless, Private LLM Inference
//
// Venice provides:
// - OpenAI-compatible API
// - No data retention (prompts stay private)
// - Permissionless access (no approval needed)
// - Multiple model access (Claude, GPT, open-source)
//
// This aligns with Clude's decentralization philosophy:
// - Memory: Solana (decentralized)
// - Inference: Venice (permissionless)
// ============================================================

const VENICE_API_URL = 'https://api.venice.ai/api/v1';

export interface VeniceConfig {
  apiKey: string;
  model?: string;
  maxTokens?: number;
}

export interface VeniceMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface VeniceResponse {
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

// Available Venice models (subset - they support many more)
export const VENICE_MODELS = {
  // Frontier (Anthropic via Venice - private inference, no logs)
  'claude-opus-4.6': 'claude-opus-4-6',
  'claude-sonnet-4.6': 'claude-sonnet-4-6',
  'claude-opus-4.5': 'claude-opus-45',
  'claude-sonnet-4.5': 'claude-sonnet-45',

  // Frontier (Other providers via Venice)
  'gpt-5.2': 'openai-gpt-52',
  'grok-4.1': 'grok-41-fast',
  'gemini-3-pro': 'gemini-3-pro-preview',
  'deepseek-v3.2': 'deepseek-v3.2',

  // Reasoning
  'qwen-thinking': 'qwen3-235b-a22b-thinking-2507',
  'kimi-thinking': 'kimi-k2-thinking',
  
  // General
  'llama-70b': 'llama-3.3-70b',
  'qwen-235b': 'qwen3-235b-a22b-instruct-2507',
  'glm-4': 'zai-org-glm-4.7',
  
  // Fast
  'llama-3b': 'llama-3.2-3b',
  'qwen-4b': 'qwen3-4b',
  'venice-medium': 'mistral-31-24b',
  
  // Code
  'qwen-coder': 'qwen3-coder-480b-a35b-instruct',

  // Uncensored
  'venice-uncensored': 'venice-uncensored-1.1',
} as const;

export type VeniceModelAlias = keyof typeof VENICE_MODELS;

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
  reply:       VENICE_MODELS['claude-sonnet-4.6'],    // Quality matters for public replies
  dream:       VENICE_MODELS['qwen-thinking'],        // Deep reasoning for consolidation, cheaper than Opus
  reflect:     VENICE_MODELS['claude-opus-4.6'],      // Self-model updates deserve the best
  emergence:   VENICE_MODELS['claude-opus-4.6'],      // Gets posted as tweets, deserves the best
  entity:      VENICE_MODELS['llama-3b'],             // Fast, lightweight extraction
  importance:  VENICE_MODELS['llama-3b'],             // Fast importance scoring
  summarize:   VENICE_MODELS['llama-70b'],            // Good enough for compaction
  web_search:  VENICE_MODELS['llama-70b'],            // Fast, good at synthesis
};

/**
 * Get the optimal Venice model for a given cognitive function.
 * Uses reasoning models for deep thought, fast models for lightweight tasks.
 */
export function getModelForFunction(fn: CognitiveFunction): string {
  return COGNITIVE_MODEL_MAP[fn] || VENICE_MODELS['llama-70b'];
}

// Track Venice usage stats for the privacy dashboard
// Stats are persisted to Supabase so they survive restarts
let _veniceStats = {
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

    const res = await fetch(`${supabaseUrl}/rest/v1/venice_stats?id=eq.1&select=*`, {
      headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
    });
    if (!res.ok) return;
    const rows = await res.json() as Array<Record<string, any>>;
    if (rows.length > 0) {
      const row = rows[0];
      _veniceStats.totalInferenceCalls = row.total_inference_calls || 0;
      _veniceStats.totalTokensProcessed = row.total_tokens_processed || 0;
      _veniceStats.callsByFunction = row.calls_by_function || {};
      _veniceStats.lastCallAt = row.last_call_at || null;
      log.info({ calls: _veniceStats.totalInferenceCalls }, 'Loaded persisted Venice stats');
    }
  } catch (err) {
    log.warn({ err }, 'Failed to load persisted Venice stats');
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
      total_inference_calls: _veniceStats.totalInferenceCalls,
      total_tokens_processed: _veniceStats.totalTokensProcessed,
      calls_by_function: _veniceStats.callsByFunction,
      last_call_at: _veniceStats.lastCallAt,
      updated_at: new Date().toISOString(),
    };

    await fetch(`${supabaseUrl}/rest/v1/venice_stats`, {
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
    log.warn({ err }, 'Failed to persist Venice stats');
  }
}

export async function getVeniceStats() {
  await loadPersistedStats();
  return { ..._veniceStats };
}

function trackVeniceUsage(fn: CognitiveFunction | 'general', tokens: number) {
  _veniceStats.totalInferenceCalls++;
  _veniceStats.totalTokensProcessed += tokens;
  _veniceStats.callsByFunction[fn] = (_veniceStats.callsByFunction[fn] || 0) + 1;
  _veniceStats.lastCallAt = new Date().toISOString();

  // Debounce: persist 5s after last update
  if (_persistTimer) clearTimeout(_persistTimer);
  _persistTimer = setTimeout(() => persistStats(), 5000);
}

let config: VeniceConfig | null = null;

export function initVenice(cfg: VeniceConfig): void {
  config = {
    ...cfg,
    model: cfg.model || VENICE_MODELS['llama-70b'],
    maxTokens: cfg.maxTokens || 2000,
  };
  log.info({ model: config.model }, 'Venice client initialized');
}

export function isVeniceEnabled(): boolean {
  return config !== null && !!config.apiKey;
}

export function getVeniceConfig(): VeniceConfig | null {
  return config;
}

/**
 * Generate a response using Venice's permissionless LLM API.
 * OpenAI-compatible format.
 */
export async function generateVeniceResponse(opts: {
  messages: VeniceMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  cognitiveFunction?: CognitiveFunction;
}): Promise<string> {
  if (!config?.apiKey) {
    throw new Error('Venice client not initialized');
  }

  const messages: VeniceMessage[] = [];
  
  // Add system prompt if provided
  if (opts.systemPrompt) {
    messages.push({ role: 'system', content: opts.systemPrompt });
  }
  
  messages.push(...opts.messages);

  const model = opts.cognitiveFunction
    ? getModelForFunction(opts.cognitiveFunction)
    : (opts.model || config.model || VENICE_MODELS['llama-70b']);
  const maxTokens = opts.maxTokens || config.maxTokens || 2000;

  try {
    const response = await fetch(`${VENICE_API_URL}/chat/completions`, {
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
      log.error({ status: response.status, error: errorText }, 'Venice API error');
      throw new Error(`Venice API error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as VeniceResponse;
    
    if (!data.choices?.[0]?.message?.content) {
      throw new Error('Invalid Venice response format');
    }

    const totalTokens = (data.usage?.prompt_tokens || 0) + (data.usage?.completion_tokens || 0);
    trackVeniceUsage(opts.cognitiveFunction || 'general', totalTokens);

    log.debug({
      model,
      cognitiveFunction: opts.cognitiveFunction || 'general',
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
    }, 'Venice response generated');

    return data.choices[0].message.content;
  } catch (err) {
    log.error({ err, model }, 'Venice request failed');
    throw err;
  }
}

/**
 * Generate a response with web search enabled.
 * Venice can search the web and include citations.
 */
export async function generateVeniceResponseWithSearch(opts: {
  messages: VeniceMessage[];
  model?: string;
  maxTokens?: number;
  systemPrompt?: string;
}): Promise<{ content: string; citations?: string[] }> {
  if (!config?.apiKey) {
    throw new Error('Venice client not initialized');
  }

  const messages: VeniceMessage[] = [];
  if (opts.systemPrompt) {
    messages.push({ role: 'system', content: opts.systemPrompt });
  }
  messages.push(...opts.messages);

  const model = opts.model || config.model || VENICE_MODELS['llama-70b'];

  try {
    const response = await fetch(`${VENICE_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: opts.maxTokens || 2000,
        venice_parameters: {
          enable_web_search: 'on',
          enable_web_citations: true,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Venice API error: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as VeniceResponse;
    const content = data.choices[0]?.message?.content || '';

    // Extract citations if present (Venice includes them in the response)
    const citationMatches = content.match(/\[(\d+)\]\s*(https?:\/\/[^\s\]]+)/g);
    const citations = citationMatches?.map(m => m.replace(/\[\d+\]\s*/, ''));

    return { content, citations };
  } catch (err) {
    log.error({ err }, 'Venice web search request failed');
    throw err;
  }
}

/**
 * Simple helper for single-turn generation.
 */
export async function askVenice(
  prompt: string,
  opts?: {
    model?: string;
    systemPrompt?: string;
    maxTokens?: number;
  }
): Promise<string> {
  return generateVeniceResponse({
    messages: [{ role: 'user', content: prompt }],
    ...opts,
  });
}
