import { murmurHash } from '@clude/shared/utils/hash'

export const RELATION_TYPES = ['supports', 'causes', 'elaborates'] as const
export type RelationType = (typeof RELATION_TYPES)[number]

export const CONCEPT_HASH_LEN = 5

export function hashConcepts(concepts: string[]): number[] {
  const top = concepts.slice(0, CONCEPT_HASH_LEN)
  const hashed = top.map((c) => murmurHash(c))
  while (hashed.length < CONCEPT_HASH_LEN) hashed.push(0)
  return hashed
}

export interface JepaMetadata {
  memoryType: 'episodic' | 'semantic' | 'procedural' | 'self_model' | 'introspective'
  importance: number
  decayFactor: number
  ageHours: number
  concepts: string[]
}

export interface JepaPredictRequest {
  memoryId: number
  embedding: number[]
  metadata: JepaMetadata
  relationTypes: RelationType[]
}

export interface JepaPrediction {
  relation_type: RelationType
  embedding: number[]
  confidence: number
}

export interface JepaPredictResponse {
  predictions: JepaPrediction[]
  model_version: string
}

export interface JepaClientOptions {
  url: string
  token: string
  enabled: boolean
  timeoutMs?: number
}

const BREAKER_THRESHOLD = 5
const BREAKER_COOLDOWN_MS = 5 * 60 * 1000

export class JepaClient {
  private failures = 0
  private breakerUntil = 0

  constructor(private opts: JepaClientOptions) {}

  isCircuitOpen(): boolean {
    if (this.failures >= BREAKER_THRESHOLD) {
      if (Date.now() < this.breakerUntil) return true
      this.failures = 0
    }
    return false
  }

  async predict(req: JepaPredictRequest): Promise<JepaPredictResponse | null> {
    if (!this.opts.enabled) return null
    if (this.isCircuitOpen()) return null

    try {
      const response = await fetch(`${this.opts.url}/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.opts.token}`,
        },
        body: JSON.stringify({
          memory_id: req.memoryId,
          embedding: req.embedding,
          metadata: {
            memory_type: req.metadata.memoryType,
            importance: req.metadata.importance,
            decay_factor: req.metadata.decayFactor,
            age_hours: req.metadata.ageHours,
            concept_hashes: hashConcepts(req.metadata.concepts),
          },
          relation_types: req.relationTypes,
        }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 5000),
      })
      if (!response.ok) {
        this.recordFailure()
        return null
      }
      this.failures = 0
      return (await response.json()) as JepaPredictResponse
    } catch {
      this.recordFailure()
      return null
    }
  }

  private recordFailure(): void {
    this.failures += 1
    if (this.failures >= BREAKER_THRESHOLD) {
      this.breakerUntil = Date.now() + BREAKER_COOLDOWN_MS
    }
  }
}
