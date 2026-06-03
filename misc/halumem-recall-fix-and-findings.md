# HaluMem benchmark: a production recall bug + honest findings

Running the **HaluMem-Medium** memory-hallucination benchmark (MemTensor/HaluMem) against Clude
surfaced a real production bug and an honest read on where Clude stands. This doc records both,
plus the blueprint to make Clude competitive.

---

## 1. THE HEADLINE: a production recall bug (found + fixed)

**Clude's production recall had its vector/semantic search silently disabled for every user.**

- `recallMemories()` (packages/brain/src/memory/memory.ts ~L904) passes a `filter_tags` argument to
  the `match_memories` RPC. **No deployed `match_memories` overload ever had that parameter** — the
  migration that adds it was never applied to prod (it had been flagged "pending" in notes).
- So every vector-search call errored (`Could not find the function match_memories(filter_owner,
  filter_tags, ...)`), the error was swallowed by the surrounding try/catch, and recall **silently
  fell back to keyword-only** (`vectorAssisted:false` on every query).
- **Impact:** the live bot has been recalling **without the semantic/vector phase**. Keyword/BM25
  recall (e.g. the 2M-fact exact-lookup proof) was unaffected; finding memories *by meaning* was off.

**Proof:** `recallMemories`' exact param set → ERROR; the same call without `filter_tags` →
60 rows at 0.93 similarity. After the fix, recall logs flipped to `vectorAssisted:true`.

**Fix:** `migrations/028_match_memories_filter_tags.sql` — adds the optional `filter_tags` param
(behavior-identical when null) and collapses the two ambiguous overloads into one function.
**Already applied to production** via the migration tool and verified (one clean overload, with
`filter_tags`). This file tracks it in the repo; re-applying is idempotent (`CREATE OR REPLACE`).

> Secondary schema-drift noticed (not yet fixed): `get_entity_cooccurrence` is also undeployed, so
> recall's entity-cooccurrence boost is off. Lower impact (recall still works); worth a follow-up.

---

## 2. HONEST HaluMem-Medium result (official gpt-4o judge, all 3,467 QA)

After the vector fix, the full 20-user run scored (this is a *legit* number — official scorer,
complete artifact, no gaming):

| Metric | Clude | Field (HaluMem-Medium) |
|---|---|---|
| **QA hallucination** | **11.77%** | MemOS 0.42% · Mem0 0.45% |
| QA correct | 39.6% | Mem0 53% · MemOS 67% |
| QA omission | 48.6% | — |

Per-type hallucination: Dynamic-Update 35.6%, Generalization 22.8%, Multi-hop 16.7%, Basic-Fact
14.9% (Memory-Boundary 2.4% and Memory-Conflict 1.3% are fine — Clude abstains correctly there).

**Read:** the vector fix made Clude *answer* far more (correct 24%→40%) but it now commits to
confident-wrong answers when recall surfaces a close-but-wrong fact — hence 11.77%. (Pre-fix it
hallucinated only 1.2% because broken recall made it abstain on everything — a hollow result.)

**Two root causes of the gap to the leaders:**
1. **Extraction recall** — the thin v1 extractor captured ~28% of gold facts, so the right fact is
   often not stored. (Validated separately: a completeness prompt extracts 15/15 gold facts for a
   sample session — the approach works; the v1 prompt was the problem.)
2. **No update reconciliation** — Clude appends every fact, so stale + updated versions coexist;
   recall surfaces the stale one and the answerer commits → the 35.6% Dynamic-Update hallucination.

---

## 3. BLUEPRINT to make Clude competitive (the v2 path)

Borrowed from Mem0 and MemOS source (both achieve ~0.4% hallucination + 53-67% accuracy via the
same two mechanisms Clude lacks):

1. **Completeness extraction** — replace the thin extractor with Mem0's `ADDITIVE_EXTRACTION_PROMPT`
   approach: extract from both roles, every topic, decompose into self-contained facts, resolve
   pronouns/dates, fight "first-topic dominance" ("if you extracted <3, re-read"). Use gpt-4o-mini
   (non-reasoning, Mem0/MemOS default) or gpt-5-mini. *Component-validated: 15/15 gold on a sample.*
2. **ADD/UPDATE/DELETE reconciliation** — for each new fact, vector-search existing memories
   (limit 5), mask UUIDs→ints, one LLM decide call (Mem0's `DEFAULT_UPDATE_MEMORY_PROMPT`) →
   UPDATE overwrites in place / DELETE removes / ADD inserts. Stale facts physically superseded.
   **Caveat learned the hard way:** on Clude's single-entity-per-user corpus, everything is
   vector-similar, so a naive decide call OVER-MERGES (collapsed 700→19). The reconciliation must
   be conservative — high similarity threshold (~0.85), default-to-ADD, UPDATE only same-attribute
   changed-value. A simpler interim is ADD-all + a "prioritize most recent memory" rule at QA time.
3. **MemOS hallucination filter** (optional, biggest single hallucination lever) — after extraction,
   delete memories not grounded in the user's explicit words.
4. **QA params:** top_k=20, timestamped context, temp 0, "most recent memory is source of truth."

Full quoted prompts + file paths are in the research notes; the WIP adapters are
`misc/scripts/halumem-adapter.mjs` (v1, scored) and `halumem-adapter-v2.mjs` (v2, in progress —
extraction works; the end-to-end storage path needs another debug cycle, then a ~5h full re-run).

**Status:** competitive HaluMem number is a focused follow-up; the production recall fix (§1) is the
urgent, shippable outcome and is done.
