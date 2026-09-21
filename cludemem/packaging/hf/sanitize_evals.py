#!/usr/bin/env python3
"""
Strip corpus and machine details from the evaluation artefacts before they are published.

    python sanitize_evals.py <release>/evals

What is removed, in place:
  - config.json, canary.jsonl (and the WINNER / TRAIN_STEP markers): they carry the training file list, per-source row counts,
    data directories and local paths. The card's Training table already holds what a reader
    needs (rank, alpha, steps, stack), so both are deleted from the release.
  - every remaining JSON: keys whose values are local paths (adapter_dir, winner_dir, json,
    adapter, data_dir, ...) and the trainer's canary_settings block are dropped, recursively.
The numbers are untouched: scores, token counts, per-task tables and trajectories stay as they are.
"""
from __future__ import annotations

import json
import os
import sys

DROP_KEYS = {"adapter_dir", "winner_dir", "json", "adapter", "data_dir", "canary_settings", "out", "cwd", "script", "canary_script"}
DROP_FILES = {"config.json", "canary.jsonl", "WINNER", "TRAIN_STEP"}


def scrub(obj):
    if isinstance(obj, dict):
        return {k: scrub(v) for k, v in obj.items()
                if k not in DROP_KEYS and not (isinstance(v, str) and v.startswith("/"))}
    if isinstance(obj, list):
        return [scrub(x) for x in obj]
    return obj


def main(root: str) -> None:
    removed, rewritten = [], []
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            p = os.path.join(dirpath, f)
            if f in DROP_FILES:
                os.remove(p)
                removed.append(os.path.relpath(p, root))
            elif f.endswith(".json"):
                with open(p) as fh:
                    data = json.load(fh)
                with open(p, "w") as fh:
                    json.dump(scrub(data), fh, indent=1)
                rewritten.append(os.path.relpath(p, root))
    print(f"removed: {removed}\nscrubbed: {rewritten}")


if __name__ == "__main__":
    if len(sys.argv) != 2 or not os.path.isdir(sys.argv[1]):
        sys.exit(__doc__)
    main(sys.argv[1])
