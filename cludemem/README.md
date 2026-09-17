# CludeMem — training pipeline

A small, open-weights memory model that runs the agent-memory lifecycle locally
(classify, extract, entities/relations, temporal, consolidate, compact,
reconcile, query, answer-with-abstention). Distributed via Ollama; drops into
Clude by setting two env vars. Two training recipes share one data engine:

- **CludeMem-E4B** — QLoRA fine-tune of **Gemma 4 E4B** (Apache 2.0); Section 2.
- **CludeMem-49M** — a 49.3M-parameter Llama-architecture model trained
  **from scratch** on the corpus; Section 2b. Runs anywhere, no base model.

Design + claim + benchmark plan: `specs/research/2026-06-13-clude-memory-model/design.md`.
Host integration (already shipped in this repo): `docs/integrations/local-memory-contract.md`.

## Pipeline

```
life scripts ──► data engine (TS, here) ──► train_qlora.py (GPU) ──► GGUF ──► Ollama ──► Clude
  planted        derive + verify             Unsloth QLoRA          merge     pull       MEMORY_MODEL=...
  ground truth   (offline or teacher)        (E4B, ~$100-150)
                                         └─► train_small.py ──────► GGUF ──┘
                                             49M from scratch      llama.cpp
                                             (any GPU, ~$2-5)      Q8_0
```

| Stage | Where it runs | Cost |
|-------|---------------|------|
| Data engine (`data-engine/`) | here, Node/tsx — offline & deterministic | $0 (templated) / ~$200-500 (teacher, at 100K scale) |
| Training (`training/`) | a GPU box (RunPod H100 ~$2/hr) | ~$100-150 per run |
| Training, 49M from scratch (`training/train_small.py`) | one consumer GPU, ~1 h (CPU for smokes) | ~$2-5 per run |
| Packaging (`packaging/`) | a box with Ollama | $0 |
| Eval (`eval/`) | a box with Ollama + the model | $0 (local) |

## 1. Generate data

**Offline smoke (no API, runs anywhere):**
```bash
npx tsx cludemem/data-engine/generate.ts      # writes data/sample.jsonl, self-checks
```
This derives examples from the planted life scripts via the deterministic
`TemplateRenderer` and runs the verification gauntlet. Labels are exact by
construction — the script IS the ground truth, so the model can't be taught a
wrong label. Running it is the test (it asserts 0 gauntlet rejections + full task
coverage + abstention examples). For the full set of v1 invariants (temporal
links, length stratification, hard-negative variety, decontamination, and the
difficulty-quota ratios), run the dedicated check:

```bash
npx tsx cludemem/data-engine/engine.test.ts
```

**Scale the count (offline, $0):** the volume lever is generating more scripts.
```bash
npx tsx cludemem/data-engine/generate.ts --count 3000 --out train.jsonl   # ~100K examples
```
Each script yields ~35 examples (3000 → ~103K). `script-generator.ts` assembles
diverse personas+timelines combinatorially while GUARANTEEING the hard structures
(a supersession, a contradiction, a temporal chain, 2 hard-negative unanswerables)
with exact labels. It's seeded/deterministic — use different `--seed` values for
disjoint dev/test shards (decontamination). To add variety, extend the pools and
archetypes in `script-generator.ts`, or add hand-authored scripts to `SEED_SCRIPTS`.

**Add naturalness (teacher-rendered):** the `--teacher` flag renders each planted
fact as natural dialogue via a teacher API. Creds live in the gitignored `.env`:
`TEACHER_API_KEY`, `TEACHER_BASE_URL`, `TEACHER_MODEL`. Labels never depend on
phrasing, so they stay exact.
```bash
npx tsx cludemem/data-engine/generate.ts --count 3000 --teacher --out train.jsonl
```
PERMITTED teachers only — `teacher.ts` hard-refuses GPT/Claude/Gemini (their terms
forbid training a competing model on their outputs; design Section 6.2). Clean
options: DeepSeek (MIT, distillation explicitly allowed), Qwen/Mistral (Apache),
Kimi K2. **On Ollama Cloud, do NOT use the Qwen3 models for rendering** — they are
reasoning models that burn ~2,800 tokens to paraphrase one line (~120x waste).
Use a fast non-thinking instruct model: `ministral-3:8b` (Apache, ~24 tok/render)
or `deepseek-v3.2` (MIT). Teacher data gets ~10% gauntlet rejections (rendering
drift drops a proper noun, breaking grounding) vs 0% on template — that's the
gauntlet filtering bad examples, exactly as intended.

## 2. Train (GPU)

```bash
cd cludemem/training && pip install -r requirements.txt
python train_qlora.py --data ../data/train.jsonl --base unsloth/gemma-4-E4B-it \
       --out ./cludemem-e4b-lora --epochs 2 --export-gguf
```
QLoRA r32 (α=2r), cosine lr 2e-4, 2 epochs, max-seq 16k. Versions are pinned to
carry the Gemma 4 fixes (grad-accum loss explosion; E2B/E4B use_cache gibberish).
Watch early loss ~13-15, not 300+. `--export-gguf` writes merged q4_k_m + q8_0.

## 2b. Train from scratch — CludeMem-49M (any GPU; CPU to smoke)

`training/train_small.py` is the other end of the size axis from the QLoRA
recipe: a **49.3M-parameter Llama-architecture decoder, random init, trained
only on the data-engine corpus**. Same wire format, same GGUF → Ollama
packaging, same `MEMORY_MODEL` seam. Why it makes sense here:

- the corpus is exact-by-construction and heavily structured, so a small model
  learns the JSON discipline fast — and Ollama's `format` (a JSON-schema
  grammar) enforces the schema at decode time, so the model only has to get
  the *values* right;
- 49M params is ~100 MB at f16 (~55 MB at Q8_0): hundreds of tokens/s on a
  laptop CPU, and one consumer GPU trains it in about an hour;
- no base-model licence in the chain — the data engine's labels are ours.

**Architecture** (preset `49m`): hidden 512, 12 layers, 8 heads, SwiGLU 1536,
RoPE, RMSNorm, tied embeddings, SentencePiece BPE vocab 16 384 →
**49,295,872 parameters** (8.39M embedding + 40.91M non-embedding).
`--preset smoke` (2.5M) exists only to exercise the pipeline; `105m` is a
bigger sibling if the 49M ceiling is ever hit.

```bash
cd cludemem/training && pip install -r requirements-49m.txt

# 1. tokenizer. The templated shards are lexically thin (~2.5K distinct
#    pieces), so broaden with real memory prose that already lives in the repo:
python collect_text.py --out ../data/tokenizer-extra.txt \
    ../../clude-memories.json ../../test-memory-pack.json \
    ../../scripts/demo/seed-maya-data/*.json ../../docs/*.md ../../docs/*/*.md ../../README.md
python tokenizer_49m.py --data ../data/train.jsonl --extra-text ../data/tokenizer-extra.txt \
    --out ./tokenizer-49m --vocab 16384        # self-checks HF == SentencePiece

# 2. train — 3 epochs of the 49K-example --balance shard = 753 steps of 64K tokens
python train_small.py --data ../data/train.jsonl --eval-data ../data/heldout.jsonl \
    --tokenizer ./tokenizer-49m --out ./runs/cludemem-49m --preset 49m --epochs 3 \
    --gen-eval-per-task 20      # optional: MemOpsEval accuracy at every eval

# 3. gate on held-out, HF-side (no Ollama needed; same scoring as memopseval.ts)
python eval_small.py --model ./runs/cludemem-49m/final --data ../data/heldout.jsonl --per-task 100
python eval_small.py --data ../data/heldout.jsonl --self-test   # scorer sanity vs gold, no model

# 4. package: HF -> GGUF (f16 + Q8_0) -> Ollama, then the Ollama-side gate
../packaging/export_gguf.sh ./runs/cludemem-49m/final cludemem-49m ~/llama.cpp
npx tsx ../eval/memopseval.ts --model cludemem-49m --data ../data/heldout.jsonl
```

Knobs: `--max-seq` (4096 default — the whole shard fits, longest example is
2,621 tokens), `--tokens-per-batch` × `--grad-accum` (16K × 4 = 64K tokens per
step by default), `--lr 5e-4` cosine with 200 warmup steps, `--resume auto`
(every checkpoint is a complete HF directory + `training_state.pt`, so any of
them exports), `--wandb-project`, `--limit` / `--max-steps` for smokes. Loss is
taken on the assistant span only; prompts are masked.

The chat format lives in ONE place, `training/chat_format.py`
(`<s><|system|>\n…<|end|>\n<|user|>\n…<|end|>\n<|assistant|>\n{json}<|end|></s>`);
the HF chat template and `packaging/Modelfile.49m` mirror it, and
`tokenizer_49m.py` asserts the three agree.

**CPU smoke that landed with this** (4 vCPU, no GPU — `training/SMOKE-REPORT.md`
has the full record): the `smoke` preset (2.5M params) trained 600 steps of
8K tokens in 10.4 min at ~7.4K tok/s: loss 9.72 → 0.20, held-out loss 0.27,
and on 20 held-out examples per task it emits schema-valid JSON unaided on
92.8% of prompts with CLASSIFY / EXTRACT / QUERY at 100%, RECONCILE 70%,
CONSOLIDATE 75%, ANSWER 35% — and 0% on ENTITIES / TEMPORAL / COMPACT, the
tasks that need exact copying of names and dates, which a 2-layer, 128-wide
model cannot do (it emits the most frequent name instead). That copy
capacity is precisely what the 12-layer 49M buys; its GPU run is the next
step. Checkpoint save → `--resume auto` was exercised in the same session.

## 3. Package + publish

```bash
cd cludemem/packaging
./build_and_push.sh cludemem-e4b ../training/cludemem-e4b-lora/unsloth.Q4_K_M.gguf clude
# -> ollama pull clude/cludemem-e4b
```
Ships **merged weights** (not adapters). Apache 2.0; include the standard NOTICE.

For CludeMem-49M use `packaging/export_gguf.sh <hf-dir> cludemem-49m [llama.cpp-dir]`
(HF → f16 GGUF → Q8_0 → `ollama create` with `Modelfile.49m`). The model is
plain Llama architecture with a `tokenizer.model`, so stock llama.cpp converts it.

## 4. Evaluate

```bash
npx tsx cludemem/eval/memopseval.ts --model cludemem-e4b --data cludemem/data/heldout.jsonl
```
Calls the local model per example and scores per-task accuracy, schema-adherence,
and abstention calibration against the planted gold. This is the gate every
training iteration must pass before any public benchmark run (design Section 8.1).

## 5. Activate in Clude

```bash
MEMORY_MODEL_PROVIDER=ollama MEMORY_MODEL=cludemem-e4b   # + EMBEDDING_PROVIDER=ollama for full offline
```
or `new Cortex({ localModel: { model: 'cludemem-e4b' } })`. Memory ops route to
CludeMem with graceful frontier fallback; personality stays on frontier.

## Status

- ✅ **Data engine (v1)** — built, runs, self-validated offline. The real IP.
  9 of 10 task types generated (RERANK deferred; design Section 8.1 ships it
  gated/optional). Difficulty quotas, length stratification, hard-negative
  variety, register noise, and a decontamination guard are enforced;
  `engine.test.ts` locks the invariants.
- ✅ **Training / packaging / eval scripts** — written, runnable on a GPU/Ollama box.
- ✅ **CludeMem-49M path (Section 2b)** — from-scratch trainer, tokenizer,
  HF-side MemOpsEval, GGUF/Ollama packaging; verified end to end on CPU
  (`training/SMOKE-REPORT.md`). ⏳ The real 49M GPU run + its gate numbers.
- ⏳ **Real corpus + fine-tune (E4B)** — needs a teacher API key + a GPU (your resources).
- ⏳ Open decisions before publishing (model name, dataset release): design Section 13.

## Layout

```
cludemem/
  data-engine/   taxonomy.ts life-script.ts script-generator.ts render.ts noise.ts derive.ts gauntlet.ts generate.ts teacher.ts engine.test.ts
  training/      train_qlora.py requirements.txt                      (E4B QLoRA)
                 chat_format.py tokenizer_49m.py collect_text.py         (49M from scratch)
                 train_small.py eval_small.py requirements-49m.txt SMOKE-REPORT.md
  packaging/     Modelfile build_and_push.sh   Modelfile.49m export_gguf.sh
  eval/          memopseval.ts
  data/          generated JSONL (gitignored except samples)
```
