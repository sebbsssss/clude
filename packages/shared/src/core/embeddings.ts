import { config } from '../config';
import { createChildLogger } from './logger';
import type { EmbeddingSpace } from './migration-profile';

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
  // Ollama local embedding provider — zero API cost, fully offline.
  // Uses OpenAI-compatible /v1/embeddings endpoint.
  // Set EMBEDDING_PROVIDER=ollama, EMBEDDING_MODEL=nomic-embed-text (or mxbai-embed-large).
  // OLLAMA_URL defaults to http://localhost:11434 — set EMBEDDING_API_KEY to any non-empty string.
  ollama: {
    url: `${process.env.OLLAMA_URL ?? 'http://localhost:11434'}/v1/embeddings`,
    defaultModel: 'nomic-embed-text',
    authHeader: () => 'Bearer ollama',
  },
};

let _enabled: boolean | null = null;
let _overrideConfig: { provider: string; apiKey: string; model?: string; dimensions?: number } | null = null;

// LRU embedding cache — avoids re-computing embeddings for repeated/similar queries
const EMBEDDING_CACHE_MAX = 200;
const EMBEDDING_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const _embeddingCache = new Map<string, { embedding: number[]; ts: number }>();

export function getCachedEmbedding(text: string): number[] | null {
  const key = text.slice(0, 500).toLowerCase().trim();
  const entry = _embeddingCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > EMBEDDING_CACHE_TTL_MS) {
    _embeddingCache.delete(key);
    return null;
  }
  return entry.embedding;
}

export function setCachedEmbedding(text: string, embedding: number[]): void {
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
  // Ollama doesn't require a real API key — allow empty/placeholder values
  const apiKeyOk = !!cfg.apiKey || cfg.provider === 'ollama';
  _enabled = !!cfg.provider && apiKeyOk && cfg.provider in PROVIDERS;
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

// ============================================================
// VERTEX AI EMBEDDING PROVIDER (GCP replacement for Voyage) — migration Slice 3
//
// Vertex does not fit the OpenAI-shaped PROVIDERS contract above: a different URL
// (project + location + model), a different body ({instances,parameters}), a
// different response ({predictions:[{embeddings:{values}}]}), and a short-lived GCP
// OAuth token instead of a static key. So it lives in its own path, kept behind
// generateEmbeddingForSpace('vertex') / config.vertex, so the Voyage space stays the
// live default until the LongMemEval gate passes. Auth is SDK-free (metadata server).
// ============================================================

interface VertexToken { token: string; expiresAtMs: number; }
let _vertexToken: VertexToken | null = null;

/** @internal test hook — clears the cached Vertex OAuth token. */
export function _resetVertexAuthCache(): void {
  _vertexToken = null;
}

const METADATA_TOKEN_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

/**
 * @internal SDK-free access-token fetch from the Cloud Run / GCE metadata server,
 * which mints a token from the instance's attached service account. No key stored.
 */
export async function _fetchMetadataToken(): Promise<{ token: string; expiresInSec: number }> {
  const res = await fetch(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) throw new Error(`Vertex metadata token fetch failed: ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  return { token: j.access_token, expiresInSec: j.expires_in };
}

async function getVertexAccessToken(): Promise<string> {
  // Local/smoke override (`gcloud auth print-access-token`); empty in prod.
  const override = config.vertex.accessToken;
  if (override) return override;
  const now = Date.now();
  if (_vertexToken && _vertexToken.expiresAtMs > now + 60_000) return _vertexToken.token;
  const { token, expiresInSec } = await _fetchMetadataToken();
  _vertexToken = { token, expiresAtMs: now + expiresInSec * 1000 };
  return token;
}

function vertexPredictUrl(model: string): string {
  const { project, location } = config.vertex;
  return `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:predict`;
}

/**
 * Generate Vertex embeddings for one or more texts. Returns an array matching input
 * length (null entries for failures), never throws. Independent of EMBEDDING_PROVIDER
 * so ingest can dual-write and the backfill can populate the shadow vector column
 * while the live Voyage space is untouched.
 */
export async function generateVertexEmbeddings(
  texts: string[],
  dimensions?: number,
): Promise<(number[] | null)[]> {
  if (texts.length === 0) return [];
  const { project, model, dimensions: defaultDims } = config.vertex;
  if (!project) {
    log.warn('Vertex embeddings requested but VERTEX_PROJECT is unset');
    return texts.map(() => null);
  }
  const outputDimensionality = dimensions ?? defaultDims;
  const startMs = Date.now();
  try {
    const token = await getVertexAccessToken();
    const res = await fetch(vertexPredictUrl(model), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        instances: texts.map((t) => ({ content: t.slice(0, 8000) })),
        parameters: { outputDimensionality },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      log.error({ status: res.status, body: errText.slice(0, 200), provider: 'vertex' }, 'Vertex embedding API error');
      return texts.map(() => null);
    }
    const data = (await res.json()) as { predictions?: Array<{ embeddings?: { values?: number[] } }> };
    const preds = data.predictions ?? [];
    log.debug({ provider: 'vertex', model, count: texts.length, elapsed: Date.now() - startMs }, 'Vertex embeddings generated');
    return texts.map((_, i) => preds[i]?.embeddings?.values ?? null);
  } catch (err) {
    log.error({ err, provider: 'vertex' }, 'Vertex embedding generation failed');
    return texts.map(() => null);
  }
}

/** Single-text Vertex embedding convenience wrapper. */
export async function generateVertexEmbedding(text: string, dimensions?: number): Promise<number[] | null> {
  const [vec] = await generateVertexEmbeddings([text], dimensions);
  return vec ?? null;
}

/**
 * Generate an embedding for a specific vector SPACE — the migration switch seam.
 * 'vertex' -> Vertex gemini-embedding-001 (the shadow space); any other value -> the
 * current Voyage / EMBEDDING_PROVIDER path. Recall passes activeEmbeddingSpace() so a
 * flag flip moves the query embedding to match the column recall reads.
 */
export async function generateEmbeddingForSpace(
  space: EmbeddingSpace,
  text: string,
): Promise<number[] | null> {
  if (space === 'vertex') return generateVertexEmbedding(text);
  return generateEmbedding(text);
}
