#!/usr/bin/env python3
"""
Train the CludeMem-49M tokenizer.

A SentencePiece BPE model (the Llama-1/2 tokenizer family: byte fallback,
split digits, identity normalisation) fitted to the data-engine corpus, then
wrapped as an HF LlamaTokenizerFast carrying the CludeMem chat template.

  python tokenizer_49m.py --data ../data/train.jsonl --out ./tokenizer-49m --vocab 16384

Why SentencePiece rather than an HF byte-level BPE: llama.cpp's
convert_hf_to_gguf.py reads `tokenizer.model` directly for Llama-architecture
models, so the trained model converts to GGUF and serves from Ollama with no
pre-tokenizer hash registration. Vocab 16384 keeps the (tied) embedding
matrix at 8.4M of the 49.3M parameters.

The script self-checks that the HF wrapper and raw SentencePiece agree on
sample strings and that every control token is a single id — the properties
the trainer and the GGUF path rely on.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile

from chat_format import (
    BOS, EOS, PAD, UNK, CONTROL_TOKENS, CHAT_TEMPLATE, render_example,
)


def iter_texts(path: str):
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            for m in row["messages"]:
                yield m["content"]


def write_corpus(data_paths: list[str], extra_text: str | None, dst: str) -> tuple[int, int]:
    """One training sentence per line, de-duplicated (the system prompts repeat
    ~50K times each; deduping keeps the BPE merges about content, not prompts)."""
    seen: set[str] = set()
    total = 0
    with open(dst, "w") as out:
        for p in data_paths:
            for text in iter_texts(p):
                total += 1
                for line in text.split("\n"):
                    line = line.strip()
                    if line and line not in seen:
                        seen.add(line)
                        out.write(line + "\n")
        if extra_text:
            with open(extra_text) as f:
                for line in f:
                    line = line.strip()
                    if line and line not in seen:
                        seen.add(line)
                        out.write(line + "\n")
    return total, len(seen)


def train_spm(corpus: str, model_prefix: str, vocab: int, threads: int) -> str:
    import sentencepiece as spm

    spm.SentencePieceTrainer.train(
        input=corpus,
        model_prefix=model_prefix,
        vocab_size=vocab,
        model_type="bpe",
        character_coverage=1.0,
        byte_fallback=True,           # any byte is representable (Llama-2 style)
        split_digits=True,            # dates/numbers tokenise digit-by-digit
        normalization_rule_name="identity",
        remove_extra_whitespaces=False,
        allow_whitespace_only_pieces=True,
        add_dummy_prefix=False,       # no leading-space prefix: matches llama.cpp
                                      # after control tokens (see chat_format.py)
        unk_id=0, bos_id=1, eos_id=2, pad_id=3,
        unk_piece=UNK, bos_piece=BOS, eos_piece=EOS, pad_piece=PAD,
        user_defined_symbols=CONTROL_TOKENS,   # ids 4..7, single tokens
        max_sentence_length=20000,    # keep the long ANSWER/COMPACT inputs
        input_sentence_size=3_000_000,
        shuffle_input_sentence=True,
        num_threads=threads,
        train_extremely_large_corpus=False,
    )
    return model_prefix + ".model"


def wrap_hf(spm_model: str, out_dir: str):
    """Wrap the SentencePiece BPE model as an HF (tokenizers-backed) LlamaTokenizer.

    transformers >= 5 builds LlamaTokenizer from an explicit vocab + merges
    table, so we extract both from the .model proto with the library's own
    extractor (the same code its from_pretrained path uses for tokenizer.model)
    and construct the non-legacy, no-prefix-space pipeline that mirrors
    llama.cpp's SPM tokenizer after control tokens (chat_format.py).
    """
    from transformers import LlamaTokenizer
    from transformers.tokenization_utils_sentencepiece import SentencePieceExtractor

    vocab_ids, _vocab_scores, merges = SentencePieceExtractor(spm_model).extract()
    tok = LlamaTokenizer(
        vocab=vocab_ids,
        merges=merges,
        unk_token=UNK, bos_token=BOS, eos_token=EOS, pad_token=PAD,
        add_bos_token=True,       # -> tokenizer.ggml.add_bos_token=true in GGUF;
        add_eos_token=False,      #    the trainer passes add_special_tokens=False
        legacy=False,             #    and renders <s> itself (chat_format.py)
        add_prefix_space=False,
        clean_up_tokenization_spaces=False,
        extra_special_tokens=CONTROL_TOKENS,
    )
    tok.chat_template = CHAT_TEMPLATE
    tok.model_max_length = 4096
    os.makedirs(out_dir, exist_ok=True)
    tok.save_pretrained(out_dir)
    # Ship the raw SentencePiece model next to tokenizer.json: it is what
    # convert_hf_to_gguf.py reads for Llama-architecture models.
    shutil.copyfile(spm_model, os.path.join(out_dir, "tokenizer.model"))
    return tok


def self_check(tok, spm_model: str, out_dir: str) -> None:
    import sentencepiece as spm

    sp = spm.SentencePieceProcessor(model_file=spm_model)
    # 1. control tokens are single ids, at the planned positions
    for i, t in enumerate(CONTROL_TOKENS):
        ids = tok(t, add_special_tokens=False).input_ids
        assert ids == [4 + i], f"{t} -> {ids}, expected [{4 + i}]"
    assert tok.bos_token_id == 1 and tok.eos_token_id == 2 and tok.pad_token_id == 3
    # 2. HF wrapper == raw SentencePiece on plain text
    samples = [
        "Maya moved to Lisbon on 2026-02-10.",
        '{"type":"semantic","importance":0.6,"tags":["personal_fact","location"]}',
        "I think devon prefers matcha over cola. At least that's my sense of it.",
        "| metric | value |\n| --- | --- |\n| latency_ms | 42 |",
    ]
    for s in samples:
        hf = tok(s, add_special_tokens=False).input_ids
        raw = sp.encode(s, out_type=int)
        assert hf == raw, f"HF/SPM mismatch on {s!r}:\n  hf ={hf}\n  spm={raw}"
        assert tok.decode(hf) == s, f"round-trip failed on {s!r}: {tok.decode(hf)!r}"
    # 3. the chat template renders exactly the wire format the trainer uses
    msgs = [
        {"role": "system", "content": "Classify the memory."},
        {"role": "user", "content": "Maya lives in Berlin."},
        {"role": "assistant", "content": '{"type":"semantic"}'},
    ]
    templated = tok.apply_chat_template(msgs, tokenize=False)
    manual = render_example(msgs[0]["content"], msgs[1]["content"], msgs[2]["content"])
    # the template ends each turn with "<|end|>\n"; the trainer ends the target
    # with "<|end|></s>" (EOS instead of the trailing newline) — equal up to that.
    assert templated.rstrip("\n") == manual.replace(EOS, "").rstrip("\n"), (templated, manual)
    # 4. a rendered example tokenises with the control tokens intact
    ids = tok(manual, add_special_tokens=False).input_ids
    assert ids[0] == 1 and ids[1] == 4 and ids[-1] == 2 and ids[-2] == 7, ids[:3] + ids[-3:]
    # 5. save/reload round-trip (the trainer + evaluator load via AutoTokenizer)
    from transformers import AutoTokenizer
    re_tok = AutoTokenizer.from_pretrained(out_dir)
    for s in samples + [manual]:
        assert re_tok(s, add_special_tokens=False).input_ids == tok(s, add_special_tokens=False).input_ids, f"reload mismatch on {s!r}"
    assert re_tok.chat_template == tok.chat_template and re_tok.pad_token_id == 3
    assert len(re_tok) == len(tok), (len(re_tok), len(tok))
    print("[tokenizer] self-check ok")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", nargs="+", required=True, help="chat JSONL shard(s) from the data engine")
    ap.add_argument("--out", default="./tokenizer-49m")
    ap.add_argument("--vocab", type=int, default=16384)
    ap.add_argument("--extra-text", default=None, help="optional plain-text file to broaden coverage (one sentence per line)")
    ap.add_argument("--threads", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        corpus = os.path.join(tmp, "corpus.txt")
        n_msgs, n_lines = write_corpus(args.data, args.extra_text, corpus)
        print(f"[tokenizer] corpus: {n_msgs} messages -> {n_lines} unique lines ({os.path.getsize(corpus) / 1e6:.1f} MB)")
        try:
            spm_model = train_spm(corpus, os.path.join(tmp, "spm"), args.vocab, args.threads)
        except RuntimeError as err:
            if "Vocabulary size too high" in str(err):
                raise SystemExit(
                    f"[tokenizer] the corpus is too lexically thin for a {args.vocab}-piece vocabulary "
                    f"({err}). The templated data-engine shards alone cannot support it: add natural text "
                    f"with --extra-text (build one with collect_text.py)."
                ) from err
            raise
        tok = wrap_hf(spm_model, args.out)
        self_check(tok, spm_model, args.out)

    # Report compression on the corpus (tokens per example) so max-seq can be chosen.
    lens = []
    for p in args.data:
        with open(p) as f:
            for i, line in enumerate(f):
                if i >= 2000:
                    break
                row = json.loads(line)
                s, u, a = (m["content"] for m in row["messages"])
                lens.append(len(tok(render_example(s, u, a), add_special_tokens=False).input_ids))
    lens.sort()
    q = lambda p: lens[min(len(lens) - 1, int(p * len(lens)))]
    print(f"[tokenizer] vocab={len(tok)}  tokens/example (first 2000): "
          f"p50={q(0.5)} p90={q(0.9)} p99={q(0.99)} max={lens[-1]}")
    print(f"[tokenizer] saved to {args.out}")


if __name__ == "__main__":
    sys.exit(main())
