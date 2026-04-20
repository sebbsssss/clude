#!/usr/bin/env python3
"""
Multi-hop benchmark runner for Clude.

Runs HotPotQA, 2WikiMultiHop, and MuSiQue through the Clude adapter server
(http://127.0.0.1:9877) + gpt-4o-mini answering. Outputs MABench-compatible
results JSON so the existing collect-results pipeline can aggregate.

Usage:
    # Ensure clude-adapter server running: npx tsx experiments/MemoryAgentBench/clude-adapter/server.ts
    # Ensure OPENAI_API_KEY in .env
    python scripts/benchmark/run-multihop.py --dataset hotpot --n 25
    python scripts/benchmark/run-multihop.py --dataset 2wiki --n 25
    python scripts/benchmark/run-multihop.py --dataset musique --n 25
    python scripts/benchmark/run-multihop.py --dataset all --n 25   # all three sequential

Output: experiments/MemoryAgentBench/outputs/gpt-4o-mini-clude/Multi_Hop/<dataset>_results.json
"""
import argparse
import json
import os
import re
import string
import sys
import time
import urllib.request
from collections import Counter
from pathlib import Path

import requests  # type: ignore
from openai import OpenAI  # type: ignore

# ── Config ─────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "experiments" / "MemoryAgentBench" / "data" / "multihop"
OUT_DIR = REPO_ROOT / "experiments" / "MemoryAgentBench" / "outputs" / "gpt-4o-mini-clude" / "Multi_Hop"
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUT_DIR.mkdir(parents=True, exist_ok=True)

CLUDE_URL = os.environ.get("CLUDE_URL", "http://127.0.0.1:9877")
OPENAI_MODEL = "gpt-4o-mini"

DATASETS = {
    "hotpot": {
        "url": "http://curtis.ml.cmu.edu/datasets/hotpot/hotpot_dev_distractor_v1.json",
        "filename": "hotpot_dev.json",
        "parser": "parse_hotpot",
    },
    "2wiki": {
        "url": "https://huggingface.co/datasets/voidful/2WikiMultihopQA/resolve/main/dev.json",
        "filename": "2wiki_dev.json",
        "parser": "parse_2wiki",
    },
    "musique": {
        # Google Drive: we skip in this runner — add a manual-download note if this dataset is required
        "url": None,
        "filename": "musique_dev.jsonl",
        "parser": "parse_musique",
    },
}


# ── Download helpers ───────────────────────────────────────────────────
def download(url: str, dest: Path) -> None:
    if dest.exists():
        return
    print(f"Downloading {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "clude-benchmark/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(dest, "wb") as f:
        f.write(r.read())
    print(f"Saved {dest} ({dest.stat().st_size // 1024} KB)")


# ── Parsers ────────────────────────────────────────────────────────────
def parse_hotpot(path: Path) -> list:
    """HotPotQA distractor: list of {_id, question, answer, context:[[title,[sents]]], supporting_facts}."""
    items = json.loads(path.read_text())
    out = []
    for it in items:
        # Build full context: all paragraphs concatenated with titles as headers
        full_context = "\n\n".join(
            f"# {title}\n" + " ".join(sents)
            for title, sents in it["context"]
        )
        out.append({
            "id": it["_id"],
            "question": it["question"],
            "answer": it["answer"],
            "context": full_context,
            "dataset": "hotpot",
        })
    return out


def parse_2wiki(path: Path) -> list:
    """2WikiMultiHop dev format: same shape as HotPotQA."""
    items = json.loads(path.read_text())
    out = []
    for it in items:
        full_context = "\n\n".join(
            f"# {title}\n" + " ".join(sents)
            for title, sents in it["context"]
        )
        out.append({
            "id": it.get("_id", str(len(out))),
            "question": it["question"],
            "answer": it["answer"],
            "context": full_context,
            "dataset": "2wiki",
        })
    return out


def parse_musique(path: Path) -> list:
    """MuSiQue jsonl: {id, question, answer, paragraphs:[{title,text}]}."""
    items = [json.loads(ln) for ln in path.read_text().splitlines() if ln.strip()]
    out = []
    for it in items:
        full_context = "\n\n".join(
            f"# {p.get('title','')}\n{p.get('paragraph_text', p.get('text', ''))}"
            for p in it.get("paragraphs", [])
        )
        out.append({
            "id": it.get("id", str(len(out))),
            "question": it["question"],
            "answer": it.get("answer", ""),
            "context": full_context,
            "dataset": "musique",
        })
    return out


# ── Clude adapter I/O ──────────────────────────────────────────────────
def clude_health() -> bool:
    try:
        r = requests.get(f"{CLUDE_URL}/health", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


def clude_store(context_id: str, chunks: list[str]) -> None:
    """Store a list of text chunks into Clude under a shared context_id.
    Uses /store-batch with the adapter's expected shape:
      { memories: [{content, type, tags?, importance?}], context_id }
    """
    r = requests.post(
        f"{CLUDE_URL}/store-batch",
        json={
            "context_id": context_id,
            "memories": [
                {"content": c, "type": "episodic", "importance": 0.5}
                for c in chunks
            ],
        },
        timeout=180,
    )
    r.raise_for_status()


def clude_recall(context_id: str, query: str, k: int = 10) -> list[str]:
    """Retrieve top-k chunks from Clude for a given query.
    Adapter returns {"count", "memories": [{content, ...}]}.
    """
    r = requests.post(
        f"{CLUDE_URL}/recall",
        json={"context_id": context_id, "query": query, "limit": k},
        timeout=120,
    )
    r.raise_for_status()
    data = r.json()
    return [m.get("content", "") for m in data.get("memories", [])]


# ── Answer + score ─────────────────────────────────────────────────────
def answer_with_gpt(client: OpenAI, system: str, context: str, question: str) -> tuple[str, int, int]:
    user = f"Context:\n{context}\n\nQuestion: {question}\n\nAnswer concisely."
    for attempt in range(5):
        try:
            resp = client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                temperature=0.0,
                max_tokens=128,
            )
            return (
                resp.choices[0].message.content or "",
                resp.usage.prompt_tokens,
                resp.usage.completion_tokens,
            )
        except Exception as e:
            msg = str(e)
            if "429" in msg or "rate_limit" in msg:
                wait = 30 * (2 ** attempt)
                print(f"  rate-limited, waiting {wait}s (attempt {attempt+1}/5)")
                time.sleep(wait)
                if attempt == 4:
                    raise
            else:
                raise
    return "", 0, 0


# Standard HotPotQA-style scoring
def normalize(s: str) -> str:
    s = s.lower()
    s = re.sub(r"\b(a|an|the)\b", " ", s)
    s = "".join(c for c in s if c not in set(string.punctuation))
    return " ".join(s.split())


def exact_match(pred: str, gold: str) -> float:
    return 1.0 if normalize(pred) == normalize(gold) else 0.0


def f1(pred: str, gold: str) -> float:
    pt, gt = normalize(pred).split(), normalize(gold).split()
    if not pt or not gt:
        return 1.0 if pt == gt else 0.0
    common = Counter(pt) & Counter(gt)
    same = sum(common.values())
    if same == 0:
        return 0.0
    p = same / len(pt)
    r = same / len(gt)
    return 2 * p * r / (p + r)


def substring_match(pred: str, gold: str) -> float:
    return 1.0 if normalize(gold) in normalize(pred) else 0.0


# ── Main per-dataset runner ────────────────────────────────────────────
def run_one(dataset_key: str, n: int, client: OpenAI) -> dict:
    spec = DATASETS[dataset_key]
    dest = DATA_DIR / spec["filename"]

    if spec["url"] is None:
        if not dest.exists():
            print(f"[{dataset_key}] skipped — no URL (manual download needed)")
            return {"skipped": True, "reason": "no_auto_download_url", "dataset": dataset_key}
    else:
        download(spec["url"], dest)

    parser = globals()[spec["parser"]]
    items = parser(dest)
    print(f"[{dataset_key}] loaded {len(items)} items")
    items = items[:n]
    print(f"[{dataset_key}] evaluating first {len(items)} items (--n)")

    system = (
        "You answer multi-hop questions using provided context. "
        "Give a short, direct answer — typically 1-5 words. "
        "If the context is insufficient, say so briefly."
    )

    results = []
    t0 = time.time()
    for i, item in enumerate(items, 1):
        q_start = time.time()
        ctx_id = f"multihop-{dataset_key}-{item['id']}"
        # Chunk context into ~500-word pieces for storage
        paras = [p.strip() for p in item["context"].split("\n\n") if p.strip()]
        try:
            clude_store(ctx_id, paras)
            retrieved = clude_recall(ctx_id, item["question"], k=10)
            retrieved_str = "\n\n".join(
                c if isinstance(c, str) else c.get("content", "")
                for c in retrieved
            )
            pred, in_tok, out_tok = answer_with_gpt(client, system, retrieved_str, item["question"])
        except Exception as e:
            print(f"[{dataset_key}] {i}/{len(items)} FAILED: {e}")
            results.append({
                "id": item["id"],
                "question": item["question"],
                "gold": item["answer"],
                "pred": "",
                "error": str(e),
                "exact_match": 0.0,
                "f1": 0.0,
                "substring_match": 0.0,
                "time_sec": time.time() - q_start,
            })
            continue

        r = {
            "id": item["id"],
            "question": item["question"],
            "gold": item["answer"],
            "pred": pred,
            "exact_match": exact_match(pred, item["answer"]),
            "f1": f1(pred, item["answer"]),
            "substring_match": substring_match(pred, item["answer"]),
            "retrieved_chunks": len(retrieved),
            "input_tokens": in_tok,
            "output_tokens": out_tok,
            "time_sec": time.time() - q_start,
        }
        results.append(r)
        if i % 5 == 0 or i == len(items):
            avg_em = sum(x["exact_match"] for x in results) / len(results)
            avg_f1 = sum(x["f1"] for x in results) / len(results)
            avg_sub = sum(x["substring_match"] for x in results) / len(results)
            print(f"[{dataset_key}] {i}/{len(items)}  EM={avg_em:.3f}  F1={avg_f1:.3f}  SUB={avg_sub:.3f}")

    total_time = time.time() - t0
    avg = {
        "exact_match": sum(x["exact_match"] for x in results) / len(results),
        "f1": sum(x["f1"] for x in results) / len(results),
        "substring_match": sum(x["substring_match"] for x in results) / len(results),
    }

    out_path = OUT_DIR / f"{dataset_key}_n{len(items)}_results.json"
    out_path.write_text(json.dumps({
        "dataset": dataset_key,
        "n": len(items),
        "model": OPENAI_MODEL,
        "clude_url": CLUDE_URL,
        "averaged_metrics": avg,
        "total_time_sec": total_time,
        "results": results,
    }, indent=2))
    print(f"[{dataset_key}] done — wrote {out_path}")
    print(f"[{dataset_key}] final  EM={avg['exact_match']:.3f}  F1={avg['f1']:.3f}  SUB={avg['substring_match']:.3f}  ({total_time:.0f}s)")
    return {"dataset": dataset_key, "out_path": str(out_path), **avg}


# ── Entry ──────────────────────────────────────────────────────────────
def main():
    p = argparse.ArgumentParser()
    p.add_argument("--dataset", choices=["hotpot", "2wiki", "musique", "all"], required=True)
    p.add_argument("--n", type=int, default=25, help="Samples per dataset")
    args = p.parse_args()

    # .env load (simple)
    env_path = REPO_ROOT / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k, v)

    if not os.environ.get("OPENAI_API_KEY"):
        print("ERROR: OPENAI_API_KEY not set")
        sys.exit(1)

    if not clude_health():
        print(f"ERROR: clude-adapter not reachable at {CLUDE_URL}")
        print("Start it: npx tsx experiments/MemoryAgentBench/clude-adapter/server.ts")
        sys.exit(1)

    client = OpenAI()
    targets = ["hotpot", "2wiki", "musique"] if args.dataset == "all" else [args.dataset]

    summary = []
    for t in targets:
        try:
            summary.append(run_one(t, args.n, client))
        except Exception as e:
            print(f"[{t}] CRASHED: {e}")
            summary.append({"dataset": t, "error": str(e)})

    print("\n━━━ Multi-hop summary ━━━")
    for s in summary:
        print(json.dumps(s, indent=2))


if __name__ == "__main__":
    main()
