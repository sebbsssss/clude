import { describe, it, expect, vi, beforeEach } from 'vitest'
import { JepaClient, hashConcepts } from './jepa'

describe('hashConcepts', () => {
  it('returns 5 ints, padded with zeros', () => {
    const result = hashConcepts(['nextjs', 'vercel'])
    expect(result).toHaveLength(5)
    expect(result.slice(2)).toEqual([0, 0, 0])
  })

  it('truncates to top 5', () => {
    const result = hashConcepts(['a', 'b', 'c', 'd', 'e', 'f', 'g'])
    expect(result).toHaveLength(5)
  })

  it('is deterministic', () => {
    const a = hashConcepts(['nextjs', 'vercel'])
    const b = hashConcepts(['nextjs', 'vercel'])
    expect(a).toEqual(b)
  })
})

describe('JepaClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('calls /predict and returns predictions', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        predictions: [
          { relation_type: 'supports', embedding: new Array(1024).fill(0.1), confidence: 0.8 },
        ],
        model_version: 'test',
      }),
    })
    global.fetch = fetchMock as unknown as typeof fetch

    const client = new JepaClient({
      url: 'https://jepa.example.com',
      token: 'test-token',
      enabled: true,
    })
    const result = await client.predict({
      memoryId: 42,
      embedding: new Array(1024).fill(0.1),
      metadata: {
        memoryType: 'semantic',
        importance: 0.7,
        decayFactor: 0.95,
        ageHours: 10,
        concepts: ['nextjs'],
      },
      relationTypes: ['supports'] as const,
    })
    expect(result?.predictions).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('returns null when disabled', async () => {
    const client = new JepaClient({ url: '', token: '', enabled: false })
    const result = await client.predict({
      memoryId: 1,
      embedding: [],
      metadata: { memoryType: 'semantic', importance: 0, decayFactor: 0, ageHours: 0, concepts: [] },
      relationTypes: ['supports'] as const,
    })
    expect(result).toBeNull()
  })

  it('opens circuit breaker after 5 failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    global.fetch = fetchMock as unknown as typeof fetch

    const client = new JepaClient({
      url: 'https://jepa.example.com',
      token: 'test-token',
      enabled: true,
    })
    const req: Parameters<JepaClient['predict']>[0] = {
      memoryId: 1,
      embedding: [],
      metadata: { memoryType: 'semantic', importance: 0, decayFactor: 0, ageHours: 0, concepts: [] },
      relationTypes: ['supports'],
    }
    for (let i = 0; i < 5; i++) {
      await client.predict(req)
    }
    expect(client.isCircuitOpen()).toBe(true)
    const callCountBefore = fetchMock.mock.calls.length
    await client.predict(req)
    expect(fetchMock.mock.calls.length).toBe(callCountBefore)
  })
})
