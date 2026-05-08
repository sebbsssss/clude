import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { api } from '../api';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api.uploadChatImage', () => {
  it('POSTs multipart with conversation_id', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      url: 'https://x', storage_path: 'w/c/u.png', mime: 'image/png',
      width: 1, height: 1, size_bytes: 100,
    }), { status: 200 }));
    const file = new File([new Uint8Array([1, 2])], 'a.png', { type: 'image/png' });
    const out = await api.uploadChatImage(file, '11111111-1111-4111-8111-111111111111');
    expect(out.storage_path).toBe('w/c/u.png');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('throws on non-2xx', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), { status: 400 }));
    const file = new File([new Uint8Array([1])], 'a.png', { type: 'image/png' });
    await expect(api.uploadChatImage(file, '11111111-1111-4111-8111-111111111111')).rejects.toThrow();
  });
});
