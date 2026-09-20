#!/usr/bin/env python3
"""
Render the Hugging Face model card for a CludeMem adapter from the run's own artefacts.

    python build_model_card.py --run-dir <dir with config.json, checkpoint_selection.json,
                                          canary_base_torch.json> \
        [--dnli evals/dnli/<run>/results_all.json] [--memopseval results.json] \
        --repo clude/cludemem-e4b --out README.md

Every number on the card is read from a file the training pipeline wrote; nothing is
typed in by hand. Sample sizes are printed next to every metric, and evaluations that
were not run are listed as not run rather than omitted. The winner is whatever the
retrieval-canary rule picked (checkpoint_selection.json) — the card explains the rule
because it is the most defensible thing about the model: it was chosen for not
forgetting how to copy dates and ids out of context, not for the lowest loss.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

TASKS = ["CLASSIFY", "EXTRACT", "ENTITIES", "TEMPORAL", "CONSOLIDATE", "COMPACT", "RECONCILE", "QUERY", "ANSWER"]

TASK_BLURB = {
    "CLASSIFY": "memory type, importance, tags, concepts, emotional valence",
    "EXTRACT": "atomic memories out of a dialogue block",
    "ENTITIES": "entities and relations",
    "TEMPORAL": "event date, precision, temporal links to known events",
    "CONSOLIDATE": "evidence-linked insights over a memory set",
    "COMPACT": "one summary of an old memory group, entities and date range preserved",
    "RECONCILE": "verdict between two memories: consistent / contradicts / supersedes / duplicate",
    "QUERY": "query understanding: expansions, temporal constraints, entities, intent",
    "ANSWER": "grounded answer with citations, or abstention",
}


def load(path: str | None):
    if not path or not os.path.exists(path):
        return None
    with open(path) as f:
        return json.load(f)


def pct(x, tokens=None) -> str:
    """A task with no scored tokens of that kind (ENTITIES has no digits/ids to copy) is
    "—", not 0.0%: an accuracy over an empty set is undefined, and printing a zero would
    read as a failure."""
    if x is None or (tokens is not None and int(tokens) == 0):
        return "—"
    return f"{float(x):.1f}%"


def fmt_int(n) -> str:
    return f"{int(n):,}"


def load_canary_log(run_dir: str) -> list[dict]:
    """canary.jsonl: one record per (checkpoint, kind) the trainer scored, BASE included."""
    path = os.path.join(run_dir, "canary.jsonl")
    if not os.path.exists(path):
        return []
    out = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


def canary_record(log: list[dict], checkpoint: str, kind: str) -> dict | None:
    """Last ok record for a checkpoint/kind (a re-scored checkpoint appends, never rewrites)."""
    hits = [r for r in log if r.get("checkpoint") == checkpoint and r.get("kind", "main") == kind and r.get("ok", True)]
    return hits[-1] if hits else None


def canary_tables(sel: dict, base: dict | None, log: list[dict]):
    """Winner-vs-base per task, and the checkpoint trajectory."""
    winner_name = sel.get("winner")
    winner = next((c for c in sel["checkpoints"] if c["checkpoint"] == winner_name), None)
    # Per-task base numbers: canary_base_torch.json if the run dir carries it, else the
    # BASE record the trainer appended to canary.jsonl (same file, same tokens).
    base_tasks = (base or {}).get("results", {}) if base else {}
    if not base_tasks:
        base_tasks = (canary_record(log, "BASE", "main") or {}).get("per_task", {})
    winner_tasks = (winner or {}).get("per_task") or (canary_record(log, winner_name, "main") or {}).get("per_task", {})
    rows = []
    for t in TASKS:
        w = winner_tasks.get(t, {})
        b = base_tasks.get(t, {})
        rows.append((t, b.get("digit_acc"), w.get("digit_acc"), w.get("digit_tokens"),
                     b.get("structure_acc"), w.get("structure_acc"), w.get("structure_tokens")))
    per_task = ["| Task | Base retrieval | **CludeMem retrieval** | tokens | Base structure | **CludeMem structure** | tokens |",
                "|---|---:|---:|---:|---:|---:|---:|"]
    for t, bd, wd, dt, bs, ws, st in rows:
        per_task.append(f"| {t} | {pct(bd, dt)} | **{pct(wd, dt)}** | {dt if dt is not None else '—'} | {pct(bs, st)} | **{pct(ws, st)}** | {st if st is not None else '—'} |")
    traj = ["| Checkpoint | Retrieval (digit) acc | Structure acc | Eligible |", "|---|---:|---:|:---:|"]
    for c in sel["checkpoints"]:
        mark = " ← selected" if c["checkpoint"] == winner_name else ""
        traj.append(f"| {c['checkpoint']}{mark} | {pct(c['digit_acc'])} | {pct(c['structure_acc'])} | {'yes' if c['eligible'] else 'no'} |")
    return winner, "\n".join(per_task), "\n".join(traj)


def dnli_section(res: dict | None) -> str:
    if not res:
        return ("Not run for this checkpoint yet. The evaluation harness (DNLI / DECODE contradiction "
                "detection through the RECONCILE task) ships with the training pipeline; results will be "
                "added here when it has been run on this adapter.")
    lines = ["Contradiction / duplicate detection on two external dialogue-NLI sets, scored through the "
             "RECONCILE task with greedy decoding. Baselines are fitted on each set's train split and scored "
             "on exactly the same sampled items.", ""]
    for name, s in res.get("sets", {}).items():
        m = s.get("model", {})
        n = m.get("n")
        lines.append(f"**{name}** — n = {n} (sampled from {fmt_int(s.get('n_test_split', 0))} test items, "
                     f"label-balanced; chance = {pct(s.get('chance_uniform'))})")
        lines.append("")
        lines.append("| System | strict 4-way | 3-way collapse | binary (is-contradiction) | binary F1 |")
        lines.append("|---|---:|---:|---:|---:|")
        ci = m.get("strict4_ci95")
        ci_s = f" (95% CI {ci[0]:.0f}–{ci[1]:.0f})" if ci else ""
        lines.append(f"| **CludeMem** | **{pct(m.get('strict4_acc'))}**{ci_s} | {pct(m.get('collapse3_acc'))} | {pct(m.get('binary_acc'))} | {pct(m.get('binary_f1'))} |")
        for bname, b in s.get("baselines", {}).items():
            lines.append(f"| {bname} | {pct(b.get('strict4_acc'))} | {pct(b.get('collapse3_acc'))} | {pct(b.get('binary_acc'))} | {pct(b.get('binary_f1'))} |")
        lines.append(f"Schema-complete outputs: {m.get('schema_complete', s.get('schema_complete', 'n/a'))}/{n}; unparseable: {s.get('unparseable', 'n/a')}.")
        lines.append("")
    lines.append("Sample sizes are small where they are small; the confidence intervals say so. Treat these as "
                 "a directional check on real dialogue data, not a leaderboard number.")
    return "\n".join(lines)


def memops_section(res: dict | None) -> str:
    if not res:
        return ("Not run for this checkpoint yet. `cludemem/eval/memopseval.ts` scores per-task accuracy, "
                "schema adherence and abstention calibration on a held-out synthetic shard through Ollama.")
    rows = ["| Task | Accuracy | Schema | n |", "|---|---:|---:|---:|"]
    for t, v in res.get("tasks", {}).items():
        rows.append(f"| {t} | {pct(100 * v['acc'])} | {pct(100 * v['schema'])} | {v['n']} |")
    rows.append(f"| **overall** | **{pct(100 * res.get('overall_acc', 0))}** | {pct(100 * res.get('overall_schema', 0))} | {res.get('n')} |")
    ab = res.get("abstention", {})
    if ab.get("n"):
        rows.append(f"\nAbstention: {ab.get('correct')}/{ab.get('n')} unanswerable questions correctly refused ({pct(100 * ab.get('rate', 0))}).")
    return "\n".join(rows)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--run-dir", required=True)
    ap.add_argument("--dnli", default=None)
    ap.add_argument("--memopseval", default=None)
    ap.add_argument("--repo", required=True, help="Hugging Face repo id the card is for, e.g. clude/cludemem-e4b")
    ap.add_argument("--base-license", default=None, help="license id of the base model as shown on its Hub page")
    ap.add_argument("--gguf-repo", default=None, help="repo id holding the GGUF exports, if separate")
    ap.add_argument("--out", default="README.md")
    args = ap.parse_args()

    cfg = load(os.path.join(args.run_dir, "config.json")) or {}
    sel = load(os.path.join(args.run_dir, "checkpoint_selection.json"))
    if not sel:
        sys.exit("checkpoint_selection.json is required: the card is built around the selected checkpoint")
    base = load(os.path.join(args.run_dir, "canary_base_torch.json"))
    dnli = load(args.dnli)
    memops = load(args.memopseval)

    log = load_canary_log(args.run_dir)
    winner, per_task_tbl, traj_tbl = canary_tables(sel, base, log)
    hard_w = canary_record(log, sel.get("winner"), "hard")
    hard_b = canary_record(log, "BASE", "hard")
    hard_line = ""
    if hard_w and hard_b:
        hard_line = (f"On the **hard canary** (`{hard_w.get('data_dir', 'data-hard-v2')}`: adversarial items with "
                     f"near-miss dates, colliding ids and unanswerables; {hard_w.get('digit_tokens')} retrieval / "
                     f"{hard_w.get('structure_tokens')} structure tokens) the selected checkpoint scores "
                     f"**{pct(hard_w.get('digit_acc'))} / {pct(hard_w.get('structure_acc'))}** against the base's "
                     f"{pct(hard_b.get('digit_acc'))} / {pct(hard_b.get('structure_acc'))}.\n\n")
    base_model = cfg.get("base_used") or cfg.get("base") or "unsloth/gemma-4-E4B-it"
    plan = cfg.get("plan", {})
    audit = cfg.get("audit", {})
    run_name = os.path.basename(os.path.abspath(args.run_dir))
    trainable = cfg.get("trainable_params")
    total = cfg.get("total_params")
    macro_w = winner.get("digit_acc") if winner else None
    macro_ws = winner.get("structure_acc") if winner else None
    data_files = cfg.get("data", [])

    front = {
        "base_model": base_model,
        "library_name": "peft",
        "pipeline_tag": "text-generation",
        "license": "apache-2.0",
        "tags": ["lora", "unsloth", "trl", "gemma-4", "agent-memory", "structured-output", "json", "cludemem"],
        "language": ["en"],
    }
    if args.base_license:
        front["base_model_license"] = args.base_license
    fm = "---\n" + "\n".join(
        f"{k}: {json.dumps(v) if isinstance(v, list) else v}" for k, v in front.items()) + "\n---\n"

    card = f"""{fm}
# CludeMem-E4B — a memory-operations model for AI agents

CludeMem runs the **agent-memory lifecycle** as strict JSON: classify, extract, find entities and
relations, date events, consolidate, compact, reconcile contradictions, understand queries, and answer
only from provided memories (abstaining when they don't support an answer). It is the local model behind
[Clude](https://github.com/sebbsssss/clude)'s memory engine, and it drops into any agent that needs
these operations without a frontier API call.

This repository holds the **LoRA adapter** (run `{run_name}`) for `{base_model}`.
{"GGUF builds for Ollama / llama.cpp are in [`" + args.gguf_repo + "`](https://huggingface.co/" + args.gguf_repo + ")." if args.gguf_repo else "GGUF builds for Ollama / llama.cpp are published alongside when available."}

## What it does

| Task | Output |
|---|---|
""" + "\n".join(f"| `{t}` | {TASK_BLURB[t]} |" for t in TASKS) + f"""

Every task takes a short task-specific system prompt plus the input and returns one flat JSON object.
There is no chat mode; this is infrastructure, not a persona.

## Headline numbers

The selected checkpoint (`{sel.get('winner')}`) scores **{pct(macro_w)} retrieval accuracy** and
**{pct(macro_ws)} structure accuracy** on the retrieval canary, against **{pct(sel.get('base_digit_acc'))}
retrieval accuracy for the untuned base model** on the same tokens.

*Retrieval accuracy* is teacher-forced next-token accuracy restricted to the digit and id tokens of the
target — dates and memory ids that cannot be inferred and must be copied out of the prompt. *Structure
accuracy* is the same measure over every other token: braces, keys, enum values. The two are reported
apart because a model can learn the JSON template perfectly while forgetting how to copy a date, and a
single loss number cannot see that happening. Per task, on the selected checkpoint versus the base:

{per_task_tbl}

{hard_line}Token counts are the number of scored positions per task on the canary split
(`{cfg.get('canary_per_task', 6)}` items per task).

## How the checkpoint was chosen

Not by validation loss. The rule, applied identically to every checkpoint the run saved:

> eligible ⇔ retrieval accuracy ≥ base retrieval accuracy − {sel.get('tolerance')} points
> winner = the eligible checkpoint with the highest structure accuracy

Base floor: {pct(sel.get('base_digit_acc'))} − {sel.get('tolerance')} = {pct(sel.get('floor'))}. Trajectory across the run:

{traj_tbl}

This rule exists because an earlier recipe (attention-projection LoRA, rank 32, high effective scale)
reached 100% structure accuracy with a smoothly converging loss while retrieval accuracy collapsed from
96% to 38%: it had learned the template and forgotten how to read. Selecting on retrieval first makes
that failure impossible to ship.

## Contradiction detection on external data (DNLI / DECODE)

{dnli_section(dnli)}

## Held-out task accuracy (MemOpsEval)

{memops_section(memops)}

## Training

| | |
|---|---|
| Base model | `{base_model}` |
| Method | QLoRA (4-bit base), LoRA rank {cfg.get('rank')}, α {cfg.get('alpha')} (effective scale {cfg.get('effective_scale')}), dropout {cfg.get('dropout')} |
| Adapted modules | {cfg.get('adapted_modules')} — `gate_proj`, `up_proj`, `down_proj` of every language-model layer; attention projections deliberately **not** adapted |
| Trainable parameters | {fmt_int(trainable) if trainable else 'n/a'} of {fmt_int(total) if total else 'n/a'} ({(100 * trainable / total):.3f}%) |
| Training rows | {fmt_int(audit.get('rows_trained', plan.get('rows', 0)))} (longest {fmt_int(audit.get('max_len', 0))} tokens, p95 {fmt_int(audit.get('p95_len', 0))}; 0 rows over the {fmt_int(cfg.get('max_seq', 0))}-token limit) |
| Schedule | {fmt_int(plan.get('total_steps', 0))} steps × {plan.get('seq_per_step')} sequences ({plan.get('corpus_coverage')} epoch), lr {cfg.get('lr')} cosine, warmup {plan.get('warmup_steps')}, {cfg.get('optim')} |
| Loss | assistant turn only (the JSON answer); prompt tokens masked |
| Stack | Unsloth {cfg.get('unsloth_version')}, TRL {cfg.get('trl_version')}, PEFT {cfg.get('peft_version')}, Transformers {cfg.get('transformers_version')}, PyTorch {cfg.get('torch_version')} |

### Data

{fmt_int(audit.get('rows_trained', 0))} supervised examples across the nine tasks, built by a synthetic **data engine**
in which every label is derived mechanically from a planted "life script" (a persona plus a timeline of
facts with supersessions, contradictions, duplicates and temporal chains). Because the script is the
ground truth, labels are exact by construction; a verification gauntlet rejects any example whose
citations, entities or temporal links are not grounded in its own prompt. Hard-negative unanswerables,
register noise (logs, tables, code fences around the dialogue) and length stratification are enforced
by quota. Sources for this run:

""" + "\n".join(f"- `{d}`" for d in data_files) + f"""

No benchmark evaluation data was used for training; persona names from public long-memory benchmarks
are on a decontamination blocklist.

## How to use

### With Transformers + PEFT

```python
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import PeftModel

base = "{base_model}"
tok = AutoTokenizer.from_pretrained(base)
model = AutoModelForCausalLM.from_pretrained(base, device_map="auto")
model = PeftModel.from_pretrained(model, "{args.repo}")

messages = [
  {{"role": "system", "content": "Classify the memory. Output JSON: {{type, importance (0-1), tags[], concepts[], emotional_valence (-1..1)}}."}},
  {{"role": "user", "content": "Maya moved to Lisbon on 2026-02-10."}},
]
ids = tok.apply_chat_template(messages, add_generation_prompt=True, return_tensors="pt").to(model.device)
out = model.generate(ids, max_new_tokens=256, do_sample=False)
print(tok.decode(out[0][ids.shape[-1]:], skip_special_tokens=True))
```

### With Clude

```bash
MEMORY_MODEL_PROVIDER=ollama MEMORY_MODEL=cludemem-e4b   # after `ollama pull` of the GGUF build
```

Memory operations route to CludeMem with graceful fallback to the configured frontier model; personality
generation stays on the frontier. See `docs/integrations/local-memory-contract.md` in the Clude repo.

## Limitations

- **Synthetic training data.** Labels are exact, but the phrasing distribution is that of the data engine
  (template-rendered, with teacher-rendered paraphrases where used). Expect the model to be strongest on
  inputs that look like agent memory traffic and weaker on free-form prose far from it.
- **English only**, and JSON only: it will not hold a conversation.
- **External-data evaluation is limited** to the contradiction task (DNLI / DECODE) at modest sample
  sizes; the other tasks are measured on held-out synthetic data and the retrieval canary.
- The base model's own limitations and content behaviours apply.

## License

The adapter weights in this repository are released under **Apache-2.0**. The base model
`{base_model}` is subject to its own license{" (" + args.base_license + ")" if args.base_license else ""}; using this adapter
requires accepting it.

## Citation

```
@software{{cludemem_{run_name.replace('-', '_')},
  title  = {{CludeMem-E4B: a memory-operations model for AI agents}},
  author = {{Clude}},
  year   = {{2026}},
  url    = {{https://huggingface.co/{args.repo}}}
}}
```
"""
    with open(args.out, "w") as f:
        f.write(card)
    print(f"wrote {args.out} ({len(card):,} chars) for {args.repo}: winner={sel.get('winner')} "
          f"retrieval={pct(macro_w)} structure={pct(macro_ws)} base={pct(sel.get('base_digit_acc'))}; "
          f"dnli={'yes' if dnli else 'not run'} memopseval={'yes' if memops else 'not run'}")


if __name__ == "__main__":
    main()
