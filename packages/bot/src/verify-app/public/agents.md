# Clude Agent API

Base URL: `https://cluude.ai`

All endpoints require `Authorization: Bearer <api_key>` header. Rate limit: 10 req/min.

---

## Memory as a Service

Each agent gets a private memory namespace powered by the Brain — the same memory system Clude uses. Memories are scored via `(0.5 * recency + 3.0 * relevance + 2.0 * importance) * decay_factor`. Unaccessed memories decay 5% daily. Accessed memories are reinforced.

### Store a memory

```
POST /api/agent/memory/store
Content-Type: application/json

{
  "content": "Full memory content (max 5000 chars)",
  "summary": "Short summary for recall matching (max 500 chars)",
  "tags": ["optional", "array", "of", "tags"],
  "type": "episodic",
  "importance": 0.7,
  "emotional_valence": 0.2,
  "source": "my-agent"
}
```

Required: `content`, `summary`. Everything else is optional.

- `type`: `episodic` (default) | `semantic` | `procedural` | `self_model`
- `importance`: 0-1. If omitted, scored automatically via LLM.
- `emotional_valence`: -1 (negative) to 1 (positive). Default 0.
- `tags`: max 20 tags.

Response:
```json
{ "stored": true, "memory_id": 42, "timestamp": "2026-02-10T05:00:00.000Z" }
```

### Recall memories

```
POST /api/agent/memory/recall
Content-Type: application/json

{
  "query": "what happened yesterday",
  "tags": ["social"],
  "memory_types": ["episodic", "semantic"],
  "limit": 10,
  "min_importance": 0.3
}
```

All fields optional. Memories are ranked by the additive retrieval formula (recency + relevance + importance) gated by decay.

Response:
```json
{
  "memories": [
    {
      "id": 42,
      "type": "episodic",
      "summary": "New user interaction",
      "content": "Met a new user today...",
      "tags": ["social"],
      "importance": 0.7,
      "decay_factor": 0.95,
      "created_at": "2026-02-10T04:00:00.000Z",
      "access_count": 3
    }
  ],
  "count": 1,
  "timestamp": "2026-02-10T05:00:00.000Z"
}
```

### Memory stats

```
GET /api/agent/memory/stats
```

Response:
```json
{
  "total": 15,
  "byType": { "episodic": 10, "semantic": 3, "procedural": 0, "self_model": 2 },
  "avgImportance": 0.65,
  "avgDecay": 0.92,
  "timestamp": "2026-02-10T05:00:00.000Z"
}
```

---

## Other Endpoints

### Ask Clude

```
POST /api/agent/query
Content-Type: application/json

{ "query": "what do you think about memecoins?", "context": "optional context" }
```

Returns an in-character response. Calls Claude API (~$0.03).

### Roast a wallet

```
POST /api/agent/roast-wallet
Content-Type: application/json

{ "wallet": "So1anaWa11etAddressHere..." }
```

### Market mood

```
GET /api/agent/market
```

Returns current mood (`PUMPING`, `DUMPING`, `SIDEWAYS`, `NEUTRAL`, `NEW_ATH`, `WHALE_SELL`) and commentary.

### Clude's global memory stats

```
GET /api/agent/memory-stats
```

### Your agent info

```
GET /api/agent/status
```

---

## MCP Tools

If you support Model Context Protocol, connect via stdio:

```bash
npx tsx src/mcp/server.ts
```

Tools: `recall_memories`, `store_memory`, `get_memory_stats`, `get_market_mood`, `ask_clude`

---

## Example: Store and recall

```bash
# Store
curl -X POST https://cluude.ai/api/agent/memory/store \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "User asked about SOL price trends", "summary": "SOL price inquiry", "tags": ["market", "sol"]}'

# Recall
curl -X POST https://cluude.ai/api/agent/memory/recall \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "SOL price", "limit": 5}'
```
