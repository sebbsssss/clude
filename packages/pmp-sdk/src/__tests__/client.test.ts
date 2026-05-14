import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PmpClient } from '../client';
import { PmpError } from '../errors';

function jsonResponse(status: number, body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('PmpClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeClient(opts: { auth?: { bearer?: string; walletSignature?: string; extra?: Record<string, string> } } = {}): PmpClient {
    return new PmpClient({
      baseUrl: 'https://api.pmp.dev',
      auth: opts.auth,
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
  }

  describe('constructor', () => {
    it('throws when baseUrl is missing', () => {
      expect(() => new PmpClient({ baseUrl: '' })).toThrow();
    });

    it('strips trailing slashes from baseUrl', async () => {
      const c = new PmpClient({
        baseUrl: 'https://api.pmp.dev///',
        fetch: fetchMock as unknown as typeof globalThis.fetch,
      });
      fetchMock.mockResolvedValue(jsonResponse(200, { count: 0, memories: [] }));
      await c.discover();
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url.startsWith('https://api.pmp.dev/v1/memories')).toBe(true);
      expect(url.includes('.dev///')).toBe(false);
    });
  });

  describe('discover', () => {
    it('returns memories and count on 200', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          count: 1,
          memories: [
            {
              id: 'mem-a',
              type: 'episodic',
              content: 'hi',
              owner: null,
              created_at: '2026-05-13T12:00:00.000Z',
              tags: [],
              attestation: null,
            },
          ],
        }),
      );
      const res = await makeClient().discover({ query: 'hi' });
      expect(res.count).toBe(1);
      expect(res.memories[0]!.id).toBe('mem-a');
    });

    it('serialises tags and memory_types as repeated query params', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { count: 0, memories: [] }));
      await makeClient().discover({
        query: 'x',
        tags: ['a', 'b'],
        memory_types: ['episodic', 'semantic'],
        limit: 7,
      });
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toContain('query=x');
      expect(url).toContain('tags=a');
      expect(url).toContain('tags=b');
      expect(url).toContain('memory_types=episodic');
      expect(url).toContain('memory_types=semantic');
      expect(url).toContain('limit=7');
    });

    it('omits unset optional params', async () => {
      fetchMock.mockResolvedValue(jsonResponse(200, { count: 0, memories: [] }));
      await makeClient().discover();
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).not.toContain('limit=');
      expect(url).not.toContain('tags=');
    });
  });

  describe('retrieve', () => {
    it('returns the memory on 200', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          id: 'mem-x',
          type: 'episodic',
          content: 'x',
          owner: null,
          created_at: '2026-05-13T12:00:00.000Z',
          tags: [],
          attestation: null,
        }),
      );
      const m = await makeClient().retrieve('mem-x');
      expect(m.id).toBe('mem-x');
    });

    it('throws PmpError on 404 with not_found code', async () => {
      // Return a fresh Response per call — Response bodies are single-use.
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(404, { error: 'not_found' })));
      try {
        await makeClient().retrieve('mem-missing');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(PmpError);
        expect((e as PmpError).status).toBe(404);
        expect((e as PmpError).code).toBe('not_found');
      }
    });

    it('throws a PmpError with isPaymentRequired=true on 402', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(402, {
          error: 'payment_required',
          reason: 'pack_gated',
          x402: { amount: '0.001', currency: 'USDC' },
        }),
      );
      try {
        await makeClient().retrieve('mem-gated');
        expect.fail('should have thrown');
      } catch (e) {
        const err = e as PmpError;
        expect(err).toBeInstanceOf(PmpError);
        expect(err.isPaymentRequired).toBe(true);
        expect(err.x402).toEqual({ amount: '0.001', currency: 'USDC' });
      }
    });

    it('throws a PmpError with isRevoked=true on 410', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(410, {
          error: 'revoked',
          reason: 'compacted',
          hint: 'superseded_by:mem-new',
        }),
      );
      try {
        await makeClient().retrieve('mem-old');
        expect.fail('should have thrown');
      } catch (e) {
        const err = e as PmpError;
        expect(err.isRevoked).toBe(true);
        expect(err.hint).toBe('superseded_by:mem-new');
      }
    });
  });

  describe('verify', () => {
    it('does NOT send Authorization header (public endpoint)', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(200, {
          id: 'mem-a',
          verified: true,
          reason: 'verified',
          recomputed_hash: 'h',
          stored_hash: 'h',
          commitment: null,
        }),
      );
      await makeClient({ auth: { bearer: 'secret-token' } }).verify('mem-a');
      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBeUndefined();
    });
  });

  describe('contribute', () => {
    it('returns 201 body on success', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(201, {
          id: 'mem-new',
          type: 'episodic',
          owner: 'wallet-1',
          created_at: '2026-05-13T12:00:00.000Z',
          tags: ['x'],
          attestation: null,
        }),
      );
      const r = await makeClient({ auth: { bearer: 'token' } }).contribute({
        content: 'hi',
        type: 'episodic',
        tags: ['x'],
      });
      expect(r.id).toBe('mem-new');
    });

    it('sends Bearer auth header when configured', async () => {
      fetchMock.mockResolvedValue(jsonResponse(201, { id: 'm', type: 'episodic', owner: null, created_at: '', tags: [], attestation: null }));
      await makeClient({ auth: { bearer: 'secret' } }).contribute({ content: 'x', type: 'episodic' });
      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Bearer secret');
    });

    it('sends X-PMP-Wallet-Signature header when configured', async () => {
      fetchMock.mockResolvedValue(jsonResponse(201, { id: 'm', type: 'episodic', owner: null, created_at: '', tags: [], attestation: null }));
      await makeClient({ auth: { walletSignature: 'sig123' } }).contribute({ content: 'x', type: 'episodic' });
      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['X-PMP-Wallet-Signature']).toBe('sig123');
    });

    it('merges extra auth headers', async () => {
      fetchMock.mockResolvedValue(jsonResponse(201, { id: 'm', type: 'episodic', owner: null, created_at: '', tags: [], attestation: null }));
      await makeClient({ auth: { extra: { 'X-Custom': 'yes' } } }).contribute({ content: 'x', type: 'episodic' });
      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers['X-Custom']).toBe('yes');
    });

    it('throws PmpError on 422 with invalid_body code', async () => {
      fetchMock.mockResolvedValue(jsonResponse(422, { error: 'invalid_body', hint: 'content required' }));
      try {
        await makeClient({ auth: { bearer: 'token' } }).contribute({ content: '', type: 'episodic' });
        expect.fail('should have thrown');
      } catch (e) {
        const err = e as PmpError;
        expect(err.status).toBe(422);
        expect(err.code).toBe('invalid_body');
        expect(err.hint).toBe('content required');
      }
    });
  });

  describe('error semantics', () => {
    it('wraps network errors as PmpError(status=0)', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      try {
        await makeClient().discover();
        expect.fail('should have thrown');
      } catch (e) {
        const err = e as PmpError;
        expect(err).toBeInstanceOf(PmpError);
        expect(err.status).toBe(0);
        expect(err.reason).toBe('network');
      }
    });

    it('isRetryable is true on 429 and 5xx', () => {
      expect(new PmpError(429, { error: 'rate_limited' }).isRetryable).toBe(true);
      expect(new PmpError(500, { error: 'retrieve_failed' }).isRetryable).toBe(true);
      expect(new PmpError(503, { error: 'retrieve_failed' }).isRetryable).toBe(true);
      expect(new PmpError(404, { error: 'not_found' }).isRetryable).toBe(false);
    });

    it('falls back gracefully on non-JSON error bodies', async () => {
      fetchMock.mockResolvedValue(new Response('<html>500</html>', { status: 500 }));
      try {
        await makeClient().discover();
        expect.fail('should have thrown');
      } catch (e) {
        const err = e as PmpError;
        expect(err.status).toBe(500);
        expect(err.reason).toBe('invalid_json');
      }
    });
  });
});
