#!/usr/bin/env bash
#
# Deploy the HTTP server to Cloud Run.
#
# PHASE 1 (this script) pins the server to a SINGLE instance (min=max=1) with
# RUN_INPROCESS_TIMERS=true, which reproduces today's Railway single-instance
# behavior EXACTLY: the three in-server timers (recall canary, marketplace delivery
# poller, title-mint reconciliation) run on the one instance and cannot duplicate.
#
# PHASE 2 (scale the server >1): first extract those three timers out of
# apps/server/src/bootstrap.ts into the worker, then set the server to
# RUN_INPROCESS_TIMERS=false and raise --max-instances. See the runbook.
#
# PRIVY_APP_ID is NOT set here: it is baked into the frontends at BUILD time
# (cloudbuild.yaml --build-arg). Setting it as a runtime env silently breaks auth.

set -euo pipefail

PROJECT="${GCP_PROJECT:-clude-query-sol-data}"
REGION="${GCP_REGION:-us-central1}"
REPO="${AR_REPO:-clude}"
IMAGE_TAG="${IMAGE_TAG:?set IMAGE_TAG to the built image tag (e.g. the git SHORT_SHA)}"
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}/cluude:${IMAGE_TAG}"

# Layer switches — default to the LIVE infra so a deploy never silently cuts over.
DB_TARGET="${DB_TARGET:-supabase}"
EMBEDDING_ACTIVE="${EMBEDDING_ACTIVE:-voyage}"

# Runtime secrets: mounted as SECRET=SECRET:latest from Secret Manager.
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

gcloud run deploy cluude-server \
  --project "$PROJECT" \
  --region "$REGION" \
  --image "$IMAGE" \
  --port 3000 \
  --cpu 1 --memory 1Gi \
  --min-instances 1 --max-instances 1 \
  --no-cpu-throttling \
  --set-env-vars "NODE_ENV=production,DB_TARGET=${DB_TARGET},EMBEDDING_ACTIVE=${EMBEDDING_ACTIVE},RUN_INPROCESS_TIMERS=true,VERTEX_PROJECT=${PROJECT},VERTEX_LOCATION=${REGION}" \
  --set-secrets "$set_secrets" \
  --allow-unauthenticated

echo "Deployed cluude-server. Verify /health, /api, MCP .well-known, and /chat + /dashboard SPAs."
