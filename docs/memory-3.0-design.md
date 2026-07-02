<!-- DRAFT for review. Produced 2026-07-02 by a 26-agent research fleet: 6 code readers + 6 web researchers -> condensed brief (2556 words) -> 3 competing architectures -> 9 adversarial verdicts -> synthesis. Scoreboard: Ledger & Lens 6.8/10 (20 fatal flaws raised); HIPPOCAMPUS 6/10 (19 fatal flaws raised); Ledgered Memory 6.8/10 (19 fatal flaws raised). -->

# Clude Memory 3.0: Final Design

**Status:** Final. Synthesized from three architect proposals ("Ledger & Lens", "HIPPOCAMPUS", "Ledgered Memory") and nine adversarial verdicts. Base proposal: Ledger & Lens (highest combined engineering + product scores on accuracy, hallucination, and recall; most graftable component structure). Path shorthands follow the brief.

## Executive summary

1. We build Ledger & Lens: a bi-temporal, reconciled write ledger under a rank-fused, cited, verified read lens. Supabase stays the store; .pmp becomes the verifiable serialization of it.
2. From Ledgered Memory we graft the crypto core (signed manifests, derivable manifest_hash, merkle domain separation, encrypted round-trip), per-export on-chain anchoring off the treasury, citation badges, the dual-identity hash_id migration, and the boot-blob freeze.
3. From HIPPOCAMPUS we graft process, not the model: graduated write authority, watermarks initialized to NOW, a write-path-ON seeding mode for HaluMem, a model-agnostic typed op client, and hosted-dreams dedup as the reconciler's first job.
4. Dropped as fatally flawed: the MemReader SLM as a load-bearing dependency, the GRPO training flywheel, rolling per-owner live roots with daily anchors, the pack-native offline query index (deferred), legacy hash_id remint, and VACUUM FULL on a live table.
5. Repaired flaws, with mechanism: frontier-class (not 3B) reconcile router behind a tiered cosine gate with a kill ladder; sync-embed-with-timeout fixes the reconcile ordering hole; post-stream verification fixes the streaming conflict; pinned seed lane fixes RRF seed dilution; per-owner entity re-derivation fixes the owner-scoping hand-wave; copy-swap fixes the VACUUM downtime.
6. Honest targets: LongMemEval-S 85.0 to 87-89 (not 90-92; the panel caught double counting). HaluMem QA-stage hallucination ~7% to 3-4% with coverage held, measurable only via the new write-path-ON seeding mode. Prod finally runs the reader that produced 85.0.
7. Sequencing: integrity floor and canary first, read side second, reader third, write side fourth. The PMP track runs in parallel so ownership work cannot be squeezed out by scope slip.
8. Every phase carries a fresh-wallet measurement gate with explicit proceed and kill numbers. Per-component claims below the measured ±2.6pp noise floor are gated at category level and on two-run means, never single runs.
9. Migration: prune 745K rows to ~40K real, copy-swap instead of VACUUM FULL, all schema changes additive and nullable, v1 packs verify forever, no forced re-export, nothing rewrites memory content.
10. Honest effort: ~22-26 engineer-weeks across two tracks, roughly 14-16 calendar weeks for this team. The 12-week figure in the source proposal was fiction and we say so.

## Inputs and disposition

Panel totals: Ledger & Lens 20.5, Ledgered Memory 20.5, HIPPOCAMPUS 18. Ledger & Lens wins the tiebreak on accuracy/hallucination/recall sub-scores from the engineering and product lenses (8.5/8.5/8 and 9/9/8), which is what this redesign is for. Ledgered Memory wins portability/ownership across all three lenses, so its ownership core is grafted wholesale. HIPPOCAMPUS is a source of process patterns; its thesis is rejected.

Fatal-flaw dispositions (every flaw a judge raised is dropped or repaired):

| Flaw (judge) | Disposition |
|---|---|
| Double-counted LongMemEval gains; 90-92 inflated (L&L, Ledgered) | Repaired: gains re-attributed below; reader port and event_date write path claimed at ~0pp harness movement; target 87-89 |
| HaluMem gain rests on machinery seeding bypasses (L&L, Ledgered, HIPPO) | Repaired: write-path-ON seeding mode added as a first-class harness variant (C10) |
| Cite-verify-revise vs streamText (all three lenses on L&L) | Repaired: post-stream verify with visible correction in chat; buffered pre-return revise in SDK/benchmark (C6) |
| Temporal +7-11% unit confusion (L&L, Ledgered) | Repaired: claim cut to +0.5-1.5pp overall; category-level gate instead |
| Untrained 3B zero-shot reconciler; no plan if gate never clears (L&L) | Repaired: Haiku-class frontier router (Zep's 0.42% used frontier) plus an explicit kill ladder ending in a no-LLM exact-dup-only floor (C1) |
| Effort math self-contradiction (L&L, Ledgered) | Repaired: real sums stated; cut order defined |
| "Verifiable ledger" on unsigned, non-derivable, non-round-tripping packs (all lenses) | Repaired: Ledgered's crypto core grafted as C9; "verifiable" becomes literally true |
| Reconcile ordering: novelty needs the async embed (L&L eng) | Repaired: synchronous embed with 500ms timeout, async outbox fallback, embed reused downstream (C1) |
| Novelty gate miscalibrated for similar dialog turns (Ledgered) | Repaired: tiered gate + shadow trigger-rate counter + per-conversation batching + per-owner budget (C1) |
| RRF dilutes intentional seed privileging (Ledgered, HIPPO) | Repaired: knowledge seeds become a pinned quota lane outside fusion (C3) |
| Entity owner-scoping backfill hand-waved (L&L eng) | Repaired: per-owner re-derivation from source memories; ambiguous rows quarantined; co-occurrence rebuilt per owner (C7) |
| VACUUM FULL lock on live table via exec_sql (L&L eng, Ledgered eng) | Repaired: batched prune + copy-swap with delta catch-up; maintenance-window VACUUM FULL only as fallback (Migration) |
| Cross-encoder = Python sidecar on a TS stack (L&L eng, HIPPO) | Repaired: LLM rerank first, gated by route hint; ONNX in-process worker-thread reranker as the measured step 2; no Python service (C4) |
| Invisible work, no user-facing trust surface (L&L product) | Repaired: citation chips, superseded annotations, Solscan anchor link ship in Track B (C9) |
| Temporal extraction rides the call short-circuit deletes (Ledgered product) | Repaired: query-plan call runs before routing; temporal-marked queries never short-circuit (C3, C5) |
| Rolling live root consistency undesigned; anchor cadence cost/leakage (Ledgered) | Dropped: per-export static anchors only |
| hash_id remint breaks PMP/message/NFT references (HIPPO) | Dropped: dual identity instead; legacy hash_id untouched forever (C2) |
| MemReader SLM vaporware; latency citation mis-transfer; GRPO is a research program (all lenses on HIPPO) | Dropped as load-bearing. Typed op client kept so an SLM can slot in later without redesign |
| Multi-hop had no intervention (Ledgered product) | Covered: deterministic entity second-hop (C7) |
| OM deferred despite external validation (L&L product) | Repaired as sequencing: OM is Phase 5 with a hard trigger; this stack is its substrate (source-turn pointers, outbox, shared reader), not its competitor |

## Components

### C0. Integrity floor (ships first, ~1.5 weeks)

Nothing else ships until recall failures are loud and tenants are isolated.

- **Recall canary.** New `apps/server/src/workers/recall-canary.ts`: on every deploy and hourly, store a sentinel row and recall it through each RPC path (`match_memories`, `match_memory_fragments`, `match_memories_temporal`, `get_linked_memories`); page if the vector lane returns empty. Converts the migration-028 class (a second `match_memories` overload silently killed vector recall for weeks) into an immediate alert.
- **Fail-closed owner scoping.** `match_memories` rejects null owner instead of fail-open (memory.ts:2503); the JS post-guard (memory.ts:1433-1440) runs unconditionally; the bot gets an explicit system wallet so `scopeToOwner(null)` no-ops die. `pmp.routes.ts:86-90` unauthenticated `?owner=` trust removed; `/v1/memories/:id` (pmp.routes.ts:149-190) gains an owner filter; `memory-packs.routes.ts:16-21` `?wallet=` trust removed (requireOwnership pattern from PR #290). Rollout: one deploy log-only, then enforce.
- **Fragment parity.** `match_memory_fragments` gains owner/min_decay/type/revoked filters (the migrations/009 gap); `revoke_memory` cascades to fragments; the vector-only backfill (memory.ts:1233-1246) respects decay and revocation. Closes revoked-memory resurrection and the plaintext-fragment encryption bypass.
- **Boot blob frozen.** database.ts:22-769 stops replaying DDL; it becomes a verify-only drift check that alerts via Pino + a health metric. Migrations are the single schema writer. All new RPCs DROP-FIRST per migration 041 discipline.
- **BENCH_MODE.** One env var consumed at the memory.ts boundary disables access boost, Hebbian reinforcement, reconciliation, and observation state mutation; the harness preflight asserts it. Operationalizes the fresh-wallet truth (+2.6pp observed from data freshness alone).

### C1. Write path: reconciliation + bi-temporal supersession (~3 weeks)

Attacks the measured ~7% floor of wrong-date and wrong-but-similar grounded errors where HaluMem says they are born: extraction and update.

- **Schema (migration 042, all additive/nullable):** `valid_from` (default created_at), `invalid_at`, `superseded_by`, `fact_key`, `event_date`, `extractor_version`, `extraction_confidence`, `source_turn_ref` jsonb on `memories`; validity columns on `memory_links`.
- **Ordering repair.** With MEMORY_RECONCILE on, `storeMemory` (memory.ts:448-588) computes the embedding synchronously with a 500ms timeout; the result is reused by the fragment pipeline so nothing is paid twice. On timeout or embed failure the write proceeds as a plain ADD and the outbox flags it for post-hoc reconcile. No fiction about "zero added latency": gated writes pay ~100-150ms.
- **Tiered gate (repairs miscalibration).** Max-cosine > 0.95 plus matching entity set: auto NOOP/exact-dup, no LLM. 0.85-0.95: one Haiku-class call routes ADD/UPDATE/NOOP against the top-5 similar owner-scoped candidates. Below 0.85: plain ADD. A shadow trigger-rate counter ships before enforcement; if conversational traffic trips the gate on more than ~40% of writes, reconciliation batches per conversation window through the outbox instead of per write, and a per-owner daily budget caps spend (overflow degrades to ADD + async dream sweep).
- **Frontier router, not 3B.** Zep's 0.42% QA hallucination came from a frontier reconciler; Memory-R1 shows small models need training we do not have yet. The router is Haiku-class via the existing OpenRouter/claude-client path, wrapped in the typed op client (C11) with `{op, model_version, confidence}` stamps.
- **UPDATE = invalidate, never delete.** New row, `invalid_at` set on the loser, `supersedes` link written. Reversible by clearing `invalid_at` (the Supersede paper: bigger memory gives zero recovery; supersession must be explicit). Relative dates normalize to absolute `event_date` at ingest from the message timestamp.
- **Kill ladder (repairs "no plan if the gate never clears").** Shadow mode logs proposed ops for 2 weeks; a 200-pair labeled sample must show <2% false-positive supersession before enforce. Failing that: raise the LLM band to 0.92, then restrict UPDATE to same-fact_key only, then ship the no-LLM floor (exact-dup NOOP only, everything else ADD, conflicts left to the dream sweep). Each rung is a shippable state.
- **Retirements.** The valence-delta contradiction heuristic (memory.ts:1940) is retired as the primary conflict path; `classifyLinkType` (memory.ts:1926-1949) is replaced by the router's typed link output, which finally emits `causes` (highest BOND_TYPE_WEIGHT, zero writers today) and `happens_before/after` on shared fact_keys.

### C2. Write receipt: outbox + identity (~1.5 weeks)

- **Outbox.** `memory_write_jobs` table with status/attempts/next_retry replaces the fire-and-forget triad (embedMemory memory.ts:575, autoLink :578, entity extraction :581, errors swallowed). A worker in apps/server drains it. `storeMemory` returns `{hash_id, jobs_queued}`. Permanent missing embeddings become visible and retryable.
- **Dual identity (graft, repairs remint breakage).** New `hash_id_v2` (16-byte, server-minted) and `content_hash` (memory-hash-v2) columns; NOT NULL + unique applied to v2 only. Legacy 4-byte `hash_id` (client-minted at memory.ts:129-131, ~50% collision odds at 77K rows, 5 live dups, nullable because migration 003 never applied) is never touched: PMP records, per-message memory_ids (chat.routes.ts:1253), and title-NFT bindings resolve forever. Both columns live on the same row; no mapping table.
- **embedding_version** column beside the hardcoded vector(1024) gives the embedding stack an escape hatch. Backfills (event_date, content_hash, v2 ids) ride this worker, throttled, direct DB (storeMemory fire-and-forget 429s are a measured trap).

### C3. RRF fusion core (~2 weeks)

Replaces the boost pile in `recallMemories` (memory.ts:984-1474) with rank fusion. `experimental/rrf-merge.ts` exists and is tested; this is promotion, not construction.

- **Lanes, fused at k=60:** memory-vector, fragment-vector, BM25 (promoted from the default-off 0.15 raw boost; its exact-fact edge now wins by rank, reconciling "embeddings hurt exact-fact QA" with vector weight 4.0 being right for diverse prod corpora), keyword/tag, temporal (C5), entity second-hop (C7).
- **Pinned seed lane (repairs seed dilution).** Knowledge seeds stop being a +2.0..+4.0 raw boost that is 2-4x the max base score (memory.ts:1617) and become a pinned quota lane (cap 3) outside fusion. Intentional privileging survives; scale abuse dies.
- **Clamps (MIRAS).** Recency, importance, and decay become tie-break multipliers clamped to [0.9, 1.1]. No scalar can dominate a rank sum, so the HaluMem recency-overflow class (0.995^hours blowup) becomes structurally impossible. Access boost becomes capped Ebbinghaus reinforcement that no longer resets `last_accessed` into decay exemption (migrations/003:12-16 immortal-memory loop); off under BENCH_MODE. Decay floor raised above recall minDecay (0.05 < 0.1 dead zone at memory.ts:987). Hebbian link strength bounded, decays, never boosts `contradicts` (database.ts:236-252).
- **Query plan call.** One structured LLM call (2s race) replaces expandQuery (memory.ts:954-968), emitting `{variants, temporal_constraints, route_hint}`. Routing repair: temporal detection happens inside this call before any short-circuit decision; temporal-marked queries never skip the temporal lane. On timeout: original query plus a fixed-bounds regex fallback. Keyword short-circuit serves high-confidence exact/tag hits with no vector pass and no Phases 5-6.
- **Contract fixes.** Unconditional sort+slice after every phase (memory.ts:1386-1388 bug); Phase 5 stops pushing past `limit`; `recallMemorySummaries` (memory.ts:1644-1689) becomes query-aware instead of an importance list; `skipExpansion` actually skips. Every result carries `{lane, rank, fused_score}` retrieval provenance (graft): rankings become debuggable and the provenance feeds citations.
- **Rollout.** Shadow dual-run on prod (v1 served, v2 logged, top-10 overlap reviewed) plus per-category fresh-wallet parity gate before the flip. The judges are right that the boost pile produced the 85.0; we verify RRF keeps it, not assume.

### C4. Rerank + score-adaptive truncation (~2 weeks)

SmartSearch's oracle shows 98.6% of gold already sits in candidates while naive truncation keeps only 22.5% of it; the gap to 88.4% lives here.

- **Runtime repair (no Python sidecar).** Step 1: Haiku listwise rerank over the fused top ~50 via the existing OpenRouter path, fired only when the route hint says complex AND candidate count exceeds a threshold. Cost measured on prod traffic for two weeks. Step 2, if cost bites: an in-process ONNX cross-encoder (bge-reranker class via onnxruntime-node) on a worker_threads pool, so the event loop never blocks and no second service exists. The decision is a measured gate, not a bet.
- **Truncation by score cliff** (largest relative drop), not fixed limit. A post-rerank absolute floor returns "no relevant memory" instead of the best distractor. Applies to prod chat (limit-25 path), SDK, and summaries.

### C5. Temporal spine (~1.5 weeks)

The storage half shipped (event_date column, `match_memories_temporal`); nothing writes or ranks it.

- **Write:** the harness's event-date extractor moves into the outbox worker; the surviving corpus is backfilled.
- **Query:** constraints come from the query-plan call as structured `{after, before, anchor}`, feeding `match_memories_temporal` as a ranked RRF lane instead of being appended after the list where the token budget trims them first (chat.routes.ts:1061). The English-regex detector's off-by-a-year bug ("after <month>" ending Jan 1 next year, temporal-bonds.ts:117-121) dies; the RPC's silent `[]` fallback (temporal-bonds.ts:162-163) becomes fail-loud. memory-grounding.ts:28-42 renders event_date instead of created_at.
- **Honest claim:** temporal questions are ~13-15% of LongMemEval; even strong category gains are +0.5-1.5pp aggregate. The category gate (Temporal 77.4 to ≥80) is the real target; the aggregate claim is deliberately small.

### C6. Grounded reader: one module, cite then verify then revise (~2.5 weeks)

- **One reader.** `packages/brain/src/memory/reader.ts` consumed by chat, SDK, and harnesses ends the three drifting grounding texts with opposite abstention polarity (memory-prompt.ts:43 abstain vs longmemeval force-answer vs halumem exact-Unknown). Polarity becomes per-surface config. The two-stage per-category prompting and session ordering that produced 85.0 finally run in prod.
- **Conflict-set assembly.** Candidates grouped by fact_key/entity, ordered by valid_from, superseded facts annotated "(superseded by ...)" rather than hidden (MADAM-RAG: the aggregation step alone was worth +7.8% in their setting). Replaces the flat concat that triggers context compliance.
- **Citations.** Claims cite `[mem:hash_id]`; per-message memory_ids (chat.routes.ts:1253) become load-bearing.
- **Streaming repair.** Chat keeps streamText untouched: the slot verifier (one Haiku call, fired only when the draft asserts dates/entities/numbers) runs on the completed draft; on mismatch the UI appends a visible correction block and the corrected text persists as the canonical turn. SDK and benchmark paths, which have no streaming contract, buffer and revise before returning. Perceived chat latency is unchanged; correctness of the persisted record improves.
- **Verifier repair (the cited-but-wrong hole).** Two checks: (a) asserted slots vs cited memory content and event_date; (b) cited-vs-conflict-set staleness, a pure metadata compare: if the citation is superseded by a valid-time-later memory already in the assembled set, revise re-anchors to the successor. Where no supersession data exists (legacy corpus), the verifier cannot fix wrong selection; this is exactly why the hallucination target is 3-4%, not <2%. Never abstain: AbstentionBench shows calibration fails on grounded-but-wrong, our dominant class.
- **Rides along:** the history-load bug (chat.routes.ts:1036-1040 orders ASC limit 50, sending the oldest 50 turns and dropping the just-sent message), atomic balance deduction (chat.routes.ts:1220-1240), and the start of carving the 1415-line monolith.

### C7. Entity second-hop + entity integrity (~2 weeks)

- **Deterministic hop.** Replace the sequential N+1 entity/co-occurrence loops (memory.ts:1275-1338): harvest entities from round-1 fused hits, one batched re-query, feed the union as an RRF lane, let C4 arbitrate. Targets Multi at 76.7. No PPR, no community summaries: Cognee's 30.6% head-to-head corroborates that graph-first collapses on conversational memory.
- **Owner scoping repair (the hard half, costed).** Entity tables/RPCs gain `owner_wallet` with entities keyed `(owner_wallet, normalized_name)`. Existing rows are global aggregates, so we re-derive per-owner entities from each owner's memories via the outbox worker (cheap over ~40K post-cleanup rows), quarantine genuinely ambiguous rows to the bot's system wallet, rebuild co-occurrence per owner, then drop the polluted global rows. graph.routes.ts stops serving global data to any Privy user.
- **Correctness fixes:** parameterized filters replace the unescaped `.or()` interpolation (graph.ts:87); upsert on the unique key kills the select-then-insert race and double invocation; `getMemoriesByEntity` filters owner in-query instead of after a limit-20 fetch (graph.ts:197-214).

### C8. One dream engine (~2.5 weeks)

- Delete hosted-dreams.ts and the local SQLite engine after one dual-run comparison cycle logged to dream_logs. One engine in cycle.ts serves bot + hosted tenants, iterating owners explicitly (the null-owner cycle currently sweeps all tenants and compacts cross-tenant rows into null-owner summaries).
- **Watermarks initialized to NOW at cutover** (graft): per-owner `last_consolidated_at` ends the rolling 7-day rescan that re-consolidates each memory ~28x (hosted-dreams.ts:126) without triggering a historical re-consolidation storm. Every run writes dream_logs. The unconditional post-deploy run (cycle.ts:1045) dies; importance-sum triggers get their own table instead of abusing rate_limits (cycle.ts:168-201); AbortController makes the 10-minute Promise.race actually cancel zombie phases.
- **Non-destructive, capped consolidation:** summaries are new linked memories with provenance to source hash_ids, originals decay, depth ≤2, consolidation stops recalling the semantic tier (cycle.ts:323), emergence importance drops 0.9 to 0.7 (cycle.ts:874), `compacted=true` rows finally leave recall (compaction stops adding net memories), and the `compacted_into` dangling pointer (cycle.ts:532 vs memory.ts:483) is fixed.
- **Insights flow through the reconciler**, so duplicates NOOP. The reconciler's first production job (graft): a one-shot dedup of historical hosted-dreams duplicates, invalidate-not-delete, on the lowest-stakes data class. Dreams run on a stronger model than recall (Letta asymmetry).

### C9. PMP: verifiable, anchored, visible (Track B, ~3.5 weeks total)

The panel's unanimous point: provenance on an unverifiable substrate is theater. So the substrate gets fixed first.

- **Crypto core (graft).** One canonical module in packages/pmp-sdk consumed by memorypack, tokenization, server, and @clude/ui (four lockstep copies today). Merkle v2 with 0x00 leaf / 0x01 inner domain separation (pack-merkle.ts:16-28; closes [A,B] ≡ [A,B,B]). `manifest_hash` derived from actual file bytes (fixes pmp-artifacts.routes.ts:603-611 vs :1380). ed25519 `manifest_sig` over (merkle_root ‖ manifest_hash ‖ created_at): verify stops being self-consistency-only. Versioned algorithm fields: v1 packs verify forever under v1 rules. isTarballPath extensionless bug fixed (writer.ts:623-633).
- **Encrypted round-trip.** Import accepts encrypted records via holder DEK recovery (fixes the :1293-1297 rejection). Without this, supersession replay is unreachable exactly where the encryption story lives.
- **Provenance profile v2.** records.jsonl gains source_turn_ref, extractor_version, extraction_confidence, valid_from/invalid_at, superseded_by chain, reconcile_op; import replays supersession chains instead of flat-inserting. memory-hash-v2 for new exports.
- **Anchoring, off the treasury.** ANCHOR_EXPORTS_ON_CHAIN wires the mainnet-proven writeMemo path (smoke txSig 3XRg..., 2026-07-01) into the export flow, carrying (merkle_root, manifest_hash). Signer: a dedicated low-balance anchor keypair; hard gate, zero anchor volume on BOT_WALLET_PRIVATE_KEY (the ~190 SOL treasury). Per-export static anchors only; the rolling live root and daily checkpoint memos are dropped (consistency under concurrent writers was undesigned, and anchor cadence leaks activity metadata).
- **Visible trust surface (repairs "invisible work").** Citation chips in chat verify against the export merkle root via a proof endpoint; a Solscan link lands on the export card; superseded annotations render in chat and dashboard.
- **Standards play.** Publish the .pmp spec with the lossless PAM-JSON profile and signed-manifest verification procedure. Text stays the only canonical form (DroidSpeak: KV caches are same-architecture-only; gist tokens are model-locked).

### C10. Benchmark harness upgrades (~1 week, inside Phase 0/1)

- **Repair the stale harness first** (broken imports post-brain-refactor); nothing is measurable until it reproduces the 85.0 baseline.
- **Write-path-ON seeding mode** (graft, repairs the flagship contradiction): two seeding paths, direct-insert for retrieval-only A/Bs and full-pipeline (Observer-less storeMemory + reconcile) for HaluMem memory-stage scoring, both fresh-wallet gated, BENCH_MODE asserted in preflight, --skip-seeding always paired with --skip-cleanup.
- **Prod-parity mode:** the harness can run through the deployed read path (same reader module), so "what prod actually scores" becomes a number instead of a guess.

### C11. Typed op client (~0.5 week, riding C1/C3)

Model-agnostic graft from HIPPOCAMPUS: one Zod-validated client for the LLM ops this design adds (QUERYPLAN, RECONCILE, RERANK, VERIFY, temporal extraction), with per-op fallback chains (frontier via OpenRouter/claude-client, then deterministic heuristic), per-op circuit breakers, `{op, model_version, confidence}` stamps on every model-derived write, and parameter stripping at the boundary (Opus 4.7 rejects temperature/top_p). Consolidates the llama-3.2-3b/llama-3.3-70b/regex scatter. If a trained SLM ever clears a quality bar, it slots in here without redesign.

## What we are NOT doing, and why

- **No MemReader SLM as a load-bearing dependency.** It does not exist (CludeMem design v2.1, 7 decisions pending, no training run); Railway has no GPUs; the cited ~650ms budget was a ColBERT number mis-applied to 4B generation. The op client keeps the slot open.
- **No GRPO training flywheel this quarter.** It is a research program (GPU infra, registries, golden-output suites) competing for the same people who must land the substrate. The reward environments remain an asset; revisit after OM.
- **No graph-first ingestion, GraphRAG community summaries, or CoN.** Measured: Cognee 30.6% vs Clude 80.4%; CoN was reverted as a net regression.
- **No novelty weight in recall.** RETRIEVAL_WEIGHT_NOVELTY stays 0 (Titans reimplementation found the surprise mechanism unreliable; our own stance). Novelty is spent on write triage and decay nudges only.
- **No abstention or calibration investment.** The ~7% floor is grounded-but-wrong; AbstentionBench shows calibration fails exactly there. We revise, we do not refuse.
- **No per-message extraction cadence.** Mem0's per-message extraction scored 3.23% extraction recall on HaluMem-Long. Reconciliation batches per conversation window when volume demands.
- **No rolling per-owner live roots or daily anchor memos.** Concurrent-writer consistency over Supabase REST was undesigned, cost and metadata leakage were unquantified. Per-export static anchors give the demo and the proof without the race.
- **No pack-native offline query index now.** Deferred: it is the single biggest line item (1.5-2 months) and has no sync story; a snapshot that decays the moment the user keeps living is a demo, not a product. The spec documents BM25 postings as the portability floor for a later phase.
- **No legacy hash_id remint.** PMP records, per-message memory_ids, and title bindings reference the 4-byte IDs; dual identity preserves them forever.
- **No unbounded score terms of any kind.** The HaluMem recency overflow (0.995^hoursSinceAccess on future-dated rows) proved the bug class; everything is clamped or rank-fused.
- **No FHE or exotic encrypted query.** Client-side index later, attested TEE cited as the roadmap, nothing bet on it.
- **No VACUUM FULL through exec_sql on the live table.** It cannot run in the RPC's transaction and takes an ACCESS EXCLUSIVE lock on a table serving prod chat. Copy-swap instead (Migration).
- **No Observational Memory as the first move, but not a burial.** Mastra's 94.87% is a whole-stack number, not a transplantable delta, and OM's Observer needs exactly the substrate Phases 1-4 build (source-turn pointers, outbox, shared reader, token-threshold plumbing). It is Phase 5 behind a hard trigger, defined below, not "after a plateau someday".

## Expected gains, with honest uncertainty

Single-run noise from data freshness alone is ±2.6pp; every gate below uses two-run fresh-wallet means and category deltas.

- **LongMemEval-S: 85.0 to 87-89 (point estimate 88).** Harness-visible levers only: fusion + rerank + score-adaptive truncation +1 to +3pp (SmartSearch's 88.4% recipe; our harness already reranks, so the increment is fusion and truncation, hence the low end); conflict-set assembly +0.5 to +1.5pp; entity second-hop, targeted at Multi 76.7 to 79-82, +0.5 to +1.5pp aggregate; temporal query lane, targeted at Temporal 77.4 to 80-83, +0.5 to +1pp aggregate. These do not add linearly; the range already discounts overlap. Explicitly claimed at ~0pp: porting the reader and event_date write path (already in the harness baseline; they close the prod gap instead). 90+ is assigned to OM, not to this stack.
- **Prod-parity (new metric):** deployed read path within 2pp of harness mode. Today this gap is unmeasured and believed large; closing it is worth more to users than the leaderboard delta.
- **HaluMem (write-path-ON mode): QA-stage hallucination ~7% to 3-4%, coverage held within 2pp.** Mechanism: supersession + ingest date normalization (wrong-date half), reconciliation (similar-but-stale candidates never exist), conflict sets + verifier (residual slot errors). Zep's 0.42% is directional evidence, not our claim: different stack, and our verifier cannot fix wrong selection on the legacy corpus. Always reported per-stage and paired with omission (Mem0's 0.03% hallucination at 54.6% omission is the refused trade).
- **LoCoMo v2: 24.2% baseline; +2 to +5pp expected** from fusion and second-hop. Low confidence, deliberately under-invested.
- **Latency:** p50 improves (keyword short-circuit removes the 3s expansion race and Phases 5-6 for simple lookups, most prod traffic); p95 on complex queries budgeted +300-900ms (rerank + verifier); chat perceived latency unchanged (post-stream verify).

## Phased roadmap with measurement gates

Track A (memory) and Track B (PMP/ownership) run in parallel so scope slip cannot zero out the differentiated work.

- **Phase 0 (weeks 1-2): C0 + C10 harness repair + DB cleanup.** Gate: repaired harness reproduces 85.0 ±1.0 on two fresh wallets (kill: nothing else proceeds until it does); canary green for one week on staging and prod; owner fence log-only week shows zero legitimate null-owner reads before enforce.
- **Phase 1 (weeks 2-5): C2 outbox + identity, migration 042 columns, boot freeze, backfills.** Gates: 99% of outbox jobs complete <5 min for a week; zero swallowed RPC errors in Pino; LongMemEval two-run mean ≥83.5 (no regression beyond noise; all changes additive, revert = stop the worker).
- **Phase 2 (weeks 4-9): read side, C3+C4+C5+C7, shadow dual-run then flip.** Gates: LongMemEval two-run mean ≥86.0 AND no category down >2pp AND Temporal ≥80 AND Multi ≥78. Proceed ≥86.0; iterate in 84-86; kill (flag revert to v1 scoring) <84.0. Prod shadow top-10 overlap reviewed before flip.
- **Phase 3 (weeks 7-11): C6 reader + prod-parity mode.** Gates: prod-parity within 2pp of harness mode; read-side HaluMem (write path still off) hallucination ≤4.5% with omission within 2pp of baseline; ≥90% of factual claims cited on sampled prod traffic. Kill: revert reader flag; conflict-set assembly stays (independently gated, prompt-only).
- **Phase 4 (weeks 9-14): C1 write path + C8 dream engine.** Gates: reconcile shadow false-positive supersession <2% on the 200-pair labeled sample sustained 2 weeks, then enforce; write-path-ON HaluMem hallucination ≤3.5% with coverage within 2pp; dream_logs duplicate-insight rate ~0 after cutover. Kill ladder: threshold 0.92, then same-fact_key-only UPDATE, then exact-dup-only floor with LLM routing off.
- **Track B1 (weeks 2-4): C9 crypto core + anchor signer.** Gates: round-trip CI green (export, import, re-export byte-stable, plain and encrypted); v1 packs verify unchanged; zero anchors signed by the treasury key.
- **Track B2 (weeks 6-10): provenance profile + export anchoring + citation chips/Solscan surface.** Gates: v2 round-trip green including supersession replay; a chat citation verifies against an anchored root end-to-end on staging.
- **Phase 5 decision gate (week 14): Observational Memory.** Trigger: if the two-run LongMemEval mean after Phases 2-4 is <89.0, OM starts immediately on the now-existing substrate. If ≥89.0, OM is still next; only its priority against the deferred pack index is revisited.

Effort honesty: component sums are ~22-26 engineer-weeks; with review, staging soaks, and deploys, ~14-16 calendar weeks for 2 engineers. Forced-cut order: C8 dream unification last-in (C1 already neutralizes its worst symptom), then C4 step-2 ONNX (keep LLM rerank), never C0, never Track B1.

## Migration: 745K prod memories + live PMP users

- **Snapshot first.** Full DB snapshot is the Phase 0 rollback.
- **Prune (repairs the VACUUM flaw).** Batched, throttled REST deletes of ~573K benchmark-wallet rows and ~127K demo rows plus their fragments (FK cascade); drop `memories_scale_bench`. Then copy-swap instead of VACUUM FULL: create `memories_v2` with the new columns and v2 constraints, copy the ~40K surviving rows, run a delta catch-up pass, swap names in one transaction inside a brief announced write pause (minutes), drop the old table after a soak. Fresh indexes come free; HNSW small-tenant starvation shrinks ~16x as a side effect. Fallback if copy-swap is rejected in review: batched deletes + plain VACUUM (space reused, not returned) and a scheduled maintenance window for VACUUM FULL.
- **Identity.** hash_id_v2 + content_hash minted during backfill; NOT NULL/unique on v2 only; the 5 duplicate legacy hash_ids stay untouched and are disambiguated by v2. No external reference (pack records, message memory_ids, title bindings) ever breaks.
- **Additive schema.** Migrations 042-047 all nullable-with-defaults; zero behavior change at deploy; DROP-FIRST on every RPC; the canary guards each one.
- **Entity rebuild.** Per-owner re-derivation via the outbox worker over the pruned corpus; ambiguous rows quarantined to the system wallet; global co-occurrence rows dropped only after the per-owner rebuild verifies.
- **Write-side rollout.** Reconciliation enforce applies to new writes only; the legacy corpus is never bulk retro-reconciled; supersession accrues organically and the dream sweep handles legacy conflicts at its own pace. Rollback: clear `invalid_at` + outbox replay.
- **Read-side rollout.** Everything behind flags; rollback is a flag flip; the v1 scoring path stays in code for one release.
- **Live PMP users.** Exports work unchanged throughout; provenance fields serialize when present; v1 verification untouched forever; v2 profile is opt-in per export after round-trip CI is green; sealed packs, holder keys, title NFTs, and marketplace flows are untouched; anchoring stays default-off until the dedicated keypair is funded and the treasury gate is enforced in code. No forced re-export, no pack invalidation, and nothing in this plan rewrites memory content: originals are immutable; only ranking, annotation, and additive metadata change.
- **Dream cutover.** Watermarks initialized to NOW; one dual-run cycle logged before hosted-dreams.ts deletion; historical duplicate insights collapsed by the reconciler's one-shot dedup, invalidate-not-delete.
- **Process.** Every phase is its own staging PR, board verifies on cludebot-test-preview, staging to main per the standard flow.

## Open questions

1. **Rerank economics:** measured per-message Haiku listwise cost at prod volume, and the threshold that triggers the ONNX worker build.
2. **Reconcile trigger rate:** what fraction of real conversational writes lands in the 0.85-0.95 band (shadow counter decides per-write vs per-window batching).
3. **fact_key derivation:** deterministic entity+attribute normalization vs router-assigned keys; collision and drift handling across extractor versions.
4. **Labeling:** who produces the 200-pair reconcile false-positive sample and at what cadence (board, contractor, or dogfood traffic with owner review).
5. **HNSW per-tenant recall after cleanup:** is the shrunken shared index plus the metadata lane sufficient, or do the largest tenants need partial indexes.
6. **Verifier correction UX:** visible correction block vs silently persisted fix; needs design review before Phase 3 ships.
7. **Marketplace DEKs (not zero-knowledge) and the Base/Solana split-brain:** confirmed out of scope here; both need a named owner as separately tracked opsec items.
8. **Phase 5 ordering:** OM vs the deferred pack-native index if the 89.0 gate passes; also whether OM's observation prefix changes the .pmp v2 record shape (decide before freezing the published spec).
