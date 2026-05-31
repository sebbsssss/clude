# Design: Proof Features — Live Tokens-Saved Counter + Solana Grounding Demo

- **Date:** 2026-05-30
- **Author:** Sebastien (with Claude)
- **Status:** Approved design → ready for spec planning
- **Scope note:** This is a **program-level design** that intentionally decomposes into **three sequential specs** (§13). Each spec gets its own implementation plan and ships independently. This document is the shared vision + architecture; it is not itself a single-plan spec.

---

## 1. Context & Problem

Clude is persistent cognitive memory for AI agents. Two of its strongest, most concrete value claims are currently **invisible to outsiders and only partially built**:

1. **Token savings.** Memory compression cuts the context a model must re-read each turn. On high-usage sessions this averages **~82%**. The chat product already shows a per-message "−N tok saved" footer and a "saved today" chip, but there is **no global, cumulative, live "tokens saved to date" number** anywhere, and nothing public.
2. **Low hallucination.** Grounding answers in retrieved memory drives hallucination down to **~2%** (i.e. ~98% grounded-or-abstain). We have benchmark machinery (LongMemEval) but **no public, interactive, self-serve demonstration**, and nothing tied to a credible external dataset.

We will build both as **public proof showcases**: a headline live metric + an interactive "see it / try it yourself" demo, centered on a new public page and echoed as widgets across all three frontends.

## 2. Goals / Non-Goals

**Goals**
- A **real**, cumulative, live-ticking "total tokens saved to date" counter, sourced from actual usage.
- A **reproducible 2% hallucination measurement** on Google BigQuery's public Solana dataset, with hard ground truth.
- A **public, self-serve page** (`/proof.html`) where anyone can watch the metrics, run both demos themselves, and read exactly what data and method we used (citations).
- The same counter surfaced on the landing hero, the dashboard, and the chat product.
- Intellectual honesty: every claim survives scrutiny.

**Non-Goals**
- No new design system — reuse the existing `apps/web` static-site tokens and component patterns.
- No real-time chain indexing — the Solana dataset is treated as a **static historical snapshot** (it froze 2025-03-31, which is ideal for a reproducible benchmark).
- No auth/paywall on the proof page — it is public.
- Not changing the recall/memory engine itself; we measure and surface it.

## 3. Grounding — what exists today (verified)

| Area | Finding | File |
|------|---------|------|
| Per-message savings UI | `saved = frontier − clude` footer, shown when `saved > 0` | [`apps/chat/src/v2/CcMessage.tsx:34`](../../apps/chat/src/v2/CcMessage.tsx) |
| "Saved today" chip | `CcSavingsChip` in topbar | `apps/chat/src/v2/atoms.tsx`, `CcChat.tsx` |
| Savings computed server-side | `frontier_tokens = promptTokens + memoriesUsed × 300`; `savings_pct` is **cost**-based vs an Opus baseline | [`apps/server/src/routes/chat.routes.ts:1190`](../../apps/server/src/routes/chat.routes.ts) |
| **Savings NOT persisted** | DB insert stores `tokens_prompt`/`tokens_completion`/`cost_usdc` only — **not** `frontier_tokens` or `memories_used` | [`chat.routes.ts:1262`](../../apps/server/src/routes/chat.routes.ts) |
| Tables | `chat_messages`, `chat_usage` exist | `chat.routes.ts` |
| Dashboard stats | `/api/dashboard/stats` returns agents/tasks/budget — **no token total** | `apps/server/src/routes/dashboard.routes.ts` |
| Benchmark machinery | LongMemEval harness; accuracy/F1; "hallucination" ≈ 100% − accuracy. **No Solana dataset, no grounded-vs-hallucinated demo** | `misc/scripts/longmemeval-benchmark.ts` |
| **`apps/web` is a static site** | `public/*.html` standalone pages sharing `styles.css` + design tokens (`--blue:#2244ff`, Funnel Sans/Inconsolata); call server via same-origin `/api/...` | `apps/web/public/` |
| Existing demo pattern | `demo.html` does live store/recall against `/api/demo/*`; `live-demo.js` is a **client-side simulated** compaction visualizer; `benchmark.html` exists | [`apps/web/public/live-demo.js`](../../apps/web/public/live-demo.js), `demo.html` |
| Solana BigQuery dataset | `bigquery-public-data.crypto_solana_mainnet_us`, **frozen 2025-03-31**; parsed tables (blocks, transactions, accounts, token transfers/mints) | external |

**Two implications that shape the design:**
- "Real aggregate" requires **new persistence**; exact historical backfill is impossible (`memories_used` was never recorded) → we use a **documented hybrid baseline** (§7.3).
- The proof page is a **new static HTML page reusing the `live-demo.js` / `demo.html` pattern with real API numbers** — no React build.

## 4. Architecture — backend truth + thin per-app renderers (Approach A)

The three frontends are **isolated** (own `node_modules`; must not import from `src/`; HTTP-only). Therefore "shared component" ≠ one imported React component. Instead:

- **One source of truth:** a new server route module `proof.routes.ts` mounted at `/api/proof/*` (mirrors the existing `/api/demo/*` convention).
- **Thin per-app renderers:** each surface implements its own small presentational view hitting those endpoints — vanilla JS for `apps/web` (matches the static-site pattern), small React components for `apps/dashboard` and `apps/chat`.
- **"Live" feel:** clients poll the metric endpoint every ~10 s and animate the number upward between polls using a returned `ratePerMin`. (SSE is a later upgrade, not v1.)

Rejected alternatives: a `packages/proof-ui` shared package (violates the documented isolation rule); an iframe/web-component widget (styling friction, feels bolted-on).

## 5. Surfaces

### 5.1 The Proof page — `apps/web/public/proof.html` (+ `proof.js`)

A new static page reusing existing design tokens. Five sections, top to bottom:

1. **Hero — live counter.** Large "**N tokens saved to date**" ticking upward + subhead "Clude's memory cuts context by ~82% on high-usage sessions." Source: `GET /api/proof/tokens-saved`.
2. **Try it — token savings.** An evolution of `live-demo.js` from *simulated* to *real*: user pastes a conversation, picks a preset, or chooses "use a representative high-usage session" → the page shows **baseline full-history re-read vs Clude's recalled context** with a real per-turn breakdown and the headline % for that session.
3. **2% hallucination — proven on Solana data.** Side-by-side **No-memory LLM ✗ / Clude ✓** with a running tally across the curated set. Controls: **"Shuffle a real on-chain fact"** and **"Ask your own"** — both run live and reveal the exact ground truth plus a "view the on-chain row" citation.
4. **The data & method (citations).** Dataset name + snapshot date, tables used, how ground truth is derived, model + run date, and external links (§15). Each demo answer links back to its source on-chain row.
5. **CTAs.** Docs + get an API key.

### 5.2 Embedded counters (drive traffic to the proof page)

- `apps/web/public/index.html` hero: compact live counter + "See the proof →".
- `apps/dashboard`: a stat card on the main Dashboard page (uses the existing `useCounter()` animation helper) + link.
- `apps/chat`: extend the existing topbar/savings UI with a **cumulative total** (today's chip already exists) + link.

All four read the same `/api/proof/tokens-saved` endpoint.

## 6. Backend API contract — `/api/proof/*`

All read endpoints are public-safe and cacheable. `POST /ask` is rate-limited (§8.5).

| Endpoint | Returns |
|----------|---------|
| `GET /api/proof/tokens-saved` | `{ totalSaved: number, savedToday: number, avgSavingsPct: number, ratePerMin: number, baselineEstimated: number, updatedAt: ISO8601 }` |
| `GET /api/proof/hallucination` | `{ rate: number, baselineRate: number, n: number, model: string, datasetVersion: string, runAt: ISO8601, byCategory: Record<string,{rate,n}> }` |
| `GET /api/proof/hallucination/examples?n=` | `Array<{ id, category, question, groundTruth, sourceRef, clude:{answer,correct,citationMemoryId}, baseline:{answer,correct} }>` (curated, instant, free) |
| `POST /api/proof/hallucination/ask` | body `{ questionId? , question? }` → `{ question, groundTruth, sourceRef, clude:{answer,correct,citationMemoryId}, baseline:{answer,correct}, hallucinated:boolean }` |

`tokens-saved` values are served from a server-side cached aggregate refreshed every N seconds (not a per-request full table scan).

## 7. Subsystem A — Tokens Saved

### 7.1 What "saved" means (resolved decision)

The existing code has two different notions: a **cost** savings % (cheaper model vs Opus) and a **token** compression heuristic (`memories × 300`). The counter is about **tokens**, so we define it precisely and defensibly:

For an assistant turn *t* in conversation *c*:
- `baseline_context_tokens(t)` = Σ `(tokens_prompt + tokens_completion)` of all prior messages in *c* + this turn's user-message tokens — i.e. the full transcript a **memoryless** agent must re-send each turn.
- `clude_context_tokens(t)` = the actual `tokens_prompt` for this turn (system + current user message + recalled memories — **not** the full prior transcript).
- `tokens_saved(t)` = `max(0, baseline_context_tokens(t) − clude_context_tokens(t))`.

This naturally yields ~80%+ on long/high-usage sessions (where re-sending history dominates), matching the cited 82%, and is honest: it is exactly the context a no-memory agent would burn that Clude avoids. The simpler per-message footer heuristic in `CcMessage.tsx` should be **aligned to this definition** as part of Spec 1 so the chat numbers and the counter agree.

### 7.2 Persistence

Migration (next numbered SQL in `packages/database/migrations/` — latest is `025_redelegate_rpc.sql`, so this is `026_*`): add to `chat_messages`:
- `frontier_tokens INT` (= `baseline_context_tokens`)
- `memories_used INT`
- `tokens_saved INT` (= computed at write per §7.1, floored at 0)

Write these in the existing assistant-message insert ([`chat.routes.ts:1262`](../../apps/server/src/routes/chat.routes.ts)). `baseline_context_tokens` is computed with one scoped query summing prior `chat_messages` tokens for the `conversation_id` (owner-scoped). Note the insert already writes a `memory_ids` array; `memories_used` is the scalar count (`memory_ids.length`) — write both so they don't drift.

### 7.3 Aggregate + live tick + baseline (hybrid)

- **Aggregate:** server keeps an in-memory cached total = `SUM(tokens_saved)`, refreshed every N seconds (and `savedToday`, `avgSavingsPct = Σsaved / Σbaseline`). O(1) reads.
- **`ratePerMin`:** derived from the last interval's delta; the client animates between polls so the number visibly ticks.
- **Hybrid baseline (resolved):** historical messages lack the inputs to reconstruct exact savings. We seed a **one-time documented estimate** = `SUM(tokens_prompt) over historical chat_messages × the measured avg savings ratio`, exposed as `baselineEstimated`, then accumulate **real** `tokens_saved` on top going forward. The page tooltip discloses the split ("X estimated from history + Y measured since <date>"). This gives an impressive-but-defensible opening number without misrepresentation.

### 7.4 Interactive demo (page section 2)

Reuse the `live-demo.js` structure but replace the simulated math with real figures: for a chosen/pasted session, show the per-turn baseline-vs-Clude context and the resulting %. A bundled "representative high-usage session" preset guarantees a stable ~82% demo without depending on any private conversation. No new model calls are required for this section (it visualizes token accounting).

## 8. Subsystem B — Solana Grounding / 2% Hallucination

### 8.1 Data acquisition (one-time, committed fixture)

A script (`misc/scripts/solana-bq-export.ts`) runs bounded BigQuery queries against `bigquery-public-data.crypto_solana_mainnet_us` over a fixed block range and writes a committed JSONL fixture under `misc/datasets/solana-bq/` (blocks, transactions, accounts, token mints). After this one-time export the benchmark runs **offline** and reproducibly; live BigQuery creds are needed only to (re)generate the fixture. The fixture size is bounded (target a few thousand facts) and documented.

### 8.2 Q&A generation with hard ground truth

`misc/scripts/solana-qa-gen.ts` deterministically templates question/answer pairs from fixture rows, where every answer is an **exact, machine-checkable** value a memoryless model cannot guess:

| Category | Question template | Ground truth |
|----------|-------------------|--------------|
| `block_time` | "What was the block time (UTC) of slot `<slot>`?" | exact timestamp |
| `tx_fee` | "What fee in lamports did transaction `<sig>` pay?" | exact int |
| `tx_status` | "Did transaction `<sig>` succeed or fail?" | success/fail |
| `account_owner` | "Which program owns account `<addr>`?" | exact program id |
| `token_supply` | "What are the decimals of token mint `<mint>`?" | exact int |

Exact-match (with light normalization) grading → **no LLM judge needed** for most categories → objective and cheap.

### 8.3 Conditions

1. **Clude (grounded):** seed the facts as memories under a dedicated benchmark wallet → recall → answer. Correct when the recalled fact is used.
2. **Baseline (no memory):** same model, no memory access → must fabricate or refuse on unguessable on-chain specifics.
3. **Abstention probe:** ask Clude facts that were **not** seeded → a correct response is "not enough information," which counts as **not** a hallucination. This captures the real product behavior: ground-or-abstain, never fabricate.

### 8.4 Metric

- `hallucination_rate` = fraction of answers that are **confidently wrong** (a specific fabricated value that ≠ ground truth; correct abstentions excluded). Target for Clude ≈ **2%**.
- `baselineRate` reported alongside for contrast (expected to be high).
- Per-category breakdown stored. A curated subset (mix of categories, including one abstention example) is frozen as the `examples` payload for the UI.

### 8.5 Live "Ask your own" + guardrails

`POST /api/proof/hallucination/ask` runs one question through both conditions live. Because it makes real model calls on public input:
- Reuse the repo's existing express-rate-limit; add a **tighter per-IP cap + a daily ceiling** on this route specifically.
- **Cap input length**; scope to the Solana corpus (the UI offers "pick/shuffle a real fact" and an "ask about this data" box, not free-form arbitrary prompts).
- Use a **cheap, fast model** for both conditions — pin `claude-haiku-4-5-20251001` (Haiku 4.5) so the API contract's `model`/`datasetVersion` stay stable and reproducible; keeps cost low and the grounding gap is still stark. (If any benchmark run uses an Opus model, strip `temperature`/`top_p` at the SDK boundary per the repo's Opus constraint.)
- **Cache** by normalized question so repeats are free. The curated `examples` set is fully static and free.

## 9. Honesty framing (applies to all copy)

The hallucination claim is stated precisely: *"With memory, the same model grounds to ~98% and **abstains instead of fabricating**; without memory it confidently makes facts up."* Not "Clude is a smarter model." The comparison is memory-vs-no-memory on the **same** model, with exact ground truth shown. This is consistent with the team's prior practice of correcting inflated benchmark numbers and keeps the demo credible under adversarial scrutiny.

## 10. Data flow

```
Tokens Saved:
  chat turn → chat.routes insert (frontier_tokens, memories_used, tokens_saved)
            → cached aggregate (refresh every N s)
            → GET /api/proof/tokens-saved → web/dashboard/chat counters (poll + animate)

Grounding (build time):
  BigQuery snapshot → solana-bq-export.ts → committed JSONL fixture
                    → solana-qa-gen.ts → Q&A set (exact ground truth)
                    → benchmark harness (Clude / baseline / abstention)
                    → rate + byCategory + curated examples (stored)

Grounding (runtime):
  GET /hallucination, /examples  → proof.html side-by-side (instant, free)
  POST /hallucination/ask        → live both-conditions (rate-limited, cached, Haiku)
```

## 11. Error handling & edge cases

- **No usage yet / aggregate cold:** endpoint returns `baselineEstimated` + `totalSaved:0`; counter still renders a sensible number.
- **`tokens_saved` negative** (short turns, completion-heavy): floored at 0 so the aggregate never decreases.
- **Recall returns nothing in `/ask`:** Clude answers "not enough information" (counts as grounded/abstain, not hallucination).
- **Baseline refuses** (won't guess): counts as not-correct but not a fabricated hallucination; tracked separately from confidently-wrong.
- **BigQuery fixture missing:** benchmark + `/hallucination*` endpoints fail loudly with a clear message; the page degrades to showing the last stored run rather than erroring the whole page.
- **Rate limit hit on `/ask`:** 429 with a friendly "try the curated examples" fallback in the UI.
- **Owner scoping:** the benchmark wallet is isolated; the public read endpoints expose only aggregate/curated data, never per-user memories.

## 12. Testing

- **Spec 1:** unit tests for `tokens_saved` computation (incl. negative→0, first-turn, long-session); aggregate refresh; `/api/proof/tokens-saved` shape. Mock Supabase per existing Vitest patterns.
- **Spec 2:** Q&A generator determinism (same fixture → same Q&A); exact-match grader (normalization, units); abstention scoring; a small fixture slice committed for CI so the harness runs without BigQuery.
- **Spec 3:** endpoint contract tests for `/hallucination`, `/examples`, `/ask` (rate-limit + cache behavior, input cap); a lightweight DOM smoke test of `proof.js` wiring if feasible, else manual QA via the browse skill.

## 13. Decomposition — three specs, sequenced

Each spec respects the repo limits (≤15 files / ≤400 diff lines), targets `staging`, and is independently plannable.

1. **Spec 1 — Proof API + live tokens-saved counter.** Migration + persistence (§7.2) + cached aggregate + `GET /api/proof/tokens-saved` + align the chat footer (§7.1) + counters on web hero, dashboard, chat. **Ships standalone value.**
2. **Spec 2 — Solana grounding benchmark.** BigQuery export + committed fixture + Q&A generation + benchmark harness + `GET /api/proof/hallucination` & `/examples` + stored run. **Produces the 2% number.** Needs GCP creds once.
3. **Spec 3 — The Proof page.** `proof.html` + `proof.js`: live counter hero, real token-savings demo, grounding side-by-side, "ask your own" (`POST /ask` + guardrails §8.5), citations panel (§5.1, item 4). **Ties it together.**

**Sequence:** 1 → 2 → 3 (Spec 3 depends on both). Spec 1 is the lowest-risk, fastest win.

## 14. Risks & open questions

- **Frontier model choice (§7.1):** the new baseline definition supersedes the shipped `memories × 300` heuristic. Risk: aligning the chat footer changes numbers users have seen. Mitigation: align in Spec 1, note in changelog. *(Resolved: align.)*
- **Baseline estimate optics (§7.3):** the seeded historical estimate must be clearly labeled or it reads as inflated. Mitigation: tooltip discloses the estimated/measured split. *(Resolved: hybrid + disclosure.)*
- **BigQuery access:** needs a GCP project/creds for the one-time export; flagged in Spec 2. After export, runs offline.
- **`/ask` cost/abuse:** mitigated by rate limit + corpus scoping + Haiku + cache (§8.5).
- **Dataset staleness messaging:** the snapshot is historical (frozen 2025-03-31); copy must present it as a historical snapshot, not live chain state.

## 15. Citations / references

- Google Cloud Marketplace — Solana Blockchain (Community Dataset): https://console.cloud.google.com/marketplace/product/bigquery-public-data/crypto-solana-mainnet-us
- Solana × Google Cloud BigQuery announcement: https://solana.com/news/solana-data-live-on-google-cloud-bigquery
- Dataset id: `bigquery-public-data.crypto_solana_mainnet_us` (snapshot frozen 2025-03-31)
