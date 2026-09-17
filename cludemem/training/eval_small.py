#!/usr/bin/env python3
"""
MemOpsEval for an HF CludeMem checkpoint — no Ollama needed.

  python eval_small.py --model ./runs/cludemem-49m/final --data ../data/heldout.jsonl --per-task 50

Scoring mirrors eval/memopseval.ts field-for-field (same load-bearing fields
per task, same abstention metric), so numbers from here and from the Ollama
gate are comparable. Schema adherence is checked against a port of
data-engine/taxonomy.ts — keep the two in sync.

Decoding is greedy (temperature 0, like the Modelfile) with NO grammar
constraint, so `schema` here is the model's unaided JSON discipline. Behind
Ollama's JSON-schema `format` the schema rate is ~100% by construction and
only `acc` is left to the model.
"""
from __future__ import annotations

import argparse
import json
import random
import sys
import time
from collections import defaultdict

import torch

from chat_format import END_TOKEN, render_prompt, strip_generation

# ── taxonomy port (data-engine/taxonomy.ts) ──
MEMORY_TYPES = {"episodic", "semantic", "procedural", "self_model", "introspective"}
BOND_TYPES = {"supports", "contradicts", "elaborates", "causes", "follows", "relates", "resolves",
              "happens_before", "happens_after", "concurrent_with"}
CONCEPTS = {"personal_fact", "preference", "goal_or_plan", "task", "event", "relationship", "knowledge",
            "skill_or_procedure", "self_reflection", "location", "possession", "temporal_marker"}
ENTITY_TYPES = {"person", "organization", "project", "concept", "location", "event", "object"}
DATE_PRECISION = {"day", "month", "year", "none"}
VERDICTS = {"contradicts", "consistent", "supersedes", "duplicate"}
TASKS = ["CLASSIFY", "EXTRACT", "ENTITIES", "TEMPORAL", "CONSOLIDATE", "COMPACT", "RECONCILE", "QUERY", "ANSWER"]


def _num(x, lo, hi) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool) and lo <= x <= hi


def _strs(x) -> bool:
    return isinstance(x, list) and all(isinstance(s, str) for s in x)


def _str_or_none(x) -> bool:
    return x is None or isinstance(x, str)


def schema_ok(task: str, o) -> bool:
    try:
        if not isinstance(o, dict):
            return False
        if task == "CLASSIFY":
            return (o["type"] in MEMORY_TYPES and _num(o["importance"], 0, 1) and _strs(o["tags"])
                    and isinstance(o["concepts"], list) and all(c in CONCEPTS for c in o["concepts"])
                    and _num(o["emotional_valence"], -1, 1))
        if task == "EXTRACT":
            return isinstance(o["memories"], list) and all(
                isinstance(m["content"], str) and isinstance(m["summary"], str) and m["type"] in MEMORY_TYPES
                for m in o["memories"])
        if task == "ENTITIES":
            return (isinstance(o["entities"], list) and all(
                isinstance(e["name"], str) and e["type"] in ENTITY_TYPES and _strs(e["aliases"]) for e in o["entities"])
                and isinstance(o["relations"], list) and all(
                isinstance(r["head"], str) and isinstance(r["type"], str) and isinstance(r["tail"], str)
                for r in o["relations"]))
        if task == "TEMPORAL":
            return (_str_or_none(o["event_date"]) and o["precision"] in DATE_PRECISION
                    and isinstance(o["links"], list)
                    and all(l["type"] in BOND_TYPES and isinstance(l["target"], str) for l in o["links"]))
        if task == "CONSOLIDATE":
            return isinstance(o["insights"], list) and all(
                isinstance(i["content"], str) and _strs(i["evidence"]) for i in o["insights"])
        if task == "COMPACT":
            dr = o["date_range"]
            return (isinstance(o["summary"], str) and _strs(o["preserved_entities"])
                    and _str_or_none(dr["start"]) and _str_or_none(dr["end"]))
        if task == "RECONCILE":
            return (o["verdict"] in VERDICTS and isinstance(o["resolution"], str)
                    and _str_or_none(o["weaker_id"]) and _num(o["confidence"], 0, 1))
        if task == "QUERY":
            tc = o["temporal_constraints"]
            return (_strs(o["expanded_queries"]) and _str_or_none(tc["after"]) and _str_or_none(tc["before"])
                    and isinstance(o["type_filters"], list) and all(t in MEMORY_TYPES for t in o["type_filters"])
                    and _strs(o["entities"]) and isinstance(o["intent"], str))
        if task == "ANSWER":
            return (isinstance(o["rationale"], str) and isinstance(o["answer"], str) and _strs(o["citations"])
                    and _num(o["confidence"], 0, 1) and isinstance(o["abstain"], bool))
        return False
    except (KeyError, TypeError):
        return False


def score(task: str, gold: dict, pred) -> bool:
    """Port of memopseval.ts score(): the load-bearing fields per task."""
    if not isinstance(pred, dict):
        return False
    g = gold
    p = pred
    try:
        if task == "CLASSIFY":
            return g.get("type") == p.get("type")
        if task == "TEMPORAL":
            return g.get("event_date") == p.get("event_date") and g.get("precision") == p.get("precision")
        if task == "RECONCILE":
            return g.get("verdict") == p.get("verdict") and g.get("weaker_id") == p.get("weaker_id")
        if task == "ENTITIES":
            gs = {e["name"].lower() for e in g.get("entities", [])}
            ps = {str(e.get("name", "")).lower() for e in p.get("entities", []) if isinstance(e, dict)}
            return gs <= ps
        if task == "EXTRACT":
            gt = sorted(m["type"] for m in g.get("memories", []))
            pt = sorted(str(m.get("type")) for m in p.get("memories", []) if isinstance(m, dict))
            return gt == pt
        if task == "CONSOLIDATE":
            gs = {e for i in g.get("insights", []) for e in i.get("evidence", [])}
            ps = {e for i in p.get("insights", []) if isinstance(i, dict) for e in i.get("evidence", [])}
            return any(e in ps for e in gs)
        if task == "COMPACT":
            if not isinstance(p.get("summary"), str) or not p["summary"].strip():
                return False
            pe = [str(e).lower() for e in p.get("preserved_entities", [])]
            kept = all(any(str(ge).lower() in n for n in pe) for ge in g.get("preserved_entities", []))
            gdr, pdr = g.get("date_range") or {}, p.get("date_range") or {}
            return kept and gdr.get("start") == pdr.get("start") and gdr.get("end") == pdr.get("end")
        if task == "QUERY":
            return g.get("intent") == p.get("intent")
        if task == "ANSWER":
            if g.get("abstain") != p.get("abstain"):
                return False
            if g.get("abstain"):
                return True
            return isinstance(p.get("answer"), str) and str(g.get("answer", "")).lower() in p["answer"].lower()
    except (AttributeError, TypeError):
        return False
    return False


def select_rows(rows: list[dict], per_task: int, seed: int = 0) -> list[dict]:
    if per_task <= 0:
        return list(rows)
    by_task: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_task[r["task"]].append(r)
    rng = random.Random(seed)
    picked: list[dict] = []
    for t in TASKS:
        pool = by_task.get(t, [])
        rng.shuffle(pool)
        picked.extend(pool[:per_task])
    return picked


@torch.no_grad()
def generate_batch(model, tok, prompts: list[str], max_new_tokens: int, device) -> list[str]:
    end_id = tok.convert_tokens_to_ids(END_TOKEN)
    tok.padding_side = "left"
    enc = tok(prompts, add_special_tokens=False, return_tensors="pt", padding=True).to(device)
    out = model.generate(
        **enc, max_new_tokens=max_new_tokens, do_sample=False, num_beams=1,
        eos_token_id=[end_id, tok.eos_token_id], pad_token_id=tok.pad_token_id, use_cache=True,
    )
    gen = out[:, enc["input_ids"].shape[1]:]
    return [strip_generation(tok.decode(g, skip_special_tokens=False)) for g in gen]


def evaluate(model, tok, rows: list[dict], per_task: int = 50, max_new_tokens: int = 384,
             batch_size: int = 8, device=None, quiet: bool = False, show: int = 0) -> dict:
    device = device or next(model.parameters()).device
    was_training = model.training
    model.eval()
    picked = select_rows(rows, per_task)
    items = []
    for r in picked:
        s, u, a = (m["content"] for m in r["messages"])
        items.append({"task": r["task"], "prompt": render_prompt(s, u), "gold": json.loads(a),
                      "answerable": (r.get("meta") or {}).get("answerable")})
    order = sorted(range(len(items)), key=lambda i: len(items[i]["prompt"]))
    t0 = time.time()
    for b in range(0, len(order), batch_size):
        idxs = order[b: b + batch_size]
        outs = generate_batch(model, tok, [items[i]["prompt"] for i in idxs], max_new_tokens, device)
        for i, text in zip(idxs, outs):
            items[i]["raw"] = text
            try:
                items[i]["pred"] = json.loads(text)
            except json.JSONDecodeError:
                items[i]["pred"] = None
        if not quiet:
            print(f"  generated {min(b + batch_size, len(order))}/{len(order)}  [{time.time() - t0:.0f}s]", end="\r")

    stat: dict[str, dict] = {t: {"n": 0, "correct": 0, "schema_ok": 0} for t in TASKS}
    abstain_n = abstain_ok = 0
    for it in items:
        s = stat[it["task"]]
        s["n"] += 1
        pred = it["pred"]
        it["schema_ok"] = schema_ok(it["task"], pred)
        it["correct"] = score(it["task"], it["gold"], pred)
        s["schema_ok"] += int(it["schema_ok"])
        s["correct"] += int(it["correct"])
        if it["task"] == "ANSWER" and it["answerable"] is False:
            abstain_n += 1
            abstain_ok += int(isinstance(pred, dict) and pred.get("abstain") is True)
    tasks = {}
    tot_n = tot_c = tot_s = 0
    for t, s in stat.items():
        if not s["n"]:
            continue
        tasks[t] = {**s, "acc": s["correct"] / s["n"], "schema": s["schema_ok"] / s["n"]}
        tot_n += s["n"]
        tot_c += s["correct"]
        tot_s += s["schema_ok"]
    res = {
        "n": tot_n,
        "tasks": tasks,
        "overall_acc": tot_c / max(1, tot_n),
        "overall_schema": tot_s / max(1, tot_n),
        "abstention": {"n": abstain_n, "correct": abstain_ok, "rate": abstain_ok / max(1, abstain_n)},
        "seconds": round(time.time() - t0, 1),
    }
    if not quiet:
        print(f"\nMemOpsEval (HF) — n={tot_n}  [{res['seconds']}s]")
        for t, v in tasks.items():
            print(f"  {t:<12} acc={100 * v['acc']:5.1f}%  schema={100 * v['schema']:5.1f}%  (n={v['n']})")
        print(f"  {'OVERALL':<12} acc={100 * res['overall_acc']:5.1f}%  schema={100 * res['overall_schema']:5.1f}%")
        if abstain_n:
            print(f"  abstention   {100 * res['abstention']['rate']:.1f}% of {abstain_n} unanswerable correctly refused")
        for it in items[:show]:
            print(f"\n--- {it['task']} correct={it['correct']} schema={it['schema_ok']}\n  gold: {json.dumps(it['gold'])[:300]}\n  pred: {it['raw'][:300]}")
    if was_training:
        model.train()
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True, help="HF checkpoint dir (final/ or ckpt-N/)")
    ap.add_argument("--data", required=True, help="held-out chat JSONL")
    ap.add_argument("--per-task", type=int, default=50, help="examples per task (0 = whole shard)")
    ap.add_argument("--max-new-tokens", type=int, default=384)
    ap.add_argument("--batch-size", type=int, default=8)
    ap.add_argument("--show", type=int, default=0, help="print N sample predictions")
    ap.add_argument("--out", default=None, help="write results JSON here")
    args = ap.parse_args()

    from transformers import AutoTokenizer, LlamaForCausalLM
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tok = AutoTokenizer.from_pretrained(args.model)
    model = LlamaForCausalLM.from_pretrained(
        args.model, dtype=torch.bfloat16 if device.type == "cuda" else torch.float32).to(device)
    rows = []
    with open(args.data) as f:
        for line in f:
            if line.strip():
                rows.append(json.loads(line))
    res = evaluate(model, tok, rows, per_task=args.per_task, max_new_tokens=args.max_new_tokens,
                   batch_size=args.batch_size, device=device, show=args.show)
    if args.out:
        with open(args.out, "w") as f:
            json.dump({"model": args.model, "data": args.data, **res}, f, indent=2)
        print(f"wrote {args.out}")


if __name__ == "__main__":
    sys.exit(main())
