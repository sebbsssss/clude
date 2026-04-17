---
name: Clude Memory MCP
description: MCP server for Clude's cognitive memory system — store, recall, search, and dream. Supports hosted (zero-setup), self-hosted (Supabase + pgvector), and local (offline) modes.
metadata:
  openclaw:
    requires:
      bins:
        - node
---

# Clude Memory MCP

MCP server exposing a cognitive memory architecture inspired by Stanford's Generative Agents (Park et al. 2023).

## Tools

### `recall_memories`
Search the memory system. Returns scored memories ranked by relevance, importance, recency, and vector similarity.

- `query` — text to search against memory summaries
- `tags` — filter by tags
- `related_user` — filter by user/agent ID
- `related_wallet` — filter by Solana wallet
- `memory_types` — filter by type: `episodic`, `semantic`, `procedural`, `self_model`, `introspective`
- `limit` — max results (1-50, default 5)
- `min_importance` — minimum importance threshold (0-1)
- `min_decay` — filter out faded memories (0-1)
- `track_access` — update access timestamps (boolean)
- `skip_expansion` — skip LLM query expansion to save latency (boolean)

### `store_memory`
Store a new memory. Memories persist across conversations and decay over time if not accessed.

- `type` — `episodic` (events), `semantic` (knowledge), `procedural` (behaviors), `self_model` (identity), `introspective` (journal)
- `content` — full memory content (max 5000 chars)
- `summary` — short summary for recall matching (max 500 chars)
- `tags` — tags for filtering
- `concepts` — structured labels (auto-inferred if omitted)
- `importance` — importance score 0-1 (auto-scored if omitted)
- `emotional_valence` — -1 (negative) to 1 (positive)
- `source` — origin identifier (e.g. `mcp:my-agent`)
- `source_id` — external ID (tweet ID, message ID, etc.)
- `related_user` — associated user/agent ID
- `related_wallet` — associated Solana wallet
- `metadata` — arbitrary JSON metadata

### `get_memory_stats`
Get statistics: counts by type, average importance/decay, dream session history, top tags.

### `find_clinamen`
Anomaly retrieval — find high-importance memories with low relevance to current context. Useful for lateral thinking and unexpected connections.

- `context` — current context/topic (required)
- `limit` — max results (1-10, default 3)
- `memory_types` — filter by type
- `min_importance` — minimum importance (0-1, default 0.6)
- `max_relevance` — maximum relevance threshold (0-1, default 0.35)

## Modes

The MCP server auto-detects its mode from environment:

| Mode | Config | Storage |
|------|--------|---------|
| **Hosted** | `CORTEX_API_KEY` | clude.io (zero setup) |
| **Self-hosted** | `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | Your Supabase |
| **Local** | `--local` flag or `CLUDE_LOCAL=true` | `~/.clude/memories.json` |

## Setup

```bash
npx @clude/sdk setup
```

Or install manually:

```bash
npm install -g @clude/sdk
clude mcp-install
```

## Architecture

- **5-tier memory**: episodic (7%/day decay), semantic (2%/day), procedural (3%/day), self_model (1%/day), introspective (2%/day)
- **Hybrid retrieval**: pgvector cosine similarity + keyword matching + tag scoring
- **Dream cycles**: consolidation, compaction, reflection, contradiction resolution, emergence
- **Association graph**: typed bonds (causes, supports, contradicts, elaborates, resolves, etc.)
- **Entity knowledge graph**: auto-extracted people, projects, concepts, tokens, wallets
- **Granular decomposition**: per-fragment embeddings for sub-memory retrieval

## License

MIT
