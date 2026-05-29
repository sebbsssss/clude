# PMP Encryption — Rollback Playbook

> **Read this before flipping `PMP_ENCRYPTION_ENABLED=true` in prod.**
> The flag flip + the first encrypted write together constitute an asymmetric
> commitment: pre-write fully reversible, post-write the provider key must
> stay set for the lifetime of those rows.

---

## Asymmetric properties

| Phase | What's true | What's reversible |
|---|---|---|
| **Pre-flag-flip** | `PMP_ENCRYPTION_ENABLED` unset, `PMP_PROVIDER_ENC_SECRET` may or may not be set | Everything. No state has been committed. |
| **Post-flip, pre-first-encrypted-write** | New writes will envelope-encrypt as soon as one arrives | Still fully reversible — unset the flag, no encrypted rows exist |
| **Post-first-encrypted-write** | One or more rows have `encrypted=true`; their content is base64(nonce \|\| ciphertext); their DEKs are wrapped to the provider's X25519 pubkey | **`PMP_PROVIDER_ENC_SECRET` must remain set forever.** Removing it bricks every encrypted row. The flag itself can still be unset to stop NEW encrypted writes. |

---

## Decision tree

Encountered a problem in the 24h post-activation window? Pick the matching scenario:

### 1. New writes are correctly encrypting, but you want to STOP creating new encrypted rows.

> Typical reason: post-activation observation reveals an issue with the encryption
> path you want to investigate before continuing.

**Action:**
1. Unset `PMP_ENCRYPTION_ENABLED` in Railway prod (delete the variable; do NOT set it to `"false"`).
2. Railway auto-redeploys.
3. Confirm: `isMemoryEncryptionEnabled()` returns false in startup probe.
4. New writes are now plaintext again.
5. **Existing encrypted rows continue to read normally** via `decryptMemories` and `decryptOneContent`.

**DO NOT unset `PMP_PROVIDER_ENC_SECRET`.** Existing encrypted rows need the provider
key to be readable. The plaintext-path rows wrote without needing it; the
encrypted-path rows wrote with the wrap sealed to that key.

**Reversible? Yes.** Re-set the flag later to resume encrypted writes.

---

### 2. The decryption path itself is broken (recall is 500'ing on encrypted rows).

> Typical reason: bug in `decryptMemories`, `decryptOneContent`, or `unwrapDek`.
> The data is fine — only the read path is broken.

**Action (two-step):**
1. **Immediately apply scenario 1** — unset `PMP_ENCRYPTION_ENABLED`. This stops the
   failure surface from growing while you fix. New writes return to plaintext.
   Existing encrypted rows continue to fail recall **until the hotfix lands** — but
   the population is now bounded.
2. **Hotfix and redeploy** the decryption code. Keep `PMP_PROVIDER_ENC_SECRET` set
   throughout. Once decryption is verified working again, optionally re-enable
   `PMP_ENCRYPTION_ENABLED` (or leave off pending a fuller postmortem).

**NEVER unset the provider key during this.** It does not help you read existing
rows; it only makes the situation irrecoverable.

**Reversible? Yes, once decryption is fixed.**

---

### 3. The provider key itself is suspected to be compromised.

> Typical reason: leaked into a log, copied into a screenshot, suspicious
> Railway access trail. Treat this as a SECURITY INCIDENT.

**Action — DO NOT just rotate the key.** A naive rotation breaks every encrypted
row (the new key cannot unwrap the existing wraps).

**Correct sequence:**
1. Unset `PMP_ENCRYPTION_ENABLED` immediately — stop new encrypted writes.
2. **Do NOT unset `PMP_PROVIDER_ENC_SECRET`** — you still need to read existing rows.
3. Triage scope: which rows were created during the compromise window? Are their
   plaintext contents sensitive enough to warrant point-in-time-restoring the
   table to pre-flip? (For the bot corpus this is generally NO; PII risk is low.)
4. Build a re-wrap migration: for each encrypted row, unwrap with the current
   provider key, generate a fresh DEK + wrap pair under the new provider key,
   atomic UPDATE. Same shape as Plan 5 Task 3 D2 Option B bulk migration. This
   is destructive in the same sense as bulk migration — paged, snapshot the
   table first, run on a maintenance window.
5. Only after re-wrap is complete, swap `PMP_PROVIDER_ENC_SECRET` to the new key
   in Railway. Optionally re-enable `PMP_ENCRYPTION_ENABLED`.

**Reversible? Yes, but slow (hours).** This is the worst scenario the rollback
needs to cover.

---

### 4. Catastrophic — decryption broken AND provider key suspected lost/compromised simultaneously.

> Extremely unlikely; included for completeness.

**Action — point-in-time restore.** Use the UTC timestamp captured in Task 0 I2
(pre-flip) to restore the `memories` table to its pre-encryption state via
Supabase PITR. **This loses every legitimate write between the flip and the
restore.** Communicate the data loss window clearly.

After restore, the system is back to "all plaintext, dormant." Triage why
provider key + decryption both failed; do not re-attempt activation until both
root causes are understood.

---

## Forbidden actions (will make things worse)

- **Setting `PMP_PROVIDER_ENC_SECRET` to a different value while encrypted rows
  exist.** Bricks every encrypted row. The only valid key-change path is the
  re-wrap migration in scenario 3.
- **Deleting rows from `memory_dek_wraps` outside of `revoke_memory`.** The wraps
  are how the system reads encrypted rows; deleting them is equivalent to
  silently revoking without the proper audit trail.
- **Setting `encrypted=false` on a row whose `content` is still ciphertext.** The
  system will then try to read the ciphertext as plaintext and emit garbage to
  callers.

---

## Quick reference

```
Problem                                  → Action
─────────────────────────────────────────────────────────────────────
Stop new encrypted writes                → unset PMP_ENCRYPTION_ENABLED
Decryption broken                         → unset flag (1), then hotfix
Provider key compromised                  → unset flag (1), plan re-wrap
Catastrophic                              → PITR restore to pre-flip
─────────────────────────────────────────────────────────────────────
ALL scenarios: leave PMP_PROVIDER_ENC_SECRET set if any encrypted row exists.
```

## Pre-activation timestamp

Recorded at Task 0 I2 (re-capture immediately before flag flip in Task 5):

```
UTC timestamp: ______________________________
Captured by:   ______________________________
```
