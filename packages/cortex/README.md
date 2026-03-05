# @clude/cortex

The integration layer. Private. Portable. Permissionless. Poly-model. Persistent.

Cortex connects [CLUDE Brain](../clude-core) to the world: wallet identity, signed MemoryPacks, on-chain proofs, and framework adapters.

## Quick Start

```typescript
import { createPack, verifyPackIntegrity, packToMarkdown } from '@clude/cortex'
import { cludeTools, handleCludeTool } from '@clude/cortex/adapters/openai'

// Export memories as a signed pack
const pack = createPack({
  wallet: '5vK6WRCq...',
  name: 'My Agent',
  memories: [...],
  secret: 'my-signing-key',
})

// Verify integrity
verifyPackIntegrity(pack) // true

// Share as markdown
console.log(packToMarkdown(pack))
```

## Features

### Wallet Identity
Every agent is identified by a wallet address. Memories are scoped to wallets.

```typescript
import { generateMemoryUUID, generateAgentId } from '@clude/cortex'

// Deterministic — same inputs always produce the same UUID
const uuid = generateMemoryUUID(wallet, content, timestamp)
```

### MemoryPacks
Self-contained, signed memory bundles. Like Git commits for memory.

```typescript
import { createPack, mergePacks, packFromJSON } from '@clude/cortex'

// Create
const pack = createPack({ wallet, memories, connections, secret })

// Merge two packs (deduplicates by UUID)
const merged = mergePacks(packA, packB)

// JSON round-trip
const json = packToJSON(pack)
const restored = packFromJSON(json)
```

### On-Chain Proofs (Solana)
Commit memory hashes to Solana for provable existence and ownership.

```typescript
import { commitPackToChain, verifyOnChainProof } from '@clude/cortex/solana'

const proof = await commitPackToChain(pack, {
  rpcUrl: 'https://api.mainnet-beta.solana.com',
  privateKey: '...',
})
// proof.tx = Solana transaction signature
```

### OpenAI Function Calling
Drop Clude into any OpenAI agent in 3 lines:

```typescript
import { cludeTools, handleCludeTool } from '@clude/cortex/adapters/openai'

const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages,
  tools: cludeTools,  // remember, recall, forget
})

// Handle tool calls
for (const call of response.choices[0].message.tool_calls) {
  const result = await handleCludeTool(call, engine)
}
```

### LangChain / LangGraph
Works as a drop-in memory backend:

```typescript
import { CludeMemory } from '@clude/cortex/adapters/langchain'

const memory = new CludeMemory(engine)
// Automatically loads relevant memories before each LLM call
// Automatically saves interactions after each response
```

## Architecture

```
@clude/cortex
├── src/
│   ├── index.ts          — Public exports
│   ├── identity.ts       — Wallet-based agent identity
│   ├── pack.ts           — MemoryPack create/sign/verify/merge
│   ├── solana.ts         — On-chain proofs (Ed25519, memo)
│   └── adapters/
│       ├── openai.ts     — OpenAI function calling tools
│       └── langchain.ts  — LangChain memory + LangGraph checkpointer
```

## The 5 P's

| Principle | How |
|---|---|
| **Private** | Venice AI inference, no data logging |
| **Portable** | Wallet-based identity, signed MemoryPacks |
| **Permissionless** | Any agent can store/recall, no gatekeepers |
| **Poly-model** | Works with any LLM (OpenAI, Anthropic, local) |
| **Persistent** | Solana on-chain proofs, survives model changes |

## Packages

| Package | What |
|---|---|
| `@clude/brain` | Memory engine (7-phase recall, scoring, decay) |
| **`@clude/cortex`** | **Integration layer (this package)** |
| `@clude/local` | SQLite + gte-small (zero config) |
| `@clude/cloud` | Supabase + Voyage AI |

## License

MIT
