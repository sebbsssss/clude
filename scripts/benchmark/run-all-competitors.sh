#!/usr/bin/env bash
# Run MemoryAgentBench on all systems × AR/LRU/CR competencies.
# Systems run in parallel (different APIs); datasets within a system run sequentially.
#
# Usage:
#   ./scripts/benchmark/run-all-competitors.sh
#
# Prerequisites:
#   - experiments/MemoryAgentBench/.venv is set up (Day 0 Task 0.4)
#   - .env at repo root with API keys for the systems you want to run
#     (OPENAI_API_KEY required; MEM0_API_KEY, LETTA_API_KEY, ZEP_API_KEY optional)
#   - Run from the main checkout, not the worktree (experiments/ is gitignored)
#
# Outputs:
#   experiments/MemoryAgentBench/outputs/<system>/<competency>/*_results.json
#   experiments/MemoryAgentBench/logs/<system>-<competency>.log
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BENCH_DIR="$(cd "$SCRIPT_DIR/../../experiments/MemoryAgentBench" 2>/dev/null && pwd)"

# Noob-friendly: fail fast if experiments/ isn't present
if [ -z "$BENCH_DIR" ] || [ ! -d "$BENCH_DIR" ]; then
  echo "ERROR: experiments/MemoryAgentBench not found."
  echo "Run this script from the main checkout (not the worktree)."
  echo "experiments/ is gitignored and only exists in the primary working tree."
  exit 1
fi

if [ ! -f "$BENCH_DIR/.venv/bin/activate" ]; then
  echo "ERROR: Python venv not found at $BENCH_DIR/.venv"
  echo "Set up first: cd $BENCH_DIR && python3.10 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

cd "$BENCH_DIR"
# shellcheck disable=SC1091
source .venv/bin/activate

SYSTEMS=(
  "Structure_rag_gpt-4o-mini-clude"
  "Structure_rag_gpt-4o-mini-mem0"
  "Agentic_memory_gpt-4o-mini-letta"
  "Structure_rag_gpt-4o-mini-zep"
  "Structure_rag_gpt-4o-mini-cognee"
  "Simple_rag_gpt-4o-mini-bm25"
  "Embedding_rag_gpt-4o-mini-text_embedding_3_large"
  "no-memory-gpt-4o-mini"
)

COMPETENCIES=(
  "Accurate_Retrieval"
  "Long_Range_Understanding"
  "Conflict_Resolution"
)

mkdir -p logs

# Noob-friendly: print expected runtime + tailing hint before starting
echo "━━━ MemoryAgentBench runner ━━━"
echo "Systems:      ${#SYSTEMS[@]} (parallel up to 4 concurrent)"
echo "Competencies: ${#COMPETENCIES[@]} (AR, LRU, CR)"
echo "Expected wall-clock: 6–12 hours depending on API rate limits"
echo ""
echo "Monitor progress in another terminal with:"
echo "  tail -f $BENCH_DIR/logs/<system>-<competency>.log"
echo ""
echo "Press Ctrl-C to abort (in-flight subprocesses will continue)."
echo ""
sleep 2

run_system() {
  local system="$1"
  local config="configs/agent_conf/RAG_Agents/gpt-4o-mini/${system}.yaml"

  if [ ! -f "$config" ]; then
    echo "[$system] SKIP — config not found: $config"
    return
  fi

  for comp in "${COMPETENCIES[@]}"; do
    echo "[$system] starting $comp"
    for ds in configs/data_conf/$comp/**/*.yaml; do
      # Guard for no-glob-match (bash returns the literal pattern)
      [ -f "$ds" ] || continue
      python main.py \
        --agent_config "$config" \
        --dataset_config "$ds" \
        >> "logs/${system}-${comp}.log" 2>&1 \
        || echo "[$system] FAILED: $ds (see logs/${system}-${comp}.log)"
    done
    echo "[$system] done $comp"
  done
}

# Launch each system as a background job. Cap to 4 concurrent to avoid OpenAI throttle.
MAX_CONCURRENT=4
for system in "${SYSTEMS[@]}"; do
  while [ "$(jobs -r | wc -l)" -ge "$MAX_CONCURRENT" ]; do sleep 5; done
  run_system "$system" &
done
wait

echo ""
echo "━━━ All runs complete ━━━"
echo "Results in: $BENCH_DIR/outputs/"
echo "Next: run collect-results.ts to generate the leaderboard table."
