#!/usr/bin/env bash
# Package a trained CludeMem into Ollama + (optionally) push to a namespace.
# Run on a box with Ollama installed and the merged GGUF present.
#
#   ./build_and_push.sh cludemem-e4b ./cludemem-e4b-lora/unsloth.Q4_K_M.gguf clude
#
# Args: <model-name> <gguf-path> [ollama-namespace]
set -euo pipefail

NAME="${1:?usage: build_and_push.sh <model-name> <gguf-path> [namespace]}"
GGUF="${2:?missing gguf path}"
NS="${3:-}"

if [[ ! -f "$GGUF" ]]; then
  echo "GGUF not found: $GGUF" >&2
  exit 1
fi

WORK="$(mktemp -d)"
sed "s#^FROM .*#FROM ${GGUF}#" "$(dirname "$0")/Modelfile" > "${WORK}/Modelfile"

echo "[cludemem] ollama create ${NAME}"
ollama create "${NAME}" -f "${WORK}/Modelfile"

echo "[cludemem] smoke test (CLASSIFY)"
ollama run "${NAME}" --format json \
  'Task: CLASSIFY. Input: Maya moved to Lisbon on 2026-02-10.' || true

if [[ -n "${NS}" ]]; then
  echo "[cludemem] pushing ${NS}/${NAME}"
  ollama cp "${NAME}" "${NS}/${NAME}"
  ollama push "${NS}/${NAME}"
  echo "[cludemem] published: ollama pull ${NS}/${NAME}"
fi

rm -rf "${WORK}"
echo "[cludemem] done. Activate in Clude: MEMORY_MODEL_PROVIDER=ollama MEMORY_MODEL=${NAME}"
