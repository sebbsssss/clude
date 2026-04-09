import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runDeepConnectionPhase } from './deep-connection'

// Minimal mocks for DB and memory helpers — we only want unit behaviour here
vi.mock('@clude/shared/core/database', () => ({
  getDb: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      insert: vi.fn().mockResolvedValue({ error: null }),
      // make it thenable so `await query` resolves
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    })),
  })),
}))

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}))

vi.mock('../memory', () => ({
  recallMemories: vi.fn().mockResolvedValue([]),
  createMemoryLinksBatch: vi.fn().mockResolvedValue(undefined),
  fetchExistingLinkTargets: vi.fn().mockResolvedValue(new Set()),
  markJepaQueried: vi.fn().mockResolvedValue(undefined),
  fetchJepaQueriedSince: vi.fn().mockResolvedValue(new Set()),
  matchByEmbedding: vi.fn().mockResolvedValue([]),
}))

describe('runDeepConnectionPhase', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.JEPA_ENABLED
  })

  afterEach(() => {
    delete process.env.JEPA_ENABLED
  })

  it('returns skipped=true when JEPA_ENABLED is not set', async () => {
    const result = await runDeepConnectionPhase()
    expect(result.skipped).toBe(true)
    expect(result.linksCreated).toBe(0)
    expect(result.topLinks).toEqual([])
  })

  it('returns skipped=true when JEPA_ENABLED is "false"', async () => {
    process.env.JEPA_ENABLED = 'false'
    const result = await runDeepConnectionPhase()
    expect(result.skipped).toBe(true)
  })

  it('returns skipped=true when JEPA_ENABLED is "1" (not "true")', async () => {
    process.env.JEPA_ENABLED = '1'
    const result = await runDeepConnectionPhase()
    expect(result.skipped).toBe(true)
  })

  it('returns skipped=true when no candidate memories are returned', async () => {
    process.env.JEPA_ENABLED = 'true'
    // DB mock already returns empty data arrays — so no candidates, expect skipped
    const result = await runDeepConnectionPhase()
    expect(result.skipped).toBe(true)
    expect(result.linksCreated).toBe(0)
  })
})
