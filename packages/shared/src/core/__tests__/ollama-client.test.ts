import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response);
}

describe('ollama-client', () => {
  it('returns message content from /api/chat (stream:false)', async () => {
    const f = mockFetchOnce({ message: { role: 'assistant', content: 'hello' }, done: true });
    const { generateOllamaResponse } = await import('../ollama-client');

    const out = await generateOllamaResponse({
      ollamaUrl: 'http://localhost:11434',
      model: 'gemma3:4b',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(out).toBe('hello');
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe('http://localhost:11434/api/chat');
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.stream).toBe(false);
    expect(sent.model).toBe('gemma3:4b');
    expect(sent.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('prepends systemPrompt and passes a JSON schema as `format`', async () => {
    const f = mockFetchOnce({ message: { content: '{"type":"semantic"}' }, done: true });
    const { generateOllamaResponse } = await import('../ollama-client');
    const schema = { type: 'object', properties: { type: { type: 'string' } } };

    const out = await generateOllamaResponse({
      ollamaUrl: 'http://localhost:11434',
      model: 'm',
      systemPrompt: 'You classify memories.',
      messages: [{ role: 'user', content: 'x' }],
      format: schema,
      options: { temperature: 0 },
    });

    expect(out).toBe('{"type":"semantic"}');
    const sent = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.format).toEqual(schema);
    expect(sent.options.temperature).toBe(0);
    expect(sent.messages[0]).toEqual({ role: 'system', content: 'You classify memories.' });
  });

  it('omits format and options when not provided', async () => {
    const f = mockFetchOnce({ message: { content: 'ok' } });
    const { generateOllamaResponse } = await import('../ollama-client');

    await generateOllamaResponse({
      ollamaUrl: 'http://localhost:11434',
      model: 'm',
      messages: [{ role: 'user', content: 'x' }],
    });

    const sent = JSON.parse((f.mock.calls[0][1] as RequestInit).body as string);
    expect('format' in sent).toBe(false);
    expect('options' in sent).toBe(false);
  });

  it('throws on a non-2xx response', async () => {
    mockFetchOnce({ error: 'model not found' }, false, 404);
    const { generateOllamaResponse } = await import('../ollama-client');

    await expect(
      generateOllamaResponse({
        ollamaUrl: 'http://localhost:11434',
        model: 'missing',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow(/Ollama API error: 404/);
  });

  it('throws on a malformed response shape', async () => {
    mockFetchOnce({ nope: true });
    const { generateOllamaResponse } = await import('../ollama-client');

    await expect(
      generateOllamaResponse({
        ollamaUrl: 'http://localhost:11434',
        model: 'm',
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrow(/invalid response shape/);
  });

  it('pingOllama returns true on ok and false when fetch throws', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: true } as Response)
      .mockRejectedValueOnce(new Error('connection refused'));
    const { pingOllama } = await import('../ollama-client');

    expect(await pingOllama('http://localhost:11434')).toBe(true);
    expect(await pingOllama('http://localhost:11434')).toBe(false);
  });
});
