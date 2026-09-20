#!/usr/bin/env python3
"""
Upload a CludeMem release directory to the Hugging Face Hub.

    HF_TOKEN=hf_... python push_to_hf.py --release <dir> --repo clude/cludemem-e4b \
        [--gguf-repo clude/cludemem-e4b-GGUF] [--private] [--dry-run]

The release directory is what release-v4-1m.startup.sh assembles:

    adapter/      adapter_config.json, adapter_model.safetensors, tokenizer files
    README.md     the model card (build_model_card.py)
    evals/        checkpoint_selection.json, canary.jsonl, DNLI results_all.json, ...
    gguf/         *.gguf (optional; goes to --gguf-repo when given, else alongside)

Everything under adapter/ lands at the repo root (that is where PeftModel.from_pretrained
looks); README.md and evals/ are uploaded as they are. Uploads are one commit per repo,
so a failed upload leaves no half-written model page.
"""
from __future__ import annotations

import argparse
import os
import sys


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--release", required=True, help="release directory (see module docstring)")
    ap.add_argument("--repo", required=True, help="adapter repo id, e.g. clude/cludemem-e4b")
    ap.add_argument("--gguf-repo", default=None, help="separate repo for the GGUF files (default: same repo)")
    ap.add_argument("--private", action="store_true", help="create the repo(s) private (default public)")
    ap.add_argument("--message", default=None, help="commit message (default derived from the release)")
    ap.add_argument("--dry-run", action="store_true", help="list what would be uploaded and exit")
    args = ap.parse_args()

    token = os.environ.get("HF_TOKEN")
    if not token and not args.dry_run:
        sys.exit("HF_TOKEN is not set")

    rel = os.path.abspath(args.release)
    adapter_dir = os.path.join(rel, "adapter")
    for required in ("adapter_config.json", "adapter_model.safetensors"):
        if not os.path.exists(os.path.join(adapter_dir, required)):
            sys.exit(f"{adapter_dir}/{required} is missing")
    card = os.path.join(rel, "README.md")
    if not os.path.exists(card):
        sys.exit(f"{card} is missing: build it with build_model_card.py first")
    evals_dir = os.path.join(rel, "evals")
    gguf_dir = os.path.join(rel, "gguf")
    gguf_files = sorted(f for f in os.listdir(gguf_dir) if f.endswith(".gguf")) if os.path.isdir(gguf_dir) else []

    # (local path, path in repo) for the adapter repo
    plan = [(os.path.join(adapter_dir, f), f) for f in sorted(os.listdir(adapter_dir))]
    plan.append((card, "README.md"))
    if os.path.isdir(evals_dir):
        for root, _dirs, files in os.walk(evals_dir):
            for f in sorted(files):
                p = os.path.join(root, f)
                plan.append((p, os.path.relpath(p, rel)))
    gguf_plan = [(os.path.join(gguf_dir, f), f) for f in gguf_files]
    gguf_repo = args.gguf_repo or args.repo
    if gguf_plan and gguf_repo == args.repo:
        plan += [(p, os.path.join("gguf", f)) for p, f in gguf_plan]
        gguf_plan = []

    def show(repo: str, items: list[tuple[str, str]]) -> None:
        total = sum(os.path.getsize(p) for p, _ in items)
        print(f"{repo}: {len(items)} files, {total / 1e9:.2f} GB")
        for p, dst in items:
            print(f"  {dst:50s} {os.path.getsize(p) / 1e6:10.1f} MB")

    show(args.repo, plan)
    if gguf_plan:
        show(gguf_repo, gguf_plan)
    if args.dry_run:
        return

    from huggingface_hub import CommitOperationAdd, HfApi

    api = HfApi(token=token)
    msg = args.message or f"CludeMem release from {os.path.basename(rel)}"

    def push(repo: str, items: list[tuple[str, str]], readme: str | None) -> str:
        api.create_repo(repo, repo_type="model", private=args.private, exist_ok=True)
        ops = [CommitOperationAdd(path_in_repo=dst, path_or_fileobj=p) for p, dst in items]
        if readme:
            ops.append(CommitOperationAdd(path_in_repo="README.md", path_or_fileobj=readme))
        info = api.create_commit(repo_id=repo, repo_type="model", operations=ops, commit_message=msg)
        return info.commit_url

    print("uploading adapter repo:", push(args.repo, plan, None))
    if gguf_plan:
        # The GGUF repo gets a short card pointing at the adapter repo; the full card lives there.
        stub = os.path.join(rel, "README.gguf.md")
        if not os.path.exists(stub):
            # same license as the adapter card's front matter (the GGUF is the merged derivative)
            lic = "apache-2.0"
            for line in open(card):
                if line.startswith("license:"):
                    lic = line.split(":", 1)[1].strip()
                    break
            with open(stub, "w") as f:
                f.write(f"---\nbase_model: {args.repo}\nlibrary_name: gguf\npipeline_tag: text-generation\n"
                        f"license: {lic}\ntags: [\"gguf\", \"llama.cpp\", \"ollama\", \"cludemem\"]\n---\n\n"
                        f"# GGUF builds of [{args.repo}](https://huggingface.co/{args.repo})\n\n"
                        + "\n".join(f"- `{f}` ({os.path.getsize(p) / 1e9:.2f} GB)" for p, f in gguf_plan)
                        + f"\n\nSee the adapter repo for evaluation numbers, the training recipe and usage.\n")
        print("uploading gguf repo:", push(gguf_repo, gguf_plan, stub))
    print(f"done: https://huggingface.co/{args.repo}")


if __name__ == "__main__":
    main()
