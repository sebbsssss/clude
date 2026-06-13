import { z } from 'zod';
import { createChildLogger } from './logger';

const log = createChildLogger('ollama-client');

// ============================================================
// LOCAL OLLAMA CHAT CLIENT
//
// Talks to a local Ollama server via its native /api/chat endpoint
// (stream:false). Supports JSON-schema structured output via `format`.
// Zero API cost, fully offline. Mirrors the local embedding provider in
// embeddings.ts. This is the host path for the CludeMem memory model
// (and any stock Ollama chat model). See specs design Sections 5 and 9.
//
// Endpoint contract:
//   POST {ollamaUrl}/api/chat
//   { model, messages, stream:false, format?, options? }
//   → { message: { role, content }, done, ... }
//
// The client is pure: callers pass ollamaUrl/model explicitly (no config
// import) so it stays trivially testable and reusable from the SDK.
// ============================================================

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaGenerateOptions {
  /** Base URL of the Ollama server, e.g. http://localhost:11434 */
  ollamaUrl: string;
  /** Model tag, e.g. "gemma3:4b" or "cludemem-e4b" */
  model: string;
  /** Conversation turns */
  messages: OllamaMessage[];
  /** Optional system prompt, prepended as a system message */
  systemPrompt?: string;
  /** JSON schema for structured output (Ollama `format`). Omit for free text. */
  format?: Record<string, unknown>;
  /** Runtime/sampling options (temperature, num_ctx, ...) */
  options?: { temperature?: number; num_ctx?: number; [k: string]: unknown };
  /** Per-request timeout in ms (default 20000) */
  timeoutMs?: number;
}

const OllamaChatResponse = z.object({
  message: z.object({
    role: z.string().optional(),
    content: z.string(),
  }),
  done: z.boolean().optional(),
});

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Generate a chat completion from a local Ollama model.
 * Throws on non-2xx, timeout, or malformed response.
 */
export async function generateOllamaResponse(opts: OllamaGenerateOptions): Promise<string> {
  const { ollamaUrl, model, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  if (!ollamaUrl) throw new Error('Ollama client: ollamaUrl is required');
  if (!model) throw new Error('Ollama client: model is required');

  const messages: OllamaMessage[] = [];
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
  messages.push(...opts.messages);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        ...(opts.format ? { format: opts.format } : {}),
        ...(opts.options ? { options: opts.options } : {}),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      log.error({ status: response.status, model }, 'Ollama API error');
      throw new Error(`Ollama API error: ${response.status} ${errorText}`);
    }

    const parsed = OllamaChatResponse.safeParse(await response.json());
    if (!parsed.success) {
      log.error({ model }, 'Ollama returned an invalid response shape');
      throw new Error('Ollama client: invalid response shape');
    }

    log.debug({ model, structured: Boolean(opts.format) }, 'Ollama response generated');
    return parsed.data.message.content;
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      log.error({ model, timeoutMs }, 'Ollama request timed out');
      throw new Error(`Ollama request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Single-turn convenience helper. */
export async function askOllama(
  prompt: string,
  opts: Omit<OllamaGenerateOptions, 'messages'>,
): Promise<string> {
  return generateOllamaResponse({ ...opts, messages: [{ role: 'user', content: prompt }] });
}

/**
 * Liveness probe — true if the Ollama server responds on /api/tags.
 * Used by `clude doctor` and the desktop-app integration contract (Spec 1c).
 */
export async function pingOllama(ollamaUrl: string, timeoutMs = 3_000): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ollamaUrl}/api/tags`, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
