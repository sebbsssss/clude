# Clude Memory MCP — Reference

Detailed parameter reference and configuration for the Clude Memory MCP skill.

## store_memory — Full Parameters

**Required:**
- `type` — memory category: `episodic`, `semantic`, `procedural`, `self_model`, `introspective`
- `content` — full memory content (max 5000 chars)
- `summary` — short summary for recall matching (max 500 chars)

**Optional:**
- `tags` — string array for filtering (e.g. `["auth", "bugfix"]`)
- `concepts` — structured labels (auto-inferred if omitted)
- `importance` — importance score 0-1 (auto-scored if omitted)
- `emotional_valence` — -1 (negative) to 1 (positive)
- `source` — origin identifier (e.g. `mcp:my-agent`)
- `source_id` — external ID (tweet ID, message ID, etc.)
- `related_user` — associated user/agent ID
- `related_wallet` — associated Solana wallet
- `metadata` — arbitrary JSON metadata

## recall_memories — Full Parameters

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

## find_clinamen — Full Parameters

- `context` — current context/topic (required)
- `limit` — max results (1-10, default 3)
- `memory_types` — filter by type
- `min_importance` — minimum importance (0-1, default 0.6)
- `max_relevance` — maximum relevance threshold (0-1, default 0.35)

## Setup

```bash
npx clude-bot setup
```

Or install manually:

```bash
npm install -g clude-bot
clude-bot mcp-install
```

## Modes

The MCP server auto-detects its mode from environment:

| Mode | Config | Storage |
|------|--------|---------|
| **Hosted** | `CORTEX_API_KEY` | clude.io (zero setup) |
| **Self-hosted** | `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | Your Supabase |
| **Local** | `--local` flag or `CLUDE_LOCAL=true` | `~/.clude/memories.json` |

## Memory Architecture

- **5-tier memory**: episodic (7%/day decay), semantic (2%/day), procedural (3%/day), self_model (1%/day), introspective (2%/day)
- **Hybrid retrieval**: pgvector cosine similarity + keyword matching + tag scoring
- **Dream cycles**: consolidation, compaction, reflection, contradiction resolution, emergence
- **Association graph**: typed bonds (causes, supports, contradicts, elaborates, resolves, etc.)
- **Entity knowledge graph**: auto-extracted people, projects, concepts, tokens, wallets
- **Granular decomposition**: per-fragment embeddings for sub-memory retrieval
