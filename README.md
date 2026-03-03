# Clude Bot

[![CI](https://github.com/sebbsssss/cludebot/actions/workflows/ci.yml/badge.svg)](https://github.com/sebbsssss/cludebot/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/clude-bot)](https://www.npmjs.com/package/clude-bot)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Molecular Memory** for AI agents. Not just storage — synthesis.

> *"From thought to proof. Where memories crystallize into knowledge."*

Built on [Stanford Generative Agents](https://arxiv.org/abs/2304.03442), [MemGPT/Letta](https://arxiv.org/abs/2310.08560), [CoALA](https://arxiv.org/abs/2309.02427), [Beads](https://github.com/steveyegge/beads), [Mole-Syn](https://x.com/bowang87/status/2025227673820176689) (molecular reasoning), and [Venice](https://venice.ai) (permissionless inference).

## Why Molecular Memory?

Traditional memory systems scan all memories on every query — **O(n)** complexity. Molecular Memory uses graph traversal — **O(k)** where k ≈ 3-5 bonds.

| Metric | Traditional | Molecular | Improvement |
|--------|-------------|-----------|-------------|
| **Retrieval** (1000 memories) | ~1000ms | ~16ms | **60x faster** |
| **Context coherence** | Scattered | Clustered | Better answers |
| **Dream cycle** | Full scan | Graph algo | 30-50% fewer LLM calls |

![Molecular vs Traditional](https://clude.io/assets/molecular-comparison.gif)

```bash
npm install clude-bot
```

## Quick Start — Hosted (Zero Setup)

```bash
npx clude-bot register   # Get your API key
```

```typescript
import { Cortex } from 'clude-bot';

const brain = new Cortex({
  hosted: { apiKey: process.env.CORTEX_API_KEY! },
});

await brain.init();

// Store a memory
await brain.store({
  type: 'episodic',
  content: 'User asked about pricing and seemed frustrated with the current plan.',
  summary: 'Frustrated user asking about pricing',
  tags: ['pricing', 'user-concern'],
  importance: 0.7,
  source: 'my-agent',
});

// Recall relevant memories
const memories = await brain.recall({
  query: 'what do users think about pricing',
  limit: 5,
});

console.log(`Recalled ${memories.length} memories`);
```

That's it. No database, no infrastructure. Memories are stored on CLUDE infrastructure, isolated by your API key.

## Quick Start — Self-Hosted (Your Supabase)

For full control, use your own Supabase:

```typescript
import { Cortex } from 'clude-bot';

const brain = new Cortex({
  supabase: {
    url: process.env.SUPABASE_URL!,
    serviceKey: process.env.SUPABASE_KEY!,
  },
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY!,
  },
});

await brain.init();

await brain.store({
  type: 'episodic',
  content: 'User asked about pricing and seemed frustrated with the current plan.',
  summary: 'Frustrated user asking about pricing',
  tags: ['pricing', 'user-concern'],
  importance: 0.7,
  source: 'my-agent',
  relatedUser: 'user-123',
});

const memories = await brain.recall({
  query: 'what do users think about pricing',
  limit: 5,
});

const context = brain.formatContext(memories);
// Pass `context` into your system prompt so the LLM knows what it remembers
```

---

## Examples

See the [`examples/`](./examples) folder for runnable scripts:

- **[hosted-mode.ts](./examples/hosted-mode.ts)** — Zero-setup with just an API key (hosted mode)
- **[basic-memory.ts](./examples/basic-memory.ts)** — Store and recall with Supabase (self-hosted)
- **[chat-agent.ts](./examples/chat-agent.ts)** — Interactive chat agent with memory and dream cycles
- **[progressive-disclosure.ts](./examples/progressive-disclosure.ts)** — Token-efficient retrieval with `recallSummaries()` + `hydrate()`

```bash
# Hosted mode
CORTEX_API_KEY=clk_... npx tsx examples/hosted-mode.ts

# Self-hosted
SUPABASE_URL=... SUPABASE_KEY=... npx tsx examples/basic-memory.ts
```

---

## CLI

```bash
npx clude-bot init        # Interactive setup wizard (hosted or self-hosted)
npx clude-bot register    # Get an API key for hosted mode
npx clude-bot start       # Start the full Clude bot (requires config)
npx clude-bot --version   # Show version
```

---

## Setup (Self-Hosted)

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com) and create a free project.

### 2. Run the schema

Open the SQL Editor in your Supabase dashboard and paste the contents of `supabase-schema.sql`:

```bash
# Find the schema file
cat node_modules/clude-bot/supabase-schema.sql
```

Or let `brain.init()` attempt auto-creation (requires an `exec_sql` RPC function in your Supabase project).

### 3. Enable extensions

In your Supabase SQL Editor:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### 4. Get your keys

- **Supabase URL + service key**: Project Settings > API
- **Anthropic API key**: [console.anthropic.com](https://console.anthropic.com) (optional for basic store/recall, required for dream cycles)
- **Voyage AI or OpenAI key**: For vector search (optional, falls back to keyword scoring)

---

## API Reference

### Constructor

**Hosted mode** — zero setup:

```typescript
const brain = new Cortex({
  hosted: {
    apiKey: string,      // From `npx clude-bot register`
    baseUrl?: string,    // Default: 'https://cluude.ai'
  },
});
```

**Self-hosted mode** — full control:

```typescript
const brain = new Cortex({
  // Required
  supabase: {
    url: string,
    serviceKey: string,
  },

  // Optional — required for dream cycles and LLM importance scoring
  anthropic: {
    apiKey: string,
    model?: string,     // default: 'claude-opus-4-6'
  },

  // Optional — enables vector similarity search
  embedding: {
    provider: 'voyage' | 'openai',
    apiKey: string,
    model?: string,     // default: voyage-3-lite / text-embedding-3-small
    dimensions?: number, // default: 1024
  },

  // Optional — commits memory hashes to Solana
  solana: {
    rpcUrl?: string,
    botWalletPrivateKey?: string,
  },

  // Optional — owner wallet for memory isolation
  ownerWallet?: string,
});
```

### `brain.init()`

Initialize the database schema. Call once before any other operation.

```typescript
await brain.init();
```

### `brain.store(opts)`

Store a new memory. Returns the memory ID or `null`.

```typescript
const id = await brain.store({
  type: 'episodic',        // 'episodic' | 'semantic' | 'procedural' | 'self_model'
  content: 'Full content of the memory...',
  summary: 'Brief summary',
  source: 'my-agent',
  tags: ['user', 'question'],
  importance: 0.7,          // 0-1, or omit for LLM-based scoring
  relatedUser: 'user-123',  // optional — enables per-user recall
  emotionalValence: 0.3,    // optional — -1 (negative) to 1 (positive)
  evidenceIds: [42, 43],    // optional — link to source memories
});
```

**Memory types:**

| Type | Decay/day | Use for |
|------|-----------|---------|
| `episodic` | 7% | Raw interactions, conversations, events |
| `semantic` | 2% | Learned knowledge, patterns, insights |
| `procedural` | 3% | Behavioral rules, what works/doesn't |
| `self_model` | 1% | Identity, self-understanding |

### `brain.recall(opts)`

Recall memories using hybrid scoring (vector similarity + keyword matching + tag overlap + importance + entity graph + association bonds).

```typescript
const memories = await brain.recall({
  query: 'what happened with user-123',
  tags: ['pricing'],
  relatedUser: 'user-123',
  memoryTypes: ['episodic', 'semantic'],
  limit: 10,
  minImportance: 0.3,
});
```

**6-phase retrieval pipeline:**
1. Vector search (memory + fragment level via pgvector)
2. Metadata filtering (user, wallet, tags, types)
3. Merge vector + metadata candidates
4. Composite scoring (recency + relevance + importance + vector similarity) * decay
5. Entity-aware expansion — direct entity recall + co-occurring entity memories
6. Bond-typed graph traversal — follow strong bonds (causes > supports > resolves > elaborates > contradicts > relates > follows)

Recalled memories get their access count incremented and decay reset. Co-retrieved memories strengthen their association links (Hebbian learning).

### `brain.recallSummaries(opts)`

Token-efficient recall — returns lightweight summaries (~50 tokens each) instead of full content.

```typescript
const summaries = await brain.recallSummaries({ query: 'recent events' });
// Each has: id, summary, type, tags, concepts, importance, decay, created_at
```

### `brain.hydrate(ids)`

Fetch full content for specific memory IDs. Use with `recallSummaries` for progressive disclosure.

```typescript
const summaries = await brain.recallSummaries({ query: 'important' });
const topIds = summaries.slice(0, 3).map(s => s.id);
const full = await brain.hydrate(topIds);
```

### `brain.dream(opts?)`

Run one dream cycle. Requires `anthropic` config.

```typescript
await brain.dream({
  onEmergence: async (thought) => {
    console.log('Agent thought:', thought);
    // Post to Discord, save to file, etc.
  },
});
```

**Five phases:**
1. **Consolidation** — generates focal-point questions from recent memories, synthesizes evidence-linked insights
2. **Compaction** — summarizes old, faded episodic memories into semantic summaries (Beads-inspired)
3. **Reflection** — reviews accumulated knowledge, updates self-model with evidence citations
4. **Contradiction Resolution** — finds unresolved `contradicts` links, Claude analyzes each pair and stores a resolved belief with `resolves` links, accelerates decay on the weaker memory
5. **Emergence** — introspective synthesis, output sent to `onEmergence` callback

### `brain.startDreamSchedule()` / `brain.stopDreamSchedule()`

Automated dream cycles every 6 hours + daily memory decay at 3am UTC. Also triggers on accumulated importance (event-driven reflection).

```typescript
brain.startDreamSchedule();
// ... later
brain.stopDreamSchedule();
```

### `brain.link(sourceId, targetId, type, strength?)`

Create a typed association between two memories.

```typescript
await brain.link(42, 43, 'supports', 0.8);
```

Link types: `'supports'` | `'contradicts'` | `'elaborates'` | `'causes'` | `'follows'` | `'relates'` | `'resolves'`

### `brain.decay()`

Manually trigger memory decay. Each type decays at its own rate per day.

```typescript
const decayed = await brain.decay();
console.log(`${decayed} memories decayed`);
```

### `brain.stats()`

Get memory system statistics.

```typescript
const stats = await brain.stats();
// { total, byType, avgImportance, avgDecay, totalDreamSessions, ... }
```

### `brain.recent(hours, types?, limit?)`

Get recent memories from the last N hours.

```typescript
const last24h = await brain.recent(24);
const recentInsights = await brain.recent(168, ['semantic'], 10);
```

### `brain.selfModel()`

Get the agent's current self-model memories.

```typescript
const identity = await brain.selfModel();
```

### `brain.formatContext(memories)`

Format memories into a markdown string for LLM prompt injection.

```typescript
const memories = await brain.recall({ query: userMessage });
const context = brain.formatContext(memories);

// Use in your LLM call:
const response = await anthropic.messages.create({
  system: `You are a helpful agent.\n\n## Memory\n${context}`,
  messages: [{ role: 'user', content: userMessage }],
});
```

### `brain.inferConcepts(summary, source, tags)`

Auto-classify memory content into structured concepts.

```typescript
const concepts = brain.inferConcepts('User frustrated about pricing', 'chat', ['pricing']);
// ['holder_behavior', 'sentiment_shift']
```

### `brain.on(event, handler)`

Listen for memory events.

```typescript
brain.on('memory:stored', ({ importance, memoryType }) => {
  console.log(`New ${memoryType} memory stored (importance: ${importance})`);
});
```

### `brain.destroy()`

Stop dream schedules, clean up event listeners.

---

## Hosted vs Self-Hosted

| | **Hosted** | **Self-Hosted** |
|---|---|---|
| **Setup** | Just an API key | Your own Supabase |
| **store / recall / stats** | Yes | Yes |
| **recent / self-model / link** | Yes | Yes |
| **Dream cycles** | No | Yes (requires Anthropic) |
| **Entity graph** | No | Yes |
| **Memory packs** | No | Yes |
| **Embeddings** | Managed | Configurable (Voyage/OpenAI) |
| **On-chain commits** | No | Yes (Solana) |
| **Dashboard** | Yes (API key login) | Yes (Privy wallet login) |

## Graceful Degradation

The self-hosted SDK progressively enhances based on config:

| Feature | Without it |
|---------|------------|
| `anthropic` not set | LLM importance scoring falls back to rules. `dream()` throws. |
| `embedding` not set | Vector search disabled, recall uses keyword + tag scoring only. |
| `solana` not set | On-chain memory commits silently skipped. |

**Minimum viable setup** — hosted mode:
```typescript
const brain = new Cortex({
  hosted: { apiKey: 'clk_...' },
});
```

**Minimum self-hosted** — just Supabase:
```typescript
const brain = new Cortex({
  supabase: { url: '...', serviceKey: '...' },
});
```

Both give you full store/recall with keyword-based retrieval. Self-hosted adds dream cycles, embeddings, and on-chain commits.

---

## Example: Chat Agent with Memory

```typescript
import { Cortex } from 'clude-bot';
import Anthropic from '@anthropic-ai/sdk';

const brain = new Cortex({
  supabase: { url: process.env.SUPABASE_URL!, serviceKey: process.env.SUPABASE_KEY! },
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
  embedding: { provider: 'voyage', apiKey: process.env.VOYAGE_API_KEY! },
});
await brain.init();
brain.startDreamSchedule();

const anthropic = new Anthropic();

async function handleMessage(userId: string, message: string): Promise<string> {
  // Recall relevant memories
  const memories = await brain.recall({
    query: message,
    relatedUser: userId,
    limit: 5,
  });

  // Generate response with memory context
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    system: `You are a helpful assistant.\n\n## What you remember\n${brain.formatContext(memories)}`,
    messages: [{ role: 'user', content: message }],
  });

  const reply = response.content[0].type === 'text' ? response.content[0].text : '';

  // Store this interaction as a memory
  await brain.store({
    type: 'episodic',
    content: `User (${userId}): ${message}\nAssistant: ${reply}`,
    summary: `Conversation with ${userId} about ${message.slice(0, 50)}`,
    source: 'chat',
    relatedUser: userId,
    tags: brain.inferConcepts(message, 'chat', []),
  });

  return reply;
}
```

---

## How It Works

### Memory Retrieval

Hybrid scoring combines multiple signals (Park et al. 2023):

- **Recency**: `0.995^hours` exponential decay since last access
- **Relevance**: Keyword trigram similarity + tag overlap
- **Importance**: LLM-scored 1-10, normalized to 0-1
- **Vector similarity**: Cosine similarity via pgvector HNSW indexes
- **Graph boost**: Association link strength between co-retrieved memories

Recalled memories get reinforced — access count increments, decay resets, and co-retrieved memories strengthen their links (Hebbian learning).

### Memory Decay

Each type persists at a different rate, mimicking biological memory:

- **Episodic** (0.93/day): Events fade quickly unless reinforced
- **Semantic** (0.98/day): Knowledge persists
- **Procedural** (0.97/day): Behavioral patterns are stable
- **Self-model** (0.99/day): Identity is nearly permanent

### Hash-Based IDs (Beads-inspired)

Every memory gets a collision-resistant ID like `clude-a1b2c3d4`:

- **No merge conflicts**: Multiple agents can create memories simultaneously without ID collisions
- **Stable references**: IDs survive database migrations and replication
- **Human-readable**: Easy to reference in logs and debugging

### Memory Compaction (Beads-inspired)

Old, faded memories get summarized to save context window space:

**Criteria for compaction:**
- Memory is older than 7 days
- Decay factor < 0.3 (faded from disuse)
- Importance < 0.5 (not critical)
- Only episodic memories (insights and self-model are preserved)

**Process:**
1. Group candidates by concept
2. Generate semantic summary for each group
3. Store summary with evidence links to originals
4. Mark originals as compacted

This mimics how human memory consolidates — details fade, patterns persist.

### Dream Cycles

Five-phase introspection process triggered by accumulated importance or 6-hour cron:

1. **Consolidation** — Generate focal-point questions from recent episodic memories, synthesize evidence-linked semantic insights
2. **Compaction** — Summarize old, faded episodic memories (7+ days, low importance, high decay) into semantic summaries. Originals marked as compacted.
3. **Reflection** — Review self-model + recent semantic memories. Produce self-observations with evidence citations. Detect patterns and contradictions.
4. **Contradiction Resolution** — Find unresolved `contradicts` links via graph query. Claude analyzes each pair, stores a resolved belief as semantic memory with `resolves` links. Accelerates decay on the weaker/older memory.
5. **Emergence** — Introspective synthesis — the agent examines its own existence. Optionally posts the thought externally via `onEmergence` callback.

### Molecular Memory Architecture

Memories form a graph with typed bonds:

```
Memory Graph:
├── Memories = nodes with type, importance, decay
├── Bonds = typed weighted edges
│   ├── causes (1.0) — "this led to that"
│   ├── supports (0.9) — "evidence for"
│   ├── resolves (0.8) — "contradiction resolved"
│   ├── elaborates (0.7) — "adds detail"
│   ├── contradicts (0.6) — "these conflict"
│   ├── relates (0.4) — "conceptually linked"
│   └── follows (0.3) — "temporal sequence"
├── Entities = extracted people, tokens, concepts, wallets
└── Co-occurrence = entities that appear together across memories
```

**Why it's faster:** Traditional retrieval scans all memories — O(n). Bond traversal follows strong connections — O(k) where k ≈ 3-5.

### Permissionless Inference (Venice)

Clude supports [Venice](https://venice.ai) as a decentralized inference provider:

```typescript
const brain = new Cortex({
  supabase: { ... },
  venice: {
    apiKey: process.env.VENICE_API_KEY,
    model: 'llama-3.3-70b',  // or deepseek-r1, qwen, etc.
  },
  inference: {
    primary: 'venice',     // Use Venice first
    fallback: 'anthropic', // Fall back to Claude if needed
  },
});
```

**Why Venice?**
- **Permissionless**: No approval process, no rate limits
- **Private**: No data retention — your prompts stay yours
- **Decentralized**: Matches Clude's on-chain memory philosophy
- **Multi-model**: Access Claude, GPT, Llama, DeepSeek, and more

Set `INFERENCE_PRIMARY=venice` and `VENICE_API_KEY` to use Venice by default.

### Association Graph & Entity Knowledge Graph

**Memory-to-memory bonds** — typed, weighted links:
- `supports`, `contradicts`, `elaborates`, `causes`, `follows`, `relates`, `resolves`
- Auto-linked on storage via embedding similarity and heuristics
- Strengthened through co-retrieval (Hebbian learning)
- Boosts recall scores for connected memories
- `contradicts` links are resolved during dream cycles, producing `resolves` links

**Entity knowledge graph** — extracted from memory content:
- Entity types: person, project, concept, token, wallet, location, event
- Entities extracted automatically (Twitter handles, wallet addresses, token tickers, proper nouns)
- Entity co-occurrence drives recall expansion — when recalling about an entity, memories from co-occurring entities are surfaced with a scaled boost

---

## Running the Clude Bot

This package also includes the full Clude bot — an autonomous AI agent on X ([@Cludebot](https://x.com/Cludebot)).

```bash
git clone https://github.com/sebbsssss/cludebot.git
cd cludebot
npm install
cp .env.example .env  # fill in API keys
npm run dev
```

See `.env.example` for required environment variables (X API, Supabase, Anthropic, Helius).

---

## Stack

TypeScript, Supabase (PostgreSQL + pgvector), Anthropic Claude, Voyage AI / OpenAI embeddings, Solana Web3.js, Node.js.

## Contributing

Contributions welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup instructions and guidelines.

## License

MIT
