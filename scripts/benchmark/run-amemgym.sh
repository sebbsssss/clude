#!/usr/bin/env bash
# run-amemgym.sh — Run Clude agent against the AMemGym benchmark
#
# Prerequisites:
#   1. Clude adapter running: npx tsx experiments/MemoryAgentBench/clude-adapter/server.ts
#   2. uv available on PATH
#   3. OPENAI_API_KEY set in experiments/amemgym/.env (or env)
#
# Usage:
#   ./scripts/benchmark/run-amemgym.sh              # full run (20 items)
#   ./scripts/benchmark/run-amemgym.sh --limit 2    # smoke test (2 items)

set -euo pipefail

AMEMGYM_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/experiments/amemgym"
AGENT_CONFIG="configs/agent/clude.json"
ENV_DATA="data/v1.base/data.json"
OUTPUT_DIR="eval-output/v1.base/overall"
LIMIT_FLAG=""

# Pass through any extra flags (e.g. --limit 2 --reset)
EXTRA_ARGS=("$@")

echo "==> AMemGym / Clude evaluation"
echo "    dir:    $AMEMGYM_DIR"
echo "    config: $AGENT_CONFIG"

# Confirm Clude adapter is alive
if ! curl -sf http://127.0.0.1:9877/health > /dev/null; then
  echo "ERROR: Clude adapter not reachable at http://127.0.0.1:9877"
  echo "Start it with: nohup npx tsx experiments/MemoryAgentBench/clude-adapter/server.ts > /tmp/clude-adapter.log 2>&1 &"
  exit 1
fi

cd "$AMEMGYM_DIR"

# Download dataset if missing
if [ ! -f "$ENV_DATA" ]; then
  echo "==> Downloading AMemGym v1.base dataset from HuggingFace..."
  uv run python -c "
from huggingface_hub import hf_hub_download
hf_hub_download('AGI-Eval/AMemGym', 'v1.base/data.json', repo_type='dataset', local_dir='data')
print('Downloaded data/v1.base/data.json')
"
fi

echo "==> Starting evaluation..."
uv run python -m amemgym.eval.overall \
    --agent_config "$AGENT_CONFIG" \
    --env_data "$ENV_DATA" \
    --output_dir "$OUTPUT_DIR" \
    "${EXTRA_ARGS[@]}"

echo ""
echo "==> Done. Results in: $AMEMGYM_DIR/$OUTPUT_DIR"
