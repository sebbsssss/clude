# CludeMem-49M — pipeline smoke report

What ran, where, and what it produced when the 49M path landed. Numbers here
come from a **CPU-only container (4 vCPU, 15 GB RAM, no GPU)**, so they prove
the pipeline end to end and show learning curves; they are not the 49M model's
real numbers — those need the GPU run in README Section 2b.

## Environment

| | |
|---|---|
| torch | 2.14 (CPU) |
| transformers | 5.17 |
| sentencepiece | 0.2.2 |
| corpus | `generate.ts --count 3000 --balance --seed 0` → 49,000 examples (0 gauntlet rejections) |
| held-out | `generate.ts --count 80 --no-seeds --seed 1` → 6,393 examples (disjoint scripts) |
| tokenizer | SentencePiece BPE, vocab 16,384, byte fallback, corpus + `collect_text.py` prose (0.92 MB) |

Token lengths with this tokenizer, full training shard:
p50 = 120, p90 = 541, p99 = 2,466, max = 2,621 → everything fits `--max-seq 4096`
(at 2,048 you lose 2,137 long CONSOLIDATE/COMPACT/ANSWER examples).

## Model

`--preset 49m`: hidden 512 · 12 layers · 8 heads · SwiGLU 1536 · vocab 16,384 · tied
→ **49,295,872 parameters** (8,388,608 embedding + 40,907,264 non-embedding).
3 epochs of the shard at 64K tokens/step = 753 optimizer steps.

## Run A — `--preset smoke` (2.5M params), 600 steps, CPU

`--max-seq 1024 --tokens-per-batch 4096 --grad-accum 2` (≈8K tokens/step),
`--lr 1e-3`, 30 warmup, cosine to 1e-4. 7.4K tok/s on 4 vCPU → 10.4 min.

| step | train loss | held-out loss | gen acc (5/task) | schema |
|-----:|-----------:|--------------:|-----------------:|-------:|
| 1 | 9.72 | | | |
| 100 | 2.32 | | | |
| 200 | 0.90 | 0.513 | 17.5% | 52.5% |
| 400 | 0.34 | 0.300 | 55.0% | 90.0% |
| 600 | 0.20 | 0.271 | 52.5% | 92.5% |

Fuller gate on the final checkpoint, 20 held-out examples per task
(`eval_small.py --per-task 20 --max-new-tokens 256`, greedy, no grammar):

| task | acc | schema |
|---|---:|---:|
| CLASSIFY | 100.0% | 100.0% |
| EXTRACT | 100.0% | 100.0% |
| ENTITIES | 0.0% | 100.0% |
| TEMPORAL | 0.0% | 100.0% |
| CONSOLIDATE | 75.0% | 75.0% |
| COMPACT | 0.0% | 80.0% |
| RECONCILE | 70.0% | 100.0% |
| QUERY | 100.0% | 100.0% |
| ANSWER | 35.0% | 80.0% |
| **overall** | **53.3%** | **92.8%** |
| abstention | 60% of 10 unanswerable refused | |

Reading it: the tiny model learns the per-task JSON shapes and every
*categorical* field (type, concepts, valence, verdict, intent) from a few
million tokens, and the values it gets wrong are the ones that must be
**copied** from the prompt — entity names, dates, ids, citations. Sample:
gold tags `["preference","location","aisha","tokyo"]`, prediction
`["preference","location","iris","nairobi"]` (it emits the most frequent
name). A 2-layer, 128-wide model has no room for the induction/copy
circuitry; that is exactly what the 12-layer 49M configuration is for, and
why its held-out ENTITIES / TEMPORAL / COMPACT / ANSWER numbers are the ones
to watch on the GPU run. Behind Ollama's `format` grammar the schema column
becomes ~100% by construction.

## Checkpoint resume

`--max-steps 30 --save-every 15`, then the same command with `--max-steps 45
--resume auto`: picked up `ckpt-30` at step 30 / batch 30, continued to 45
(loss 6.74 → 6.47 on the same schedule), saved `ckpt-45` and `final/`.

## Run B — `--preset 49m` (49.3M params), 100 steps, CPU

The real configuration, run just far enough on 4 vCPU to show it trains
stably and to measure CPU cost: `--max-seq 1024 --tokens-per-batch 4096
--grad-accum 2` (≈8K tokens/step), `--lr 5e-4`, 20 warmup. Steady-state
throughput once uncontended: **≈1.0K tok/s** (7.5–8 s per 8K-token step;
the log's running average, 728 tok/s at step 100, still carries the first
step, which overlapped a concurrent eval). Peak RSS stayed
well inside 15 GB. Gen-eval columns are 3 held-out examples per task with
`--gen-eval-max-new-tokens 96`, so long outputs (EXTRACT/CONSOLIDATE/COMPACT)
are truncated there — read them as a trend, not a score.

| step | train loss | grad norm | held-out loss | gen acc | schema | per task |
|-----:|-----------:|----------:|--------------:|--------:|-------:|---|
| 1 | 9.87 | 15.65 | | | | |
| 10 | 6.95 | 5.74 | | | | |
| 20 | 3.93 | 13.01 | | | | |
| 30 | 3.31 | 2.56 | | | | |
| 40 | 2.53 | 6.83 | | | | |
| 50 | 2.84 | 2.69 | 1.900 | 0.0% | 0.0% | CLAS=0.0 EXTR=0.0 ENTI=0.0 TEMP=0.0 CONS=0.0 COMP=0.0 RECO=0.0 QUER=0.0 ANSW=0.0 |
| 60 | 1.73 | 2.05 | | | | |
| 70 | 0.75 | 1.21 | | | | |
| 80 | 1.11 | 2.43 | | | | |
| 90 | 1.24 | 3.24 | | | | |
| 100 | 1.55 | 2.50 | 0.873 | 13.0% | 13.0% | CLAS=1.0 EXTR=0.0 ENTI=0.0 TEMP=0.0 CONS=0.0 COMP=0.0 RECO=0.0 QUER=0.0 ANSW=0.0 |

100 steps × 8K tokens ≈ 0.8M tokens, about
5% of one epoch — the full recipe is 753 steps × 64K
tokens on a GPU (≈49M tokens, 3 epochs). Extrapolating this CPU rate, one
epoch here would take ~5 h; on a single modern GPU the whole run is ~1 h.

## Handoff — what the 49M run still needs

1. **A GPU box** (any 16 GB+ card): `pip install -r requirements-49m.txt`,
   regenerate the shards (`generate.ts --count 3000 --balance`), run the
   Section 2b commands. Checkpoints are HF dirs; `--resume auto` survives
   pre-emption.
2. **Your original 49M run's config/checkpoint**, if it differs from
   `--preset 49m` (vocab, depth, tokenizer, data mix): every preset knob is a
   CLI flag, so the recipe can be aligned without code changes.
3. **Teacher rendering** (`generate.ts --teacher`, DeepSeek/Qwen key) before
   any public number: the template-rendered corpus is exact but narrow, and
   a from-scratch model has no pretraining to fall back on for phrasing it
   never saw.
4. **GGUF gate**: `packaging/export_gguf.sh` was written against stock
   llama.cpp but could not be exercised here (no llama.cpp checkout in the
   container); run it once and then `eval/memopseval.ts` against Ollama.

## Reproduce

```bash
cd cludemem/training
python collect_text.py --out ../data/tokenizer-extra.txt ../../clude-memories.json ../../test-memory-pack.json \
    ../../scripts/demo/seed-maya-data/*.json ../../docs/*.md ../../docs/*/*.md ../../README.md
python tokenizer_49m.py --data ../data/train.jsonl --extra-text ../data/tokenizer-extra.txt --out ./tokenizer-49m
python train_small.py --data ../data/train.jsonl --eval-data ../data/heldout.jsonl --tokenizer ./tokenizer-49m \
    --out ./runs/smoke --preset smoke --max-seq 1024 --tokens-per-batch 4096 --grad-accum 2 \
    --max-steps 600 --warmup 30 --lr 1e-3 --eval-every 200 --gen-eval-per-task 5 --gen-eval-max-new-tokens 160
python eval_small.py --model ./runs/smoke/final --data ../data/heldout.jsonl --per-task 20 --show 3
```
