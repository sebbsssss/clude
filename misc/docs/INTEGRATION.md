# Integrating Clude Memory Into Your Agent

**Zero to first memory in under 2 minutes.**

---

## 1. Get Your API Key (30 seconds)

### Web UI
Go to **[clude.io/register](https://clude.io/register)** — enter your agent name and Solana wallet, get a key instantly.

### Terminal
```bash
curl -X POST https://clude.io/api/cortex/register \
  -H "Content-Type: application/json" \
  -d '{"agentName": "my-agent", "walletAddress": "YOUR_SOLANA_WALLET"}'
```

Save the `apiKey` from the response — it won't be shown again.

---

## 2. Store Your First Memory (30 seconds)

```bash
curl -X POST https://clude.io/api/cortex/store \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "content": "User prefers concise answers with code examples",
    "type": "procedural",
    "importance": 0.8,
    "tags": ["preferences"]
  }'
```

---

## 3. Recall It Back (30 seconds)

```bash
curl -X POST https://clude.io/api/cortex/recall \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"query": "user preferences", "limit": 5}'
```

Returns memories ranked by vector similarity + importance + recency + entity graph.

---

## 4. Choose Your Integration

### REST API (any language)

All endpoints use `Authorization: Bearer YOUR_API_KEY`.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/cortex/store` | POST | Store a memory |
| `/api/cortex/recall` | POST | Search memories |
| `/api/cortex/stats` | GET | Memory stats |
| `/api/cortex/recent` | GET | Recent memories |

#### Python example

```python
import httpx

class CludeMemory:
    def __init__(self, api_key, base_url="https://clude.io/api/cortex"):
        self.base = base_url
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }

    async def store(self, content, type="semantic", importance=0.5, tags=None):
        async with httpx.AsyncClient() as client:
            return await client.post(f"{self.base}/store", json={
                "content": content, "type": type,
                "importance": importance, "tags": tags or []
            }, headers=self.headers)

    async def recall(self, query, limit=5):
        async with httpx.AsyncClient() as client:
            resp = await client.post(f"{self.base}/recall", json={
                "query": query, "limit": limit
            }, headers=self.headers)
            return resp.json()["memories"]
```

---

### Python SDK

```bash
pip install clude
```

```python
from clude import Clude

brain = Clude(api_key="YOUR_API_KEY")

# Store
brain.store("User prefers dark mode", type="procedural", importance=0.7)

# Recall
memories = brain.recall("user preferences")
```

Get your API key at [clude.io/register](https://clude.io/register).

---

### Node.js SDK

```bash
npm install @clude/sdk
```

#### Hosted mode (recommended to start)

```typescript
import { Cortex } from '@clude/sdk';

const brain = new Cortex({
  hosted: {
    apiKey: 'YOUR_API_KEY',  // from clude.io/register
    baseUrl: 'https://clude.io',
  },
});
await brain.init();

// Store
await brain.store({
  content: 'User prefers concise answers',
  type: 'procedural',
  importance: 0.8,
});

// Recall
const memories = await brain.recall({ query: 'user preferences' });
```

#### Self-hosted mode (full control)

```typescript
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
  agentId: 'my-agent',
});
await brain.init();

// Dream cycle + reflection
await brain.dream();
const journal = await brain.reflect();
brain.startDreamSchedule();      // Every 6h
brain.startReflectionSchedule(); // Every 3h
```

---

### MCP (Claude Desktop / Cursor / Windsurf)

```bash
npx @clude/sdk mcp-install --local
```

Or add manually to your MCP config:

```json
{
  "mcpServers": {
    "clude": {
      "command": "npx",
      "args": ["@clude/sdk", "mcp-serve", "--local"]
    }
  }
}
```

#### MCP Tools

| Tool | What it does |
|------|-------------|
| `store_memory` | Store a memory (content, type, tags, importance) |
| `recall_memories` | Multi-phase semantic search + graph traversal |
| `get_memory_stats` | Memory breakdown by type, importance, decay |
| `find_clinamen` | Surface unexpected lateral connections |

---

### Agent Skill (ClawHub)

```bash
clawhub install clude-memory
```

Or manually:
```bash
curl -o skills/clude-memory/SKILL.md \
  https://raw.githubusercontent.com/sebbsssss/clude-memory-skill/main/SKILL.md
```

GitHub: [github.com/sebbsssss/clude-memory-skill](https://github.com/sebbsssss/clude-memory-skill)

---

## Memory Types

| Type | What it stores | Decay |
|------|---------------|-------|
| `episodic` | Events and interactions | 7%/day |
| `semantic` | Distilled knowledge | 2%/day |
| `procedural` | Learned patterns | 3%/day |
| `self_model` | Self-awareness | 1%/day |
| `introspective` | Original thoughts | 2%/day |

---

## Links

- **Register:** [clude.io/register](https://clude.io/register)
- **GitHub:** [github.com/sebbsssss/cludebot](https://github.com/sebbsssss/cludebot)
- **npm:** [clude](https://www.npmjs.com/package/@clude/sdk)
- **PyPI:** [clude](https://pypi.org/project/clude/)
- **Benchmark:** [clude.io/benchmark](https://clude.io/benchmark) (83.9/100)
