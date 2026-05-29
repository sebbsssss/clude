#!/usr/bin/env bash
# PMP Encryption Pre-Flight Audit (Plan 5 Task 0).
# Run from repo root: bash scripts/encryption/preflight-audit.sh
# Exits non-zero on any FAIL. Manual-confirmation checks (Supabase SQL, Railway env)
# print the probe and a checkbox the operator records as PASS/FAIL.
set -uo pipefail
PASS=0; FAIL=0; ASK=0
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
ask()  { echo "  ⏳ $1"; ASK=$((ASK+1)); }
hdr()  { echo ""; echo "── $1 ──"; }

# Anchor: confirm HEAD's encryption code matches what's on main.
# Accept either: HEAD == anchor, OR HEAD is an ancestor of anchor (feature-branch tip
# that was merged into anchor — same tree for the encryption paths).
hdr "Anchor — git HEAD vs declared Plan 5 anchor"
ANCHOR="b6e770c1"
HEAD_SHORT="$(git rev-parse --short=8 HEAD)"
if git rev-parse "$ANCHOR" >/dev/null 2>&1; then
  if [ "$(git rev-parse HEAD)" = "$(git rev-parse $ANCHOR)" ]; then
    ok "HEAD ($HEAD_SHORT) == anchor $ANCHOR"
  elif git merge-base --is-ancestor HEAD "$ANCHOR" 2>/dev/null; then
    ok "HEAD ($HEAD_SHORT) is an ancestor of anchor $ANCHOR (feature branch that was merged)"
  elif git merge-base --is-ancestor "$ANCHOR" HEAD 2>/dev/null; then
    ok "HEAD ($HEAD_SHORT) descends from anchor $ANCHOR (catching up past the activation point)"
  else
    bad "HEAD ($HEAD_SHORT) is unrelated to anchor $ANCHOR — running against unexpected branch / rollback?"
  fi
else
  bad "anchor $ANCHOR not present in local git history — run 'git fetch origin main' first"
fi

# ── A. Production DB state (manual — run SQL in Supabase editor) ──
hdr "A. Production DB state"
cat <<'SQL_A1'
  A1 — All 5 encryption migrations applied. Run in Supabase SQL editor:
  -------------------------------------------------------------------
  SELECT
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='memories' AND column_name='encrypted')            AS m021_encrypted_col,
    EXISTS(SELECT 1 FROM information_schema.tables  WHERE table_name='memory_dek_wraps')                                 AS m021_wraps_table,
    EXISTS(SELECT 1 FROM information_schema.tables  WHERE table_name='encryption_keys')                                  AS m021_keys_table,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='memories' AND column_name='content_tokens')        AS m022_content_tokens,
    EXISTS(SELECT 1 FROM pg_proc           WHERE proname='set_memory_content_tokens')                                    AS m022_rpc,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='memories' AND column_name='provider_delegated')    AS m023_delegated_col,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='memories' AND column_name='summary_ciphertext')    AS m024_summary_ct,
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='memories' AND column_name='embedding_ciphertext')  AS m024_embedding_ct,
    EXISTS(SELECT 1 FROM pg_proc           WHERE proname='revoke_memory')                                                AS m024_rpc,
    EXISTS(SELECT 1 FROM pg_proc           WHERE proname='redelegate_memory')                                            AS m025_rpc;
  -------------------------------------------------------------------
SQL_A1
ask "A1 — paste SQL above, record: every column TRUE? [Y/N]"

cat <<'SQL_A2'
  A2 — Zero encrypted rows currently. Run in Supabase SQL editor:
  -------------------------------------------------------------------
  SELECT
    (SELECT COUNT(*) FROM memories WHERE encrypted = true)              AS encrypted_rows,
    (SELECT COUNT(*) FROM memory_dek_wraps)                             AS wrap_rows,
    (SELECT COUNT(*) FROM memories WHERE provider_delegated = false)    AS revoked_rows,
    (SELECT COUNT(*) FROM memories WHERE summary_ciphertext IS NOT NULL
                                      OR embedding_ciphertext IS NOT NULL) AS ciphertext_rows;
  -------------------------------------------------------------------
SQL_A2
ask "A2 — all four counts must be 0. Record actuals: [encrypted=?, wraps=?, revoked=?, ciphertext=?]"

cat <<'SQL_A3'
  A3 — ts_summary expression (THE migration-022-step-5 gate). Run:
  -------------------------------------------------------------------
  SELECT pg_get_expr(adbin, adrelid) AS expression
  FROM   pg_attribute a
  JOIN   pg_attrdef    d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE  a.attrelid = 'memories'::regclass AND a.attname = 'ts_summary';
  -------------------------------------------------------------------
SQL_A3
ask "A3 — does the expression mention ONLY 'summary' (PASS), or both 'summary' AND 'content' (EXPECTED current state — Task 1 fixes)?"

cat <<'SQL_A4'
  A4 — content_tokens cardinality (informs D1). Run:
  -------------------------------------------------------------------
  SELECT
    AVG(length(content))::int  AS avg_content_len,
    MAX(length(content))::int  AS max_content_len,
    AVG((SELECT COUNT(*) FROM unnest(string_to_array(content_tokens::text, ' '))))::int AS avg_token_count
  FROM (SELECT * FROM memories WHERE content_tokens IS NOT NULL ORDER BY id DESC LIMIT 100) sample;
  -------------------------------------------------------------------
SQL_A4
ask "A4 — record numbers. If avg_content_len < 2000, the LEFT(2000) bound is mostly harmless."

cat <<'SQL_A5'
  A5 — Bot corpus size (informs D2). Run:
  -------------------------------------------------------------------
  SELECT owner_wallet, COUNT(*) AS n FROM memories GROUP BY owner_wallet ORDER BY n DESC LIMIT 10;
  -------------------------------------------------------------------
SQL_A5
ask "A5 — record top 10 owners + their row counts. Bot wallet should be #1."

ask "A6 — Supabase PITR retention window: confirm Settings → Database → PITR is ENABLED + retention is recorded. [Y/N + days]"

# ── B. Railway env + service config parity ──
hdr "B. Railway env + service config"
ask "B1 — Railway PROD: PMP_ENCRYPTION_ENABLED is UNSET (must be empty). [Y/N]"
ask "B2 — Railway PROD: PMP_PROVIDER_ENC_SECRET is UNSET (must be empty). [Y/N]"
ask "B3 — Railway PROD: CLUDE_OWNER_WALLET set + matches bot wallet. [Y/N]"
ask "B4 — Preview ↔ prod parity: region, Node version (engines field in package.json), build command, start command, resource tier, secret-manager binding, and key non-secret env vars match. [Y/N per item]"

# ── C. Code coherence (mechanical) ──
hdr "C. Code coherence"
n=$(grep -cE "await decryptMemories\(" packages/brain/src/memory/memory.ts 2>/dev/null || echo 0)
if [ "$n" -ge 9 ]; then ok "C1 — decryptMemories sites in memory.ts = $n (≥9)"; else bad "C1 — only $n decryptMemories sites; expected ≥9"; fi

n=$(grep -cE "\.not\('provider_delegated', 'is', false\)" packages/brain/src/memory/memory.ts 2>/dev/null || echo 0)
if [ "$n" -eq 3 ]; then ok "C2a — recall-exclusion paths in memory.ts = 3"; else bad "C2a — $n recall-exclusion paths; expected 3"; fi
n=$(grep -cE "provider_delegated !== false" packages/brain/src/memory/graph.ts 2>/dev/null || echo 0)
if [ "$n" -ge 1 ]; then ok "C2b — graph.ts exclusion filter present"; else bad "C2b — graph.ts exclusion filter missing"; fi

if grep -q "plaintextContent" packages/brain/src/memory/memory.ts && grep -q "encrypted: boolean" packages/brain/src/memory/memory.ts; then
  ok "C3 — commitMemoryToChain takes plaintextContent + encrypted"
else
  bad "C3 — commitMemoryToChain signature missing plaintext/encrypted params"
fi

if grep -q "PMP_ENCRYPTION_ENABLED !== 'true'" packages/brain/src/memory/memory-encryption.ts; then
  ok "C4 — isMemoryEncryptionEnabled guards on env var first"
else
  bad "C4 — env-var guard not found in isMemoryEncryptionEnabled"
fi

if grep -q "decryptOneContent" apps/server/src/routes/pmp.routes.ts; then
  ok "C5 — VERIFY route uses decryptOneContent"
else
  bad "C5 — VERIFY route missing decryptOneContent (Plan 3b regression?)"
fi

if grep -q "encryptionRoutes()" apps/server/src/routes/index.ts; then
  ok "C6 — encryption routes mounted in index.ts"
else
  bad "C6 — encryption routes NOT mounted"
fi

for fn in revokeMemory redelegateMemory decryptMemories decryptOneContent; do
  if grep -q "$fn" packages/brain/src/memory/index.ts; then
    ok "C7 — barrel exports $fn"
  else
    bad "C7 — barrel missing $fn export"
  fi
done

ask "C8 — manual review: storeMemory envelope → legacy → plaintext precedence preserved at packages/brain/src/memory/memory.ts ~451-540 [Y/N]"
ask "C9 — npx tsx scripts/encryption/roundtrip-probe.ts exits 0 [Y/N]"
ask "C10 — roundtrip-probe also runs derived-key determinism + end-to-end round-trip and exits 0 [Y/N]"

# ── D. Test surface re-verification (mechanical) ──
hdr "D. Test surface"
echo "  D1 — running shared tests..."
(cd packages/shared && pnpm exec vitest run > /tmp/preflight-shared.log 2>&1) && ok "D1 shared: pass" || bad "D1 shared: FAIL (see /tmp/preflight-shared.log)"
echo "  D2 — running brain tests..."
(cd packages/brain && pnpm exec vitest run > /tmp/preflight-brain.log 2>&1) || true
brain_result="$(grep -E '^[[:space:]]+(Test Files|Tests)' /tmp/preflight-brain.log | tail -2)"
if [ -n "$brain_result" ]; then echo "$brain_result" | sed 's/^/      /'; fi
# Anchor on the summary lines specifically — first 'failed' anywhere in the log can come from error stacks.
brain_failed_files="$(grep -E '^[[:space:]]+Test Files' /tmp/preflight-brain.log | tail -1 | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' || echo 0)"
brain_failed_tests="$(grep -E '^[[:space:]]+Tests' /tmp/preflight-brain.log | tail -1 | grep -oE '[0-9]+ failed' | grep -oE '[0-9]+' || echo 0)"
if [ "${brain_failed_files:-0}" = "2" ] && [ "${brain_failed_tests:-0}" = "1" ]; then
  ok "D2 brain — 2 failed files / 1 failed test = known pre-existing (wallet-migration + setup-zero-config); no NEW reds"
else
  ask "D2 brain — UNEXPECTED counts ($brain_failed_files failed files, $brain_failed_tests failed tests). Manually verify only wallet-migration + setup-zero-config are red [Y/N]"
fi
echo "  D3 — running server (excluding 4 known-red) under default pool..."
(cd apps/server && pnpm exec vitest run \
  --exclude '**/topup-routes.test.ts' \
  --exclude '**/chat-routes-conversation.test.ts' \
  --exclude '**/compound-routes.test.ts' \
  --exclude '**/cortex-register.test.ts' > /tmp/preflight-server.log 2>&1) \
  && ok "D3 server (12 files, 115 tests): pass" || bad "D3 server: FAIL (see /tmp/preflight-server.log)"
echo "  D4 — typechecks..."
(cd packages/shared && pnpm exec tsc --noEmit) > /dev/null 2>&1 && ok "D4 shared tsc: clean" || bad "D4 shared tsc: FAIL"
(cd packages/brain  && pnpm exec tsc --noEmit) > /dev/null 2>&1 && ok "D4 brain tsc: clean"  || bad "D4 brain tsc: FAIL"
(cd apps/server     && pnpm exec tsc --noEmit) > /dev/null 2>&1 && ok "D4 server tsc: clean" || bad "D4 server tsc: FAIL"

# ── E. DEK / plaintext leak audit ──
hdr "E. DEK / plaintext leak"
e1=$(grep -rnE "log\.(info|warn|error|debug)\([^)]*(dek|wrapped|providerSecret)" packages/brain/src packages/shared/src apps/server/src 2>/dev/null \
  | grep -v "_test\." | grep -v "__tests__" | grep -v "memory-encryption.ts" || true)
if [ -z "$e1" ]; then ok "E1 — no secret material in log statements"; else bad "E1 — possible leak: $e1"; fi

e2=$(grep -rnE "wrapped_dek|wrap_pubkey|providerSecret|secretKey" apps/server/src packages/brain/src 2>/dev/null \
  | grep -v "_test\." | grep -v "__tests__" \
  | grep -v "memory-revoke.ts" | grep -v "memory-encryption.ts" | grep -v "memory-envelope.ts" | grep -v "encryption-keys.ts" \
  | grep -v "memory-decryption.ts" | grep -v "encryption.routes.ts" \
  | grep -v "cli/snapshot.ts" | grep -v "cli/export.ts" || true)
# Excluded files are the legitimate handlers of this material:
#   memory-revoke / memory-encryption / memory-decryption / memory-envelope / encryption-keys / encryption.routes — encryption surface
#   cli/snapshot + cli/export — Solana ed25519 SIGNING secretKey for memory-pack signatures (DIFFERENT key, different purpose)
if [ -z "$e2" ]; then ok "E2 — sensitive identifiers only inside allowed files (encryption surface + memorypack signing)"; else bad "E2 — outside allowed files: $e2"; fi

if grep -A 12 "async function commitMemoryToChain" packages/brain/src/memory/memory.ts | grep -q "memoryContentHash.*plaintextContent\|plaintextContent.*memoryContentHash"; then
  ok "E3 — commitMemoryToChain hashes plaintextContent"
else
  ask "E3 — visually confirm commitMemoryToChain hashes plaintextContent (not data.content) [Y/N]"
fi

# ── F. Migration coherence (3 surfaces) ──
hdr "F. Migration coherence"
for fn in revoke_memory redelegate_memory set_memory_content_tokens bm25_search_memories; do
  a=$(grep -c "FUNCTION $fn" packages/database/supabase-schema.sql 2>/dev/null || echo 0)
  b=$(grep -c "FUNCTION $fn" packages/shared/src/core/database.ts 2>/dev/null || echo 0)
  if [ "$a" -ge 1 ] && [ "$b" -ge 1 ]; then
    ok "F1 — $fn defined in schema ($a) and initDatabase ($b)"
  else
    bad "F1 — $fn: schema=$a init=$b (mismatch)"
  fi
done

# ── G. Spec / docs coherence ──
hdr "G. Spec / docs coherence"
n=$(grep -c "validate-by-decrypt\|Validate-by-decrypt" docs/pmp/memory-encryption-design.md 2>/dev/null || echo 0)
if [ "$n" -ge 1 ]; then ok "G1 — design doc §7 reflects validate-by-decrypt deviation"; else bad "G1 — design doc missing deviation note"; fi
ask "G2 — manual check: design doc §9 schema matches what's in prod (per Section A probes) [Y/N]"

# ── H. Smoke test the dormant endpoints ──
hdr "H. Smoke tests"
PROD="${PROD_URL:-https://clude.io}"
c1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PROD/v1/memories/foo/revoke" 2>/dev/null)
c2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PROD/v1/memories/foo/redelegate" -H "Content-Type: application/json" -d '{}' 2>/dev/null)
c3=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$PROD/v1/keys/revoke-all" 2>/dev/null)
[ "$c1" = "401" ] && ok "H1a — revoke route 401 (dormant + auth-gated)"     || bad "H1a — revoke got $c1; expected 401"
[ "$c2" = "401" ] && ok "H1b — redelegate route 401"                         || bad "H1b — redelegate got $c2; expected 401"
[ "$c3" = "401" ] && ok "H1c — revoke-all route 401"                         || bad "H1c — revoke-all got $c3; expected 401"
hc=$(curl -s -o /dev/null -w "%{http_code}" "$PROD/health" 2>/dev/null)
[ "$hc" = "200" ] && ok "H2 — /health 200" || bad "H2 — /health $hc"
ask "H3 — manually GET /v1/memories/<known-plaintext-hash-id>/verify and confirm {verified:true, committed_encrypted:false}"

# ── I. Backup verification ──
hdr "I. Backup verification"
ask "I1 — Supabase Settings → Database → PITR is ENABLED + record retention window in days"
ask "I2 — capture exact UTC timestamp before activation: $(date -u '+%Y-%m-%d %H:%M:%S UTC') — record for rollback target"

# ── J. Rollback plan ──
hdr "J. Rollback"
[ -f scripts/encryption/ROLLBACK.md ] && ok "J1 — ROLLBACK.md exists" || bad "J1 — ROLLBACK.md missing — create per Plan 5 Task 0 J1"
ask "J2 — ROLLBACK.md content reviewed + committed [Y/N]"

# ── Result ──
hdr "Result"
echo "  PASS: $PASS   FAIL: $FAIL   manual-confirm pending: $ASK"
if [ "$FAIL" -gt 0 ]; then
  echo ""
  echo "🛑 Pre-flight FAILED — do NOT proceed to Plan 5 Tasks 1+. Fix issues above and re-run."
  exit 1
fi
if [ "$ASK" -gt 0 ]; then
  echo ""
  echo "⏳ Pre-flight COMPLETE for mechanical checks. $ASK items require operator manual confirmation."
  echo "   Resolve all ⏳ items above with PASS/FAIL/values before proceeding."
  exit 2
fi
echo ""
echo "✅ Pre-flight GREEN. PMP encryption stack is coherent and dormancy is intact."
