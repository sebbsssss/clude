import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PmpClient } from '../client';
import { PmpMemoryStore } from '../adapters/langchain';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PmpMemoryStore (LangChain adapter)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let client: PmpClient;
  let store: PmpMemoryStore;

  beforeEach(() => {
    fetchMock = vi.fn();
    client = new PmpClient({
      baseUrl: 'https://api.pmp.dev',
      fetch: fetchMock as unknown as typeof globalThis.fetch,
    });
    store = new PmpMemoryStore(client, { defaultType: 'episodic', k: 5 });
  });

  describe('getRelevantDocuments', () => {
    it('returns LangChain-shaped documents from DISCOVER', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          jsonResponse(200, {
            count: 2,
            memories: [
              {
                id: 'mem-a',
                type: 'episodic',
                content: 'memory A',
                owner: 'wallet-1',
                created_at: '2026-05-13T12:00:00.000Z',
                tags: ['t1'],
                attestation: null,
              },
              {
                id: 'mem-b',
                type: 'semantic',
                content: 'memory B',
                owner: null,
                created_at: '2026-05-13T12:01:00.000Z',
                tags: [],
                attestation: null,
              },
            ],
          }),
        ),
      );
      const docs = await store.getRelevantDocuments('pricing');
      expect(docs).toHaveLength(2);
      expect(docs[0]).toMatchObject({
        pageContent: 'memory A',
        metadata: { id: 'mem-a', type: 'episodic', tags: ['t1'] },
      });
    });

    it('passes k as the discover limit', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(jsonResponse(200, { count: 0, memories: [] })));
      await store.getRelevantDocuments('x');
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toContain('limit=5');
    });
  });

  describe('addDocuments', () => {
    it('CONTRIBUTEs each document and returns the new ids', async () => {
      let callCount = 0;
      fetchMock.mockImplementation(() => {
        callCount += 1;
        return Promise.resolve(
          jsonResponse(201, {
            id: `mem-new-${callCount}`,
            type: 'episodic',
            owner: 'wallet-1',
            created_at: '2026-05-13T12:00:00.000Z',
            tags: [],
            attestation: null,
          }),
        );
      });
      const ids = await store.addDocuments([
        { pageContent: 'first', metadata: {} },
        { pageContent: 'second', metadata: { tags: ['x'], type: 'semantic', importance: 0.9 } },
      ]);
      expect(ids).toEqual(['mem-new-1', 'mem-new-2']);

      // Confirm the type and tags were forwarded for the second doc
      const secondBody = JSON.parse(fetchMock.mock.calls[1]![1].body as string);
      expect(secondBody.type).toBe('semantic');
      expect(secondBody.tags).toEqual(['x']);
      expect(secondBody.importance).toBe(0.9);
    });

    it('falls back to defaultType when metadata.type is invalid', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          jsonResponse(201, {
            id: 'mem-x',
            type: 'episodic',
            owner: null,
            created_at: '',
            tags: [],
            attestation: null,
          }),
        ),
      );
      await store.addDocuments([{ pageContent: 'x', metadata: { type: 'bogus' } }]);
      const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
      expect(body.type).toBe('episodic');
    });
  });

  describe('convenience methods', () => {
    it('addMemory returns the id', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          jsonResponse(201, {
            id: 'mem-z',
            type: 'episodic',
            owner: null,
            created_at: '',
            tags: [],
            attestation: null,
          }),
        ),
      );
      const id = await store.addMemory('hello', { tags: ['hi'] });
      expect(id).toBe('mem-z');
    });

    it('getMemory delegates to retrieve', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          jsonResponse(200, {
            id: 'mem-q',
            type: 'episodic',
            content: 'q',
            owner: null,
            created_at: '',
            tags: [],
            attestation: null,
          }),
        ),
      );
      const m = await store.getMemory('mem-q');
      expect(m.id).toBe('mem-q');
    });
  });
});
