# Clude

[![npm version](https://img.shields.io/npm/v/@clude/sdk)](https://www.npmjs.com/package/@clude/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/sebbsssss/clude/blob/main/LICENSE)

**Cognitive memory for AI agents.** Not just storage — synthesis.

Clude gives any agent persistent, typed memory with hybrid retrieval (vector + keyword + tags + importance), differential decay, a bond-typed memory graph, and autonomous consolidation. TypeScript declarations included.

- **Local-first:** SQLite + local embeddings. Zero API keys, zero network, full semantic search offline.
- **Hosted:** one API key, no infrastructure — `npx @clude/sdk register`
- **Benchmarked:** 85.0% on [LongMemEval-S](https://arxiv.org/abs/2410.10813), reproducible — the harness, per-question outputs, and judge model ship [in the repo](https://github.com/sebbsssss/clude/tree/main/benchmarks/longmemeval-s). 1.96% hallucination on [HaluMem](https://arxiv.org/abs/2511.03506).
- **Portable:** export/import memories as JSON, Markdown, ChatGPT, Claude, or Gemini packs.

Works with Claude Code, Claude Desktop, Cursor, and any MCP-compatible runtime.

## Quick start

```bash
npx @clude/sdk setup   # register + config + MCP install, ~30 seconds
```

Works headless too: with no TTY it completes in local-only mode (set `CLUDE_SETUP_EMAIL` to register in CI).

Or use the SDK directly:

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

const memories = await brain.recall({ query: 'what do users think about pricing', limit: 5 });
const context = brain.formatContext(memories);  // markdown, ready for your system prompt
```

## Storage modes

| Mode | Config | Storage |
|---|---|---|
| **Hosted** | `CORTEX_API_KEY` | clude.io, isolated per API key |
| **Self-hosted** | `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | your Supabase (PostgreSQL + pgvector) |
| **Local (default)** | none | `~/.clude/brain.db` — SQLite + local embeddings, fully offline |
| **Local (JSON)** | `CLUDE_LOCAL=true` or `--local` | `~/.clude/memories.json`, portable single file |

Self-hosted unlocks the full cognitive layer: dream cycles (consolidation, reflection, contradiction resolution), the entity graph, and memory packs.

## MCP integration

```json
{
  "mcpServers": {
    "clude-memory": {
      "command": "npx",
      "args": ["@clude/sdk", "mcp-serve"],
      "env": { "CORTEX_API_KEY": "clk_..." }
    }
  }
}
```

Or `npx @clude/sdk setup` to install automatically. Your agent gets 8 tools: `recall_memories`, `store_memory`, `batch_store_memories`, `list_memories`, `update_memory`, `delete_memory`, `get_memory_stats`, `find_clinamen` (anomaly retrieval). A remote Streamable-HTTP connector is also available at `https://clude.io/api/mcp` (`npx @clude/sdk connect`).

## CLI

```bash
npx @clude/sdk setup          # Guided setup: register + config + MCP install
npx @clude/sdk status         # Mode, storage, MCP detection, memory stats
npx @clude/sdk register       # Get a hosted API key
npx @clude/sdk mcp-install    # Install MCP config for your IDE
npx @clude/sdk mcp-serve      # Run as a stdio MCP server
npx @clude/sdk connect        # Connect Claude Desktop / claude.ai via remote MCP
npx @clude/sdk export         # Export memories (json/md/chatgpt/gemini/memorypack)
npx @clude/sdk import         # Import from ChatGPT export, markdown, JSON
npx @clude/sdk doctor         # Diagnostics
```

## Memory model

Five typed stores with differential decay — accessed memories are reinforced, unaccessed ones fade:

| Type | Decay/day | Use for |
|---|---|---|
| `episodic` | 7% | events, conversations |
| `semantic` | 2% | facts, knowledge, insights |
| `procedural` | 3% | workflows, what works |
| `self_model` | 1% | identity, preferences |
| `introspective` | 2% | reflections, journals |

Retrieval is hybrid-scored (recency + relevance + importance + vector similarity, weighted by decay) with entity-aware expansion and bond-typed graph traversal. Co-retrieved memories strengthen their links (Hebbian reinforcement).

## Docs

- **Complete integration reference (one fetch, agent-friendly):** [clude.io/llms-full.txt](https://clude.io/llms-full.txt)
- Docs: [clude.io/docs](https://clude.io/docs) · Dashboard: [clude.io/dashboard](https://clude.io/dashboard)
- REST API: `POST https://clude.io/api/cortex/register` → then `/store`, `/recall`, `/stats`, ... with `Authorization: Bearer <key>`
- Source, issues, benchmarks: [github.com/sebbsssss/clude](https://github.com/sebbsssss/clude)

Built on research from [Stanford Generative Agents](https://arxiv.org/abs/2304.03442), [MemGPT/Letta](https://arxiv.org/abs/2310.08560), and [CoALA](https://arxiv.org/abs/2309.02427). The same engine powers [@Cludebot](https://x.com/Cludebot), an autonomous agent running publicly 24/7 — a live demonstration of the memory system.

## License

MIT
