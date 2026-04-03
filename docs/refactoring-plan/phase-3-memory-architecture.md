# Phase 3: Memory System Architecture

Can start immediately -- independent of other phases.

---

## 3.1 -- Dream Cycle Structured Observability (M)

**File**: `apps/server/src/features/dream-cycle.ts`

**Plan**:
- Add `DreamCycleMetrics` object tracking per-phase: `duration_ms`, `memories_read`, `memories_written`, `llm_calls`, `errors`
- Add `metrics` JSONB column to `dream_logs` table
- Structured log entries at phase boundaries:
  ```
  log.info({ phase: 'consolidation', status: 'start', ownerWallet })
  log.info({ phase: 'consolidation', status: 'complete', duration_ms, insights_created })
  ```
- Expose metrics via `GET /api/brain/consciousness` (extend existing `lastDream` response)

**Risk**: Low. Additive changes only.

---

## 3.2 -- Multi-Tenant Dream Isolation Fix (S) -- URGENT

**File**: `apps/server/src/features/hosted-dreams.ts`

**Bug found**: The importance accumulator (`importanceAccumulator`) at dream-cycle.ts line 70 is a **module-level variable**, not per-tenant. One tenant's activity can trigger another tenant's dream cycle.

Same issue with `lastReflectionTime` and `reflectionInProgress`.

**Fix**:
- Change `importanceAccumulator` from `number` to `Map<string, number>` keyed by `owner_wallet`
- Same for `lastReflectionTime` -> `Map<string, number>`
- Same for `reflectionInProgress` -> `Map<string, boolean>`
- Add TTL cleanup: evict entries older than 24h, limit map to 10K entries

**Risk**: Medium. Without cleanup, map grows unbounded for inactive tenants.

---

## 3.3 -- Configurable Recall Scoring Weights (M)

**File**: `apps/server/src/core/memory.ts`, function `scoreMemory` (lines 938-1031)

Currently all weights are global constants from `utils/constants.ts`.

**Plan**:
- Create `ScoringProfile` type with all weight fields
- Store per-agent profiles in `dashboard_agents.config` JSONB column (already exists)
- Default profile = current constants
- `scoreMemory` accepts optional `ScoringProfile` parameter
- New endpoint: `PUT /api/dashboard/agents/:id/scoring` to update weights
- New endpoint: `GET /api/dashboard/agents/:id/scoring` to read effective weights

**Risk**: Low. Default profile preserves current behavior.

---

## 3.4 -- Verify Confabulation Penalty (S)

**File**: `apps/server/src/core/memory.ts`, lines 1022-1029

Current logic:
```typescript
if (mem.source === 'consolidation') {
  rawScore *= vectorSim > 0.5 ? 0.45 : 0.30;
} else if (INTERNAL_MEMORY_SOURCES.has(mem.source)) {
  rawScore *= vectorSim > 0.5 ? 0.70 : 0.50;
}
```

**Verification**:
1. Confirm `INTERNAL_MEMORY_SOURCES` contains all dream-generated sources
2. Confirm consolidation memories have `source: 'consolidation'`
3. Write unit test calling `scoreMemory` directly with mock internal-source memories
4. Assert penalty is correctly applied at various vector similarity levels

**Risk**: Low.
