# Encrypted `.pmp` Export + Owner-Held Client-Side Decrypt — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/v1/pmp/export` emit an encrypted `.pmp` (ciphertext + DEK sealed to the holder) by default, and add a zero-knowledge browser decrypt in the dashboard, reusing the existing `memory-envelope` + `title-dek` primitives. The server never sees plaintext on either path.

**Architecture:** The export already builds `records: MemoryPackRecord[]` and calls `writeMemoryPack(outFile, records)` (`pmp-artifacts.routes.ts:518`). On the encrypted path we insert `encryptRecordsForHolder(records, holderWallet)` *before* `writeMemoryPack`: since at-rest encryption is off by default (no provider DEK exists), it **generates a fresh pack DEK**, `secretbox`-encrypts each record's content/tags under it (reusing the v0.2 `encrypted`/`nonce` fields), and seals the pack DEK **once** to the holder's registered `encryption_keys` X25519 pubkey — leaving `metadata.leaf_hash` (the merkle leaf, computed over plaintext in `mapMemoryToRecord`) untouched so the on-chain commitment holds. The holder must first register their pubkey (a one-time sign-`OWNER_SIGN_MESSAGE` flow). The dashboard re-derives the holder key from a wallet signature (Web Crypto HKDF, byte-identical to the server) and decrypts locally.

**Tech Stack:** TypeScript, `tweetnacl` (browser + server), Node `crypto.hkdf` (server) / Web Crypto `subtle` (browser), Vitest, pnpm monorepo. Reuses `@clude/shared/core/memory-envelope` (`generateDek`/`wrapDek`/`unwrapDek`/`encryptField`/`makeVerifierCiphertext`/`checkVerifier`), the new `owner-key-constants` leaf module, `@clude/memorypack`. (No provider key — the export self-encrypts.)

**Spec:** `docs/encrypted-pmp-export-design.md`. **MONEY/ACCESS/DATA code — TDD throughout; the plan ends with a gating 3-lens adversarial backtest.**

---

## Corrections folded post-review (2026-06-27)

Three corrections from the plan-reviewer iteration-2 advisory + the opsec audit are folded into the tasks below. They land BEFORE any real `verifier_ct`/owner key is published, so changing derivation now is free:

- **L1 (Task 1) — separate verifier key.** `memory-envelope`'s `makeVerifierCiphertext`/`checkVerifier` currently feed the 32-byte X25519 ECDH private key straight into `nacl.secretbox` to build the public `verifier_ct` (cross-primitive key reuse). Derive a SEPARATE verifier key via HKDF under a distinct info label `VERIFIER_HKDF_INFO = 'memory-key-verifier-v1'` (add it to `owner-key-constants`). The box secret must never be the secretbox key.
- **M1 (Task 1b) — publish-route binding.** The owner-key publish route binds `owner_wallet` to `req.verifiedWallet` ONLY. A posted `verifier_ct` does **not** prove wallet binding (an attacker can post a self-consistent `{pubkey, verifier_ct}` for any keypair they control), so it must never be trusted for auth. Add a verifier-class overwrite guard: refuse to stomp an existing `encryption_keys` row whose `verifier_ct` is a different class (mirror `ensureCustodialTitleIdentity`).
- **Iteration-2 (Task 5) — browser-safe primitives.** The browser decrypt must NOT import `memory-envelope` (it pulls Node `crypto` into the bundle). Implement the tweetnacl ops (`box.open` = unwrap DEK, `secretbox.open`, verifier check) inline in `decrypt-pmp.ts` against `tweetnacl` directly, importing only the string constants from `owner-key-constants`. Add `tweetnacl` to `apps/dashboard` deps; base64 via `atob`/`Uint8Array` (note the Buffer polyfill if any util needs it).

---

## File structure

| File | Responsibility | New? |
|---|---|---|
| `packages/shared/src/core/memory-envelope.ts` | Re-export `HKDF_SALT`/`HKDF_INFO` so the browser imports the exact constants | modify |
| `apps/server/src/lib/pmp/encrypt-records-for-holder.ts` | Server: recover-via-provider → reseal-to-holder + secretbox sensitive fields; throws `holder_key_unregistered` | **new** |
| `apps/server/src/lib/pmp/__tests__/encrypt-records-for-holder.test.ts` | Unit tests for the above | **new** |
| `packages/memorypack/src/types.ts` | `EncryptedMemoryPackRecord` shape + `encryption_scope: 'owner'` + header fields | modify |
| `packages/memorypack/src/*` (writer/parser) | Accept encrypted records + the `'owner'` header; parse discriminator | modify |
| `apps/server/src/routes/pmp-artifacts.routes.ts` | Branch `writeRegisterRespond` on `body.encrypt ?? true`; encrypt records before `writeMemoryPack`; `encryption_scope:'owner'` | modify (~458–567) |
| `apps/dashboard/src/lib/decrypt-pmp.ts` | Browser: `deriveOwnerKeypairBrowser` (Web Crypto HKDF + tweetnacl) + `decryptPmp` | **new** |
| `apps/dashboard/src/lib/__tests__/decrypt-pmp.test.ts` | Round-trip + parity + tamper tests | **new** |
| `apps/dashboard/src/pages/ExportScreen.tsx` | "Decrypt locally" action + wallet-sign UX | modify |

No new migration (reuses `encryption_keys` + `memory_dek_wraps`).

**Test commands** (from repo root): server — `cd apps/server && SITE_ONLY=true npx vitest run <path>`; shared — `cd packages/shared && npx vitest run <path>`; memorypack — `cd packages/memorypack && npx vitest run <path>`; dashboard — `cd apps/dashboard && npx vitest run <path>`.

---

### Task 1: Re-export the HKDF constants from `memory-envelope`

The browser must derive with the *exact* salt/info the server uses, but `memory-envelope.ts` imports Node `crypto` — importing it into the dashboard drags Node-only code into the bundle. Put the constants in a **dependency-free leaf module** the browser can import safely; have the envelope import from it (single source of truth).

**Files:** Create `packages/shared/src/core/owner-key-constants.ts`; Modify `packages/shared/src/core/memory-envelope.ts`; Test `packages/shared/src/core/__tests__/owner-key-constants.test.ts`

- [ ] **Step 1: Failing test:**
```ts
import { OWNER_SIGN_MESSAGE, HKDF_SALT, HKDF_INFO, VERIFIER_HKDF_INFO } from '../owner-key-constants.js';
it('exposes the exact owner-key constants for cross-platform parity', () => {
  expect(OWNER_SIGN_MESSAGE).toBe('clude-pmp-owner-v1');
  expect(HKDF_SALT).toBe('clude-cortex-v1');
  expect(HKDF_INFO).toBe('memory-encryption-x25519-v2');
  expect(VERIFIER_HKDF_INFO).toBe('memory-key-verifier-v1'); // L1: distinct label, separate verifier key
});
```
- [ ] **Step 2: Run, verify FAIL** — `cd packages/shared && npx vitest run src/core/__tests__/owner-key-constants.test.ts`.
- [ ] **Step 3: Implement** — create `owner-key-constants.ts` exporting the four **string** constants (no imports whatsoever); in `memory-envelope.ts` import `HKDF_SALT`/`HKDF_INFO` from it and `TextEncoder().encode()` them where the HKDF needs bytes — values byte-for-byte unchanged.
- [ ] **Step 3b (L1): separate verifier key.** In `memory-envelope.ts`, change `makeVerifierCiphertext`/`checkVerifier` to derive a DEDICATED 32-byte secretbox key via `hkdf('sha256', secretKey, HKDF_SALT, VERIFIER_HKDF_INFO, 32)` instead of feeding the X25519 box secret to `nacl.secretbox`. Add a test: `checkVerifier(makeVerifierCiphertext(sk), sk) === true`, a different sk fails, and the derived verifier key is NOT byte-equal to the box secret. (No published `verifier_ct` exists yet, so this is a free, non-breaking change.)
- [ ] **Step 4: Run, verify PASS** (+ existing `memory-envelope.test.ts` still green — DEK wrap/unwrap + owner-key derivation unchanged; only the verifier-key source changes).
- [ ] **Step 5: Commit** — `git commit -m "feat(shared): owner-key-constants leaf module + separate verifier key (L1)"`

---

### Task 1b: Owner-key registration (the prerequisite)

The export seals to a holder's registered `encryption_keys` pubkey; no user-facing flow registers one today. Add an authed route that stores the **public** key the browser derived, plus the browser register call.

**Files:** Create `apps/server/src/routes/encryption-owner-key.routes.ts` (or extend `encryption.routes.ts`) + test; a `registerOwnerKey` helper in the browser crypto module.

- [ ] **Step 1: Failing route test** — `POST /v1/encryption/owner-key` (`requirePrivyAuth` + `requireOwnership`) with `{ x25519_pubkey, verifier_ct }` upserts the `encryption_keys` row keyed on the **verified wallet** and is idempotent; unauthenticated → 401; a body/query `owner`/`wallet` is IGNORED (binding comes from `req.verifiedWallet`); the route never reads/stores a private key. **M1 overwrite guard:** a second POST from the SAME wallet with a DIFFERENT `verifier_ct` class is rejected (refuse to stomp a row of a different verifier class), so a re-register can't silently replace a holder's key.
- [ ] **Step 2: Run, verify FAIL** — `cd apps/server && SITE_ONLY=true npx vitest run <test>`.
- [ ] **Step 3: Implement** — derive `owner = getRequestOwner(req)` from `req.verifiedWallet` ONLY (never body/query — a posted `verifier_ct` does NOT prove wallet binding, since an attacker can post a self-consistent `{pubkey, verifier_ct}` for any keypair they control). Upsert `encryption_keys(owner_wallet=owner, x25519_pubkey, verifier_ct)`; before overwriting an existing row, apply the same verifier-class guard `ensureCustodialTitleIdentity` uses (refuse to replace a different verifier class). The browser `registerOwnerKey()` signs `OWNER_SIGN_MESSAGE` → `deriveOwnerKeypairBrowser` → computes `verifier_ct` via tweetnacl secretbox (using the L1 separate verifier key) → POSTs the public pubkey + verifier_ct.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat: owner-key registration route + browser register (prereq for encrypted export)"`

---

### Task 2: `encryptRecordsForHolder` server helper

**Self-encrypting (corrected after plan review).** At-rest encryption is off by default, so there is NO provider DEK to recover. Generate a fresh **pack DEK**, secretbox each record's `content` (+ `tags`) under it, and seal the pack DEK **once** to the holder's registered pubkey. The merkle leaf is `record.metadata.leaf_hash` — leave it untouched (plaintext hash). `summary` is not on the record — do not encrypt it.

**Files:** Create `apps/server/src/lib/pmp/encrypt-records-for-holder.ts` + `__tests__/encrypt-records-for-holder.test.ts`

Interface:
```ts
export async function encryptRecordsForHolder(
  db: DbLike,
  records: MemoryPackRecord[],          // plaintext records from mapMemoryToRecord
  holderWallet: string,
): Promise<{ records: MemoryPackRecord[]; header: OwnerEncHeader }>
// header = { recipient_wallet, recipient_pubkey, verifier_ct, dek_wrap, wrap_pubkey }
// each record: content=base64 ciphertext, nonce=base64, encrypted=true, tags encrypted; metadata.leaf_hash UNCHANGED
```

- [ ] **Step 1: Failing tests** — mock `db` so `encryption_keys` returns the holder's `x25519_pubkey` + `verifier_ct`. Use `generateDek` + `wrapDek`/`unwrapDek` from `memory-envelope` in the test. Assert:
  - each returned record's `content` is base64 ciphertext (NOT the plaintext), `encrypted === true`, has a `nonce`, and `metadata.leaf_hash` is UNCHANGED; the `header` has `dek_wrap` + `wrap_pubkey` + `recipient_pubkey` + `verifier_ct`;
  - round-trip: `unwrapDek(header.dek_wrap, holderSecret)` recovers the pack DEK, and `secretbox.open(record.content, packDek)` recovers the original plaintext;
  - a different holder secret → `unwrapDek` returns null (no leak);
  - **throws `holder_key_unregistered`** when `encryption_keys` has no row for `holderWallet`;
  - the returned `header.verifier_ct` equals the holder's registered `verifier_ct`.
- [ ] **Step 2: Run, verify FAIL** — `cd apps/server && SITE_ONLY=true npx vitest run src/lib/pmp/__tests__/encrypt-records-for-holder.test.ts`.
- [ ] **Step 3: Implement** — load `encryption_keys.x25519_pubkey` + `verifier_ct` for `holderWallet` (throw `holder_key_unregistered` if absent); `const dek = generateDek()`; `wrapDek(dek, holderPubkey)` → the header `dek_wrap`/`wrap_pubkey`; for each record: `encryptField(content, dek)` → set `content`/`nonce`/`encrypted=true`, encrypt `tags` the same way, **leave `metadata.leaf_hash` untouched**; return `{ records, header }`. **No provider key, no `memory_dek_wraps` read.** Owner-scope every query; never log the DEK or plaintext.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git add apps/server/src/lib/pmp/encrypt-records-for-holder.ts apps/server/src/lib/pmp/__tests__/ && git commit -m "feat(server): encryptRecordsForHolder — reseal pack DEK to holder + secretbox fields (TDD)"`

---

### Task 3: `.pmp` `'owner'` record shape in `@clude/memorypack`

Add the encrypted record + header fields + a parse discriminator. Keep the writer byte-stable for plaintext records (backward compat).

**Files:** Modify `packages/memorypack/src/types.ts` + the writer/parser; Test `packages/memorypack/src/__tests__/*`

- [ ] **Step 1: Failing test** — `writeMemoryPack` with `encryption_scope:'owner'` + records carrying ciphertext + `dek_wrap` produces a `.pmp` whose parse round-trips the encrypted fields and reports `encryption_scope === 'owner'`; a plaintext (`'none'`) pack parses byte-identically to before (snapshot).
- [ ] **Step 2: Run, verify FAIL** — `cd packages/memorypack && npx vitest run`.
- [ ] **Step 3: Implement** — extend `MemoryPackRecord` (or add `EncryptedMemoryPackRecord`) with optional `dek_wrap?`, `wrap_pubkey?`, and treat `content`/`summary` as opaque strings; add header fields `recipient_wallet`, `recipient_pubkey`, `verifier_ct`; parser branches on `encryption_scope`.
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(memorypack): encryption_scope:'owner' record shape + parse discriminator (TDD)"`

---

### Task 4: Wire encryption into `/v1/pmp/export`

Branch `writeRegisterRespond` on `body.encrypt ?? true` (fail-closed to encrypted). On the encrypted path, transform `records` via `encryptRecordsForHolder` BEFORE `writeMemoryPack` (so the file bytes are ciphertext), set the `'owner'` header + `encryption_scope:'owner'` on the artifact row. Plaintext path unchanged when `encrypt === false`.

**Files:** Modify `apps/server/src/routes/pmp-artifacts.routes.ts` (~458–567); Test `apps/server/src/routes/__tests__/pmp-artifacts*.test.ts` (or a focused new test)

- [ ] **Step 1: Failing route test** — POST `/v1/pmp/export` (selection or pack path) with `encrypt` omitted: assert the response `pmp_base64`, decoded + parsed, has `encryption_scope === 'owner'` and **contains no plaintext** of a known seeded memory's content; with `encrypt: false`: plaintext `.pmp` as today; with the holder having no `encryption_keys` row: 4xx `holder_key_unregistered` (no plaintext file emitted).
- [ ] **Step 2: Run, verify FAIL.**
- [ ] **Step 3: Implement** — thread `encrypt` + `owner` into `writeRegisterRespond`; when encrypting, `const { records: enc, header } = await encryptRecordsForHolder(db, records, owner)`, pass `enc` to `writeMemoryPack` and emit `header` into the `.pmp`; set `encryption_scope:'owner'` on the artifact row. Keep `metadata.leaf_hash`/merkle untouched (already plaintext). Map the `holder_key_unregistered` throw to a 4xx.
- [ ] **Step 4: Run, verify PASS** (+ run the full `pmp-artifacts` + `marketplace-payments` route suites to confirm no regression).
- [ ] **Step 5: Commit** — `git commit -m "feat(server): encrypted .pmp export by default (fail-closed) — wire encryptRecordsForHolder (TDD)"`

---

### Task 5: Browser decrypt module `decrypt-pmp.ts` (incl. the parity fixture)

`deriveOwnerKeypairBrowser(signature)` byte-identical to the server, and `decryptPmp(pmpJson, signature)`. The HKDF parity fixture is the single highest-risk assertion.

**Files:** Create `apps/dashboard/src/lib/decrypt-pmp.ts` + `__tests__/decrypt-pmp.test.ts`

- [ ] **Step 1: Failing tests:**
  - **Parity fixture (load-bearing):** for a fixed 64-byte signature, `deriveOwnerKeypairBrowser(sig)` produces the SAME X25519 keypair bytes as the server's `deriveOwnerEncryptionKeypair(sig)` (import the server fn in the test to compare — both run under Node/vitest; this proves salt/info encoding equivalence).
  - **Round-trip:** given a `.pmp` produced by `encryptRecordsForHolder` for a holder whose secret derives from `sig`, `decryptPmp(pmp, sig)` returns the original plaintext records and `verified === true` (re-hash matches `metadata.leaf_hash`/root).
  - **Wrong key:** a different `sig` → `box.open` null → throws/empty, never partial plaintext.
  - **Verifier gate:** wrong `sig` fails `checkVerifier` before any record is attempted.
  - **Tamper:** mutate `content`/`dek_wrap`/`metadata.leaf_hash` independently → fail closed.
- [ ] **Step 2: Run, verify FAIL** — `cd apps/dashboard && npx vitest run src/lib/__tests__/decrypt-pmp.test.ts`.
- [ ] **Step 3: Implement** — **do NOT import `memory-envelope`** (it pulls Node `crypto` into the bundle); implement every crypto op inline against `tweetnacl` (iteration-2 advisory). Add `tweetnacl` to `apps/dashboard/package.json`. `deriveOwnerKeypairBrowser`: `subtle.importKey('raw', sig, 'HKDF', …)` → `subtle.deriveBits({name:'HKDF', hash:'SHA-256', salt: enc(HKDF_SALT), info: enc(HKDF_INFO)}, key, 256)` → `nacl.box.keyPair.fromSecretKey(new Uint8Array(bits))`. `decryptPmp`: verifier check = `nacl.secretbox.open` of `verifier_ct` under the HKDF-`VERIFIER_HKDF_INFO` key (L1 parity with the server); per record unwrap DEK = `nacl.box.open` of `dek_wrap`, then `nacl.secretbox.open(content, nonce, dek)` → plaintext; re-hash + verify; return `{records, verified}`. Import ONLY the string constants (`HKDF_SALT`/`HKDF_INFO`/`VERIFIER_HKDF_INFO`) from `@clude/shared` `owner-key-constants` (Task 1). base64 via `atob`/`Uint8Array` (note a Buffer polyfill only if a shared util needs it).
- [ ] **Step 4: Run, verify PASS.**
- [ ] **Step 5: Commit** — `git commit -m "feat(dashboard): decrypt-pmp browser module — zero-knowledge owner decrypt + HKDF parity (TDD)"`

---

### Task 6: "Decrypt locally" UI in `ExportScreen.tsx`

A button on the artifact card that detects `encryption_scope:'owner'`, prompts a wallet signature over **`OWNER_SIGN_MESSAGE`** (the chat's `BYOK_SIGN_MESSAGE` = `'clude-byok-v1'` is a DIFFERENT scheme — copy the sign-message *UX*, not the constant), runs `decryptPmp`, and renders/downloads plaintext. If the holder has no registered key yet, prompt Task 1b's `registerOwnerKey()` first. Nothing posts to the server.

**Files:** Modify `apps/dashboard/src/pages/ExportScreen.tsx` (+ a small `usePmpDecrypt` hook if cleaner)

- [ ] **Step 1:** Add the action gated on `encryption_scope==='owner'`; wire wallet `signMessage(fixedMessage)` → `decryptPmp` → set decrypted state → download/preview. Clear the derived key after use.
- [ ] **Step 2:** Dashboard typecheck (`cd apps/dashboard && npx tsc --noEmit`) clean; manual smoke noted (no browser test harness for the wallet path — verified in backtest lens (a) via the unit round-trip).
- [ ] **Step 3: Commit** — `git commit -m "feat(dashboard): Decrypt locally action on encrypted .pmp"`

---

### Task 7: Backward-compat verification

Legacy `encryption_scope:'none'` `.pmp`s import/verify/parse unchanged; the importer only offers decrypt for `'owner'`.

**Files:** Test only (server import path + memorypack parse)

- [ ] **Step 1: Failing/guard test** — a pre-existing plaintext `.pmp` fixture parses + verifies exactly as before; the import route handles `'none'` without prompting for a key. **Step 2:** run. **Step 3: Commit** — `git commit -m "test: backward-compat for plaintext .pmp import/parse"`

---

### Task 8 (GATING): 3-lens adversarial backtest

MONEY/ACCESS/DATA code does not merge without this. Dispatch 2–3 `general-purpose` subagents, distinct lenses, each returns GO/NO_GO. Any NO_GO → remediate, re-run.

- [ ] **Lens (a) Crypto correctness** — verify the parity fixture (server↔browser derive identical keypair), full export→browser-decrypt round-trip on real seeded memories, wrong-key/wrong-wallet returns null (no partial plaintext), verifier gate fires.
- [ ] **Lens (b) Leakage audit** — trace + grep the encrypted export response + server logs for ANY cleartext content/summary/tags/DEK/private-key; confirm no `/decrypt` endpoint exists and the browser path posts nothing; confirm `holder_key_unregistered` can't be bypassed into a plaintext file.
- [ ] **Lens (c) Compat + tamper** — legacy plaintext `.pmp` still works; each of `content`/`dek_wrap`/`metadata.leaf_hash` tampered independently fails closed; the plaintext merkle leaf still matches the on-chain commitment so a decrypted pack verifies against what was sold.
- [ ] **Remediate any NO_GO, then full suite green (`encrypt-records-for-holder`, `pmp-artifacts` routes, `memorypack`, `decrypt-pmp`) + tsc clean across server/shared/memorypack/dashboard. Then open PR to `staging`.**

---

## Notes for the implementer
- Owner-scope EVERY db query (this is cross-tenant data). Mirror `title-dek.ts`.
- Never log plaintext, DEKs, or private keys (structured fields only).
- The merkle/`metadata.leaf_hash` is computed in `mapMemoryToRecord` BEFORE encryption — do not recompute it post-encryption or the on-chain commitment breaks.
- The `.pmp` `pmp_base64` is the buyer-facing artifact; the leakage test must decode it and assert zero cleartext.
