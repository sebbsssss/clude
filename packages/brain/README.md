# @clude/brain

CLUDE Brain. The memory engine.

## What This Is

The brain of [Clude](https://clude.io) — a biologically-inspired memory system that gives AI agents persistent, evolving memory with:

- **4 memory types** (episodic, semantic, procedural, self_model)
- **Hybrid retrieval** (vector + keyword + metadata + entity graph)
- **7-phase recall pipeline** (vector search → metadata → seeds → score → entities → graph traversal → type diversity)
- **Biological mechanics** (time-based decay, Hebbian reinforcement, importance rehearsal)
- **Query expansion** via LLM for broader recall
- **Bond-typed graph** traversal (causes, supports, elaborates, contradicts...)
- **Provider-agnostic** — bring your own storage, embeddings, and LLM

## Quick Start

```typescript
import { CludeEngine } from '@clude/brain'
import { VoyageEmbeddings } from '@clude/brain/providers/voyage'

const engine = new CludeEngine({
  storage: myStorageProvider,  // Implement StorageProvider interface
  embeddings: new VoyageEmbeddings({ apiKey: 'pa-...' }),
})

// Store
await engine.store({ content: "User prefers dark mode" })

// Recall
const memories = await engine.recall({ query: "theme preferences" })
```

## Architecture

```
@clude/brain (this package)
├── engine.ts        ← CludeEngine: the 7-phase recall pipeline
├── scoring.ts       ← Composite scoring formula
├── concepts.ts      ← Auto-concept classification
├── entities.ts      ← Entity extraction (NER)
├── utils.ts         ← Hash IDs, cosine sim, formatting
├── types/
│   ├── memory.ts    ← Memory, Entity, MemoryPack types
│   └── provider.ts  ← StorageProvider, EmbeddingProvider interfaces
└── providers/
    ├── voyage.ts    ← Voyage AI embeddings
    └── venice-llm.ts ← Venice AI for query expansion
```

## Provider Interfaces

### StorageProvider

Implement this to plug in any database:

```typescript
interface StorageProvider {
  insert(memory): Promise<Memory>
  vectorSearch(opts): Promise<Array<{ id, similarity }>>
  queryByImportance(opts): Promise<Memory[]>
  queryByText(opts): Promise<Memory[]>
  queryBySource(opts): Promise<Memory[]>
  getByIds(ids): Promise<Memory[]>
  upsertLink(link): Promise<void>
  getLinkedMemories(seedIds, minStrength, limit): Promise<...>
  batchTrackAccess(ids): Promise<void>
  batchDecay(opts): Promise<number>
  boostImportance(id, amount, max): Promise<void>
  boostLinkStrength(ids, amount): Promise<number>
  storeEmbedding(memoryId, embedding): Promise<void>
  count(): Promise<number>
  delete(id): Promise<boolean>
  // ... see types/provider.ts for full interface
}
```

### EmbeddingProvider

```typescript
interface EmbeddingProvider {
  name: string
  dimensions: number
  embed(text: string): Promise<number[]>
  embedBatch(texts: string[]): Promise<(number[] | null)[]>
  embedQuery?(text: string): Promise<number[]>  // optional asymmetric
}
```

### LLMProvider (optional)

Used for query expansion. Without it, recall uses direct queries only.

```typescript
interface LLMProvider {
  generate(opts: { system?, prompt, max_tokens?, temperature? }): Promise<string>
}
```

## Scoring Formula

```
score = (recency * 0.15 + relevance * 0.25 + importance * 0.20 + vectorSim * 0.40) * decay

+ knowledge_type_boost (semantic +0.15, procedural +0.12, self_model +0.10)
+ knowledge_seed_boost (2.0 + vectorSim * 2.0 when relevant)
* consolidation_penalty (0.30x for dream cycle noise)
```

All weights are configurable via `EngineConfig.weights`.

## Multi-Tenant Scoping

Every operation accepts an optional `Scope`:

```typescript
interface Scope {
  user_id?: string
  agent_id?: string
  session_id?: string
  run_id?: string
  owner_wallet?: string
}

// Scoped recall
await engine.recall({ query: "preferences" }, { user_id: "alice" })
```

## Packages

| Package | What | Status |
|---------|------|--------|
| `@clude/brain` | Memory engine (this) | ✅ Ready |
| `@clude/local` | SQLite + gte-small provider | 🔨 Building |
| `@clude/cloud` | Supabase + Voyage provider | 🔨 Extracting |
| `@clude/cortex` | Portability + identity + integrations | 🔨 Building |

## License

MIT
