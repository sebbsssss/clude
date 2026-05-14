import { beforeEach, describe, expect, it, vi } from 'vitest';
import { discoverAcrossProviders, type RegistryProvider } from '../discovery';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const aliceProvider: RegistryProvider = {
  name: 'alice',
  endpoint: 'https://alice.example',
  chain_id: 'solana',
  verbs_supported: ['DISCOVER', 'RETRIEVE', 'VERIFY', 'CONTRIBUTE'],
};
const bobProvider: RegistryProvider = {
  name: 'bob',
  endpoint: 'https://bob.example',
  chain_id: 'base',
  verbs_supported: ['DISCOVER', 'VERIFY'],
};
const charlieProvider: RegistryProvider = {
  name: 'charlie',
  endpoint: 'https://charlie.example',
  chain_id: 'solana',
  verbs_supported: ['VERIFY'], // does not support DISCOVER → filtered out
};

describe('discoverAcrossProviders', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it('throws if neither registryUrl nor providers is given', async () => {
    await expect(discoverAcrossProviders({ fetch: fetchMock as never })).rejects.toThrow(
      /registryUrl or providers/,
    );
  });

  it('fetches the registry when registryUrl is given', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('registry.json')) {
        return Promise.resolve(
          jsonResponse(200, {
            schema_version: '1',
            spec_version: '0.1',
            providers: [aliceProvider],
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { count: 0, memories: [] }));
    });
    const result = await discoverAcrossProviders({
      registryUrl: 'https://pmp.dev/registry.json',
      fetch: fetchMock as never,
    });
    expect(fetchMock.mock.calls[0]![0]).toContain('registry.json');
    expect(result.memories).toEqual([]);
  });

  it('throws when registry fetch returns non-ok status', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'not_found' }));
    await expect(
      discoverAcrossProviders({
        registryUrl: 'https://pmp.dev/missing.json',
        fetch: fetchMock as never,
      }),
    ).rejects.toThrow(/HTTP 404/);
  });

  it('fans out to all eligible providers and merges memories', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('alice.example')) {
        return Promise.resolve(
          jsonResponse(200, {
            count: 1,
            memories: [
              {
                id: 'mem-a',
                type: 'episodic',
                content: 'from alice',
                owner: null,
                created_at: '2026-05-13T12:00:00Z',
                tags: [],
                attestation: null,
              },
            ],
          }),
        );
      }
      if (url.includes('bob.example')) {
        return Promise.resolve(
          jsonResponse(200, {
            count: 2,
            memories: [
              {
                id: 'mem-b1',
                type: 'semantic',
                content: 'from bob 1',
                owner: null,
                created_at: '2026-05-13T12:00:00Z',
                tags: [],
                attestation: null,
              },
              {
                id: 'mem-b2',
                type: 'semantic',
                content: 'from bob 2',
                owner: null,
                created_at: '2026-05-13T12:00:00Z',
                tags: [],
                attestation: null,
              },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { count: 0, memories: [] }));
    });

    const result = await discoverAcrossProviders({
      providers: [aliceProvider, bobProvider],
      query: 'test',
      fetch: fetchMock as never,
    });
    expect(result.memories).toHaveLength(3);
    expect(result.perProvider).toEqual({ alice: 1, bob: 2 });
    expect(result.errors).toEqual([]);

    const fromAlice = result.memories.find((m) => m.id === 'mem-a');
    expect(fromAlice?.provider).toBe('alice');
    const fromBob1 = result.memories.find((m) => m.id === 'mem-b1');
    expect(fromBob1?.provider).toBe('bob');
  });

  it('filters out providers missing required verbs', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { count: 0, memories: [] }));
    await discoverAcrossProviders({
      providers: [aliceProvider, charlieProvider],
      fetch: fetchMock as never,
    });
    // Only one provider hit (alice). charlie filtered out for not supporting DISCOVER.
    const calls = fetchMock.mock.calls.map((c) => c[0] as string);
    expect(calls.some((u) => u.includes('alice.example'))).toBe(true);
    expect(calls.some((u) => u.includes('charlie.example'))).toBe(false);
  });

  it('records per-provider errors without aborting the fan-out', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('alice.example')) {
        return Promise.resolve(jsonResponse(500, { error: 'discover_failed' }));
      }
      if (url.includes('bob.example')) {
        return Promise.resolve(
          jsonResponse(200, {
            count: 1,
            memories: [
              {
                id: 'mem-b',
                type: 'episodic',
                content: 'from bob',
                owner: null,
                created_at: '2026-05-13T12:00:00Z',
                tags: [],
                attestation: null,
              },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse(200, { count: 0, memories: [] }));
    });
    const result = await discoverAcrossProviders({
      providers: [aliceProvider, bobProvider],
      fetch: fetchMock as never,
    });
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0]!.provider).toBe('bob');
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.provider).toBe('alice');
    expect(result.errors[0]!.status).toBe(500);
  });

  it('forwards query, tags, and limit options to each provider', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { count: 0, memories: [] }));
    await discoverAcrossProviders({
      providers: [aliceProvider],
      query: 'foo',
      tags: ['x', 'y'],
      limit: 3,
      fetch: fetchMock as never,
    });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('query=foo');
    expect(url).toContain('tags=x');
    expect(url).toContain('tags=y');
    expect(url).toContain('limit=3');
  });
});
