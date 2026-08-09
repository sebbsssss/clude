# PMP Encryption — Activation Runbook (Plan 5)

> Turnkey sequence for the maintenance window + flag flip. Run top to bottom.
> Each step has a verify. STOP if any verify fails. Keep `ROLLBACK.md` open alongside.
>
> **Decisions locked:** D1 = Option A (LEFT 2000), D2 = Option A (forward-only).
> **Pre-flight:** GREEN (see `preflight-audit.sh`). PITR enabled, 7-day window.

---

## Status of the 4 encryption-prep migrations

| # | File | State |
|---|---|---|
| 026 | `026_proof_token_savings.sql` | ✅ applied (unrelated, proof features) |
| 027 | `027_provider_delegated_backfill.sql` | ✅ applied 2026-06-01 (returned 0) |
| 028 | `028_ts_summary_summary_only.sql` | ⏳ apply in STEP 1 below |
| 029 | `029_content_tokens_bounded.sql` | ⏳ apply in STEP 2 below |

---

## STEP 0 — Pre-window checks (do right before the window)

```bash
# On the activation branch, re-run the mechanical audit:
bash scripts/encryption/preflight-audit.sh
# Expect: 30+ PASS / 0 FAIL on mechanical checks.

# Confirm crypto invariants still hold:
npx tsx scripts/encryption/roundtrip-probe.ts
# Expect: C9 + C10 GREEN, exit 0.
```

Capture the **pre-activation UTC timestamp** now (rollback target):
```bash
date -u '+%Y-%m-%d %H:%M:%S UTC'
```
Record it in `ROLLBACK.md`.

---

## STEP 1 — Migration 028 (ts_summary summary-only)  ⚠️ MAINTENANCE WINDOW

> Writes to `memories` are blocked ~2–5 min during Phase 1. BM25-on-summary degrades
> until Phase 2's index is VALID. Run Phase 1 + Phase 2 BACK-TO-BACK.
> Pre-load the Phase 2 SQL in a separate psql Session-pooler session BEFORE starting.

### Phase 1 — row rewrite (Supabase SQL editor)
```sql
BEGIN;
  ALTER TABLE memories DROP COLUMN ts_summary;  -- also drops idx_memories_ts_summary
  ALTER TABLE memories ADD  COLUMN ts_summary tsvector
    GENERATED ALWAYS AS (setweight(to_tsvector('english', COALESCE(summary, '')), 'A')) STORED;
COMMIT;
```

### Phase 2 — concurrent index (psql Session pooler — NOT transaction pooler)
```sql
SET statement_timeout = 0;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_ts_summary ON memories USING GIN (ts_summary);
```

### Verify
```sql
-- Expression now summary-only:
SELECT pg_get_expr(adbin, adrelid)
FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE a.attrelid='memories'::regclass AND a.attname='ts_summary';   -- mentions only `summary`

-- Index VALID:
SELECT indexrelid::regclass, indisvalid FROM pg_index
WHERE indrelid='memories'::regclass AND indexrelid::regclass::text LIKE '%ts_summary%';  -- indisvalid = true
```
**STOP if `indisvalid` is false** — DROP and rebuild (still CONCURRENTLY) before continuing.

---

## STEP 2 — Migration 029 (content_tokens LEFT 2000)  — fast, no window needed

```sql
CREATE OR REPLACE FUNCTION set_memory_content_tokens(p_memory_id bigint, p_text text)
RETURNS void LANGUAGE sql AS $$
  UPDATE memories
  SET content_tokens = CASE
        WHEN p_text IS NULL OR p_text = '' THEN NULL
        ELSE setweight(to_tsvector('english', LEFT(p_text, 2000)), 'B')
      END
  WHERE id = p_memory_id;
$$;
```
Verify: `SELECT prosrc FROM pg_proc WHERE proname='set_memory_content_tokens';`  → contains `LEFT(p_text, 2000)`.

---

## STEP 3 — Generate provider keypair (offline, NEVER in chat)

```bash
cat > /tmp/gen-provider-key.js <<'EOF'
const nacl = require('tweetnacl');
const k = nacl.box.keyPair();                 // X25519 — the ONLY correct primitive
if (k.publicKey.length !== 32 || k.secretKey.length !== 32) throw new Error('bad key length');
const testDek = nacl.randomBytes(32), eph = nacl.box.keyPair(), n = nacl.randomBytes(24);
const sealed = nacl.box(testDek, n, k.publicKey, eph.secretKey);
const opened = nacl.box.open(sealed, n, eph.publicKey, k.secretKey);
if (!opened || Buffer.compare(opened, testDek) !== 0) throw new Error('round-trip failed — wrong primitive?');
require('child_process').spawnSync('pbcopy', { input: Buffer.from(k.secretKey).toString('base64') });
console.log('✅ secret copied to clipboard; public:', Buffer.from(k.publicKey).toString('base64'));
EOF
node /tmp/gen-provider-key.js && rm /tmp/gen-provider-key.js
```
- Save the printed **public** key to `docs/pmp/provider-pubkey.txt` (committable).
- Keep the secret on the clipboard for STEP 4.

---

## STEP 4 — Stage on PREVIEW first

1. Railway preview env: set `PMP_PROVIDER_ENC_SECRET` = (clipboard). Restart. Confirm log `Provider encryption keypair loaded`.
2. Railway preview env: set `PMP_ENCRYPTION_ENABLED=true`. Restart.
3. Write one test memory through the bot/agent path. Verify in DB:
   ```sql
   SELECT id, encrypted, provider_delegated,
          (SELECT count(*) FROM memory_dek_wraps w WHERE w.memory_id=m.id) AS wraps
   FROM memories m ORDER BY id DESC LIMIT 3;
   ```
   Newest row: `encrypted=true`, `provider_delegated=true`, `wraps=2`, content base64 (not plaintext).
4. Recall it → plaintext matches. VERIFY → `verified=true, committed_encrypted=true`. Revoke → `revoked=true` + DB shows provider wrap gone, summary='', ts_summary empty (proves STEP 1 landed).
5. **No-owner-key fallback:** write as a fresh non-bot wallet (no published key) → row lands `encrypted=false` + warn log `No owner encryption key resolvable`. Recall returns plaintext.

---

## STEP 5 — Flip PROD  ⚠️ IRREVERSIBLE after first encrypted write

1. Re-run STEP 0 audit. **Re-confirm 028 expression is summary-only + index VALID.**
2. Prod env: set `PMP_PROVIDER_ENC_SECRET` = same secret. Redeploy. Confirm `Provider encryption keypair loaded`. (Encryption still OFF — flag not set yet.)
3. Prod env: set `PMP_ENCRYPTION_ENABLED=true`. Note UTC timestamp. Redeploy.
4. Trigger a known write. Verify newest prod row: `encrypted=true, provider_delegated=true, wraps=2`, content not plaintext.
5. End-to-end: recall round-trip, VERIFY (`committed_encrypted=true`), revoke round-trip.
6. Watch Railway logs 15 min — no new 500s on `/v1/memories/*`, no unexpected errors.

> From the first `encrypted=true` row onward: **`PMP_PROVIDER_ENC_SECRET` must stay set forever.**
> See `ROLLBACK.md` for the asymmetric rollback tree.

---

## STEP 6 — 24h observation

- `npx tsx scripts/encryption/decrypt-bench.ts --memories=50` (write this first — Task 6) → record p50/p95 added latency. Expect ~8–15 ms per recall at recall_limit=50.
- Watch logs/Sentry hourly. Triage `revoke_memory RPC failed`, `No owner encryption key resolvable` (expected for SDK users pre-Plan-6), unexpected 500s.
- Compare 24h recall p95 vs prior baseline (budget +20 ms).
- Green at 24h → update MEMORY.md + design doc footer with the activation date.

---

## Quick rollback (full tree in ROLLBACK.md)

| Problem | Action |
|---|---|
| Stop new encrypted writes | unset `PMP_ENCRYPTION_ENABLED` (leave provider secret) |
| Decryption broken | unset flag, hotfix code, keep secret set |
| Provider key compromised | unset flag, plan re-wrap migration, swap key only after |
| Catastrophic | PITR restore to STEP 0 timestamp |
