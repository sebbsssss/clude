# Clude on LongMemEval-S

Headline: **85.0% (425 / 500)** on LongMemEval-S, judged by `claude-sonnet-4-5-20250929`.

LongMemEval (Wu et al., ICLR 2025 — [arXiv 2410.10813](https://arxiv.org/abs/2410.10813)) is a 500-question benchmark for long-term memory in chat assistants. The S variant uses single long sessions per question. We run the official cleaned dataset (`xiaowu0162/longmemeval-cleaned` on HuggingFace) end-to-end through Clude: seed every conversation as memories, retrieve, read, answer, judge.

Per-question outputs are in [`results.json`](./results.json) so you can audit or rejudge them yourself.

## Result

| Category | Score | F1 | Evidence hit |
|---|---:|---:|---:|
| Knowledge-Update | 85.9% (67/78) | 0.187 | 100.0% |
| Multi-Session | 79.7% (106/133) | 0.079 | 100.0% |
| Single-Session — Assistant | 98.2% (55/56) | 0.265 | 100.0% |
| Single-Session — Preference | 76.7% (23/30) | 0.396 | 76.7% |
| Single-Session — User | 87.1% (61/70) | 0.491 | 94.3% |
| Temporal-Reasoning | 85.0% (113/133) | 0.249 | 97.9% |
| **Overall** | **85.0% (425/500)** | **0.238** | **98.2%** |

Eval wall-clock: 82 minutes for 500 questions at concurrency 4 (a separate ~30 min for the initial seeding of 74,976 memories).

## Notes on judging

We judge with `claude-sonnet-4-5-20250929`, which is stricter than the GPT-4o judge most published numbers use. Where direct head-to-head data exists ([Supermemory's research](https://supermemory.ai/research/)), the same outputs grade roughly 3-4pp higher under GPT-4o than under Sonnet-strict. So 85.0% here is in the same league as the 88-90% numbers cited under GPT-4o judges. We publish both the generated answers and the judge model so anyone can rejudge with whatever model they prefer.

## How to reproduce

### Requirements

- Node.js 22.x, pnpm
- API keys: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (Supabase project with pgvector and the migrations from `/migrations/` applied)

### Steps

```bash
# 1. Install
pnpm install

# 2. Set env vars (or put them in .env at the repo root)
export ANTHROPIC_API_KEY=sk-ant-...
export VOYAGE_API_KEY=pa-...
export EMBEDDING_API_KEY=$VOYAGE_API_KEY
export EMBEDDING_PROVIDER=voyage
export SUPABASE_URL=https://...supabase.co
export SUPABASE_SERVICE_KEY=eyJ...

# 3. Run with a fresh wallet (REQUIRED — see "Methodology notes" below)
cd misc/scripts
npx tsx longmemeval-benchmark.ts \
  --variant s \
  --run-id "my-run-$(date -u +%Y%m%dT%H%M)" \
  --skip-cleanup \
  --rerank \
  --concurrency 4 \
  --batch-sleep 1500 \
  --reader claude-sonnet-4-5-20250929 \
  --judge claude-sonnet-4-5-20250929
```

Results land at `misc/scripts/.longmemeval-cache/results_s.json`.

### Cost

A full run is roughly **$30-50** in API spend (Anthropic for the reader + judge; Voyage for embeddings + reranking).

## Methodology

| | |
|---|---|
| **Dataset** | `xiaowu0162/longmemeval-cleaned`, S variant, 500 questions |
| **Seeding** | Session-level chunked: split each session at turn boundaries into ~5K-char chunks → ~57K episodic memories + ~18K extracted semantic facts |
| **Embedding** | Voyage AI `voyage-4-large`, 1024 dims |
| **Retrieval** | Hybrid vector + keyword + tag, recall limit 50, then Voyage `rerank-2.5` with per-category top-N (KU=15, multi=30, SS-User=35, SS-Pref=30, others=25) |
| **Reader (per-category routing)** | `claude-opus-4-7` for Knowledge-Update / Multi-Session / SS-Preference / Temporal; `claude-sonnet-4-5-20250929` for SS-Assistant / SS-User |
| **Reader pattern** | Two-stage per category: stage 1 extracts (quotes / version-history / timeline / item-list); stage 2 synthesizes the final answer |
| **Judge** | `claude-sonnet-4-5-20250929`, strict prompt |

The full pipeline lives in [`misc/scripts/longmemeval-benchmark.ts`](../../misc/scripts/longmemeval-benchmark.ts).

## Methodology notes (important)

**Seed a fresh wallet for every comparison run.** Reading from a seeded wallet mutates its retrieval state — recall updates `last_accessed` timestamps, link-strengthening boosts (Hebbian), and dream/reflection cycle outputs all accumulate. We measured **+2.6pp** of aggregate score drift on the same code by reusing a wallet across 5 prior runs vs. seeding a clean one. If you're A/B-testing code changes, isolate each variant on its own `--run-id`.

**The 76.7% evidence hit rate on SS-Preference is a known retrieval gap** — preference questions sometimes ask about topics the user mentioned in passing across multiple sessions. The reader does what it can with partial recall.

## What's in `results.json`

```json
{
  "timestamp": "2026-05-30T...",
  "config": { "variant": "s", "readerModel": "...", "judgeModel": "...", ... },
  "summary": { "accuracy": 85.0, "totalCorrect": 425, "totalEvaluated": 500, ... },
  "perType": { "knowledge-update": { "accuracy": 85.9, "correct": 67, ... }, ... },
  "results": [
    {
      "questionId": "...",
      "questionType": "knowledge-update",
      "question": "...",
      "goldAnswer": "...",
      "generatedAnswer": "...",
      "correct": 1,
      "f1": 0.21,
      "recallLatencyMs": 2034,
      "memoriesReturned": 50,
      "memoriesAfterFilter": 25,
      "evidenceSessionHits": 2,
      "evidenceSessionTotal": 2
    },
    ...
  ]
}
```

Per-question records let you rejudge, diff against your own runs, or inspect specific failures.

## References

- LongMemEval paper: [Wu et al., ICLR 2025 — arXiv 2410.10813](https://arxiv.org/abs/2410.10813)
- Dataset: [xiaowu0162/longmemeval-cleaned](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned)
- Clude memory system: [`packages/brain/`](../../packages/brain/)
- Benchmark script: [`misc/scripts/longmemeval-benchmark.ts`](../../misc/scripts/longmemeval-benchmark.ts)
