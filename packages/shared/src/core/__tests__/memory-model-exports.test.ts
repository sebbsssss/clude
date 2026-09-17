import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Smoke test: the public capability helpers are reachable from the package
// entry (`@clude/shared` → src/index), and the client from its deep subpath.
// __CLUDE_SDK_MODE keeps config import lenient on unrelated required vars.
describe('memory-model public surface', () => {
  beforeEach(() => {
    (globalThis as unknown as { __CLUDE_SDK_MODE?: boolean }).__CLUDE_SDK_MODE = true;
  });
  afterEach(() => {
    delete (globalThis as unknown as { __CLUDE_SDK_MODE?: boolean }).__CLUDE_SDK_MODE;
  });

  it('exposes isOllamaEnabled and isMemoryModelEnabled from the package entry', async () => {
    const entry = await import('../../index');
    expect(typeof entry.isOllamaEnabled).toBe('function');
    expect(typeof entry.isMemoryModelEnabled).toBe('function');
  });

  it('exposes the Ollama client from its deep subpath', async () => {
    const client = await import('../ollama-client');
    expect(typeof client.generateOllamaResponse).toBe('function');
    expect(typeof client.askOllama).toBe('function');
    expect(typeof client.pingOllama).toBe('function');
  });
});
