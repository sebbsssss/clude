#!/usr/bin/env python3
"""
Gather natural-language text for `tokenizer_49m.py --extra-text`.

The data-engine corpus is deliberately templated (labels are exact by
construction), which leaves it lexically thin: SentencePiece finds only ~2.5K
distinct pieces in it, far short of the 16K vocabulary CludeMem-49M budgets.
This pulls real agent-memory prose that already lives in the repo (exported
memories, demo seed memories, design docs) into one line-per-sentence file so
the BPE learns ordinary English + JSON-in-prose subword statistics.

It only shapes the tokenizer. No training labels come from here, and nothing
from an evaluation set (LoCoMo / LongMemEval caches) may be passed in.

  python collect_text.py --out ../data/tokenizer-extra.txt \
      ../../clude-memories.json ../../test-memory-pack.json \
      ../../scripts/demo/seed-maya-data/*.json ../../docs/*.md ../../docs/*/*.md ../../README.md
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

EVAL_MARKERS = ("longmemeval", "locomo", "halumem")


def strings_from_json(node, out: list[str]) -> None:
    if isinstance(node, str):
        if len(node.split()) >= 3:
            out.append(node)
    elif isinstance(node, dict):
        for v in node.values():
            strings_from_json(v, out)
    elif isinstance(node, list):
        for v in node:
            strings_from_json(v, out)


def lines_from_file(path: str) -> list[str]:
    low = path.lower()
    if any(m in low for m in EVAL_MARKERS):
        raise SystemExit(f"refusing evaluation-set text: {path}")
    out: list[str] = []
    if low.endswith(".jsonl"):
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line:
                    strings_from_json(json.loads(line), out)
    elif low.endswith(".json"):
        with open(path) as f:
            strings_from_json(json.load(f), out)
    else:
        with open(path, errors="replace") as f:
            out.extend(f.read().split("\n"))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-words", type=int, default=3)
    args = ap.parse_args()

    seen: set[str] = set()
    n_files = 0
    with open(args.out, "w") as out:
        for path in args.files:
            if not os.path.isfile(path):
                continue
            n_files += 1
            for text in lines_from_file(path):
                for line in text.split("\n"):
                    line = re.sub(r"\s+", " ", line).strip()
                    if len(line.split()) >= args.min_words and line not in seen:
                        seen.add(line)
                        out.write(line + "\n")
    size = os.path.getsize(args.out)
    print(f"[collect_text] {n_files} files -> {len(seen)} unique lines, {size / 1e6:.2f} MB -> {args.out}")
    if size < 200_000:
        print("[collect_text] warning: under 200KB of text; a 16K vocabulary may not be reachable", file=sys.stderr)


if __name__ == "__main__":
    main()
