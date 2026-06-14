#!/usr/bin/env python3
"""
CludeMem QLoRA fine-tune (Gemma 4 E4B) via Unsloth.

Runs on a single GPU (RunPod H100 ~$2/hr; QLoRA E4B fits ~10-17GB). NOT runnable
in CI / on the data-engine box — this is the GPU stage of the pipeline.

  pip install -r requirements.txt
  python train_qlora.py \
      --data ../data/train.jsonl \
      --base unsloth/gemma-4-E4B-it \
      --out ./cludemem-e4b-lora --epochs 2

Pinned versions (requirements.txt) carry the Gemma 4 fixes: the grad-accumulation
loss-explosion fix and the E2B/E4B use_cache gibberish fix (Unsloth >=0.1.36,
transformers >=5.5.2). See design Section 7.
"""
import argparse, json


def load_chat_jsonl(path):
    rows = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    # Keep only the chat fields; the data engine also stores task/meta.
    return [{"messages": r["messages"]} for r in rows]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True, help="chat-format JSONL from the data engine")
    ap.add_argument("--base", default="unsloth/gemma-4-E4B-it")
    ap.add_argument("--out", default="./cludemem-e4b-lora")
    ap.add_argument("--epochs", type=float, default=2.0)
    ap.add_argument("--rank", type=int, default=32)          # design: r 32-64
    ap.add_argument("--lr", type=float, default=2e-4)        # cosine
    ap.add_argument("--max-seq", type=int, default=16384)    # length-stratified data needs long ctx
    ap.add_argument("--batch", type=int, default=2)
    ap.add_argument("--grad-accum", type=int, default=8)
    ap.add_argument("--export-gguf", action="store_true", help="also write merged GGUF (q4_k_m,q8_0)")
    args = ap.parse_args()

    from unsloth import FastModel
    from unsloth.chat_templates import get_chat_template, standardize_sharegpt
    from datasets import Dataset
    from trl import SFTTrainer, SFTConfig

    model, tokenizer = FastModel.from_pretrained(
        model_name=args.base,
        max_seq_length=args.max_seq,
        load_in_4bit=True,            # QLoRA
        full_finetuning=False,
    )
    model = FastModel.get_peft_model(
        model,
        r=args.rank,
        lora_alpha=2 * args.rank,     # design: alpha = 2r
        lora_dropout=0.0,
        bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        use_gradient_checkpointing="unsloth",
    )
    tokenizer = get_chat_template(tokenizer, chat_template="gemma-4")

    rows = load_chat_jsonl(args.data)
    ds = standardize_sharegpt(Dataset.from_list(rows))

    def fmt(ex):
        # Strip the auto-added <bos>; the processor re-adds it (design Section 7).
        text = tokenizer.apply_chat_template(ex["messages"], tokenize=False, add_generation_prompt=False)
        return {"text": text.removeprefix(tokenizer.bos_token) if tokenizer.bos_token else text}

    ds = ds.map(fmt)

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=ds,
        args=SFTConfig(
            dataset_text_field="text",
            per_device_train_batch_size=args.batch,
            gradient_accumulation_steps=args.grad_accum,
            warmup_ratio=0.03,
            num_train_epochs=args.epochs,
            learning_rate=args.lr,
            lr_scheduler_type="cosine",
            logging_steps=10,
            optim="adamw_8bit",
            seed=3407,
            output_dir=args.out,
            report_to="none",
        ),
    )
    # Sanity: E4B multimodal loss should sit ~13-15 early, not explode to 300+
    # (that signals the grad-accum bug -> bump Unsloth). See design Section 7.
    trainer.train()

    model.save_pretrained(args.out)
    tokenizer.save_pretrained(args.out)
    print(f"[cludemem] LoRA saved to {args.out}")

    if args.export_gguf:
        # Merge + export GGUF. Ship merged weights (NOT adapters) for Ollama.
        for q in ("q4_k_m", "q8_0"):
            model.save_pretrained_gguf(args.out, tokenizer, quantization_method=q)
            print(f"[cludemem] wrote GGUF ({q})")


if __name__ == "__main__":
    main()
