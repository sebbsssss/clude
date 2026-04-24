#!/usr/bin/env bash
# Sequential competitor runner. Fixed: mem0 retry, langchain 0.3 pin, letta_client 0.1.87 pin.
# Runs ONE system × ONE dataset at a time to avoid OpenAI 200k TPM ceiling.
#
# Order: fast → slow so partial data still useful.
# Skip Clude (already done).
set -uo pipefail

BENCH_DIR="/Users/sebastien/Projects/cluude-bot/experiments/MemoryAgentBench"
cd "$BENCH_DIR"
# shellcheck disable=SC1091
source .venv/bin/activate

DATASETS=(
  "configs/data_conf/Accurate_Retrieval/LongMemEval/Longmemeval_s_star.yaml"
  "configs/data_conf/Long_Range_Understanding/Detective_QA.yaml"
  "configs/data_conf/Conflict_Resolution/Factconsolidation_sh_6k.yaml"
)

# System → config file (RAG_Agents/ for most; Long_Context_Agents/ for no-memory baseline)
SYSTEMS=(
  "Simple_rag_gpt-4o-mini-bm25|configs/agent_conf/RAG_Agents/gpt-4o-mini/Simple_rag_gpt-4o-mini-bm25.yaml"
  "Embedding_rag_gpt-4o-mini-text_embedding_3_large|configs/agent_conf/RAG_Agents/gpt-4o-mini/Embedding_rag_gpt-4o-mini-text_embedding_3_large.yaml"
  "Long_context_agent_gpt-4o-mini|configs/agent_conf/Long_Context_Agents/Long_context_agent_gpt-4o-mini.yaml"
  "Structure_rag_gpt-4o-mini-mem0|configs/agent_conf/RAG_Agents/gpt-4o-mini/Structure_rag_gpt-4o-mini-mem0.yaml"
  "Agentic_memory_gpt-4o-mini-letta_api|configs/agent_conf/RAG_Agents/gpt-4o-mini/Agentic_memory_gpt-4o-mini-letta_api.yaml"
)

mkdir -p logs

echo "━━━ Sequential competitor run ━━━"
echo "Systems:  ${#SYSTEMS[@]}"
echo "Datasets: ${#DATASETS[@]}"
echo "Total runs: $(( ${#SYSTEMS[@]} * ${#DATASETS[@]} ))"
echo ""
echo "Order: BM25 → embedding → no-memory → mem0 → Letta-api"
echo "Logs at: $BENCH_DIR/logs/"
echo ""

total_start=$(date +%s)

for entry in "${SYSTEMS[@]}"; do
  system="${entry%%|*}"
  config="${entry##*|}"

  if [ ! -f "$config" ]; then
    echo "[$system] SKIP — config not found: $config"
    continue
  fi

  echo ""
  echo "════════════════════════════════════════"
  echo "System: $system"
  echo "════════════════════════════════════════"

  for ds in "${DATASETS[@]}"; do
    comp=$(echo "$ds" | awk -F/ '{print $3}')
    logfile="logs/${system}-${comp}.log"
    echo ""
    echo "  [$comp] starting — tail -f $logfile"
    sys_start=$(date +%s)

    if python main.py --agent_config "$config" --dataset_config "$ds" >> "$logfile" 2>&1; then
      sys_end=$(date +%s)
      echo "  [$comp] ✓ done in $(( sys_end - sys_start ))s"
    else
      sys_end=$(date +%s)
      echo "  [$comp] ✗ FAILED after $(( sys_end - sys_start ))s (see $logfile)"
    fi
  done
done

total_end=$(date +%s)
echo ""
echo "━━━ All runs complete in $(( (total_end - total_start) / 60 )) min ━━━"
echo "Results in: $BENCH_DIR/outputs/"
