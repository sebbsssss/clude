import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the three provider clients so we assert routing, not network calls.
// vi.hoisted keeps the mock fns available to the hoisted vi.mock factories.
const { ollamaMock, claudeMock, openrouterMock } = vi.hoisted(() => ({
  ollamaMock: vi.fn(async (..._a: unknown[]) => 'OLLAMA_OUT'),
  claudeMock: vi.fn(async (..._a: unknown[]) => 'CLAUDE_OUT'),
  openrouterMock: vi.fn(async (..._a: unknown[]) => 'OR_OUT'),
}));

vi.mock('../ollama-client', () => ({ generateOllamaResponse: ollamaMock }));
vi.mock('../claude-client', () => ({ generateResponse: claudeMock }));
vi.mock('../openrouter-client', () => ({
  generateOpenRouterResponse: openrouterMock,
  isOpenRouterEnabled: () => false,
}));

const KEYS = ['MEMORY_MODEL_PROVIDER', 'MEMORY_MODEL', 'OLLAMA_URL'];

describe('inference: ollama (local memory model) routing', () => {
  beforeEach(() => {
    (globalThis as unknown as { __CLUDE_SDK_MODE?: boolean }).__CLUDE_SDK_MODE = true;
    for (const k of KEYS) delete process.env[k];
    ollamaMock.mockClear();
    claudeMock.mockClear();
    openrouterMock.mockClear();
    vi.resetModules();
  });

  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
    delete (globalThis as unknown as { __CLUDE_SDK_MODE?: boolean }).__CLUDE_SDK_MODE;
  });

  it('isOllamaEnabled is false with no provider, and false with a model but no provider (no auto-enable)', async () => {
    const a = await import('../inference');
    expect(a.isOllamaEnabled()).toBe(false);

    process.env.MEMORY_MODEL = 'm'; // model set, provider still unset
    vi.resetModules();
    const b = await import('../inference');
    expect(b.isOllamaEnabled()).toBe(false);
  });

  it('routes generate({ provider: "ollama" }) to the local client', async () => {
    process.env.MEMORY_MODEL_PROVIDER = 'ollama';
    process.env.MEMORY_MODEL = 'cludemem-e4b';
    const { generate, isOllamaEnabled } = await import('../inference');

    expect(isOllamaEnabled()).toBe(true);
    const out = await generate({ provider: 'ollama', userMessage: 'classify: I moved to Lisbon' });

    expect(out).toBe('OLLAMA_OUT');
    expect(ollamaMock).toHaveBeenCalledOnce();
    expect(claudeMock).not.toHaveBeenCalled();
    const arg = ollamaMock.mock.calls[0][0] as { model: string };
    expect(arg.model).toBe('cludemem-e4b');
  });

  it('does NOT fall back to anthropic when an explicit ollama call fails', async () => {
    process.env.MEMORY_MODEL_PROVIDER = 'ollama';
    process.env.MEMORY_MODEL = 'cludemem-e4b';
    ollamaMock.mockRejectedValueOnce(new Error('ollama down'));
    const { generate } = await import('../inference');

    await expect(generate({ provider: 'ollama', userMessage: 'x' })).rejects.toThrow(/ollama down/);
    expect(claudeMock).not.toHaveBeenCalled();
  });

  it('auto mode never selects ollama even when it is configured', async () => {
    process.env.MEMORY_MODEL_PROVIDER = 'ollama';
    process.env.MEMORY_MODEL = 'cludemem-e4b';
    const { generate } = await import('../inference');

    const out = await generate({ provider: 'auto', userMessage: 'x' });
    expect(out).toBe('CLAUDE_OUT'); // openrouter mocked disabled -> anthropic
    expect(ollamaMock).not.toHaveBeenCalled();
  });
});
