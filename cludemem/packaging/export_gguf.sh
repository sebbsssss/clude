#!/usr/bin/env bash
# Export a CludeMem-49M HF checkpoint to GGUF and load it into Ollama.
#
#   ./export_gguf.sh <hf-model-dir> <ollama-name> [llama.cpp-dir] [ollama-namespace]
#   ./export_gguf.sh ../training/runs/cludemem-49m/final cludemem-49m ~/llama.cpp
#
# Needs: a llama.cpp checkout (convert_hf_to_gguf.py + a built llama-quantize),
# python with `gguf` + `sentencepiece` (pip install -r llama.cpp/requirements.txt),
# and Ollama. The model is Llama-architecture with a SentencePiece tokenizer
# (tokenizer.model), so stock llama.cpp converts it with no custom vocab hooks.
#
# At 49M parameters, Q8_0 (~55 MB) is lossless in practice; f16 (~100 MB) is
# kept alongside for reference. There is no reason to go to Q4 at this size.
set -euo pipefail

SRC="${1:?usage: export_gguf.sh <hf-model-dir> <ollama-name> [llama.cpp-dir] [namespace]}"
NAME="${2:?missing ollama model name}"
LLAMA="${3:-${LLAMA_CPP_DIR:-$HOME/llama.cpp}}"
NS="${4:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"

[[ -f "$SRC/config.json" && -f "$SRC/tokenizer.model" ]] || { echo "not an HF checkpoint with tokenizer.model: $SRC" >&2; exit 1; }
[[ -f "$LLAMA/convert_hf_to_gguf.py" ]] || { echo "llama.cpp not found at $LLAMA (set LLAMA_CPP_DIR)" >&2; exit 1; }

QUANT="$(command -v llama-quantize || true)"
[[ -n "$QUANT" ]] || QUANT="$LLAMA/build/bin/llama-quantize"
[[ -x "$QUANT" ]] || { echo "llama-quantize not found (build llama.cpp first)" >&2; exit 1; }

F16="$HERE/$NAME.f16.gguf"
Q8="$HERE/$NAME.Q8_0.gguf"

echo "[cludemem] convert -> $F16"
python3 "$LLAMA/convert_hf_to_gguf.py" "$SRC" --outfile "$F16" --outtype f16
echo "[cludemem] quantize -> $Q8"
"$QUANT" "$F16" "$Q8" Q8_0

WORK="$(mktemp -d)"
sed "s#^FROM .*#FROM ${Q8}#" "$HERE/Modelfile.49m" > "$WORK/Modelfile"
echo "[cludemem] ollama create $NAME"
ollama create "$NAME" -f "$WORK/Modelfile"
rm -rf "$WORK"

echo "[cludemem] smoke test (CLASSIFY, JSON mode)"
ollama run "$NAME" --format json 'Classify the memory. Output JSON: {type, importance (0-1), tags[], concepts[], emotional_valence (-1..1)}.
Maya moved to Lisbon on 2026-02-10.' || true

if [[ -n "$NS" ]]; then
  echo "[cludemem] pushing $NS/$NAME"
  ollama cp "$NAME" "$NS/$NAME"
  ollama push "$NS/$NAME"
fi
echo "[cludemem] done. Gate it:   npx tsx cludemem/eval/memopseval.ts --model $NAME --data cludemem/data/heldout.jsonl"
echo "[cludemem] activate:       MEMORY_MODEL_PROVIDER=ollama MEMORY_MODEL=$NAME"
