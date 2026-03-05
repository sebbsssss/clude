# clude

Persistent memory for AI agents. Local-first, zero config.

```bash
npm install clude
```

## Quick Start

```typescript
import { remember, recall } from 'clude'

// Store a memory
await remember("User prefers dark mode and works in TypeScript")

// Recall relevant memories
const memories = await recall("what programming language?")
console.log(memories[0].content)
// → "User prefers dark mode and works in TypeScript"
```

That's it. No API keys, no server, no config. Memories persist in a local SQLite database.

## API

### `remember(input)`

Store a memory. Pass a string or an options object.

```typescript
// Simple
await remember("The API key rotates every 90 days")

// With options
await remember({
  content: "User is a backend engineer",
  type: "semantic",       // episodic | semantic | procedural | self_model
  importance: 0.8,        // 0.0 - 1.0
  tags: ["user", "role"]
})
```

### `recall(input)`

Find relevant memories for a query. Returns scored results.

```typescript
const results = await recall("API key rotation")
// → [{ content, summary, type, importance, similarity, score, ... }]

// With options
const results = await recall({
  query: "user background",
  limit: 5,
  types: ["semantic"],
  minImportance: 0.5,
  threshold: 0.3  // minimum similarity
})
```

### Other functions

```typescript
import { count, list, search, forget, clear, warmup, close, exportAll } from 'clude'

count()                  // Number of stored memories
list(50)                 // Recent memories (no embedding needed)
search("keyword", 10)    // Keyword search (instant, no embedding)
forget(id)               // Delete a memory by ID
clear()                  // Delete all memories
await warmup()           // Pre-load the embedding model (~700ms)
exportAll()              // Export all memories as JSON
close()                  // Close database connection
```

### Custom store

```typescript
import { createStore } from 'clude'

const store = createStore('./my-agent/memory.db')
await store.remember({ content: "something important" })
const results = await store.recall({ query: "important stuff" })
store.close()
```

## How It Works

**Storage:** SQLite via better-sqlite3. WAL mode for concurrent reads. Database auto-created at `.clude/memory.db` in your working directory.

**Embeddings:** Local ONNX model ([gte-small](https://huggingface.co/Xenova/gte-small), 384 dims, ~30MB). Downloads once on first use, runs entirely offline after that. No API calls.

**Retrieval:** Dual-vector search (content + summary embeddings), brute-force cosine similarity with keyword boosting. Scoring combines:
- Semantic similarity (dominant signal)
- Normalized relative similarity (amplifies differences in compressed embedding spaces)
- Keyword and direct text matching
- Importance, recency, and decay factors

**Performance at 90 memories:**
- Top-1 accuracy: 68%
- Top-3 accuracy: 84%
- Average recall: 10ms
- Store speed: ~60 memories/sec
- Cold start: ~700ms (model load)

Brute-force cosine is faster than vector indices below ~50k memories at 384 dims. No native dependencies beyond better-sqlite3.

## Memory Types

| Type | Purpose | Example |
|------|---------|---------|
| `episodic` | Raw events, conversations | "Had lunch at Genki Sushi" |
| `semantic` | Facts, knowledge | "Clude uses 4 memory types" |
| `procedural` | How-to, behaviors | "Deploy via Railway Dockerfile" |
| `self_model` | Identity, preferences | "I should avoid em-dashes" |

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│  remember()  │────▶│  gte-small   │────▶│   SQLite   │
│   recall()   │◀────│  embeddings  │◀────│  + vectors │
└─────────────┘     └──────────────┘     └────────────┘
                           │
                    dual-vector search
                    (content + summary)
```

Everything runs locally. No network calls after the initial model download.

## Roadmap

- [ ] Cloud sync (Supabase/Solana)
- [ ] On-chain memory proofs
- [ ] Memory compaction and consolidation
- [ ] Entity graph (local)
- [ ] CLI tool (`clude remember "..."`, `clude recall "..."`)

## License

MIT
