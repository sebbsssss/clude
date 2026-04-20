#!/usr/bin/env bash
# Hackathon short-run: 3 datasets (1 per competency) × selected systems, n=25 each.
# Illustrative run for submission, not exhaustive. See HONEST_LIMITATIONS.md.
#
# Strategy:
#   - Fast local systems first (Clude, BM25, text-embedding-3-large)
#   - Slower API-based systems second (mem0, Letta-API)
#   - Datasets: LongMemEval_s_star (AR), Detective_QA (LRU), Factconsolidation_sh_6k (CR)
#   - n=25 per dataset (already patched in YAML)
#
# Usage: run from the main checkout.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BENCH_DIR="$(cd "$SCRIPT_DIR/../../experiments/MemoryAgentBench" 2>/dev/null && pwd)"

if [ -z "$BENCH_DIR" ] || [ ! -d "$BENCH_DIR" ]; then
  echo "ERROR: experiments/MemoryAgentBench not found. Run from main checkout."
  exit 1
fi

cd "$BENCH_DIR"
# shellcheck disable=SC1091
source .venv/bin/activate

DATASETS=(
  "configs/data_conf/Accurate_Retrieval/LongMemEval/Longmemeval_s_star.yaml"
  "configs/data_conf/Long_Range_Understanding/Detective_QA.yaml"
  "configs/data_conf/Conflict_Resolution/Factconsolidation_sh_6k.yaml"
)

# Two tiers — fast first so we have SOMETHING even if the slow tier stalls overnight.
FAST_SYSTEMS=(
  "Structure_rag_gpt-4o-mini-clude"
  "Simple_rag_gpt-4o-mini-bm25"
  "Embedding_rag_gpt-4o-mini-text_embedding_3_large"
)

SLOW_SYSTEMS=(
  "Structure_rag_gpt-4o-mini-mem0"
  "Agentic_memory_gpt-4o-mini-letta_api"
)

mkdir -p logs

echo "━━━ Tonight's benchmark run ━━━"
echo "Fast tier:  ${FAST_SYSTEMS[*]}"
echo "Slow tier:  ${SLOW_SYSTEMS[*]}"
echo "Datasets:   ${#DATASETS[@]} (AR + LRU + CR; n=25 each)"
echo "Logs:       $BENCH_DIR/logs/"
echo ""
echo "Monitor with: tail -f $BENCH_DIR/logs/<system>-<competency>.log"
echo ""

run_pair() {
  local system="$1"
  local dataset="$2"
  local comp
  comp=$(echo "$dataset" | awk -F/ '{print $3}')
  local config="configs/agent_conf/RAG_Agents/gpt-4o-mini/${system}.yaml"

  if [ ! -f "$config" ]; then
    echo "[$system] SKIP — config not found: $config"
    return
  fi

  echo "[$system][$comp] starting"
  local logfile="logs/${system}-${comp}.log"
  if python main.py --agent_config "$config" --dataset_config "$dataset" >> "$logfile" 2>&1; then
    echo "[$system][$comp] ✓ done"
  else
    echo "[$system][$comp] ✗ FAILED (see $logfile)"
  fi
}

# Fast tier — in parallel (3 systems, 3 datasets each = 9 pairs, all parallel)
echo "=== Fast tier starting ==="
for system in "${FAST_SYSTEMS[@]}"; do
  for ds in "${DATASETS[@]}"; do
    run_pair "$system" "$ds" &
  done
done
wait
echo "=== Fast tier complete ==="

# Slow tier — 2 systems × 3 datasets, sequential per system to avoid rate limits
echo "=== Slow tier starting ==="
for system in "${SLOW_SYSTEMS[@]}"; do
  (
    for ds in "${DATASETS[@]}"; do
      run_pair "$system" "$ds"
    done
  ) &
done
wait
echo "=== Slow tier complete ==="

echo ""
echo "━━━ All tonight's runs complete ━━━"
echo "Results in: $BENCH_DIR/outputs/"
