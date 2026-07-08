#!/usr/bin/env bash
#
# Seed GCP Secret Manager from a local .env file. Values are NEVER committed.
# Idempotent: creates a secret if missing, else adds a new version.
#
# Usage:
#   GCP_PROJECT=clude-query-sol-data ./infra/gcp/seed-secrets.sh path/to/.env
#
# Then grant the Cloud Run runtime service account access (once):
#   gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
#     --member="serviceAccount:<runtime-sa>@<project>.iam.gserviceaccount.com" \
#     --role="roles/secretmanager.secretAccessor"
#
# SECURITY: BOT_WALLET_PRIVATE_KEY is the live treasury signer. After seeding,
# scope its access to ONLY the runtime SA (per-secret IAM), and rotate any secret
# that has ever transited a chat/log.

set -euo pipefail

ENV_FILE="${1:?usage: seed-secrets.sh <path-to-.env>}"
PROJECT="${GCP_PROJECT:-clude-query-sol-data}"

# Keys treated as SECRETS (mounted via --set-secrets in deploy-*.sh). Non-secret
# config (DB_TARGET, EMBEDDING_ACTIVE, VERTEX_PROJECT/LOCATION, RUN_INPROCESS_TIMERS,
# NODE_ENV) is passed as plain --set-env-vars at deploy time, NOT stored here.
# PRIVY_APP_ID is intentionally absent: it is a Cloud BUILD arg, not a runtime env.
SECRETS=(
  SUPABASE_URL SUPABASE_SERVICE_KEY
  CLOUDSQL_PGREST_URL CLOUDSQL_SERVICE_KEY
  ANTHROPIC_API_KEY OPENROUTER_API_KEY
  EMBEDDING_API_KEY EMBEDDING_QUERY_API_KEY
  TAVILY_API_KEY TELEGRAM_BOT_TOKEN
  STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET
  HELIUS_WEBHOOK_SECRET HELIUS_RPC_URL
  PRIVY_APP_SECRET PRIVY_JWKS_URL
  OAUTH_SIGNING_SECRET
  BOT_WALLET_PRIVATE_KEY CLUUDE_TOKEN_MINT
  X_API_KEY X_API_SECRET X_ACCESS_TOKEN X_ACCESS_SECRET X_BOT_USER_ID
)

for key in "${SECRETS[@]}"; do
  # Read `KEY=value` from the .env (value may contain '='), tolerate absence.
  val="$(grep -E "^${key}=" "$ENV_FILE" | head -1 | cut -d= -f2- || true)"
  if [[ -z "$val" ]]; then
    echo "skip  $key (not present in $ENV_FILE)"
    continue
  fi
  if gcloud secrets describe "$key" --project "$PROJECT" >/dev/null 2>&1; then
    printf '%s' "$val" | gcloud secrets versions add "$key" --project "$PROJECT" --data-file=- >/dev/null
    echo "update $key"
  else
    printf '%s' "$val" | gcloud secrets create "$key" --project "$PROJECT" \
      --replication-policy=automatic --data-file=- >/dev/null
    echo "create $key"
  fi
done

echo "Done. Remember to grant the runtime SA roles/secretmanager.secretAccessor."
