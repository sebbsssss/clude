#!/bin/bash
# Reproduce the LongMemEval-S 85.0% result.
# Requires: ANTHROPIC_API_KEY, VOYAGE_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
# Optional: source from .env at repo root.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

# Load .env if present and not already in environment.
if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Voyage is used both for embeddings (via EMBEDDING_API_KEY) and reranking.
export EMBEDDING_API_KEY="${EMBEDDING_API_KEY:-${VOYAGE_API_KEY:-}}"
export EMBEDDING_PROVIDER="${EMBEDDING_PROVIDER:-voyage}"

for var in ANTHROPIC_API_KEY VOYAGE_API_KEY SUPABASE_URL SUPABASE_SERVICE_KEY; do
  if [ -z "${!var:-}" ]; then
    echo "Missing required env var: $var" >&2
    exit 1
  fi
done

RUN_ID="${1:-longmemeval-$(date -u +%Y%m%dT%H%M)}"
echo "=== LongMemEval-S reproduction run ==="
echo "Run ID: $RUN_ID"
echo "Reader: Opus 4.7 (hard categories) + Sonnet 4.5 (rest)"
echo "Judge:  Sonnet 4.5 (strict)"
echo ""

cd misc/scripts
exec npx tsx longmemeval-benchmark.ts \
  --variant s \
  --run-id "$RUN_ID" \
  --skip-cleanup \
  --rerank \
  --concurrency 4 \
  --batch-sleep 1500 \
  --reader claude-sonnet-4-5-20250929 \
  --judge claude-sonnet-4-5-20250929
