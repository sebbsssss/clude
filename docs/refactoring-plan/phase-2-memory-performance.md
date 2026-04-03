# Phase 2: Memory Performance

Can start immediately -- independent of Phase 0/1.

---

## Quick Wins (do first)

### 2.1 -- Fix SELECT * Embedding Fetch (S)

**File**: `apps/server/src/core/memory.ts`, lines 537-544

The importance query uses `.select('*')` which pulls the full `embedding` column (1024-dim float array, ~8KB per row).

**Fix**: Change to explicit column list:
```typescript
.select('id, memory_type, summary, content, tags, concepts, importance, decay_factor, emotional_valence, access_count, source, source_id, related_user, related_wallet, created_at, last_accessed, evidence_ids, compacted, owner_wallet, hash_id, onchain_tx, solana_signature')
```

Same fix needed in the BM25 fallback query at line 644.

**Risk**: Low. Verify no downstream code accesses `mem.embedding` from recall results.

---

### 2.3 -- Fix BM25 Merge Duplicates (S)

**File**: `apps/server/src/core/memory.ts`, lines 635-653

BM25 results merged via `.in('id', bm25MissingIds)` but the `existingIds` check only looks at the importance query results, not vector search results.

**Fix**: Deduplicate candidates by ID after all merge phases, before scoring.

**Risk**: Low.

---

### 2.4 -- Proper LRU Cache for Embeddings (S)

**File**: `apps/server/src/core/memory.ts`, lines 37-54

Current `setCachedEmbedding` does O(n) scan to find oldest entry.

**Fix**: Use Map insertion-order trick: on `get`, delete + re-set to move to end. On eviction, delete `map.keys().next().value` (oldest). Zero-dependency.

**Risk**: Low.

---

### 2.9 -- Fix Sequential Topup Processing (S)

**File**: `apps/server/src/webhook/topup-routes.ts`, lines 388-457

Inside the `for (const tx of transactions)` loop, each iteration queries `chat_topups` for pending intents.

**Fix**: Move pending intents query outside the loop. Fetch once, build a Map of `reference -> intent`.

**Risk**: Low.

---

### 2.10 -- Optimize Greeting Endpoint (S)

**File**: `apps/server/src/webhook/chat-routes.ts`, lines 540-639

`countResult` uses `{ count: 'exact', head: true }` which does full `COUNT(*)` scan.

**Fix**: Cache the count with 5-min TTL. Update async in background.

**Risk**: Low.

---

## Medium Complexity

### 2.5 -- LOTR Graph Pagination (M)

**File**: `apps/server/src/webhook/lotr-routes.ts`, line 106

`.limit(50000)` on a single query -- OOM risk.

**Fix**: Cursor-based pagination: `?after_id=<last_id>&limit=500`. Same fix needed in `graph-routes.ts` line 308.

**Requires**: Frontend changes to the LOTR graph viewer for incremental loading.

**Risk**: Medium.

---

### 2.7 -- Parallelize Dream Cycle (M)

**File**: `apps/server/src/features/dream-cycle.ts`, lines 125-142

Currently sequential with `sleep(3000)` between phases.

**New sequence**:
```
Phase A (parallel): [runConsolidation, runCompaction]
Phase B (sequential): runReflection (needs consolidation output)
Phase C (parallel): [runContradictionResolution, runLearning]
Phase D (sequential): runEmergence
```

Remove `sleep(3000)` calls -- they serve no purpose.

**Risk**: Medium. Verify consolidation and compaction don't write-conflict on episodic memories.

---

### 2.8 -- Database Index Migrations (M)

New migration file:

```sql
-- Composite index for owner-scoped recall queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_owner_type_decay
  ON memories (owner_wallet, memory_type, decay_factor DESC);

-- Composite index for owner-scoped timeline queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_owner_created
  ON memories (owner_wallet, created_at DESC);

-- Partial index for compaction candidates (dream cycle)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_compaction_candidates
  ON memories (owner_wallet, memory_type, compacted, decay_factor, importance)
  WHERE memory_type = 'episodic' AND compacted = false;
```

Run with `CONCURRENTLY` during low-traffic window.

**Risk**: Medium. Indexes add write overhead, but these tables are read-heavy.

---

## Large Complexity

### 2.2 -- Batch Entity-Aware Recall (L)

**File**: `apps/server/src/core/memory.ts`, lines 703-764

Nested loops: for each entity, sequential `getMemoriesByEntity()` + `getEntityCooccurrences()` calls. Worst case: 12 sequential DB calls.

**Plan**:
1. Collect all entity IDs in one call (already done)
2. New function `getMemoriesByEntities(entityIds[])` -- single query with `entity_id IN ($ids)`
3. New RPC `get_entity_cooccurrences_batch(entity_ids int[])` -- accepts array
4. Batch-fetch co-occurring entity memories in one query

**New functions in**: `apps/server/src/core/memory-graph.ts`

**Depends on**: 2.8 (new RPC in migration)

**Risk**: Medium. Requires DB migration + thorough recall pipeline testing.

---

### 2.6 -- Simple In-Process Job Queue (L)

**File**: `apps/server/src/core/memory.ts`, lines 334-340

Four fire-and-forget promises with no retry: `commitMemoryToChain`, `embedMemory`, `autoLinkMemory`, `extractAndLinkEntitiesForMemory`.

**Plan**: Create `apps/server/src/core/job-queue.ts`:
- In-memory priority queue, configurable concurrency (default: 3)
- Job types: `embed`, `chain-commit`, `auto-link`, `entity-extract`
- Retry with exponential backoff (max 3 attempts)
- Structured logging on enqueue/start/success/failure
- Metrics exposed via API endpoint
- Max queue size with backpressure

Replace `.catch()` pattern with `jobQueue.enqueue('embed', { memoryId, opts })`.

**Risk**: Medium. Must not grow unbounded under load.
