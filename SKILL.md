---
name: clude-memory-mcp
description: "Persistent memory for AI agents — store, recall, and search memories across conversations. Use when the agent needs to remember context, save notes, recall previous interactions, maintain long-term memory, or retrieve past decisions and learnings."
metadata:
  version: "1.0.0"
  openclaw:
    requires:
      bins:
        - node
---

# Clude Memory MCP

MCP server providing persistent memory for AI agents. Store information that survives across conversations, recall relevant context by topic, and surface unexpected connections through anomaly retrieval.

## Workflow

1. **Recall** before starting work — query for relevant memories on the current topic
   - If no results: broaden the query, remove filters, or proceed without prior context
2. **Store** after meaningful work — save decisions, findings, outcomes, and learnings
   - Verify: recall the stored memory immediately to confirm it persisted
   - If store fails: check that `content` is under 5000 chars and `type` is valid
3. **Search** when context is needed — query by topic, tags, user, or memory type
   - If results are sparse: try a broader query, drop `min_importance`, or increase `limit`
4. **Review stats** periodically — check memory health, top tags, and decay status

## Tools

### `store_memory`

Store a new memory. Memories persist across conversations and decay over time if not accessed.

**Required:** `type` (see Memory Types), `content` (max 5000 chars), `summary` (max 500 chars)
**Common optional:** `tags`, `importance` (0-1), `source` (e.g. `mcp:my-agent`), `related_user`

See [REFERENCE.md](REFERENCE.md) for all optional parameters.

**Example — store a decision:**

```json
{
  "type": "semantic",
  "content": "Decided to use Supabase RLS for multi-tenant isolation instead of application-level filtering. Reason: reduces surface area for data leaks.",
  "summary": "Architecture decision: Supabase RLS for tenant isolation",
  "tags": ["architecture", "security", "supabase"],
  "importance": 0.8,
  "source": "mcp:lead-engineer"
}
```

### `recall_memories`

Search the memory system. Returns scored memories ranked by relevance, importance, recency, and vector similarity.

**Common parameters:** `query`, `tags`, `memory_types`, `limit` (1-50, default 5), `min_importance` (0-1)

See [REFERENCE.md](REFERENCE.md) for all parameters including `related_user`, `related_wallet`, `min_decay`, `track_access`, `skip_expansion`.

**Example — recall context before working on auth:**

```json
{
  "query": "authentication decisions and past issues",
  "tags": ["auth", "security"],
  "min_importance": 0.5,
  "limit": 10
}
```

### `get_memory_stats`

Get statistics: counts by type, average importance/decay, dream session history, top tags. Use to audit memory health and identify areas with sparse or decaying coverage.

### `find_clinamen`

Anomaly retrieval — find high-importance memories with low relevance to the current context. Use for lateral thinking and surfacing unexpected connections.

**Parameters:** `context` (required), `limit` (1-10, default 3), `memory_types`, `min_importance` (default 0.6), `max_relevance` (default 0.35)

## Memory Types

| Type | Use for | Decay rate |
|------|---------|------------|
| `episodic` | Events, task completions, incidents | 7%/day |
| `semantic` | Facts, knowledge, architecture decisions | 2%/day |
| `procedural` | How-to workflows, patterns that work | 3%/day |
| `self_model` | Identity reflections, strengths, gaps | 1%/day |
| `introspective` | Journal entries, self-assessment | 2%/day |

## Setup & Modes

See [REFERENCE.md](REFERENCE.md) for setup instructions and deployment mode configuration (hosted, self-hosted, local).

Quick start: `npx clude-bot setup`
