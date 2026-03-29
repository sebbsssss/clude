# Local Memory Experiment

A fully offline, zero-API-dependency memory system for Clude — no Supabase, no Voyage AI, no OpenAI required. Runs entirely on the user's machine.

## Motivation

Clude's current memory system requires:
- Supabase (PostgreSQL + pgvector) — cloud hosted
- Voyage AI or OpenAI — for embeddings
- Optional: Venice AI — for temporal extraction

This prevents users from running a personal, private version of Clude locally. This experiment builds a local-first alternative using:
- **SQLite** (via `better-sqlite3`) — local vector store with `sqlite-vec` extension
- **Ollama** — local embeddings via `nomic-embed-text` model
- **Local LLM** (Ollama) — for dream cycle consolidation and reflection

## Architecture

```
┌─────────────────────────────────────────┐
│          Local Memory System            │
│                                         │
│  ┌─────────────┐    ┌────────────────┐  │
│  │  SQLite DB  │    │  Ollama Server │  │
│  │  (sqlite-   │◄──►│  (embeddings + │  │
│  │   vec ext)  │    │   LLM calls)   │  │
│  └─────────────┘    └────────────────┘  │
│                                         │
│  Tables: memories, memory_links,        │
│          entities, entity_mentions      │
└─────────────────────────────────────────┘
```

## Key Design Decisions

1. **SQLite-vec** for vector similarity (0-dependency, SIMD-optimized)
2. **nomic-embed-text** via Ollama (768-dim, 8k context, open-source)
3. **llama3.1:8b** or **mistral:7b** via Ollama for memory consolidation
4. **BM25 fallback** (same as existing codebase) if Ollama is unavailable
5. **HNSW indexing** via sqlite-vec for fast approximate nearest neighbor

## Prerequisites

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull embedding model (~500MB)
ollama pull nomic-embed-text

# Pull small LLM for consolidation (~4.7GB)
ollama pull llama3.2:3b
# Or for higher quality:
ollama pull mistral:7b

# Install dependencies
npm install
```

## Quick Start

```typescript
import { LocalMemory } from './src/local-memory';

const memory = new LocalMemory({
  dbPath: './local-memory.db',
  ollamaUrl: 'http://localhost:11434',
  embeddingModel: 'nomic-embed-text',
  llmModel: 'llama3.2:3b',
});

await memory.init();

// Store a memory
await memory.store({
  type: 'episodic',
  summary: 'Had a conversation about Solana meme tokens',
  content: 'User mentioned they hold 50k $CLUDE...',
  importance: 0.8,
  tags: ['solana', 'clude', 'conversation'],
});

// Recall memories
const results = await memory.recall('What does the user hold?', { limit: 5 });
```

## Running the Demo

```bash
# Run the interactive demo
npx ts-node src/demo.ts

# Run benchmarks (compares vs random baseline)
npx ts-node src/benchmark.ts
```

## Comparison with Clude Production

| Feature | Production | Local Experiment |
|---------|-----------|-----------------|
| Storage | Supabase cloud | SQLite file |
| Embeddings | Voyage AI / OpenAI | Ollama local |
| LLM | Claude API | Ollama local |
| Privacy | API providers | Fully local |
| Cost | ~$5-20/month | Free |
| Setup | Minutes | Requires Ollama |
| Vector dims | 1024 (Voyage) | 768 (nomic) |
| DB limit | Supabase plan | Disk size |
| Temporal extraction | Venice LLM | Same local LLM |

## Files

- `src/local-memory.ts` — Core memory system (store, recall, link)
- `src/embeddings.ts` — Ollama embedding provider with BM25 fallback
- `src/sqlite-store.ts` — SQLite-vec storage layer
- `src/dream-cycle.ts` — Simplified consolidation using local LLM
- `src/demo.ts` — Interactive demo
- `src/benchmark.ts` — Comparison benchmark

## Status

**Experimental** — not production-ready. This is a proof-of-concept to explore the feasibility and quality trade-offs of a fully offline memory system.

Open questions to explore:
- [ ] Embedding quality: nomic-embed-text vs Voyage AI on recall benchmarks
- [ ] LLM quality: llama3.2:3b vs Claude for consolidation quality
- [ ] Latency: sqlite-vec vs pgvector at 10k, 100k memories
- [ ] BM25 fallback path (when Ollama unavailable)
