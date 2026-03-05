# @clude/cloud

Supabase + Voyage AI + Venice providers for [@clude/brain](../clude-core).

## Quick Start

```ts
import { CludeEngine } from '@clude/brain'
import { SupabaseProvider, VoyageEmbeddings, VeniceLLM } from '@clude/cloud'

const engine = new CludeEngine({
  storage: new SupabaseProvider({
    url: process.env.SUPABASE_URL!,
    serviceKey: process.env.SUPABASE_KEY!,
  }),
  embeddings: new VoyageEmbeddings({
    apiKey: process.env.VOYAGE_API_KEY!,
  }),
  llm: new VeniceLLM({
    apiKey: process.env.VENICE_API_KEY!,
  }),
  scope: { owner_wallet: 'your-wallet-address' },
})

// Store
await engine.store({ content: 'Important fact', type: 'semantic' })

// Recall
const memories = await engine.recall({ query: 'What do I know?' })
```

## Swarm (multiple agents, shared memory)

```ts
// All agents use the same engine → same Supabase → shared memory
const engine = new CludeEngine({ storage, embeddings, llm, scope })

// Agent A stores knowledge
await engine.store({ content: 'Vector threshold should be 0.25 for Voyage', source: 'researcher' })

// Agent B recalls it instantly
const results = await engine.recall({ query: 'vector search threshold' })
// → finds researcher's memory
```

See `examples/swarm-demo.ts` for a full multi-agent demo.

## Providers

| Provider | Class | Purpose |
|----------|-------|---------|
| Supabase | `SupabaseProvider` | Storage, vector search (pgvector), link graph, entities |
| Voyage AI | `VoyageEmbeddings` | 1024-dim embeddings (voyage-4-large) |
| Venice AI | `VeniceLLM` | Query expansion, importance scoring (private inference) |

## Test

```bash
SUPABASE_URL=... SUPABASE_KEY=... VOYAGE_API_KEY=... npx tsx test/e2e.ts
```
