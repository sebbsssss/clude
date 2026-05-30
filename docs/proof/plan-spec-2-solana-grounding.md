# Spec 2 — Solana Grounding / 2% Hallucination Benchmark — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Produce a *real, reproducible* hallucination rate on Google BigQuery's public Solana dataset by comparing Clude-with-memory vs a no-memory baseline on exact-ground-truth Q&A, and expose it via `GET /api/proof/hallucination`, `/examples`, and a live `POST /api/proof/hallucination/ask`.

**Architecture:** A one-time `bq`-CLI export of a bounded slice of `bigquery-public-data.crypto_solana_mainnet_us` → committed JSONL fact fixture → deterministic Q&A generator (exact, machine-checkable answers) → a benchmark harness that seeds the facts as memories under an isolated wallet, recalls per question, answers via Haiku in 3 conditions (Clude-grounded / no-memory baseline / abstention probe), grades by exact match, and writes a results JSON + curated examples JSON. Three new endpoints read those committed fixtures (cached) and run a rate-limited live demo.

**Tech Stack:** TypeScript (ESM/NodeNext), `bq` CLI (gcloud, ADC), Supabase REST (`getDb()`), `@clude/brain/memory` (recall + direct insert), `@clude/shared/core/embeddings` (Voyage batch), `@clude/shared/core/openrouter-client` (`generateOpenRouterResponse`, Haiku), Express, Vitest 4.

**Spec:** `docs/proof/proof-features-design.md` §8. Implements **Spec 2** only. (Spec 3 builds the public `/proof.html` that surfaces this — note `apps/web/public/proof.html` does not yet exist; the chat chip already links to it.)

## ⚠️ Run-gates (these are not buildable in a bare worktree — flag to the human)
1. **Export run** needs `bq` (installed at `~/google-cloud-sdk/bin/bq`) + ADC (done). Produces a committed fixture. Cheap, within BigQuery free tier.
2. **Benchmark run** needs: `pnpm install` (workspace symlinks) + `pnpm --filter @clude/brain build` (the `@clude/brain/*` exports resolve to `dist/`), a reachable Supabase (`SUPABASE_URL`/`SUPABASE_SERVICE_KEY`), a Voyage key (`VOYAGE_API_KEY`/`EMBEDDING_API_KEY`), and an OpenRouter key (`OPENROUTER_API_KEY`) — and it spends model + embedding API calls. **This is the cost/side-effect knob.** The harness seeds into an **isolated benchmark wallet** and cleans up at the end.
3. Everything else (scripts' code, the grader, the endpoints, tests) is buildable + testable now.

## Conventions
Named exports; Pino `createChildLogger` (no `console.log` in `apps/`/`packages/` — but `misc/scripts/*` are CLI tools and may use `console.*`); owner-scoping via an isolated benchmark wallet; **honesty framing** in all copy (memory-vs-no-memory on the *same* model; abstention counts as *not* hallucinating); conventional commits; PRs target `staging`.

---

## File Structure

| File | Create/Modify | Responsibility |
|------|---------------|----------------|
| `misc/scripts/solana-bq-export.ts` | **Create** | One-time: `bq` query a bounded slice → write `misc/datasets/solana-bq/facts.jsonl` |
| `misc/datasets/solana-bq/facts.jsonl` | **Create (committed)** | The frozen fact corpus (a few thousand rows; force-added if needed) |
| `misc/scripts/lib/solana-qa.ts` | **Create** | Pure: `factToQA(fact)` templates + `gradeAnswer(category, gold, predicted)` deterministic grader |
| `misc/scripts/lib/__tests__/solana-qa.test.ts` | **Create** | TDD for the grader + templating |
| `misc/scripts/solana-qa-gen.ts` | **Create** | Reads facts.jsonl → writes `apps/web/public/proof/solana-qa.json` (the Q&A set) |
| `misc/scripts/solana-grounding-benchmark.ts` | **Create** | Seed → recall → answer (3 conditions) → grade → write results + examples fixtures |
| `apps/web/public/proof/solana-grounding-results.json` | **Create (committed)** | Benchmark summary (rate, baselineRate, byCategory, model, datasetVersion, runAt) |
| `apps/web/public/proof/solana-grounding-examples.json` | **Create (committed)** | Curated side-by-side examples (incl. one abstention) |
| `apps/server/src/lib/proof-hallucination.ts` | **Create** | Pure helpers: load+cache fixtures (readFileSync from webPublicDir), shape the API payloads |
| `apps/server/src/lib/__tests__/proof-hallucination.test.ts` | **Create** | TDD for fixture-loading + payload shaping |
| `apps/server/src/routes/proof.routes.ts` | **Modify** | Add `GET /hallucination`, `GET /hallucination/examples`, `POST /hallucination/ask` (+ `askLimiter`) |
| `apps/server/src/routes/__tests__/proof-routes.test.ts` | **Modify** | Add tests for the 3 new routes |

Sequencing: **Phase A** (export + Q&A) → **Phase B** (benchmark run → fixtures) → **Phase C** (endpoints). C is buildable against a small committed *sample* fixture before B's real run lands. Likely **two PRs to staging**: (A+C scaffold with sample data) then (B real fixtures) — or one PR if the run completes first.

---

## PHASE A — Data + Q&A

### Task A1: BigQuery export script

**Files:** Create `misc/scripts/solana-bq-export.ts`; output `misc/datasets/solana-bq/facts.jsonl`.

Goal: pull a **bounded, deterministic** slice (fixed slot range so it's reproducible against the frozen 2025-03-31 snapshot) of exact facts across Blocks/Transactions/Accounts/Tokens. Shell out to `bq` (no new deps).

- [ ] **Step 1: Write the script.** Use `execFileSync('~/google-cloud-sdk/bin/bq' resolved via `os.homedir()`, ['query','--use_legacy_sql=false','--format=json','--max_rows=5000','--project_id=clude-query-sol-data', SQL])`. Run ~4 bounded queries (one per category) over a **fixed slot window** (pick a window with confirmed data before 2025-03-31, e.g. `block_slot BETWEEN A AND B` chosen so each returns a few hundred rows). Example (Transactions):
```sql
SELECT signature, block_slot, fee, status, compute_units_consumed
FROM `bigquery-public-data.crypto_solana_mainnet_us.Transactions`
WHERE block_slot BETWEEN @lo AND @hi AND signature IS NOT NULL
LIMIT 400
```
Blocks: `slot, block_timestamp, leader, transaction_count, block_hash`. Accounts: `pubkey, owner, lamports, executable, program` (WHERE owner IS NOT NULL). Tokens: `mint, name, symbol, is_nft` (WHERE symbol IS NOT NULL). Tag each row with a `category` field and a stable `id`. Write one JSON object per line to `misc/datasets/solana-bq/facts.jsonl`. Log row counts per category.
- [ ] **Step 2: Self-check the SQL offline** (table names are **capitalized with spaces** — quote `` `...Block Rewards` `` etc.; we only use the no-space tables here). Confirm column names against the verified schema (Blocks.slot/block_timestamp/leader/transaction_count/block_hash; Transactions.signature/fee/status/compute_units_consumed; Accounts.pubkey/owner/lamports/executable; Tokens.mint/symbol/name/is_nft).
- [ ] **Step 3: RUN the export** (run-gate #1; `bq` + ADC available). Verify `facts.jsonl` has rows across all 4 categories. *(If `bq` PATH fails, use the absolute `~/google-cloud-sdk/bin/bq`.)*
- [ ] **Step 4: Commit** (force-add the dataset dir if gitignored, like migrations):
```bash
git add misc/scripts/solana-bq-export.ts
git add -f misc/datasets/solana-bq/facts.jsonl
git commit -m "feat(bench): one-time BigQuery export of Solana fact corpus"
```

### Task A2: Q&A generator + deterministic grader (TDD)

REQUIRED SUB-SKILL: @superpowers:test-driven-development

**Files:** Create `misc/scripts/lib/solana-qa.ts` + `misc/scripts/lib/__tests__/solana-qa.test.ts`; then `misc/scripts/solana-qa-gen.ts`.

- [ ] **Step 1: Write failing tests** for `gradeAnswer(category, gold, predicted)` and `factToQA(fact)`:
```ts
import { describe, it, expect } from 'vitest';
import { gradeAnswer, factToQA } from '../solana-qa.js';

describe('gradeAnswer', () => {
  it('numeric: matches fee ignoring separators/units', () => {
    expect(gradeAnswer('tx_fee', '5000', 'The fee was 5,000 lamports')).toBe(true);
    expect(gradeAnswer('tx_fee', '5000', '4999')).toBe(false);
  });
  it('pubkey: case-SENSITIVE base58 match (program owner)', () => {
    expect(gradeAnswer('account_owner', 'Vote111111111111111111111111111111111111111', 'Vote111111111111111111111111111111111111111')).toBe(true);
    expect(gradeAnswer('account_owner', 'Vote111111111111111111111111111111111111111', 'vote111111111111111111111111111111111111111')).toBe(false);
  });
  it('symbol: case-insensitive token symbol', () => {
    expect(gradeAnswer('token_symbol', 'USDC', 'usdc')).toBe(true);
  });
  it('status: success/fail synonyms', () => {
    expect(gradeAnswer('tx_status', 'Success', 'it succeeded')).toBe(true);
  });
  it('abstention: an "I do not know" answer never counts as correct on a real fact', () => {
    expect(gradeAnswer('tx_fee', '5000', "I don't have enough information")).toBe(false);
  });
});

describe('factToQA', () => {
  it('builds an exact-ground-truth question from a tx fact', () => {
    const qa = factToQA({ category: 'tx_fee', signature: 'abc', fee: '5000' });
    expect(qa.question).toContain('abc');
    expect(qa.gold).toBe('5000');
    expect(qa.category).toBe('tx_fee');
  });
});
```
- [ ] **Step 2: Run → fail.** `cd misc/scripts && <vitest> run lib/__tests__/solana-qa.test.ts` (no node_modules in worktree → use the main repo's vitest binary; if `misc/scripts` has no test setup, run from a package that does, pointing at the file — confirm during impl).
- [ ] **Step 3: Implement `solana-qa.ts`.** `factToQA(fact)` maps each `category` to `{ id, category, question, gold, sourceRef }` using the templates from the design (block_time, tx_fee, tx_status, account_owner, token_supply/symbol). `gradeAnswer(category, gold, predicted)`: normalize per category — numeric (strip commas/units, parse, `===`), base58 (case-sensitive substring/equality; optionally validate with `PublicKey`), symbol/text (lowercase, trim, substring), status (map success/ok/succeeded↔fail/error/failed). Return boolean. Also export `isAbstention(text)` (detects "don't know / not enough info") for the abstention-condition scoring. Keep it pure.
- [ ] **Step 4: Run → pass.**
- [ ] **Step 5: Write `solana-qa-gen.ts`** — read `facts.jsonl`, map each via `factToQA`, drop any with empty/unusable gold, write `apps/web/public/proof/solana-qa.json` = `{ datasetVersion: 'crypto_solana_mainnet_us@2025-03-31', generatedFrom: 'facts.jsonl', count, items: QA[] }`. Run it; verify the JSON.
- [ ] **Step 6: Commit.**
```bash
git add misc/scripts/lib/solana-qa.ts misc/scripts/lib/__tests__/solana-qa.test.ts misc/scripts/solana-qa-gen.ts apps/web/public/proof/solana-qa.json
git commit -m "feat(bench): deterministic Solana Q&A generator + grader (TDD)"
```

---

## PHASE B — Benchmark harness (run-gated)

### Task B1: The grounding benchmark script

**Files:** Create `misc/scripts/solana-grounding-benchmark.ts`. Outputs `apps/web/public/proof/solana-grounding-results.json` + `solana-grounding-examples.json`.

This is a **fresh** script (do NOT reuse the stale `locomo-benchmark.ts`; `longmemeval-benchmark.ts` is a *reference* for patterns only). It uses the brain via the workspace package.

- [ ] **Step 1: Seeding.** Read `solana-qa.json`. For each fact, build a memory row and **direct-insert** in batches of 50: `db.from('memories').insert(rows)` with `memory_type: 'semantic'`, `content` = a natural-language statement of the fact (e.g. "Transaction abc… paid a fee of 5000 lamports."), `summary` = same (truncated), `tags: ['solana-grounding', category]`, `source: 'solana-grounding-benchmark'`, `owner_wallet: BENCHMARK_WALLET` (a **distinctive non-base58 sentinel** like `'bench:solana-grounding'` so a mis-run can never collide with a real user's wallet), `importance: 0.6`, `compacted: false`, `evidence_ids: []`. **Do NOT set `provider_delegated`** (NULL passes recall's filter). Capture inserted ids.
- [ ] **Step 2: Embed.** Batch-embed the seeded `content` via `generateEmbeddings(texts)` from `@clude/shared/core/embeddings` (configure provider from env), then `db.from('memories').update({ embedding: JSON.stringify(vec) }).eq('id', id)` per row. (Embeddings are required for precise exact-fact recall.) Poll/confirm `embedding IS NOT NULL` count.
- [ ] **Step 3: Per-question, 3 conditions** (import `withOwnerWallet` from `@clude/shared/core/owner-context`; it returns `T | Promise<T>`, so `await` it: `await withOwnerWallet(BENCHMARK_WALLET, () => recallMemories({ query: question, limit: 10, skipExpansion: true }))`):
  - **Clude-grounded**: format recalled memories into a context block (reuse `formatMemoryContext` or a local join of `m.content`), call `generateOpenRouterResponse({ systemPrompt: GROUNDED_SYS, messages:[{role:'user', content: \`Context:\n${ctx}\n\nQuestion: ${q}\n\nAnswer:\`}], model: OPENROUTER_MODELS['claude-haiku-4.5'], temperature: 0, maxTokens: 200 })`. Grade with `gradeAnswer`.
  - **No-memory baseline**: same model + question, NO context, a neutral system prompt (no "the answer is present" assertion). Grade.
  - **Abstention probe** (subset): ask Clude a fact that was NOT seeded (hold out ~10% of facts from seeding) → correct behavior is `isAbstention()` true → counts as **not** a hallucination.
  - **Model id correction**: through OpenRouter use `anthropic/claude-haiku-4.5` (the dated `claude-haiku-4-5-20251001` is only valid on the direct Anthropic SDK path). Haiku ⇒ no Opus temperature-strip issue.
- [ ] **Step 4: Metrics.** `hallucination_rate` = (confidently-wrong Clude answers) / (non-abstaining Clude answers); also `baselineRate` (baseline wrong rate); per-category breakdown; abstention accuracy. Write `solana-grounding-results.json` = `{ rate, baselineRate, n, model:'anthropic/claude-haiku-4.5', datasetVersion, runAt, byCategory }` and `solana-grounding-examples.json` = a curated ~8-item set `{ id, category, question, groundTruth, sourceRef, clude:{answer,correct}, baseline:{answer,correct} }[]` (include ≥1 abstention example).
- [ ] **Step 5: Cleanup.** Delete the benchmark corpus with a **paginated** loop (`select id … limit 1000` → delete → repeat until empty) scoped to `owner_wallet = BENCHMARK_WALLET` (per the MEMORY.md cleanup-pagination bug — a single delete only hits 1000 rows). Make cleanup a `--cleanup`/`finally` step.
- [ ] **Step 6: RUN** (run-gate #2 — needs pnpm install + brain build + DB + Voyage + OpenRouter; spends API). Start with a small N (e.g. `--limit 60`) to produce the first real number. Verify the two fixtures are written + sane.
- [ ] **Step 7: Commit** the script + the produced fixtures.
```bash
git add misc/scripts/solana-grounding-benchmark.ts
git add apps/web/public/proof/solana-grounding-results.json apps/web/public/proof/solana-grounding-examples.json
git commit -m "feat(bench): Solana grounding benchmark (seed/recall/answer/grade) + result fixtures"
```

> If the run can't happen yet, commit the script with **placeholder sample fixtures** (clearly labeled `"placeholder": true`, e.g. rate 0.02 with 3 illustrative examples) so Phase C can build/test; replace with real output when the run lands. The endpoints must surface `placeholder` honestly (the design's honesty rule).

---

## PHASE C — Endpoints

### Task C1: Fixture-loading helper (TDD)

REQUIRED SUB-SKILL: @superpowers:test-driven-development

**Files:** Create `apps/server/src/lib/proof-hallucination.ts` + test.

- [ ] **Step 1: Failing test** — `loadHallucinationData(dir)` reads `solana-grounding-results.json` + `solana-grounding-examples.json` from a given dir and returns `{ results, examples }`; on missing files returns a safe default `{ results: null, examples: [] }` (no throw). Test with a tmp dir containing sample JSON + a missing-dir case.
- [ ] **Step 2: Run → fail.**
- [ ] **Step 3: Implement.** `readFileSync`+`JSON.parse` guarded in try/catch. Resolve the fixtures from the **deployed webPublicDir** the way `static.routes.ts` does (`path.join(__dirname, '..', ...)` accounting for `dist/` vs `src/` — copy that resolution). Cache parsed results in module scope.
- [ ] **Step 4: Run → pass. Step 5: Commit.**

### Task C2: The three routes (TDD)

**Files:** Modify `apps/server/src/routes/proof.routes.ts` + `__tests__/proof-routes.test.ts`.

- [ ] **Step 1: Failing tests** (extend the existing test file; mock `getDb`, the fixture loader, and `generateOpenRouterResponse`):
  - `GET /api/proof/hallucination` → 200, returns `{ rate, baselineRate, n, model, datasetVersion, byCategory }` from the loaded results (or a safe default when fixture missing).
  - `GET /api/proof/hallucination/examples` → 200, returns the examples array (cap `?n=`).
  - `POST /api/proof/hallucination/ask` with `{ questionId }` → recalls (mocked) + answers (mocked Haiku for both conditions) → `{ question, groundTruth, clude:{answer,correct}, baseline:{answer,correct}, hallucinated }`. Test the rate-limit wrapper exists (don't exhaust it) + input-length cap (oversized `question` → 400).
- [ ] **Step 2: Run → fail. Step 3: Implement** the 3 handlers in `proofRoutes()` (mirror the existing TTL-cache + always-200-with-fallback style). Add `const askLimiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false })` and attach to the POST route (stacks atop the global 200/min). For `/ask`: cap question length (e.g. 500 chars), scope to the corpus (accept `questionId` from the Q&A set, or a free-text `question` graded only if it maps to a known fact), use `generateOpenRouterResponse` with `anthropic/claude-haiku-4.5`, `temperature: 0`. Grade via the shared `gradeAnswer` (import the pure helper — consider relocating `solana-qa.ts`'s grader into a shared spot both `misc/scripts` and `apps/server` can import, or duplicate the small grader; decide during impl and note it). Cache repeated questions.
- [ ] **Step 4: Run → pass (full server `tsc --noEmit` 0 errors — annotate `await r.json()` as `any` in new tests, per the Spec 1 lesson). Step 5: Commit.**

### Task C3: Final review + verification
- [ ] Final holistic review across Phase A–C (definition/contract consistency: grader used by both benchmark + `/ask`; fixture shapes match what routes read; honesty copy; `placeholder` surfaced if real run pending).
- [ ] If real run done: `curl /api/proof/hallucination` + `/examples` + one `/ask`. Confirm shapes + that the rate is real.
- [ ] Ship to `staging` via `/ship` (PR body notes: the benchmark is a dev/offline run; fixtures are committed; `/ask` is rate-limited + Haiku; honesty framing).

---

## Risks & open decisions (surface at the plan-review gate)
- **Run scope/cost** (the knob): how many Q&A (`--limit`)? Recommend a small first run (~60) for a real headline, expand later. The run seeds+cleans an isolated wallet on the live Supabase and spends Haiku+Voyage calls.
- **Grader sharing**: `gradeAnswer` is needed in both `misc/scripts` (benchmark) and `apps/server` (`/ask`). Decide: move it to `packages/shared` (clean, importable by both) vs duplicate the ~30 lines. Recommend `packages/shared/src/core/` for one source of truth.
- **Fixture deploy path**: fixtures live under `apps/web/public/proof/` (deployed static) and are read by the server via the `static.routes.ts` `__dirname` resolution — verify that path resolves in the Railway build (dist layout).
- **proof.html dead link**: the chat "all-time" chip already links to `/proof.html` which doesn't exist until Spec 3. Out of scope here; note for Spec 3.
- **Honesty**: if shipping before the real run, fixtures MUST be marked `placeholder` and the endpoint must say so — never present a fabricated 2% as measured.
