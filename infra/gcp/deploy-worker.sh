#!/usr/bin/env bash
#
# Deploy the autonomous-bot worker to Cloud Run as a normal service.
#
# The worker (apps/workers) is a loop process (dream cycle, X poller, mood tweeter,
# price oracle, sentiment monitor, task executor). It now ships a minimal /health
# server (apps/workers/src/index.ts) so it satisfies Cloud Run's port probe and does
# NOT need a Worker Pool. Runs the SAME image as the server with the command overridden.
#
# Pinned to exactly one instance (min=max=1, CPU always allocated) so the timers run
# on a single owner. RUN_INPROCESS_TIMERS=false: the three in-SERVER timers belong to
# the server; this flag only affects apps/server, but we set it false here to be explicit.
# No public API surface, so --no-allow-unauthenticated (only /health is exposed).

set -euo pipefail

PROJECT="${GCP_PROJECT:-clude-query-sol-data}"
REGION="${GCP_REGION:-us-central1}"
REPO="${AR_REPO:-clude}"
IMAGE_TAG="${IMAGE_TAG:?set IMAGE_TAG to the built image tag (e.g. the git SHORT_SHA)}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/cluude:${IMAGE_TAG}"

DB_TARGET="${DB_TARGET:-supabase}"
EMBEDDING_ACTIVE="${EMBEDDING_ACTIVE:-voyage}"

SECRET_KEYS=(
  SUPABASE_URL SUPABASE_SERVICE_KEY CLOUDSQL_PGREST_URL CLOUDSQL_SERVICE_KEY
  ANTHROPIC_API_KEY OPENROUTER_API_KEY EMBEDDING_API_KEY EMBEDDING_QUERY_API_KEY
  TAVILY_API_KEY TELEGRAM_BOT_TOKEN STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET
  HELIUS_WEBHOOK_SECRET HELIUS_RPC_URL PRIVY_APP_SECRET PRIVY_JWKS_URL
  OAUTH_SIGNING_SECRET BOT_WALLET_PRIVATE_KEY CLUUDE_TOKEN_MINT
  X_API_KEY X_API_SECRET X_ACCESS_TOKEN X_ACCESS_SECRET X_BOT_USER_ID
)
set_secrets=""
for k in "${SECRET_KEYS[@]}"; do set_secrets+="${k}=${k}:latest,"; done
set_secrets="${set_secrets%,}"

gcloud run deploy cluude-workers \
  --project "$PROJECT" \
  --region "$REGION" \
  --image "$IMAGE" \
  --command node \
  --args apps/workers/dist/index.js \
  --cpu 1 --memory 1Gi \
  --min-instances 1 --max-instances 1 \
  --no-cpu-throttling \
  --no-allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,DB_TARGET=${DB_TARGET},EMBEDDING_ACTIVE=${EMBEDDING_ACTIVE},RUN_INPROCESS_TIMERS=false,VERTEX_PROJECT=${PROJECT},VERTEX_LOCATION=${REGION}" \
  --set-secrets "$set_secrets"

echo "Deployed cluude-workers. Confirm the log line 'All workers running.' and that the dream cycle / pollers fire exactly once."
