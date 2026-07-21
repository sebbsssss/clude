import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// config.ts reads env at import time and rebuilds on resetModules.
// __CLUDE_SDK_MODE makes required() lenient so importing config in a unit
// test never throws on unrelated missing vars (X_API_KEY, etc.).
const KEYS = ['MEMORY_MODEL_PROVIDER', 'MEMORY_MODEL', 'OLLAMA_URL', 'MEMORY_MODEL_TIMEOUT_MS'];

describe('config.memoryModel', () => {
  beforeEach(() => {
    (globalThis as unknown as { __CLUDE_SDK_MODE?: boolean }).__CLUDE_SDK_MODE = true;
    for (const k of KEYS) delete process.env[k];
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
    delete (globalThis as unknown as { __CLUDE_SDK_MODE?: boolean }).__CLUDE_SDK_MODE;
  });

  it('defaults to a disabled provider (memory ops stay on the frontier path)', async () => {
    const { config } = await import('../../config');
    expect(config.memoryModel.provider).toBe('');
  });

  it('reads provider, model, and ollamaUrl from env', async () => {
    process.env.MEMORY_MODEL_PROVIDER = 'ollama';
    process.env.MEMORY_MODEL = 'cludemem-e4b';
    process.env.OLLAMA_URL = 'http://127.0.0.1:11434';
    const { config } = await import('../../config');
    expect(config.memoryModel.provider).toBe('ollama');
    expect(config.memoryModel.model).toBe('cludemem-e4b');
    expect(config.memoryModel.ollamaUrl).toBe('http://127.0.0.1:11434');
  });

  it('parses the request timeout as a number', async () => {
    process.env.MEMORY_MODEL_TIMEOUT_MS = '12345';
    const { config } = await import('../../config');
    expect(config.memoryModel.timeoutMs).toBe(12345);
  });
});
