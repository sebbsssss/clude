# CLUDE

**Portable memory layer for AI agents.**

Memory that survives across sessions, models, and frameworks. Built on Solana for provable ownership.

## Packages

| Package | Description | Tests |
|---------|-------------|-------|
| [`@clude/brain`](packages/brain) | Provider-agnostic memory engine (7-phase recall pipeline) | 25/25 ✅ |
| [`@clude/cortex`](packages/cortex) | Portability, wallet identity, framework adapters (OpenAI, LangChain) | 35/35 ✅ |
| [`@clude/cloud`](packages/cloud) | Supabase + Voyage AI + Venice providers | 21/21 ✅ |
| [`@clude/local`](packages/local) | SQLite + gte-small local-first provider (zero config) | 15/15 ✅ |
| [`@clude/bot`](packages/bot) | X (Twitter) agent — the original Clude bot | — |

## Quick Start

### Cloud (Supabase + Voyage)

```ts
import { CludeEngine } from '@clude/brain'
import { SupabaseProvider, VoyageEmbeddings, VeniceLLM } from '@clude/cloud'

const engine = new CludeEngine({
  storage: new SupabaseProvider({ url: SUPABASE_URL, serviceKey: SUPABASE_KEY }),
  embeddings: new VoyageEmbeddings({ apiKey: VOYAGE_KEY }),
  llm: new VeniceLLM({ apiKey: VENICE_KEY }),
  scope: { owner_wallet: 'your-wallet' },
})

await engine.store({ content: 'Important fact', type: 'semantic' })
const memories = await engine.recall({ query: 'What do I know?' })
```

### Local (zero config)

```ts
import { CludeEngine } from '@clude/brain'
import { SQLiteProvider } from '@clude/local'
import { GteSmallEmbeddings } from '@clude/local'

const engine = new CludeEngine({
  storage: new SQLiteProvider({ path: './memories.db' }),
  embeddings: new GteSmallEmbeddings(),
})
```

### Swarm (multiple agents, shared memory)

```ts
// All agents share the same engine → shared memory
const engine = new CludeEngine({ storage, embeddings, llm, scope })

// Agent A stores → Agent B recalls instantly
await engine.store({ content: 'Vector threshold = 0.25', source: 'researcher' })
const results = await engine.recall({ query: 'vector threshold' })
```

See [`packages/cloud/examples/swarm-demo.ts`](packages/cloud/examples/swarm-demo.ts) for a full demo.

## Architecture

```
┌─────────────────────────────────────────────┐
│                 Your Agent                   │
├─────────────────────────────────────────────┤
│  @clude/cortex  (identity, portability,     │
│                   OpenAI/LangChain adapters) │
├─────────────────────────────────────────────┤
│  @clude/brain   (7-phase recall, scoring,   │
│                   decay, entity graph)       │
├──────────────┬──────────────────────────────┤
│ @clude/local │       @clude/cloud           │
│ SQLite+gte   │  Supabase+Voyage+Venice      │
└──────────────┴──────────────────────────────┘
```

## The 5 P's

- **Private** — Venice AI for private inference, no data leaves your control
- **Portable** — Wallet-based identity, signed MemoryPacks, export/import anywhere
- **Permissionless** — No API keys needed for local mode, Solana for on-chain proofs
- **Poly-model** — Works with any LLM, any embedding model, any framework
- **Persistent** — Memories survive sessions, models, and infrastructure changes

## Token

`$CLUDE` — [`AWGCDT2gd8JadbYbYyZy1iKxfWokPNgrEQoU24zUpump`](https://solscan.io/token/AWGCDT2gd8JadbYbYyZy1iKxfWokPNgrEQoU24zUpump)

## Links

- [clude.io](https://clude.io)
- [@cludebot](https://x.com/cludebot)
- [8004 Agent Registry](https://solscan.io/token/13wL2Ynx6aCB97UGfdEuYrx9RLBHyofqSc37SNor261N)
