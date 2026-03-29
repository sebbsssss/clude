# Experimental Memory Enhancements

Based on Researcher findings ([CLU-8](/CLU/issues/CLU-8#document-plan)). All changes are isolated here —
production code in `src/core/memory.ts` is untouched.

## Modules

| Module | Experiment | Status | Expected Impact |
|--------|-----------|--------|-----------------|
| `temporal-bonds.ts` | Exp 9 | Ready | Temporal accuracy +12-17pp |
| `reranker.ts` | Exp 3 | Ready | Overall +7-10pp, strongest anti-hallucination lever |
| `confidence-gate.ts` | Exp 6 | Ready | -30-45% hallucination rate |
| `rrf-merge.ts` | Exp 1 | Ready | MRR +8-18%, eliminates weight tuning |
| `ircot.ts` | Exp 4 | Ready | Multi-hop +10-15pp |
| `bm25-search.ts` | Exp 8 | Ready | LoCoMo +4-9pp |
| `enhanced-recall.ts` | — | Ready | Orchestrator wiring all experiments |
| `config.ts` | — | Ready | Feature flags for each experiment |

## Quick Start

```typescript
import { enhancedRecallMemories } from './experimental/enhanced-recall';

// Drop-in replacement for recallMemories() with all experiments enabled
const result = await enhancedRecallMemories(opts);

// result.memories — the final ranked memories
// result.confidence — evidence sufficiency assessment
// result.confidence.hedgingInstruction — inject into LLM prompt if insufficient
// result.activeExperiments — which experiments ran
```

## Feature Flags (Environment Variables)

| Variable | Default | Description |
|----------|---------|-------------|
| `EXP_TEMPORAL_BONDS` | `true` | Exp 9: Temporal link types in graph traversal |
| `EXP_RERANKING` | `false` | Exp 3: Cross-encoder reranking (requires `COHERE_API_KEY`) |
| `EXP_CONFIDENCE_GATE` | `false` | Exp 6: Confidence-gated responses |
| `EXP_RRF_MERGE` | `false` | Exp 1: RRF fusion (requires core pipeline changes) |
| `EXP_BM25_SEARCH` | `false` | Exp 8: tsvector search (requires SQL migration) |
| `EXP_IRCOT` | `false` | Exp 4: IRCoT multi-hop (adds latency) |
| `COHERE_API_KEY` | — | Required for Exp 3 (Cohere Rerank API) |
| `EXP_CONFIDENCE_THRESHOLD` | `0.4` | Confidence gate threshold (0-1) |
| `EXP_IRCOT_MAX_STEPS` | `3` | Max IRCoT retrieval iterations |

## Integration Guide

### Tier 1: No core changes required

**Exp 9 (Temporal Bonds)** — Patch one object in `memory.ts:854`:
```typescript
// Replace the local BOND_TYPE_WEIGHTS object with:
import { TEMPORAL_BOND_TYPE_WEIGHTS } from '../experimental/temporal-bonds';
const BOND_TYPE_WEIGHTS = TEMPORAL_BOND_TYPE_WEIGHTS;
```

**Exp 3 (Reranking)** — Add after Phase 7 in `memory.ts:919`:
```typescript
import { rerankWithCrossEncoder } from '../experimental/reranker';
// After Phase 7, before owner guard:
if (getExperimentalConfig().reranking && opts.query) {
  results = await rerankWithCrossEncoder(results, opts.query, {
    apiKey: getExperimentalConfig().cohereApiKey,
    topN: limit,
  });
}
```

**Exp 6 (Confidence Gate)** — Add in `response.service.ts:74`:
```typescript
import { evaluateConfidence } from '../experimental/confidence-gate';
const confidence = evaluateConfidence(memories);
if (confidence.hedgingInstruction) {
  memoryContext = confidence.hedgingInstruction + '\n\n' + memoryContext;
}
```

### Tier 2: Core pipeline changes

**Exp 1 (RRF)** — Replace Phase 3-4 merge logic with `rrfMerge()`.
**Exp 4 (IRCoT)** — Wrap response pipeline with `runIRCoT()` for multi-hop queries.
**Exp 8 (BM25)** — Run `bm25-migration.sql` on Supabase, then replace ilike queries.

## SQL Migrations

Canonical migrations live in `migrations/experimental/` (not in this directory):
- `001_temporal_rpc.sql` — `match_memories_temporal()` RPC + `event_date` columns
- `002_bm25_search.sql` — `ts_summary` tsvector column (weighted A/B) + `bm25_search_memories()` RPC

**Run order:** Deploy SQL first (`001` then `002`), then enable the corresponding feature flags.

## Combined Projection

Implementing Exp 3 + 4 + 6 + 9 together (orthogonal improvements):
- **LongMemEval: 68.4% → 78-82%** (oracle ceiling: 76.2%)
- **Hallucination rate: estimated -35-50%**

## Architecture

```
recallMemories() (existing 7-phase pipeline)
    │
    ├── Phase 6: BOND_TYPE_WEIGHTS ←── temporal-bonds.ts (Exp 9)
    │
    └── Phase 7 results
            │
            ├── reranker.ts (Exp 3) ←── Cohere cross-encoder
            │
            ├── confidence-gate.ts (Exp 6) ←── evidence check
            │
            └── enhanced-recall.ts ←── orchestrator
                    │
                    └── response.service.ts ←── hedging instruction
```
