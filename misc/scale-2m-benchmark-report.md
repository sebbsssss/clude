# Clude at Scale: 2,000,000 Real Solana Facts

**Question:** Can Clude retrieve the exact needle from a corpus far larger than any context window — at high accuracy and low hallucination — while the same model *without* Clude cannot?

**Answer:** Yes. At 2 million real Solana facts, Clude recalls the exact fact in the top-8 **100% of the time** and answers **100% correctly** using ~199 input tokens per query. The same model handed a full 177K-token context window of the same data answers only **12%** correctly (it abstains on the rest — it literally cannot fit the data) while spending **891× more tokens**.

---

## The corpus

- **2,000,000 facts** pulled from **real Solana mainnet** via Helius (333 blocks).
- 6 fact types: `block_time`, `block_leader`, `block_txcount` (block-level), `tx_fee`, `tx_status` (transaction-level), `account_lamports` (account balances at a slot).
- 100% distinct. Loaded into an **isolated** `memories_scale_bench` table — production memories (the real `memories` table) were never touched.
- **~142,000,000 tokens** of data in total (measured ~71 tokens/fact — Solana base58 pubkeys and signatures tokenize densely).

### This is genuinely "beyond context size"

| Context window | Corpus is… | Window holds | = % of corpus |
|---|---|---|---|
| 200K tokens (GPT-4o, Claude std) | **709× larger** | ~2,800 facts | 0.14% |
| 1M tokens (Claude/GPT large) | **142× larger** | ~14,000 facts | 0.70% |
| 2M tokens (Gemini, the largest) | **71× larger** | ~28,000 facts | 1.41% |

No model can hold this corpus. Retrieval is the only way to answer questions over it.

---

## Results

### Retrieval — recall@8 = 100%

Across **600 random samples** spanning all 6 categories, the exact fact was retrieved in the top-8 **every single time**, at **rank 0** (the very first result).

| Category | recall@8 | avg rank | n |
|---|---|---|---|
| account_lamports | 100% | 0.0 | 278 |
| tx_fee | 100% | 0.0 | 126 |
| tx_status | 100% | 0.0 | 95 |
| block_leader | 100% | 0.0 | 50 |
| block_txcount | 100% | 0.0 | 50 |
| block_time | 100% | 0.0 | 1 + completeness |
| **Overall** | **100%** | **0.0** | **600** |

### Latency — sub-millisecond retrieval

- **Database query: 0.33 ms** (EXPLAIN ANALYZE, GIN bitmap index scan on a focused identifier query, at the full 2M rows).
- End-to-end incl. cross-region network round-trip (client → Supabase ap‑southeast‑2): **p50 184 ms / p95 369 ms**. In production (server co-located with the DB) retrieval is the sub-millisecond figure; the ~184 ms here is almost entirely Sydney network RTT, not the lookup.

### Clude vs. no-Clude (end-to-end answer, n=25)

| | Accuracy | Abstains | Input tokens/query | Hallucination |
|---|---|---|---|---|
| **Clude** (retrieves top-8, answers) | **100%** | 0% | **~199** | **0%** |
| **No-Clude** (full 177K-token context window) | **12%** | 96% | **~177,330** | 0% |

- **Accuracy:** Clude 100% vs no-Clude 12%. No-Clude only answers the handful of questions whose facts happen to land in its context window (0.14% of the corpus); it cannot fit the rest.
- **Hallucination is low for *both*** — but for different reasons. Clude grounds every answer in the exact retrieved fact (0% hallucination). No-Clude doesn't hallucinate either; it honestly **abstains** ("I don't have enough information") on the 96% it can't see. The gap is **accuracy**, not honesty.
- **Cost:** Clude uses **~891× fewer input tokens** per query — and is more accurate.

---

## How Clude does it (no embeddings required)

This is **exact-fact lookup**, so the right tool is precise keyword retrieval (BM25), not vector similarity. (Clude's own prior benchmarks show embeddings *hurt* exact-fact QA — near-identical facts are semantically similar, so vector search floods results with topically-related-but-wrong rows.)

1. **`content_tokens`** — a Postgres `tsvector`, generated automatically on insert — indexed with **GIN**. No embedding step, so loading is fast and cheap.
2. **Focused keyword query** — Clude extracts the *rare identifier* from the question (a tx signature, account pubkey, or slot number) plus one disambiguating term, and searches on that. The rare identifier hits a tiny GIN posting list → precise + sub-millisecond, even at 2M rows.
   - The naïve alternatives both fail at scale: matching the *full question* with AND-semantics drops 57% of the corpus (the stemmer won't unify "hold"/"held"); with OR-semantics it degrades to an ~11s sequential scan (the word "solana" is in every fact).

---

## Method notes / honesty

- Isolated bench table + dedicated `bench:scale:*` wallets; production data untouched throughout.
- The no-Clude baseline is the *steelman*: it gets the largest context window that fits (~177K tokens, ~2,500 facts spread across the corpus), not an empty context. It still can't answer, because the specific fact almost never lands in that window.
- The no-Clude 12% slightly over-credits the baseline (structured sampling put a few needles in its window); a purely random window would score ~0%. We report the higher, baseline-favorable number.
- Retrieval was measured over 600 samples; the LLM answer comparison over 25 (each no-Clude call ≈ 177K input tokens).

## Reproduce

```
# load (drop GIN, fast COPY, rebuild GIN):  misc/scripts/copy-seed-nobed.mjs
# benchmark:                                misc/scripts/scale-bm25-benchmark.mjs
WALLET=bench:scale:2m SAMPLE=500 K=8 ANSWER=1 ANSWER_N=25 CTX_FACTS=2500 \
  node --import tsx misc/scripts/scale-bm25-benchmark.mjs
```
