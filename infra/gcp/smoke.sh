#!/usr/bin/env bash
#
# Post-deploy smoke check. Run against ANY deployment of the server (Cloud Run,
# Railway, a PR-preview revision) — pass the base URL:
#
#   ./infra/gcp/smoke.sh https://cluude-server-xxxx-uc.a.run.app
#   PRIVY_APP_ID=<app-id> ./infra/gcp/smoke.sh https://clude.io
#
# WHY THIS EXISTS: this repo's deploy failures are silent — /health stays 200
# while the SPAs ship broken. The two documented failure modes it targets:
#   1. PRIVY_APP_ID baked wrong/missing at BUILD time (Vite inlines
#      VITE_PRIVY_APP_ID as a literal; a bad --build-arg ships bundles where
#      login silently breaks). With PRIVY_APP_ID set, we grep the served chat
#      bundle for the literal id.
#   2. A route module or static mount dying while /health (which touches
#      nothing) keeps answering 200.
#
# Exit code 0 = all checks pass. Non-zero = at least one failed (each failure
# prints FAIL with what to look at). No gcloud dependency — pure curl.

set -uo pipefail

BASE="${1:?usage: smoke.sh <base-url> [worker-health-url]}"
BASE="${BASE%/}"
WORKER="${2:-}"
PRIVY_APP_ID="${PRIVY_APP_ID:-}"
# For Cloud Run services not yet public (org policy / --no-allow-unauthenticated):
#   SMOKE_AUTH_TOKEN="$(gcloud auth print-identity-token)" ./infra/gcp/smoke.sh <url>
SMOKE_AUTH_TOKEN="${SMOKE_AUTH_TOKEN:-}"

pass=0
fail=0

note() { printf '%s\n' "$*"; }
ok()   { pass=$((pass+1)); note "  OK   $*"; }
bad()  { fail=$((fail+1)); note "  FAIL $*"; }

# fetch <url> — sets globals BODY and STATUS (no subshell: set -u safe)
fetch() {
  local url="$1" raw
  local -a auth=()
  [ -n "$SMOKE_AUTH_TOKEN" ] && auth=(-H "Authorization: Bearer $SMOKE_AUTH_TOKEN")
  if ! raw=$(curl -sS --max-time 20 -w $'\n%{http_code}' "${auth[@]}" "$url" 2>/dev/null); then
    STATUS=000; BODY=""; return 1
  fi
  STATUS="${raw##*$'\n'}"
  BODY="${raw%$'\n'*}"
}

note "Smoke: ${BASE}"

# 1. /health — the basic liveness everyone already trusts (baseline, not proof)
fetch "${BASE}/health"
if [ "$STATUS" = "200" ]; then ok "/health 200"; else bad "/health -> $STATUS"; fi

# 2. A real API route that exercises Express routing + the DB read path.
#    /api/proof/tokens-saved is mounted unconditionally (unlike /api/compound,
#    which is gated on COMPOUND_ENABLED) and returns JSON even with zero data.
fetch "${BASE}/api/proof/tokens-saved"
if [ "$STATUS" = "200" ] && printf '%s' "$BODY" | grep -q '{'; then
  ok "/api/proof/tokens-saved 200 + JSON"
else
  bad "/api/proof/tokens-saved -> $STATUS (route modules or DB path dead while /health stays green)"
fi

# 3. MCP discovery — the connector integration breaks silently if this mount is lost.
fetch "${BASE}/.well-known/oauth-protected-resource"
if [ "$STATUS" = "200" ]; then
  ok "MCP .well-known/oauth-protected-resource 200"
else
  bad "MCP .well-known -> $STATUS (connector auth discovery dead)"
fi

# 4 + 5. The two SPAs: HTML serves, references a hashed Vite bundle, bundle fetches.
check_spa() { # check_spa <mount> <label>
  local mount="$1" label="$2"
  local html asset js
  fetch "${BASE}${mount}/"
  if [ "$STATUS" != "200" ]; then bad "${label} ${mount}/ -> $STATUS"; return; fi
  html="$BODY"
  # Vite emits /assets/index-<hash>.js (path may be nested under the mount)
  asset=$(printf '%s' "$html" | grep -oE '[^"]*assets/[^"]+\.js' | head -1)
  if [ -z "$asset" ]; then bad "${label} HTML has no Vite bundle reference (static mount broken)"; return; fi
  case "$asset" in
    http*) : ;;
    /*) asset="${BASE}${asset}" ;;
    *) asset="${BASE}${mount}/${asset}" ;;
  esac
  fetch "$asset"
  if [ "$STATUS" != "200" ]; then bad "${label} bundle ${asset} -> $STATUS"; return; fi
  js="$BODY"
  ok "${label} ${mount}/ + bundle serve"
  # The Privy build-arg bake: the app id is a public client id inlined as a literal.
  if [ -n "$PRIVY_APP_ID" ] && [ "$mount" = "/chat" ]; then
    if printf '%s' "$js" | grep -q "$PRIVY_APP_ID"; then
      ok "${label} bundle contains PRIVY_APP_ID (build-arg bake verified)"
    else
      bad "${label} bundle MISSING PRIVY_APP_ID — built without --build-arg, login will silently break"
    fi
  fi
}
check_spa "/chat" "chat SPA"
check_spa "/dashboard" "dashboard SPA"

# 6. Optional: worker health (Cloud Run worker service exposes only /health; it is
#    --no-allow-unauthenticated, so pass an identity-token-authenticated URL or
#    curl it from a shell that attaches one).
if [ -n "$WORKER" ]; then
  fetch "${WORKER%/}/health"
  if [ "$STATUS" = "200" ]; then ok "worker /health 200"; else bad "worker /health -> $STATUS"; fi
fi

note ""
note "smoke: ${pass} passed, ${fail} failed"
if [ "$fail" -gt 0 ]; then
  note "Deep-health reminder: check logs for 'Recall canary healthy' after boot — HTTP checks cannot see a dead recall lane."
  exit 1
fi
exit 0
