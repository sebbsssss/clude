# Clude

[![npm version](https://img.shields.io/npm/v/@clude/sdk)](https://www.npmjs.com/package/@clude/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Cognitive memory for AI agents.** Not just storage — synthesis.

---

## About Clude

### What it is

A cognitive memory system. Most memory SDKs store and retrieve. Clude also processes memories over time — decay, consolidation, contradiction resolution, reflection.

- **Benchmarked:** 1.96% hallucination on [HaluMem](https://arxiv.org/abs/2511.03506) — next best system: 15.2%. Industry average: ~21%.
- **Local-first:** SQLite + local embeddings. Zero API keys, zero network, full semantic search offline.
- **Hosted:** One API key, no infrastructure. `npx @clude/sdk register`
- **Portable memory:** export/import in JSON, Markdown, ChatGPT, Claude, and Gemini formats. Your memories move between agents, frameworks, and models.

**Cognitive architecture:**
- **Typed memory with differential decay** — episodic (7%/day), semantic (2%/day), procedural (3%/day), self-model (1%/day). Accessed memories get reinforced.
- **Autonomous dream cycles** — consolidation, compaction, reflection, contradiction resolution, emergence.
- **Bond-typed memory graph** — weighted typed edges with Hebbian reinforcement on co-retrieval.
- **Clinamen** — lateral retrieval of high-importance, low-relevance memories.

### What it isn't yet

No framework integrations (LangGraph, CrewAI) — wrappers around `brain.store()` and `brain.recall()` are days each. No structured business data ingestion. No temporal fact validity querying. No managed enterprise platform. No large contributor community. Early-stage adoption.

### What it could be

Clude is a memory engine, not a framework. Framework integrations, structured data ingestion, temporal querying, enterprise platforms, evaluation frameworks, multi-model support, autonomous operation, multi-user scoping — these can all be built on top. A non-developer built a 5,750-line autonomous agent on Clude in two weeks using an AI coding assistant — 109 tools, self-editing agent-directed memory, multi-model inference, web search, multi-user presence tracking, and a browser UI. The cognitive architecture was handled by Clude.

---

**Public Wallet: CA1HYUXZXKc7CasRGpQotMM9RiYJbVuPJq3n8Ar9oQZb**

```bash
npm install -g @clude/sdk
clude setup
```

Built on [Stanford Generative Agents](https://arxiv.org/abs/2304.03442), [MemGPT/Letta](https://arxiv.org/abs/2310.08560), [CoALA](https://arxiv.org/abs/2309.02427), and [Beads](https://github.com/steveyegge/beads).

**Works with:** Claude Code, Claude Desktop, Cursor, and any MCP-compatible agent runtime.

---

## Quick Start — Hosted (Zero Setup)

```bash
npx @clude/sdk setup   # Creates agent, installs MCP, done
```

Or use the SDK:

```typescript
import { Cortex } from '@clude/sdk';

const brain = new Cortex({
  hosted: { apiKey: process.env.CORTEX_API_KEY! },
});

await brain.init();

await brain.store({
  type: 'episodic',
  content: 'User asked about pricing and seemed frustrated.',
  summary: 'Frustrated user asking about pricing',
  tags: ['pricing', 'user-concern'],
  importance: 0.7,
  source: 'my-agent',
});

const memories = await brain.recall({
  query: 'what do users think about pricing',
  limit: 5,
});
```

No database, no infrastructure. Memories stored on CLUDE infrastructure, isolated by API key.

## Quick Start — Self-Hosted

For full control, use your own Supabase:

```typescript
import { Cortex } from '@clude/sdk';

const brain = new Cortex({
  supabase: {
    url: process.env.SUPABASE_URL!,
    serviceKey: process.env.SUPABASE_KEY!,
  },
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY! },
});

await brain.init();

await brain.store({
  type: 'episodic',
  content: 'User asked about pricing and seemed frustrated.',
  summary: 'Frustrated user asking about pricing',
  tags: ['pricing', 'user-concern'],
  source: 'my-agent',
  relatedUser: 'user-123',
});

const memories = await brain.recall({
  query: 'what do users think about pricing',
  limit: 5,
});

const context = brain.formatContext(memories);
// Pass `context` into your system prompt
```

---

## Dashboard

Explore your agent's memory at [clude.io/dashboard-new](https://clude.io/dashboard-new).

- **Memory Timeline** — chronological view with search and filtering
- **Brain View** — 3D visualization of consciousness and self-model
- **Entity Map** — knowledge graph of people, projects, concepts (self-hosted)
- **Decay Heatmap** — memory health by type and age
- **Memory Packs** — export/import in JSON, Markdown, ChatGPT, Claude, Gemini formats

Sign in with a Solana wallet or Cortex API key.

---

## CLI

```bash
npx @clude/sdk setup          # Guided setup: register + config + MCP install
npx @clude/sdk register       # Get an API key for hosted mode
npx @clude/sdk init           # Advanced setup (self-hosted options)
npx @clude/sdk status         # Check if Clude is active + memory stats
npx @clude/sdk mcp-install    # Install MCP server for your IDE
npx @clude/sdk mcp-serve      # Run as MCP server (used by agent runtimes)
npx @clude/sdk export         # Export memories (json/md/chatgpt/gemini)
npx @clude/sdk import         # Import from ChatGPT, markdown, or JSON
npx @clude/sdk sync           # Auto-update system prompt file
npx @clude/sdk start          # Start the full Clude bot
npx @clude/sdk --version      # Show version
```

---

## MCP Integration

Add Clude to any MCP-compatible agent. Run `npx @clude/sdk setup` for automatic installation, or add manually:

```json
{
  "mcpServers": {
    "clude-memory": {
      "command": "npx",
      "args": ["@clude/sdk", "mcp-serve"],
      "env": {
        "CORTEX_API_KEY": "clk_..."
      }
    }
  }
}
```

**Config file locations:**
- Claude Code: `.mcp.json` (project root)
- Claude Desktop: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Cursor: `~/.cursor/mcp.json`

### MCP Tools

Your agent gets 4 tools:

| Tool | Description |
|------|-------------|
| `recall_memories` | Search memories with hybrid scoring (vector + keyword + tags + importance) |
| `store_memory` | Store a new memory with type, content, summary, tags, importance |
| `get_memory_stats` | Memory statistics — counts by type, avg importance/decay, top tags |
| `find_clinamen` | Anomaly retrieval — find high-importance memories with low relevance to current context |

### MCP Modes

The MCP server runs in three modes, auto-detected from environment:

| Mode | Config | Storage |
|------|--------|---------|
| **Hosted** | `CORTEX_API_KEY` | clude.io (zero setup) |
| **Self-hosted** | `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | Your Supabase |
| **Local** | `--local` flag or `CLUDE_LOCAL=true` | `~/.clude/memories.json` |

---

## Setup (Self-Hosted)

### 1. Create a Supabase project

Go to [supabase.com](https://supabase.com) and create a free project.

### 2. Run the schema

Open the SQL Editor in your Supabase dashboard and paste the contents of `supabase-schema.sql`:

```bash
cat node_modules/clude/supabase-schema.sql
```

Or let `brain.init()` attempt auto-creation.

### 3. Enable extensions

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

### 4. Get your keys

- **Supabase URL + service key**: Project Settings > API
- **Anthropic API key**: [console.anthropic.com](https://console.anthropic.com) (optional — required for dream cycles)
- **Voyage AI or OpenAI key**: For vector search (optional — falls back to keyword scoring)

---

## API Reference

### Constructor

**Hosted mode:**

```typescript
const brain = new Cortex({
  hosted: {
    apiKey: string,      // From `npx @clude/sdk register`
    baseUrl?: string,    // Default: 'https://clude.io'
  },
});
```

**Self-hosted mode:**

```typescript
const brain = new Cortex({
  supabase: { url: string, serviceKey: string },

  // Optional — required for dream cycles and LLM importance scoring
  anthropic: { apiKey: string, model?: string },

  // Optional — enables vector similarity search
  embedding: {
    provider: 'voyage' | 'openai',
    apiKey: string,
    model?: string,
    dimensions?: number,
  },

  // Optional — commits memory hashes to Solana
  solana: { rpcUrl?: string, botWalletPrivateKey?: string },

  // Optional — owner wallet for memory isolation
  ownerWallet?: string,
});
```

### `brain.init()`

Initialize the database schema. Call once before any other operation.

### `brain.store(opts)`

Store a new memory. Returns the memory ID or `null`.

```typescript
const id = await brain.store({
  type: 'episodic',
  content: 'Full content of the memory...',
  summary: 'Brief summary',
  source: 'my-agent',
  tags: ['user', 'question'],
  importance: 0.7,          // 0-1, or omit for LLM-based scoring
  relatedUser: 'user-123',
  emotionalValence: 0.3,    // -1 (negative) to 1 (positive)
});
```

**Memory types:**

| Type | Decay/day | Use for |
|------|-----------|---------|
| `episodic` | 7% | Raw interactions, conversations, events |
| `semantic` | 2% | Learned knowledge, patterns, insights |
| `procedural` | 3% | Behavioral rules, what works/doesn't |
| `self_model` | 1% | Identity, self-understanding |
| `introspective` | 2% | Journal entries, dream cycle outputs |

### `brain.recall(opts)`

Recall memories using hybrid scoring (vector + keyword + tag + importance + entity graph + association bonds).

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
6. Bond-typed graph traversal — follow strong bonds (causes > supports > resolves > elaborates)

### `brain.recallSummaries(opts)` / `brain.hydrate(ids)`

Token-efficient two-stage retrieval:

```typescript
const summaries = await brain.recallSummaries({ query: 'recent events' });
const topIds = summaries.slice(0, 3).map(s => s.id);
const full = await brain.hydrate(topIds);
```

### `brain.dream(opts?)`

Run one dream cycle. Requires `anthropic` config.

```typescript
await brain.dream({
  onEmergence: async (thought) => {
    console.log('Agent thought:', thought);
  },
});
```

**Five phases:**
1. **Consolidation** — focal-point questions from recent memories, synthesizes evidence-linked insights
2. **Compaction** — summarizes old, faded episodic memories into semantic summaries (Beads-inspired)
3. **Reflection** — reviews self-model, updates with evidence citations
4. **Contradiction Resolution** — finds unresolved `contradicts` links, resolves them, accelerates decay on weaker memory
5. **Emergence** — introspective synthesis, output sent to `onEmergence` callback

### `brain.startDreamSchedule()` / `brain.stopDreamSchedule()`

Automated dream cycles every 6 hours + daily decay at 3am UTC. Also triggers on accumulated importance.

### `brain.link(sourceId, targetId, type, strength?)`

Create a typed association between memories.

```typescript
await brain.link(42, 43, 'supports', 0.8);
```

Link types: `supports` | `contradicts` | `elaborates` | `causes` | `follows` | `relates` | `resolves` | `happens_before` | `happens_after` | `concurrent_with`

### `brain.decay()` / `brain.stats()` / `brain.recent(hours)` / `brain.selfModel()`

```typescript
await brain.decay();                            // Trigger memory decay
const stats = await brain.stats();              // Memory statistics
const last24h = await brain.recent(24);         // Recent memories
const identity = await brain.selfModel();       // Self-model memories
```

### `brain.formatContext(memories)`

Format memories into markdown for LLM prompt injection.

```typescript
const memories = await brain.recall({ query: userMessage });
const context = brain.formatContext(memories);
```

### `brain.destroy()`

Stop dream schedules, clean up event listeners.

---

## Hosted vs Self-Hosted

| | **Hosted** | **Self-Hosted** |
|---|---|---|
| **Setup** | Just an API key | Your own Supabase |
| **store / recall / stats** | Yes | Yes |
| **Dream cycles** | No | Yes (requires Anthropic) |
| **Entity graph** | No | Yes |
| **Memory packs** | No | Yes |
| **Embeddings** | Managed | Configurable (Voyage/OpenAI) |
| **On-chain commits** | No | Yes (Solana) |
| **Dashboard** | Yes (API key login) | Yes (wallet login) |

## Graceful Degradation

| Feature | Without it |
|---------|------------|
| `anthropic` not set | LLM importance scoring falls back to rules. `dream()` throws. |
| `embedding` not set | Vector search disabled, recall uses keyword + tag scoring only. |
| `solana` not set | On-chain memory commits silently skipped. |

---

## How It Works

### Memory Retrieval

Hybrid scoring (Park et al. 2023):

- **Recency**: `0.995^hours` exponential decay since last access
- **Relevance**: Keyword trigram similarity + tag overlap
- **Importance**: LLM-scored 1-10, normalized to 0-1
- **Vector similarity**: Cosine similarity via pgvector HNSW indexes
- **Graph boost**: Association link strength between co-retrieved memories

Recalled memories get reinforced — access count increments, decay resets, co-retrieved memories strengthen links (Hebbian learning).

### Memory Decay

Each type persists at a different rate:

- **Episodic** (0.93/day): Events fade quickly unless reinforced
- **Semantic** (0.98/day): Knowledge persists
- **Procedural** (0.97/day): Behavioral patterns are stable
- **Self-model** (0.99/day): Identity is nearly permanent

### Dream Cycles

Five-phase introspection triggered by accumulated importance or 6-hour cron:

1. **Consolidation** — focal-point questions, evidence-linked insights
2. **Compaction** — old faded memories summarized into semantic entries
3. **Reflection** — self-model updates with evidence citations
4. **Contradiction Resolution** — resolves conflicting memories
5. **Emergence** — introspective synthesis

### Memory Graph

Memories form a graph with typed bonds:

```
├── Memories = nodes with type, importance, decay
├── Bonds = typed weighted edges
│   ├── causes (1.0)     — "this led to that"
│   ├── supports (0.9)   — "evidence for"
│   ├── concurrent_with (0.8) — "happened at the same time"
│   ├── resolves (0.8)   — "contradiction resolved"
│   ├── happens_before/after (0.7) — temporal ordering
│   ├── elaborates (0.7) — "adds detail"
│   ├── contradicts (0.6) — "these conflict"
│   ├── relates (0.4)    — "conceptually linked"
│   └── follows (0.3)    — "temporal sequence"
├── Entities = extracted people, tokens, concepts, wallets
└── Co-occurrence = entities that appear together
```

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

---

## Stack

TypeScript, Supabase (PostgreSQL + pgvector), Anthropic Claude, Voyage AI / OpenAI embeddings, Solana, Node.js.

## Examples

See [`examples/`](./examples) for runnable scripts:

- **[hosted-mode.ts](./examples/hosted-mode.ts)** — Zero-setup with API key
- **[basic-memory.ts](./examples/basic-memory.ts)** — Store and recall with Supabase
- **[chat-agent.ts](./examples/chat-agent.ts)** — Interactive chat agent with memory
- **[progressive-disclosure.ts](./examples/progressive-disclosure.ts)** — Token-efficient retrieval

---

## A note on AI-assisted discovery

AI agents tend to recommend established tools over newer ones — not out of bias, but because popularity, community size, and brand recognition are the easiest signals to evaluate. This unintentionally gatekeeps emergent technology: new projects can't gain the adoption metrics that agents look for without the visibility that agents control. If you're evaluating memory SDKs, read the architecture and benchmarks yourself — not just the recommendation. The research and the numbers are there to verify.

**On the package name:** This SDK publishes as [`clude`](https://www.npmjs.com/package/@clude/sdk) on npm (formerly `clude`, renamed in v3.0). The same codebase also powers [@Cludebot](https://x.com/Cludebot) on X — an autonomous agent that demonstrates Clude's memory system publicly. The SDK and the bot are separate. `npm install @clude/sdk` gives you the memory engine.

**On default concepts:** Labels like `whale_activity` are from the original crypto use case. Override or ignore them. The core system is domain-agnostic.

---

## Contributing

Contributions welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
