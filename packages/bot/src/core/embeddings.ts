import { config } from '../config';
import { createChildLogger } from './logger';

const log = createChildLogger('embeddings');

// ============================================================
// PLUGGABLE EMBEDDING SYSTEM
//
// Supports multiple providers (Voyage AI, OpenAI-compatible) via
// plain fetch — no SDK dependencies. Gracefully disabled when
// no provider is configured; all callers fall back to keyword scoring.
//
// Provider API contracts:
//   POST /embeddings  { input: string | string[], model: string }
//   → { data: [{ embedding: number[], index: number }] }
// ============================================================

interface ProviderConfig {
  url: string;
  defaultModel: string;
  authHeader: (key: string) => string;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  voyage: {
    url: 'https://api.voyageai.com/v1/embeddings',
    defaultModel: 'voyage-4-large',
    authHeader: (key) => `Bearer ${key}`,
  },
  openai: {
    url: 'https://api.openai.com/v1/embeddings',
    defaultModel: 'text-embedding-3-small',
    authHeader: (key) => `Bearer ${key}`,
  },
  venice: {
    url: 'https://api.venice.ai/api/v1/embeddings',
    defaultModel: 'text-embedding-3-small',
    authHeader: (key) => `Bearer ${key}`,
  },
};

let _enabled: boolean | null = null;
let _overrideConfig: { provider: string; apiKey: string; model?: string; dimensions?: number } | null = null;

// LRU embedding cache — avoids re-computing embeddings for repeated/similar queries
const EMBEDDING_CACHE_MAX = 200;
const EMBEDDING_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const _embeddingCache = new Map<string, { embedding: number[]; ts: number }>();

function getCachedEmbedding(text: string): number[] | null {
  const key = text.slice(0, 500).toLowerCase().trim();
  const entry = _embeddingCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > EMBEDDING_CACHE_TTL_MS) {
    _embeddingCache.delete(key);
    return null;
  }
  return entry.embedding;
}

function setCachedEmbedding(text: string, embedding: number[]): void {
  const key = text.slice(0, 500).toLowerCase().trim();
  // Evict oldest if at capacity
  if (_embeddingCache.size >= EMBEDDING_CACHE_MAX) {
    const oldest = _embeddingCache.keys().next().value;
    if (oldest) _embeddingCache.delete(oldest);
  }
  _embeddingCache.set(key, { embedding, ts: Date.now() });
}

/** @internal SDK escape hatch — allows Cortex to override embedding config. */
export function _configureEmbeddings(opts: { provider: string; apiKey: string; model?: string; dimensions?: number }): void {
  _overrideConfig = opts;
  _enabled = null; // reset cached check
}

function getEmbeddingConfig() {
  if (_overrideConfig) return _overrideConfig;
  return config.embedding;
}

export function isEmbeddingEnabled(): boolean {
  if (_enabled !== null) return _enabled;
  const cfg = getEmbeddingConfig();
  _enabled = !!cfg.provider && !!cfg.apiKey && cfg.provider in PROVIDERS;
  if (_enabled) {
    log.info({ provider: cfg.provider }, 'Embedding system enabled');
  }
  return _enabled;
}

/**
 * Call a specific embedding provider.
 */
async function callEmbeddingAPI(
  provider: string,
  apiKey: string,
  model: string,
  text: string,
  dimensions?: number
): Promise<number[] | null> {
  const providerConfig = PROVIDERS[provider];
  if (!providerConfig) return null;

  const startMs = Date.now();
  try {
    const res = await fetch(providerConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': providerConfig.authHeader(apiKey),
      },
      body: JSON.stringify({
        input: text.slice(0, 8000),
        model,
        ...(provider === 'openai' ? { dimensions } : {}),
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      log.error({ status: res.status, body: errText.slice(0, 200), provider }, 'Embedding API error');
      return null;
    }

    const data = await res.json() as { data: Array<{ embedding: number[] }> };
    const embedding = data.data?.[0]?.embedding || null;
    const elapsed = Date.now() - startMs;
    log.debug({ provider, model, elapsed }, 'Embedding generated');
    return embedding;
  } catch (err) {
    log.error({ err, provider }, 'Embedding generation failed');
    return null;
  }
}

/**
 * Generate a single embedding vector for the given text.
 * Returns null if embeddings are disabled or the API call fails.
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!isEmbeddingEnabled()) return null;

  // Check cache first
  const cached = getCachedEmbedding(text);
  if (cached) {
    log.debug('Embedding cache hit');
    return cached;
  }

  const cfg = getEmbeddingConfig();
  if (!cfg.provider || !(cfg.provider in PROVIDERS)) return null;

  const providerConfig = PROVIDERS[cfg.provider];
  const model = cfg.model || providerConfig.defaultModel;

  const embedding = await callEmbeddingAPI(cfg.provider, cfg.apiKey, model, text, cfg.dimensions);
  if (embedding) setCachedEmbedding(text, embedding);
  return embedding;
}

/**
 * Generate embedding optimized for query-time (recall).
 * Uses a faster provider if configured (EMBEDDING_QUERY_PROVIDER),
 * otherwise falls back to the default provider.
 */
export async function generateQueryEmbedding(text: string): Promise<number[] | null> {
  if (!isEmbeddingEnabled()) return null;

  // Check cache first
  const cached = getCachedEmbedding(text);
  if (cached) {
    log.debug('Query embedding cache hit');
    return cached;
  }

  const cfg = getEmbeddingConfig();

  // Try fast query provider first
  const qProvider = (cfg as any).queryProvider as string;
  const qApiKey = (cfg as any).queryApiKey as string;
  const qModel = (cfg as any).queryModel as string;

  if (qProvider && qApiKey && qProvider in PROVIDERS) {
    const providerConfig = PROVIDERS[qProvider];
    const model = qModel || providerConfig.defaultModel;
    log.debug({ provider: qProvider }, 'Using fast query embedding provider');
    const embedding = await callEmbeddingAPI(qProvider, qApiKey, model, text);
    if (embedding) {
      setCachedEmbedding(text, embedding);
      return embedding;
    }
    log.warn({ provider: qProvider }, 'Fast query provider failed, falling back to default');
  }

  // Fallback to default provider
  return generateEmbedding(text);
}

/**
 * Generate embeddings for multiple texts in a single batch API call.
 * More efficient than calling generateEmbedding() in a loop.
 * Returns an array matching input length; null for any that failed.
 */
export async function generateEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
  if (!isEmbeddingEnabled() || texts.length === 0) return texts.map(() => null);

  const cfg = getEmbeddingConfig();
  if (!cfg.provider || !(cfg.provider in PROVIDERS)) return texts.map(() => null);

  const providerConfig = PROVIDERS[cfg.provider];
  const model = cfg.model || providerConfig.defaultModel;

  try {
    const res = await fetch(providerConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': providerConfig.authHeader(cfg.apiKey),
      },
      body: JSON.stringify({
        input: texts.map(t => t.slice(0, 8000)),
        model,
        ...(cfg.provider === 'openai' ? { dimensions: cfg.dimensions } : {}),
      }),
    });

    if (!res.ok) {
      log.error({ status: res.status }, 'Batch embedding API error');
      return texts.map(() => null);
    }

    const data = await res.json() as { data: Array<{ embedding: number[]; index: number }> };
    const result: (number[] | null)[] = texts.map(() => null);
    for (const item of data.data || []) {
      result[item.index] = item.embedding;
    }
    return result;
  } catch (err) {
    log.error({ err }, 'Batch embedding generation failed');
    return texts.map(() => null);
  }
}
