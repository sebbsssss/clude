import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// The runtime override lets the SDK / desktop app enable local mode after
// config has frozen (mirrors _configureEmbeddings).
const KEYS = ['MEMORY_MODEL_PROVIDER', 'MEMORY_MODEL', 'OLLAMA_URL'];

describe('memory-model-config runtime override', () => {
  beforeEach(() => {
    (globalThis as unknown as { __CLUDE_SDK_MODE?: boolean }).__CLUDE_SDK_MODE = true;
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(async () => {
    for (const k of KEYS) delete process.env[k];
    delete (globalThis as unknown as { __CLUDE_SDK_MODE?: boolean }).__CLUDE_SDK_MODE;
    const mod = await import('../memory-model-config');
    mod._resetMemoryModelConfig();
  });

  it('returns env config (disabled) when no override is set', async () => {
    const { getMemoryModelConfig } = await import('../memory-model-config');
    expect(getMemoryModelConfig().provider).toBe('');
  });

  it('applies a runtime override and enables the local model via isOllamaEnabled', async () => {
    const { _configureMemoryModel, getMemoryModelConfig } = await import('../memory-model-config');
    const { isOllamaEnabled, isMemoryModelEnabled } = await import('../inference');

    expect(isOllamaEnabled()).toBe(false);
    _configureMemoryModel({ provider: 'ollama', model: 'cludemem-e4b', ollamaUrl: 'http://localhost:11434' });

    const mm = getMemoryModelConfig();
    expect(mm.provider).toBe('ollama');
    expect(mm.model).toBe('cludemem-e4b');
    expect(isOllamaEnabled()).toBe(true);
    expect(isMemoryModelEnabled()).toBe(true);
  });

  it('merges a partial override over env defaults (ollamaUrl falls back)', async () => {
    const { _configureMemoryModel, getMemoryModelConfig } = await import('../memory-model-config');
    _configureMemoryModel({ provider: 'ollama', model: 'm' });
    expect(getMemoryModelConfig().ollamaUrl).toBe('http://localhost:11434');
  });
});
