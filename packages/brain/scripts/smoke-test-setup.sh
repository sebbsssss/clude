#!/bin/bash
# Smoke test for `npx @clude/sdk setup` against a deployment with Privy configured.
#
# Requirements:
#   - Built clude dist: pnpm --filter @clude/brain build
#   - CORTEX_HOST_URL pointing to a deployment with Privy configured
#   - jq installed for JSON parsing
#
# Usage:
#   CORTEX_HOST_URL=https://staging.clude.io ./smoke-test-setup.sh

set -euo pipefail

# Configurable
CORTEX_HOST_URL="${CORTEX_HOST_URL:-https://clude.io}"
TEST_EMAIL="clude-smoke-$(date +%s)@example.com"
TEST_HOME="$(mktemp -d)"

# Locate the CLI
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_PATH="$SCRIPT_DIR/../dist/cli/index.js"

if [ ! -f "$CLI_PATH" ]; then
  echo "ERROR: CLI not built at $CLI_PATH"
  echo "       Run: pnpm --filter @clude/brain build"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required (brew install jq)"
  exit 1
fi

cleanup() {
  rm -rf "$TEST_HOME"
}
trap cleanup EXIT

echo "=== Clude Setup Smoke Test ==="
echo "  Email:          $TEST_EMAIL"
echo "  Host:           $CORTEX_HOST_URL"
echo "  Test HOME:      $TEST_HOME"
echo ""

# First run — should register and create artifacts
HOME="$TEST_HOME" \
CLUDE_SETUP_EMAIL="$TEST_EMAIL" \
CORTEX_HOST_URL="$CORTEX_HOST_URL" \
  node "$CLI_PATH" setup

echo ""
echo "=== Verifying artifacts ==="

# Check config.json
CONFIG="$TEST_HOME/.clude/config.json"
if [ ! -f "$CONFIG" ]; then
  echo "FAIL: $CONFIG not created"
  exit 1
fi
echo "  ✓ config.json exists"

STORED_EMAIL=$(jq -r '.email' "$CONFIG")
if [ "$STORED_EMAIL" != "$TEST_EMAIL" ]; then
  echo "FAIL: email mismatch (expected $TEST_EMAIL, got $STORED_EMAIL)"
  exit 1
fi
echo "  ✓ email matches"

API_KEY=$(jq -r '.apiKey' "$CONFIG")
if [ -z "$API_KEY" ] || [ "$API_KEY" = "null" ]; then
  echo "FAIL: apiKey missing in config"
  exit 1
fi
echo "  ✓ apiKey present (${API_KEY:0:12}...)"

DID=$(jq -r '.did' "$CONFIG")
if [ -z "$DID" ] || [ "$DID" = "null" ]; then
  echo "FAIL: did missing in config"
  exit 1
fi
echo "  ✓ Privy DID present ($DID)"

# Check brain.db
DB="$TEST_HOME/.clude/brain.db"
if [ ! -f "$DB" ]; then
  echo "FAIL: $DB not created"
  exit 1
fi
echo "  ✓ brain.db exists"

# Re-run setup — should show "already set up"
echo ""
echo "=== Verifying idempotency (second run) ==="
SECOND_RUN=$(HOME="$TEST_HOME" node "$CLI_PATH" setup 2>&1)
if echo "$SECOND_RUN" | grep -q "already set up"; then
  echo "  ✓ Second run shows 'already set up'"
else
  echo "FAIL: Second run did not detect existing setup"
  echo "$SECOND_RUN"
  exit 1
fi

echo ""
echo "=== ALL CHECKS PASSED ==="
echo ""
echo "Manual verification:"
echo "  1. Visit $CORTEX_HOST_URL/dashboard"
echo "  2. Sign in with email: $TEST_EMAIL"
echo "  3. Verify the agent appears in the dashboard"
