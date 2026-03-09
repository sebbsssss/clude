# Integrating Clude Memory Into Your Agent

Three ways to give your AI agent persistent cognitive memory, from simplest to most powerful.

---

## Option 1: MCP Server (Zero Code)

**Best for:** Claude Desktop, Claude Code, Cursor, Windsurf, AgenC, or any MCP-compatible agent.

No SDK. No code changes. Just add the MCP server and your agent gets 4 memory tools.

### Local Mode (zero config)

```bash
# Install
npm install -g better-sqlite3

# Add to Claude Desktop config (~/.config/Claude/claude_desktop_config.json):
```

```json
{
  "mcpServers": {
    "clude": {
      "command": "npx",
      "args": ["tsx", "/path/to/clude/packages/mcp/src/index.ts"]
    }
  }
}
```

```bash
# Or for Claude Code:
claude mcp add clude -- npx tsx /path/to/clude/packages/mcp/src/index.ts
```

Memories stored locally in `~/.clude/memories.db`. No API keys needed.

### Cloud Mode (Supabase + vector search)

```json
{
  "mcpServers": {
    "clude": {
      "command": "npx",
      "args": ["tsx", "/path/to/clude/packages/mcp/src/index.ts"],
      "env": {
        "CLUDE_MODE": "cloud",
        "CLUDE_SUPABASE_URL": "https://your-project.supabase.co",
        "CLUDE_SUPABASE_KEY": "your-service-key",
        "CLUDE_VOYAGE_KEY": "your-voyage-api-key",
        "CLUDE_OWNER_WALLET": "your-agent-id"
      }
    }
  }
}
```

Cloud mode gives you: vector similarity search (Voyage-4-Large), 20k+ memory capacity, cross-device sync, and on-chain provenance.

### What your agent gets

| Tool | What it does |
|------|-------------|
| `remember` | Store a memory (content, summary, type, tags, importance) |
| `recall` | Search memories by query, type, or tags |
| `forget` | Delete a memory by ID |
| `memory_stats` | Total count and breakdown by type |
| `visualize` | 3D brain visualization in browser |

### Memory types

- **episodic** — what happened (events, conversations)
- **semantic** — what it means (facts, knowledge)
- **procedural** — what works (strategies, patterns)
- **self_model** — who I am (self-awareness, preferences)

---

## Option 2: SDK (npm install)

**Best for:** Custom agents, Node.js/TypeScript projects, deeper integration.

```bash
npm install clude-bot
```

### Self-hosted mode (direct Supabase + Voyage)

```typescript
import { Cortex } from 'clude-bot/sdk';

const brain = new Cortex({
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_KEY,
  },
  embedding: {
    provider: 'voyage',
    apiKey: process.env.VOYAGE_API_KEY,
    model: 'voyage-4-large',
    dimensions: 1024,
  },
  ownerWallet: 'my-agent-001',  // isolates your agent's memories
});

await brain.init();

// Store a memory
await brain.store({
  content: 'User prefers concise answers with code examples',
  type: 'procedural',
});

// Recall relevant memories
const memories = await brain.recall('user preferences');
// Returns ranked by: vector similarity + importance + recency + entity graph

// Get stats
const stats = await brain.stats();
console.log(stats.total); // number of memories
```

### Memory isolation

Each agent gets its own memory space via `ownerWallet`:

```typescript
// Agent A's memories
const agentA = new Cortex({ ownerWallet: 'agent-a', ... });

// Agent B's memories — completely isolated
const agentB = new Cortex({ ownerWallet: 'agent-b', ... });

// Agent A can't see Agent B's memories and vice versa
```

### Dream cycle + active reflection

Enable background cognitive processing (requires Anthropic API key):

```typescript
const brain = new Cortex({
  // ... supabase + voyage config
  anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
});

// Run dream cycle (consolidation + reflection + emergence)
await brain.dream();

// Run active reflection (meditation / journaling)
const journal = await brain.reflect();
console.log(journal.title); // "Patterns in Error Handling"
console.log(journal.text);  // Full journal entry

// Or start on a schedule
brain.startDreamSchedule();      // Every 6 hours
brain.startReflectionSchedule(); // Every 3 hours
```

### MemoryPacks (portable knowledge)

Export an agent's memories and import into another:

```typescript
// Export
const pack = await brain.exportPack();
// { identity, memories, connections, content_hash, signature }

// Import into a different agent
const otherBrain = new Cortex({ ownerWallet: 'other-agent', ... });
await otherBrain.importPack(pack);
```

---

## Option 3: REST API (any language)

**Best for:** Python agents, non-Node environments, or quick prototyping.

### Store

```bash
curl -X POST https://clude.io/api/demo/store \
  -H "Content-Type: application/json" \
  -d '{
    "content": "API rate limit is 100 requests per minute",
    "summary": "API rate limit: 100/min",
    "type": "procedural",
    "tags": ["api", "limits"],
    "importance": 0.8
  }'
```

### Recall

```bash
curl -X POST https://clude.io/api/demo/recall \
  -H "Content-Type: application/json" \
  -d '{
    "query": "rate limits",
    "limit": 5
  }'
```

### Python

```python
# pip install clude  (coming soon)
# For now, use the REST API:

import httpx

class CludeMemory:
    def __init__(self, base_url="https://clude.io/api/demo"):
        self.base = base_url
    
    async def store(self, content, summary, type="semantic", importance=0.5):
        async with httpx.AsyncClient() as client:
            return await client.post(f"{self.base}/store", json={
                "content": content, "summary": summary,
                "type": type, "importance": importance
            })
    
    async def recall(self, query, limit=5):
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{self.base}/recall", json={
                "query": query, "limit": limit
            })
            return resp.json()["memories"]
```

---

## How Clude Memory Works

```
Your Agent
    │
    ├── store("learned something") 
    │       │
    │       ▼
    │   ┌──────────────────────────────────────────┐
    │   │  Clude Memory Engine                     │
    │   │                                          │
    │   │  1. Classify (episodic/semantic/proc...)  │
    │   │  2. Embed (Voyage-4-Large, 1024 dims)    │
    │   │  3. Extract entities + link to graph      │
    │   │  4. Score importance (0-1)                │
    │   │  5. Store in Supabase + vector index      │
    │   └──────────────────────────────────────────┘
    │
    ├── recall("what do I know about X?")
    │       │
    │       ▼
    │   ┌──────────────────────────────────────────┐
    │   │  7-Phase Retrieval Pipeline              │
    │   │                                          │
    │   │  1. Vector similarity (cosine)            │
    │   │  2. Importance + recency ranking          │
    │   │  3. Entity graph traversal                │
    │   │  4. Knowledge seed pinning                │
    │   │  5. Type diversity injection              │
    │   │  6. Hebbian reinforcement (access boost)  │
    │   │  7. Final scoring + dedup                 │
    │   └──────────────────────────────────────────┘
    │
    └── Background (automatic)
            │
            ▼
        ┌──────────────────────────────────────────┐
        │  Dream Cycle (every 6h)                  │
        │  - Consolidate episodes → semantic       │
        │  - Extract behavioral patterns           │
        │  - Resolve contradictions                 │
        │  - Decay old/unused memories             │
        │  - Generate emergence thoughts           │
        │                                          │
        │  Active Reflection (every 3h)            │
        │  - Free-write journal entries            │
        │  - Connect ideas across sessions         │
        │  - Build on previous reflections         │
        │  - Store as introspective memories       │
        └──────────────────────────────────────────┘
```

---

## Real-World Example: Yoshi (OpenClaw Agent)

Yoshi is an OpenClaw agent running Clude in self-hosted mode. Here's the actual integration:

**File: `clude-bridge.cjs`**

```javascript
const { Cortex } = require('clude-bot');

const brain = new Cortex({
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_KEY,
  },
  embedding: {
    provider: 'voyage',
    apiKey: process.env.VOYAGE_API_KEY,
    model: 'voyage-4-large',
    dimensions: 1024,
  },
  ownerWallet: 'yoshi-openclaw-agent',
});

await brain.init();

// Store
await brain.store({ content: 'Seb prefers monochrome graphics', type: 'procedural' });

// Recall
const memories = await brain.recall('design preferences');
```

**Result:** Yoshi's memories are isolated from the main Clude bot's 20,567 memories. Both agents share the same infrastructure but can't see each other's data.

---

## Getting API Keys

| Service | What for | Get it at |
|---------|----------|-----------|
| **Supabase** | Memory storage + vector index | [supabase.com](https://supabase.com) (free tier works) |
| **Voyage AI** | Embeddings (voyage-4-large) | [voyageai.com](https://dash.voyageai.com) |
| **Anthropic** | Dream cycle + reflection (optional) | [anthropic.com](https://console.anthropic.com) |
| **Venice AI** | Private inference (optional) | [venice.ai](https://venice.ai) |

### Supabase Setup

1. Create project at supabase.com
2. Run the migrations from `clude/migrations/` in the SQL editor
3. Copy project URL + service key

### Voyage AI Setup

1. Sign up at voyageai.com
2. Copy API key
3. That's it (Clude uses `voyage-4-large` by default)

---

## Links

- **GitHub:** [github.com/sebbsssss/clude](https://github.com/sebbsssss/clude)
- **Live demo:** [clude.io/explore](https://clude.io/explore) (20,567+ real memories)
- **Benchmark:** [clude.io/benchmark](https://clude.io/benchmark) (83.9/100)
- **npm:** `clude-bot` (v2.7.0)
- **X:** [@cludebotclone](https://x.com/cludebotclone)
