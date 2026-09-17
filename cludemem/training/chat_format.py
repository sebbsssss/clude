"""
CludeMem-49M chat format — the ONE definition shared by the tokenizer, the
trainer, the evaluator, and (by hand-mirroring) packaging/Modelfile.49m.

Wire format (what the model sees, one line per turn):

    <s><|system|>\n{system}<|end|>\n<|user|>\n{user}<|end|>\n<|assistant|>\n{json}<|end|></s>

- <s> / </s> are the SentencePiece BOS/EOS. Ollama adds BOS itself
  (tokenizer.ggml.add_bos_token), so Modelfile.49m's TEMPLATE starts at
  <|system|> — training and serving tokenize identically.
- The four <|...|> control tokens are SentencePiece user-defined symbols
  (fixed ids 4-7) and HF additional special tokens, so they are always a
  single token and never split by the BPE.
- Loss is computed on the assistant span only: `{json}<|end|></s>`.
"""

BOS = "<s>"
EOS = "</s>"
PAD = "<pad>"
UNK = "<unk>"

SYSTEM_TOKEN = "<|system|>"
USER_TOKEN = "<|user|>"
ASSISTANT_TOKEN = "<|assistant|>"
END_TOKEN = "<|end|>"

# Order matters: SentencePiece assigns user-defined symbols ids 4.. in this order
# (after <unk>=0, <s>=1, </s>=2, <pad>=3).
CONTROL_TOKENS = [SYSTEM_TOKEN, USER_TOKEN, ASSISTANT_TOKEN, END_TOKEN]

# HF Jinja chat template — produces exactly the wire format above.
CHAT_TEMPLATE = (
    "{{ bos_token }}"
    "{% for message in messages %}"
    "<|{{ message['role'] }}|>\n{{ message['content'] }}<|end|>\n"
    "{% endfor %}"
    "{% if add_generation_prompt %}<|assistant|>\n{% endif %}"
)


def render_prompt(system: str, user: str) -> str:
    """Everything up to and including the assistant header (no loss here)."""
    return (
        f"{BOS}{SYSTEM_TOKEN}\n{system}{END_TOKEN}\n"
        f"{USER_TOKEN}\n{user}{END_TOKEN}\n"
        f"{ASSISTANT_TOKEN}\n"
    )


def render_target(assistant: str) -> str:
    """The supervised span: the JSON answer plus the two terminators."""
    return f"{assistant}{END_TOKEN}{EOS}"


def render_example(system: str, user: str, assistant: str) -> str:
    return render_prompt(system, user) + render_target(assistant)


def strip_generation(text: str) -> str:
    """Cut a decoded continuation at the first terminator."""
    for stop in (END_TOKEN, EOS):
        idx = text.find(stop)
        if idx >= 0:
            text = text[:idx]
    return text.strip()
