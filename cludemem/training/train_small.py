#!/usr/bin/env python3
"""
CludeMem-49M — train a small memory-ops model FROM SCRATCH on the data-engine corpus.

train_qlora.py adapts Gemma 4 E4B (a 24GB GPU, the Gemma licence). This file is
the other end of the size axis: a 49.3M-parameter Llama-architecture decoder,
random init, trained only on CludeMem data. It converts to GGUF with stock
llama.cpp (packaging/export_gguf.sh) and serves from Ollama through the same
MEMORY_MODEL seam — Ollama's JSON-schema `format` constrains decoding, so the
small model only has to get the VALUES right.

  python tokenizer_49m.py --data ../data/train.jsonl --out ./tokenizer-49m --extra-text ../data/tokenizer-extra.txt
  python train_small.py --data ../data/train.jsonl --eval-data ../data/heldout.jsonl \
      --tokenizer ./tokenizer-49m --out ./runs/cludemem-49m --preset 49m --epochs 3

  # CPU smoke (a few minutes): tiny preset, short sequences
  python train_small.py ... --preset smoke --max-steps 60 --max-seq 512 --tokens-per-batch 2048

Design
- Loss on the assistant span only (the strict JSON + terminators); prompt
  tokens carry label -100. Wire format: chat_format.py.
- Length-bucketed, token-budgeted batches with dynamic padding. No packing,
  so no cross-example attention leakage and exact per-token loss weighting.
- AdamW (0.9, 0.95), weight decay 0.1 on matrices only, cosine LR with linear
  warmup, grad-clip 1.0, bf16 autocast on CUDA (fp32 on CPU).
- Every checkpoint is a complete HF directory (config + safetensors +
  tokenizer + chat template) plus training_state.pt, so `--resume auto`
  continues exactly and any checkpoint can be exported.
"""
from __future__ import annotations

import argparse
import glob
import json
import math
import os
import random
import shutil
import sys
import time
from collections import Counter
from dataclasses import dataclass

import torch
import torch.nn.functional as F

from chat_format import END_TOKEN, render_prompt, render_target

# name -> Llama config overrides. Parameter counts assume vocab 16384 + tied embeddings.
PRESETS: dict[str, dict] = {
    # ~2.9M params: only for exercising the pipeline on a laptop CPU.
    "smoke": dict(hidden_size=128, num_hidden_layers=2, num_attention_heads=4,
                  num_key_value_heads=4, intermediate_size=384),
    # 49.3M params — the CludeMem-49M target.
    "49m": dict(hidden_size=512, num_hidden_layers=12, num_attention_heads=8,
                num_key_value_heads=8, intermediate_size=1536),
    # ~105M params if a bigger local model is wanted later.
    "105m": dict(hidden_size=768, num_hidden_layers=12, num_attention_heads=12,
                 num_key_value_heads=12, intermediate_size=2304),
}


@dataclass
class Row:
    task: str
    input_ids: list[int]
    labels: list[int]
    n_target: int


# ────────────────────────────────────────────────────────────── data ──

def read_jsonl(path: str, limit: int | None = None) -> list[dict]:
    rows = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
                if limit and len(rows) >= limit:
                    break
    return rows


def encode_rows(raw: list[dict], tok, max_seq: int) -> tuple[list[Row], Counter, list[int]]:
    prompts, targets = [], []
    for r in raw:
        s, u, a = (m["content"] for m in r["messages"])
        prompts.append(render_prompt(s, u))
        targets.append(render_target(a))
    p_ids = tok(prompts, add_special_tokens=False).input_ids
    t_ids = tok(targets, add_special_tokens=False).input_ids
    rows: list[Row] = []
    dropped: Counter = Counter()
    lengths: list[int] = []
    for r, p, t in zip(raw, p_ids, t_ids):
        n = len(p) + len(t)
        lengths.append(n)
        if n > max_seq:
            dropped[r["task"]] += 1
            continue
        rows.append(Row(r["task"], p + t, [-100] * len(p) + t, len(t)))
    return rows, dropped, lengths


def make_batches(rows: list[Row], tokens_per_batch: int, seed: int, epoch: int) -> list[list[int]]:
    """Length-bucketed batches under a padded-token budget, shuffled per epoch."""
    rng = random.Random(seed * 7919 + epoch)
    order = sorted(range(len(rows)), key=lambda i: len(rows[i].input_ids) + rng.random() * 16)
    batches: list[list[int]] = []
    cur: list[int] = []
    cur_max = 0
    for i in order:
        n = len(rows[i].input_ids)
        new_max = max(cur_max, n)
        if cur and new_max * (len(cur) + 1) > tokens_per_batch:
            batches.append(cur)
            cur, new_max = [], n
        cur.append(i)
        cur_max = new_max
    if cur:
        batches.append(cur)
    rng.shuffle(batches)
    return batches


def collate(rows: list[Row], idxs: list[int], pad_id: int, device: torch.device):
    L = max(len(rows[i].input_ids) for i in idxs)
    ids = torch.full((len(idxs), L), pad_id, dtype=torch.long)
    lab = torch.full((len(idxs), L), -100, dtype=torch.long)
    att = torch.zeros((len(idxs), L), dtype=torch.long)
    for r, i in enumerate(idxs):
        n = len(rows[i].input_ids)
        ids[r, :n] = torch.tensor(rows[i].input_ids)
        lab[r, :n] = torch.tensor(rows[i].labels)
        att[r, :n] = 1
    return ids.to(device), lab.to(device), att.to(device)


# ───────────────────────────────────────────────────────────── model ──

def build_model(tok, preset: str, max_seq: int, overrides: dict):
    from transformers import LlamaConfig, LlamaForCausalLM

    cfg = dict(PRESETS[preset])
    cfg.update({k: v for k, v in overrides.items() if v is not None})
    config = LlamaConfig(
        vocab_size=len(tok),
        max_position_embeddings=max(max_seq, 4096),
        rms_norm_eps=1e-5,
        rope_theta=10000.0,
        tie_word_embeddings=True,
        attention_bias=False,
        mlp_bias=False,
        bos_token_id=tok.bos_token_id,
        eos_token_id=tok.eos_token_id,
        pad_token_id=tok.pad_token_id,
        initializer_range=0.02,
        **cfg,
    )
    config.use_cache = False
    model = LlamaForCausalLM(config)
    return model


def count_params(model) -> tuple[int, int]:
    total = sum(p.numel() for p in model.parameters())
    emb = model.get_input_embeddings().weight.numel()
    return total, emb


def lm_loss_sum(model, ids, lab, att):
    logits = model(input_ids=ids, attention_mask=att).logits
    shift_logits = logits[:, :-1, :].float()
    shift_labels = lab[:, 1:]
    return F.cross_entropy(
        shift_logits.reshape(-1, shift_logits.size(-1)), shift_labels.reshape(-1),
        ignore_index=-100, reduction="sum",
    )


def lr_at(step: int, total: int, warmup: int, lr: float, min_ratio: float) -> float:
    if step < warmup:
        return lr * (step + 1) / max(1, warmup)
    progress = min(1.0, (step - warmup) / max(1, total - warmup))
    return lr * (min_ratio + (1 - min_ratio) * 0.5 * (1 + math.cos(math.pi * progress)))


@torch.no_grad()
def eval_loss(model, rows: list[Row], tokens_per_batch: int, pad_id: int, device, autocast) -> float:
    model.eval()
    total, n = 0.0, 0
    for idxs in make_batches(rows, tokens_per_batch, seed=0, epoch=0):
        ids, lab, att = collate(rows, idxs, pad_id, device)
        with autocast():
            total += lm_loss_sum(model, ids, lab, att).item()
        n += sum(rows[i].n_target for i in idxs)
    model.train()
    return total / max(1, n)


# ─────────────────────────────────────────────────────── checkpoints ──

def save_checkpoint(path: str, model, tok, optimizer, state: dict, keep: int, out_dir: str) -> None:
    tmp = path + ".tmp"
    if os.path.exists(tmp):
        shutil.rmtree(tmp)
    model.save_pretrained(tmp, safe_serialization=True)
    tok.save_pretrained(tmp)
    torch.save({**state, "optimizer": optimizer.state_dict(), "torch_rng": torch.get_rng_state()},
               os.path.join(tmp, "training_state.pt"))
    if os.path.exists(path):
        shutil.rmtree(path)
    os.replace(tmp, path)
    ckpts = sorted(glob.glob(os.path.join(out_dir, "ckpt-*")), key=lambda p: int(p.rsplit("-", 1)[1]))
    for old in ckpts[:-keep]:
        shutil.rmtree(old)


def find_resume(out_dir: str, resume: str | None) -> str | None:
    if not resume:
        return None
    if resume != "auto":
        return resume
    ckpts = sorted(glob.glob(os.path.join(out_dir, "ckpt-*")), key=lambda p: int(p.rsplit("-", 1)[1]))
    return ckpts[-1] if ckpts else None


# ─────────────────────────────────────────────────────────────── main ──

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", required=True, help="training shard (chat JSONL from the data engine)")
    ap.add_argument("--eval-data", default=None, help="held-out shard for eval loss")
    ap.add_argument("--tokenizer", required=True, help="dir written by tokenizer_49m.py")
    ap.add_argument("--out", required=True)
    ap.add_argument("--preset", default="49m", choices=sorted(PRESETS))
    ap.add_argument("--hidden", type=int, default=None)
    ap.add_argument("--layers", type=int, default=None)
    ap.add_argument("--heads", type=int, default=None)
    ap.add_argument("--kv-heads", type=int, default=None)
    ap.add_argument("--intermediate", type=int, default=None)
    ap.add_argument("--max-seq", type=int, default=4096, help="examples longer than this are dropped (reported)")
    ap.add_argument("--tokens-per-batch", type=int, default=16384, help="padded tokens per micro-batch")
    ap.add_argument("--grad-accum", type=int, default=4)
    ap.add_argument("--epochs", type=float, default=3.0)
    ap.add_argument("--max-steps", type=int, default=0, help="stop after N optimizer steps (0 = by epochs)")
    ap.add_argument("--lr", type=float, default=5e-4)
    ap.add_argument("--min-lr-ratio", type=float, default=0.1)
    ap.add_argument("--warmup", type=int, default=200)
    ap.add_argument("--weight-decay", type=float, default=0.1)
    ap.add_argument("--clip", type=float, default=1.0)
    ap.add_argument("--seed", type=int, default=3407)
    ap.add_argument("--limit", type=int, default=0, help="use only the first N training rows (smoke)")
    ap.add_argument("--eval-examples", type=int, default=1000)
    ap.add_argument("--eval-every", type=int, default=200)
    ap.add_argument("--gen-eval-per-task", type=int, default=0,
                    help="if >0, also run generation accuracy (eval_small) on N examples per task at each eval")
    ap.add_argument("--gen-eval-max-new-tokens", type=int, default=384)
    ap.add_argument("--save-every", type=int, default=500)
    ap.add_argument("--keep", type=int, default=2, help="checkpoints to keep")
    ap.add_argument("--log-every", type=int, default=10)
    ap.add_argument("--resume", default=None, help="checkpoint dir, or 'auto' for the latest in --out")
    ap.add_argument("--compile", action="store_true")
    ap.add_argument("--grad-checkpointing", action="store_true")
    ap.add_argument("--wandb-project", default=None)
    ap.add_argument("--dry-run", action="store_true", help="build model + dataset, print stats, exit")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if device.type == "cpu":
        torch.set_num_threads(os.cpu_count() or 1)
    else:
        torch.backends.cuda.matmul.allow_tf32 = True
    autocast = (lambda: torch.autocast("cuda", dtype=torch.bfloat16)) if device.type == "cuda" \
        else (lambda: torch.autocast("cpu", enabled=False))

    from transformers import AutoTokenizer, GenerationConfig, LlamaForCausalLM
    from transformers.utils import logging as hf_logging
    hf_logging.disable_progress_bar()
    tok = AutoTokenizer.from_pretrained(args.tokenizer)
    pad_id = tok.pad_token_id
    end_id = tok.convert_tokens_to_ids(END_TOKEN)
    assert pad_id is not None and end_id is not None and end_id != tok.unk_token_id

    # ── data ──
    t0 = time.time()
    raw = read_jsonl(args.data, args.limit or None)
    rows, dropped, lengths = encode_rows(raw, tok, args.max_seq)
    lengths.sort()
    q = lambda p: lengths[min(len(lengths) - 1, int(p * len(lengths)))]
    print(f"[data] {len(rows)} rows kept, {sum(dropped.values())} dropped (> {args.max_seq} tokens): "
          f"{dict(dropped) or 'none'}; tokens/example p50={q(.5)} p90={q(.9)} p99={q(.99)} max={lengths[-1]}  "
          f"[{time.time() - t0:.1f}s]")
    print(f"[data] task mix: {dict(Counter(r.task for r in rows))}")
    eval_rows: list[Row] = []
    eval_raw: list[dict] = []
    if args.eval_data:
        eval_raw = read_jsonl(args.eval_data)
        rng = random.Random(0)
        rng.shuffle(eval_raw)
        eval_raw = eval_raw[: args.eval_examples]
        eval_rows, edropped, _ = encode_rows(eval_raw, tok, args.max_seq)
        print(f"[data] eval: {len(eval_rows)} rows ({sum(edropped.values())} dropped)")

    # ── model ──
    resume_dir = find_resume(args.out, args.resume)
    if resume_dir:
        model = LlamaForCausalLM.from_pretrained(resume_dir, dtype=torch.float32)
        model.config.use_cache = False
        state = torch.load(os.path.join(resume_dir, "training_state.pt"), map_location="cpu", weights_only=False)
        print(f"[resume] {resume_dir} @ step {state['step']} (epoch {state['epoch']}, batch {state['batch_pos']})")
    else:
        model = build_model(tok, args.preset, args.max_seq, dict(
            hidden_size=args.hidden, num_hidden_layers=args.layers, num_attention_heads=args.heads,
            num_key_value_heads=args.kv_heads, intermediate_size=args.intermediate))
        state = {"step": 0, "epoch": 0, "batch_pos": 0}
    model.to(device)
    if args.grad_checkpointing:
        model.gradient_checkpointing_enable()
    total, emb = count_params(model)
    c = model.config
    print(f"[model] preset={args.preset} hidden={c.hidden_size} layers={c.num_hidden_layers} heads={c.num_attention_heads}"
          f" kv={c.num_key_value_heads} inter={c.intermediate_size} vocab={c.vocab_size} tied={c.tie_word_embeddings}")
    print(f"[model] parameters: {total / 1e6:.2f}M total, {emb / 1e6:.2f}M embedding, {(total - emb) / 1e6:.2f}M non-embedding  device={device}")

    steps_per_epoch = max(1, len(make_batches(rows, args.tokens_per_batch, args.seed, 0)) // args.grad_accum)
    total_steps = args.max_steps or int(math.ceil(args.epochs * steps_per_epoch))
    print(f"[train] {steps_per_epoch} steps/epoch x grad_accum {args.grad_accum} micro-batches of <= {args.tokens_per_batch} tokens; "
          f"total steps={total_steps}; warmup={args.warmup}; lr={args.lr}")
    if args.dry_run:
        return

    decay, no_decay = [], []
    for n, p in model.named_parameters():
        (decay if p.ndim >= 2 else no_decay).append(p)
    optimizer = torch.optim.AdamW(
        [{"params": decay, "weight_decay": args.weight_decay}, {"params": no_decay, "weight_decay": 0.0}],
        lr=args.lr, betas=(0.9, 0.95), eps=1e-8, fused=(device.type == "cuda"))
    if resume_dir:
        optimizer.load_state_dict(state["optimizer"])
        torch.set_rng_state(state["torch_rng"])
    train_model = torch.compile(model) if args.compile else model

    wandb = None
    if args.wandb_project:
        import wandb as _wandb
        wandb = _wandb
        wandb.init(project=args.wandb_project, config=vars(args), resume="allow")

    os.makedirs(args.out, exist_ok=True)
    log_f = open(os.path.join(args.out, "log.jsonl"), "a")

    def log(rec: dict) -> None:
        log_f.write(json.dumps(rec) + "\n")
        log_f.flush()
        if wandb:
            wandb.log(rec, step=rec.get("step"))

    last_eval_step = -1

    def run_eval(step: int) -> None:
        nonlocal last_eval_step
        if step == last_eval_step:
            return
        last_eval_step = step
        rec = {"step": step, "epoch": epoch}
        if eval_rows:
            rec["eval_loss"] = eval_loss(model, eval_rows, args.tokens_per_batch, pad_id, device, autocast)
            print(f"[eval] step {step}: eval_loss={rec['eval_loss']:.4f}")
        if args.gen_eval_per_task and eval_raw:
            from eval_small import evaluate
            res = evaluate(model, tok, eval_raw, per_task=args.gen_eval_per_task,
                           max_new_tokens=args.gen_eval_max_new_tokens, batch_size=8, device=device, quiet=True)
            rec.update({f"acc/{t}": v["acc"] for t, v in res["tasks"].items()})
            rec["acc/overall"] = res["overall_acc"]
            rec["schema/overall"] = res["overall_schema"]
            print(f"[eval] step {step}: gen acc={res['overall_acc']:.3f} schema={res['overall_schema']:.3f} "
                  + " ".join(f"{t}={v['acc']:.2f}" for t, v in res["tasks"].items()))
            model.train()
        log(rec)

    # ── loop ──
    model.train()
    step = state["step"]
    epoch = state["epoch"]
    batch_pos = state["batch_pos"]
    t_start = time.time()
    tokens_seen = 0
    done = step >= total_steps
    while not done:
        batches = make_batches(rows, args.tokens_per_batch, args.seed, epoch)
        if len(batches) < args.grad_accum:
            raise SystemExit(f"only {len(batches)} micro-batches per epoch but --grad-accum {args.grad_accum}: "
                             f"lower --grad-accum / --tokens-per-batch or add data")
        while batch_pos + args.grad_accum <= len(batches) and not done:
            group = batches[batch_pos: batch_pos + args.grad_accum]
            n_target = sum(rows[i].n_target for b in group for i in b)
            lr = lr_at(step, total_steps, args.warmup, args.lr, args.min_lr_ratio)
            for g in optimizer.param_groups:
                g["lr"] = lr
            loss_sum = 0.0
            for idxs in group:
                ids, lab, att = collate(rows, idxs, pad_id, device)
                with autocast():
                    loss = lm_loss_sum(train_model, ids, lab, att) / n_target
                loss.backward()
                loss_sum += loss.item()
                tokens_seen += int(att.sum())
            grad_norm = torch.nn.utils.clip_grad_norm_(model.parameters(), args.clip).item()
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)
            step += 1
            batch_pos += args.grad_accum

            if step % args.log_every == 0 or step == 1:
                elapsed = time.time() - t_start
                rec = {"step": step, "epoch": epoch, "loss": round(loss_sum, 4), "lr": lr,
                       "grad_norm": round(grad_norm, 3), "tok_per_s": round(tokens_seen / max(1e-6, elapsed)),
                       "elapsed_s": round(elapsed)}
                eta = (total_steps - step) * elapsed / max(1, step - state["step"])
                print(f"[train] step {step}/{total_steps} ep {epoch} loss {loss_sum:.4f} lr {lr:.2e} "
                      f"gn {grad_norm:.2f} {rec['tok_per_s']} tok/s eta {eta / 60:.1f}m")
                log(rec)
            if args.eval_every and step % args.eval_every == 0:
                run_eval(step)
            if args.save_every and step % args.save_every == 0:
                save_checkpoint(os.path.join(args.out, f"ckpt-{step}"), model, tok, optimizer,
                                {"step": step, "epoch": epoch, "batch_pos": batch_pos}, args.keep, args.out)
                print(f"[ckpt] saved ckpt-{step}")
            done = step >= total_steps
        if not done:
            epoch += 1
            batch_pos = 0

    # ── final ──
    run_eval(step)
    final = os.path.join(args.out, "final")
    model.config.use_cache = True   # inference default for whoever loads final/
    model.save_pretrained(final, safe_serialization=True)
    tok.save_pretrained(final)
    GenerationConfig(max_new_tokens=1024, do_sample=False, eos_token_id=[end_id, tok.eos_token_id],
                     pad_token_id=pad_id, bos_token_id=tok.bos_token_id).save_pretrained(final)
    with open(os.path.join(final, "cludemem_train_args.json"), "w") as f:
        json.dump({**vars(args), "steps": step, "params": total}, f, indent=2)
    print(f"[done] {step} steps in {(time.time() - t_start) / 60:.1f} min -> {final}")
    if wandb:
        wandb.finish()


if __name__ == "__main__":
    sys.exit(main())
