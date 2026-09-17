import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the underlying clients; assert routing, not network calls.
const { ollamaMock, openrouterMock, claudeMock } = vi.hoisted(() => ({
  ollamaMock: vi.fn(async (..._a: unknown[]) => 'LOCAL'),
  openrouterMock: vi.fn(async (..._a: unknown[]) => 'OPENROUTER'),
  claudeMock: vi.fn(async (..._a: unknown[]) => 'CLAUDE'),
}));

vi.mock('../ollama-client', () => ({ generateOllamaResponse: ollamaMock }));
vi.mock('../claude-client', () => ({ generateResponse: claudeMock }));

// isOpenRouterEnabled is toggled per test via a mutable flag.
let openrouterEnabled = true;
vi.mock('../openrouter-client', () => ({
  generateOpenRouterResponse: openrouterMock,
  isOpenRouterEnabled: () => openrouterEnabled,
}));

const KEYS = ['MEMORY_MODEL_PROVIDER', 'MEMORY_MODEL'];

describe('memory-ops router', () => {
  beforeEach(() => {
    (globalThis as unknown as { __CLUDE_SDK_MODE?: boolean }).__CLUDE_SDK_MODE = true;
    for (const k of KEYS) delete process.env[k];
    openrouterEnabled = true;
    ollamaMock.mockClear();
    openrouterMock.mockClear();
    claudeMock.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
    delete (globalThis as unknown as { __CLUDE_SDK_MODE?: boolean }).__CLUDE_SDK_MODE;
  });

  it('classifies query/classify/importance as memory ops and reply/reflect as not', async () => {
    const { isMemoryOp } = await import('../memory-ops');
    expect(isMemoryOp('query')).toBe(true);
    expect(isMemoryOp('classify')).toBe(true);
    expect(isMemoryOp('importance')).toBe(true);
    expect(isMemoryOp('reply')).toBe(false);
    expect(isMemoryOp('reflect')).toBe(false);
    expect(isMemoryOp('emergence')).toBe(false);
    expect(isMemoryOp('dream')).toBe(false);
  });

  it('uses the frontier path (OpenRouter) when the local model is disabled', async () => {
    const { generateMemoryOp } = await import('../memory-ops');
    const out = await generateMemoryOp({ cognitiveFunction: 'query', userMessage: 'x' });
    expect(out).toBe('OPENROUTER');
    expect(ollamaMock).not.toHaveBeenCalled();
    expect(openrouterMock).toHaveBeenCalledOnce();
  });

  it('uses the local model for a memory op when enabled, passing the format schema', async () => {
    process.env.MEMORY_MODEL_PROVIDER = 'ollama';
    process.env.MEMORY_MODEL = 'cludemem-e4b';
    const { generateMemoryOp } = await import('../memory-ops');
    const schema = { type: 'object' };
    const out = await generateMemoryOp({
      cognitiveFunction: 'classify',
      userMessage: 'I moved to Lisbon',
      format: schema,
    });
    expect(out).toBe('LOCAL');
    expect(openrouterMock).not.toHaveBeenCalled();
    const arg = ollamaMock.mock.calls[0][0] as { model: string; format?: unknown };
    expect(arg.model).toBe('cludemem-e4b');
    expect(arg.format).toEqual(schema);
  });

  it('does NOT route a personality function to the local model even when enabled', async () => {
    process.env.MEMORY_MODEL_PROVIDER = 'ollama';
    process.env.MEMORY_MODEL = 'cludemem-e4b';
    const { generateMemoryOp } = await import('../memory-ops');
    const out = await generateMemoryOp({ cognitiveFunction: 'reply', userMessage: 'x' });
    expect(out).toBe('OPENROUTER');
    expect(ollamaMock).not.toHaveBeenCalled();
  });

  it('falls back to the frontier path when the local call fails', async () => {
    process.env.MEMORY_MODEL_PROVIDER = 'ollama';
    process.env.MEMORY_MODEL = 'cludemem-e4b';
    ollamaMock.mockRejectedValueOnce(new Error('ollama down'));
    const { generateMemoryOp } = await import('../memory-ops');
    const out = await generateMemoryOp({ cognitiveFunction: 'classify', userMessage: 'x' });
    expect(out).toBe('OPENROUTER');
    expect(ollamaMock).toHaveBeenCalledOnce();
    expect(openrouterMock).toHaveBeenCalledOnce();
  });

  it('falls back to the Claude client when OpenRouter is also disabled', async () => {
    openrouterEnabled = false;
    const { generateMemoryOp } = await import('../memory-ops');
    const out = await generateMemoryOp({ cognitiveFunction: 'summarize', userMessage: 'x' });
    expect(out).toBe('CLAUDE');
    expect(claudeMock).toHaveBeenCalledOnce();
  });
});
