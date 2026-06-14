# CludeMem — training pipeline

A small, open-weights memory model: fine-tune **Gemma 4 E4B** (Apache 2.0) into a
specialist that runs the agent-memory lifecycle locally (classify, extract,
entities/relations, temporal, consolidate, reconcile, query, answer-with-abstention).
Distributed via Ollama; drops into Clude by setting two env vars.

Design + claim + benchmark plan: `specs/research/2026-06-13-clude-memory-model/design.md`.
Host integration (already shipped in this repo): `docs/integrations/local-memory-contract.md`.

## Pipeline

```
life scripts ──► data engine (TS, here) ──► train_qlora.py (GPU) ──► GGUF ──► Ollama ──► Clude
  planted        derive + verify             Unsloth QLoRA          merge     pull       MEMORY_MODEL=...
  ground truth   (offline or teacher)        (E4B, ~$100-150)
```

| Stage | Where it runs | Cost |
|-------|---------------|------|
| Data engine (`data-engine/`) | here, Node/tsx — offline & deterministic | $0 (templated) / ~$200-500 (teacher, at 100K scale) |
| Training (`training/`) | a GPU box (RunPod H100 ~$2/hr) | ~$100-150 per run |
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
coverage + abstention examples).

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

## 3. Package + publish

```bash
cd cludemem/packaging
./build_and_push.sh cludemem-e4b ../training/cludemem-e4b-lora/unsloth.Q4_K_M.gguf clude
# -> ollama pull clude/cludemem-e4b
```
Ships **merged weights** (not adapters). Apache 2.0; include the standard NOTICE.

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

- ✅ **Data engine** — built, runs, self-validated (offline). The real IP.
- ✅ **Training / packaging / eval scripts** — written, runnable on a GPU/Ollama box.
- ⏳ **Real corpus + fine-tune** — needs a teacher API key + a GPU (your resources).
- ⏳ Open decisions before publishing (model name, dataset release): design Section 13.

## Layout

```
cludemem/
  data-engine/   taxonomy.ts life-script.ts script-generator.ts render.ts derive.ts gauntlet.ts generate.ts teacher.ts
  training/      train_qlora.py requirements.txt
  packaging/     Modelfile build_and_push.sh
  eval/          memopseval.ts
  data/          generated JSONL (gitignored except samples)
```
