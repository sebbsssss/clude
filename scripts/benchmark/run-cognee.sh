#!/usr/bin/env bash
# Cognee benchmark runner.
#
# Runs Cognee (pip-installed) via a Python 3.11 venv that lives at
# experiments/MemoryAgentBench/.venv-cognee.  The main .venv (Python 3.14)
# cannot be used because `pip install cognee` fails on Python 3.14+.
#
# Setup (one-time):
#   /opt/homebrew/opt/python@3.11/bin/python3.11 -m venv \
#       experiments/MemoryAgentBench/.venv-cognee
#   source experiments/MemoryAgentBench/.venv-cognee/bin/activate
#   pip install openai anthropic 'numpy<2' pyyaml datasets tiktoken \
#               huggingface_hub torch --index-url https://download.pytorch.org/whl/cpu \
#               transformers nltk spacy rank_bm25 editdistance rouge_score \
#               langchain langchain-openai langchain-core langchain-text-splitters \
#               sentence-transformers cognee
#
# Usage (from repo root):
#   ./scripts/benchmark/run-cognee.sh                 # smoke test (Conflict_Resolution, n=25)
#   ./scripts/benchmark/run-cognee.sh all             # all three competencies
#   ./scripts/benchmark/run-cognee.sh <agent_cfg> <dataset_cfg> [log_file]
#
# Required env:
#   OPENAI_API_KEY   (or auto-loaded from .env at repo root)
#
# Key env tweaks for Cognee:
#   LLM_API_KEY=<same as OPENAI_API_KEY>
#   LLM_MODEL=openai/gpt-4o-mini
#   ENABLE_BACKEND_ACCESS_CONTROL=false   (avoids multi-user dataset lookup bugs)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BENCH_DIR="$REPO_ROOT/experiments/MemoryAgentBench"
VENV_PYTHON="$BENCH_DIR/.venv-cognee/bin/python"
ENV_FILE="$REPO_ROOT/.env"

# ── Validate setup ──────────────────────────────────────────────────────────
if [[ ! -f "$VENV_PYTHON" ]]; then
  echo "ERROR: .venv-cognee not found. Run the one-time setup commands in this file's header." >&2
  exit 1
fi

# ── Load API key ─────────────────────────────────────────────────────────────
if [[ -z "${OPENAI_API_KEY:-}" ]] && [[ -f "$ENV_FILE" ]]; then
  OPENAI_API_KEY="$(grep '^OPENAI_API_KEY=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
fi
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "ERROR: OPENAI_API_KEY not set (checked env + $ENV_FILE)" >&2
  exit 1
fi

# ── Helper ───────────────────────────────────────────────────────────────────
run_benchmark() {
  local agent_cfg="$1"
  local dataset_cfg="$2"
  local log_file="${3:-}"

  local run_cmd=(
    env
    OPENAI_API_KEY="$OPENAI_API_KEY"
    LLM_API_KEY="$OPENAI_API_KEY"
    LLM_MODEL="openai/gpt-4o-mini"
    ENABLE_BACKEND_ACCESS_CONTROL="false"
    "$VENV_PYTHON" main.py
    --agent_config "$agent_cfg"
    --dataset_config "$dataset_cfg"
  )

  if [[ -n "$log_file" ]]; then
    mkdir -p "$(dirname "$log_file")"
    echo "Cognee run: $dataset_cfg → $log_file"
    "${run_cmd[@]}" 2>&1 | tee "$log_file"
  else
    "${run_cmd[@]}"
  fi
}

cd "$BENCH_DIR"

COGNEE_AGENT="configs/agent_conf/RAG_Agents/gpt-4o-mini/Structure_rag_gpt-4o-mini-cognee.yaml"

case "${1:-smoke}" in
  all)
    run_benchmark "$COGNEE_AGENT" \
      "configs/data_conf/Conflict_Resolution/Factconsolidation_sh_6k.yaml" \
      "logs/Cognee-Conflict_Resolution.log"

    run_benchmark "$COGNEE_AGENT" \
      "configs/data_conf/Accurate_Retrieval/LongMemEval/Longmemeval_s_star.yaml" \
      "logs/Cognee-Accurate_Retrieval.log"

    run_benchmark "$COGNEE_AGENT" \
      "configs/data_conf/Long_Range_Understanding/Detective_QA.yaml" \
      "logs/Cognee-Long_Range_Understanding.log"
    ;;
  smoke)
    run_benchmark "$COGNEE_AGENT" \
      "configs/data_conf/Conflict_Resolution/Factconsolidation_sh_6k.yaml"
    ;;
  *)
    # Positional: agent_config dataset_config [log_file]
    run_benchmark "${1}" "${2}" "${3:-}"
    ;;
esac
