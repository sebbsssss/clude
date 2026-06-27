# Encrypted `.pmp` Export + Owner-Held Client-Side Decrypt — Design Spec

**Status:** Approved design (2026-06-27). Next: implementation plan via writing-plans.

**Goal:** Make the memory-pack `.pmp` export ship **ciphertext** instead of plaintext, and add a **zero-knowledge, client-side decrypt** flow in the dashboard so the legitimate holder "unhashes" the file themselves with their wallet. The server never sees plaintext on either path.

**Why:** Today `/v1/pmp/export` emits plaintext (`encryption_scope: 'none'`, `pmp-artifacts.routes.ts:567`), so a sold/leaked `.pmp` exposes raw memory content. The marketplace sells pack ownership via the title NFT; the file that travels with it must be useless without the holder's key.

---

## Locked decisions (from brainstorming)

1. **Self-contained, client-side decrypt** (zero-knowledge). The `.pmp` embeds ciphertext + the DEK sealed to the holder; the **browser** decrypts. The server never receives the derived private key or plaintext.
2. **Encrypted by default — enforced server-side, fail-closed.** The dashboard already sends `encrypt: true`, but the route's Zod `encrypt` field is `z.boolean().optional()` with **no `.default`** and is currently never read. The server must add the default at the branch point as `body.encrypt ?? true` — an omitted field fails **closed to encrypted**, never to plaintext. Opt-out to plaintext requires an explicit `encrypt: false`; marketplace-listed packs are always encrypted.
3. **Wallet-signature key** (reuse `memory-envelope`). Decryption key = `HKDF(ed25519 wallet signature over a fixed message)`. "Can decrypt" == "holds the title-bearing wallet." No new key system, no passphrase.

---

## What already exists (reuse, do not rebuild)

- `packages/shared/src/core/memory-envelope.ts`: `deriveOwnerEncryptionKeypair(signature)` (X25519 box keypair via HKDF-SHA256 of the 64-byte ed25519 signature; determinism is load-bearing, guarded by a verifier token), `wrapDek`/`unwrapDek` (nacl sealed box), `encryptField`/`decryptField` (XSalsa20-Poly1305 secretbox), `makeVerifierCiphertext`/`checkVerifier`.
- `encryption_keys` table (migration 021): `owner_wallet → x25519_pubkey + verifier_ct`. **Public keys only.** The server seals DEKs to a holder's registered pubkey without ever holding a private key.
- `memory_dek_wraps` (021 + 034): per-memory wrapped DEKs, `recipient ∈ {owner, provider, title_holder}`; `holder_wallet` set only for `title_holder`.
- `apps/server/src/lib/payments/title-dek.ts`: `rewrapPackDekToTitleHolder` does **recover-DEK-via-provider-wrap → reseal-to-holder**, but that is the **title-transfer** path (rewrapping at-rest provider DEKs when a title NFT changes hands), **not** what the export needs. At-rest provider wraps are gated off by `PMP_ENCRYPTION_ENABLED`, so the export has no DEK to recover; it generates a fresh per-pack DEK from the `memory-envelope` primitives above (`generateDek`/`wrapDek`/`secretbox`). See *Server change*.
- `apps/chat/src/lib/crypto.ts`: a working **client-side** wallet-signature → HKDF → decrypt flow (different scheme — Web Crypto AES-GCM BYOK — but it proves the browser sign-to-derive UX and pattern).
- `tweetnacl` runs natively in the browser (pure JS): `nacl.box.open` + `nacl.secretbox.open` work client-side.

---

## Architecture & data flow

```
EXPORT (server; no plaintext leaves the boundary)        DECRYPT (browser; only place content is in the clear)
  load holder's encryption_keys row (REQUIRE it)           user clicks "Decrypt locally" on the .pmp
  packDEK ← generateDek()                 [fresh, per pack] wallet signs OWNER_SIGN_MESSAGE
  dek_wrap ← wrapDek(packDEK, holder_pubkey) [seal once]    keypair ← deriveOwnerKeypairBrowser(sig)  [Web Crypto HKDF]
  for each record:                                          checkVerifier(verifier_ct, key)  → right wallet?
    content ← secretbox(content, packDEK)  [encrypt]        packDEK ← unwrapDek(header.dek_wrap)  nacl.box.open (once)
    leaf (metadata.leaf_hash) left as the PLAINTEXT hash    for each record: secretbox.open(content, packDEK)
  header: {recipient_pubkey, verifier_ct, dek_wrap, wrap_pubkey, merkle_root}   re-hash plaintext → verify vs leaf+root
  records: {…structural…, content(ct), nonce, encrypted, metadata.leaf_hash}   render / download plaintext
  → .pmp = ciphertext only
```

---

## The `.pmp` payload (`encryption_scope: 'owner'`)

**Header (once per pack):** `recipient_wallet`, `recipient_pubkey` (base64 X25519), `verifier_ct` (copied from `encryption_keys`), `dek_wrap` (the **single pack DEK** sealed to the holder), `wrap_pubkey` (ephemeral sender X25519), and the existing `merkle_root`.

**Per record — reuse the existing v0.2 fields, do not invent new ones.** `MemoryPackRecord` already has `encrypted?: boolean` + `nonce?: string` (`packages/memorypack/src/types.ts`). Structural fields stay **plaintext** (`kind`, `created_at`, `metadata.leaf_hash` — the merkle leaf) so the file is browseable + integrity-checkable without decrypting. Sensitive fields become ciphertext under the pack DEK:
- `content` = base64 secretbox ciphertext; `nonce` = base64 per-record nonce; `encrypted = true`.
- `tags` encrypted the same way (they leak content).
- `summary` is **not** carried on the export record — `mapMemoryToRecord` omits it — so there is nothing to encrypt there (the original spec's `summary_ct` was a no-op).

**Verifiability decision (the one real tradeoff, approved):** the merkle `leaf` is computed over **plaintext** at export, *before* encryption — matching the on-chain commitment, which hashes plaintext (`commitMemoryToChain`, C1). After decrypting, the browser re-hashes each record's plaintext and proves it matches the embedded `leaf`, the embedded `merkle_root`, and (optionally) the on-chain anchor. Tampering with `content`/`nonce`, `dek_wrap`, or `metadata.leaf_hash` fails verification. (Alternative — leaf over ciphertext — was rejected: it would make the file self-verifying but break the buyer's ability to prove the *content* matches what was sold on-chain.)

---

## Prerequisite: owner-key registration (new sub-flow, from plan review)

The export seals to the holder's X25519 pubkey, which must already be in `encryption_keys`. Today there is **no user-facing flow to register one** and **no canonical sign-message** for the envelope scheme (only the bot/provider key is derived server-side; the chat `clude-byok-v1` is a *different* AES-GCM scheme). So the feature adds a one-time registration:

- **Browser** (dashboard, gated behind the wallet): sign `OWNER_SIGN_MESSAGE` → `deriveOwnerKeypairBrowser(sig)` → `verifier_ct = makeVerifierCiphertext(secretKey)` → POST `{ x25519_pubkey, verifier_ct }`.
- **Server**: `POST /v1/encryption/owner-key` (authed, owner-scoped) upserts `encryption_keys(owner_wallet, x25519_pubkey, verifier_ct)`. **Never receives a private key.** Idempotent.
- The encrypted export refuses with `holder_key_unregistered` until this exists; the dashboard prompts "register your encryption key" first. Decryption re-derives from the *same* `OWNER_SIGN_MESSAGE`, so keys match by construction.

Reuses `encryption_keys` (migration 021) — **no new migration.**

---

## Server change (surgical)

New: `apps/server/src/lib/pmp/encrypt-records-for-holder.ts` → `encryptRecordsForHolder(db, records, holderWallet)`.

**Self-encrypting — corrected after plan review.** At-rest memory encryption is gated by `PMP_ENCRYPTION_ENABLED` and is **off by default / not yet activated in prod** (it's literally Plan 5 Task 5, pending). So the exported memories have **no provider DEK to recover** — the original "reuse the title-dek rewrap" approach does not apply. The export instead **generates its own encryption**, independent of at-rest state:
- Load the holder's `encryption_keys.x25519_pubkey` + `verifier_ct`; **throw `holder_key_unregistered`** if absent (see *Prerequisite: owner-key registration* below).
- `generateDek()` **once per pack**; `wrapDek(packDek, holderPubkey)` **once** → `{dek_wrap, wrap_pubkey}` go in the `.pmp` **header**.
- For each record: `secretbox(content, packDek)` with a fresh nonce → set `record.content` = base64 ciphertext, `record.encrypted = true`, `record.nonce` = base64(nonce). Encrypt `tags` the same way. **Do not touch `metadata.leaf_hash`** (the merkle leaf — it must stay the plaintext hash).
- Owner-scope every query; never log the DEK or plaintext.

`pmp-artifacts.routes.ts` `/v1/pmp/export`: branch on `body.encrypt ?? true`. **Two coupled-but-distinct write sites** must both change on the encrypted path, not just the DB column:
- the **`.pmp` file bytes** are assembled to `outFile` / `pmpBase64` (~line 543) — this is what the buyer downloads and must carry ciphertext;
- the **`pmp_artifacts` row** sets `encryption_scope` (the `'none'` literal at ~line 567) — flip it to `'owner'`.

Flipping only the column while still writing a plaintext file is the trap. On the encrypted path, run `encryptRecordsForHolder` before the file is written, emit the `'owner'` header into the file, and confirm `pmp_base64` contains zero cleartext. When `encrypt` is `false`, the plaintext path is unchanged.

`packages/memorypack` (the `.pmp` schema/types): add the encrypted record shape + the `'owner'` `encryption_scope`, plus a parse-time discriminator so importers branch.

---

## Dashboard decrypt (the new UI + browser crypto)

**Constants — browser-safe leaf module (avoid bundling Node crypto).** `memory-envelope.ts` imports Node `crypto`, and `@clude/shared` pulls in `getDb`; importing from it into the dashboard would drag Node-only modules into the browser bundle. So put the three plain string constants in a new **dependency-free leaf module** `packages/shared/src/core/owner-key-constants.ts` (no imports): `OWNER_SIGN_MESSAGE = 'clude-pmp-owner-v1'`, `HKDF_SALT = 'clude-cortex-v1'`, `HKDF_INFO = 'memory-encryption-x25519-v2'`. `memory-envelope.ts` imports its salt/info from there (single source of truth); the browser imports the same. Add `tweetnacl` to `apps/dashboard/package.json`.

New browser module: `apps/dashboard/src/lib/decrypt-pmp.ts` →
- `deriveOwnerKeypairBrowser(signature)` — **byte-identical** to the server: Web Crypto `subtle.deriveBits({name:'HKDF', hash:'SHA-256', salt, info}, …)` then `nacl.box.keyPair.fromSecretKey(first32bytes)`, with `salt`/`info` = `TextEncoder().encode()` of the **same** `HKDF_SALT`/`HKDF_INFO` strings the server's Node `hkdf` uses. This salt/info encoding equivalence is the single highest-risk item — backtest §a asserts a known signature → identical X25519 keypair on a shared fixture.
- `decryptPmp(pmpJson, signature)` — `checkVerifier(header.verifier_ct)`; unwrap the **pack DEK** from the header (`nacl.box.open`) once; per record `secretbox.open(content, packDek)` → plaintext; re-hash + verify vs `metadata.leaf_hash`/`merkle_root`; returns `{records, verified}`.

UI: a "Decrypt locally" action on the export/artifact card in `ExportScreen.tsx`. Flow: detect `encryption_scope:'owner'` → prompt a wallet signature over **`OWNER_SIGN_MESSAGE`** (NOT the chat BYOK message — different scheme) → `decryptPmp` → render or download plaintext. **Nothing posts to the server.** Clear the derived key from memory after use.

---

## Security invariants (the backtest hammers these)

1. On the encrypted export path the server response (`pmp_base64` + JSON) contains **zero cleartext** memory content/summary/tags.
2. The server **never** receives the holder's derived private key or decrypted plaintext on the decrypt path (it's browser-only; no `/decrypt` endpoint exists in this design).
3. The DEK is sealed **only** to the holder's pubkey; a different wallet's signature derives a different key → `box.open` returns null → hard fail, no partial leak.
4. `verifier_ct` gate rejects a wrong wallet/signature before any record is attempted.
5. Determinism: same wallet + fixed message → same key (existing verifier-token guard; browser path must reproduce it).
6. Tamper-evidence: mutated `content`/`dek_wrap`/`leaf` → secretbox/box auth fail or merkle mismatch → fail closed.
7. Backward compat: legacy `encryption_scope:'none'` `.pmp`s import/verify unchanged; the importer only prompts for decrypt when scope is `'owner'`.

---

## Threat model (honest boundaries)

- **Protects:** a leaked/intercepted `.pmp` file (useless ciphertext); content-before-purchase (only the title-holding wallet can derive the key).
- **Does NOT protect:** a legitimate holder re-sharing decrypted plaintext (no crypto stops that — licensing/watermarking is out of scope); a compromised browser, wallet, or signed-message phishing.

---

## Out of scope (YAGNI)

- Bearer `.pmp` (a file decryptable by *future* title holders) — incompatible with self-contained client-side; the per-holder model + on-chain title already handle ownership transfer.
- Passphrase decrypt (Approach B) — not built; documented only as a fallback if client-side wallet signing proves infeasible for some account type.
- Re-encrypting at-rest storage — unchanged; this only touches the export + a new browser decrypt.

---

## Adversarial backtest plan (MONEY/ACCESS/DATA code — required before merge)

2–3 general-purpose subagents, **distinct lenses**, each returns a GO/NO_GO verdict; any NO_GO blocks merge until remediated.

- **(a) Crypto correctness:** prove `deriveOwnerKeypairBrowser` is **byte-identical** to `deriveOwnerEncryptionKeypair` on shared fixtures (a known signature → identical X25519 keypair); full round-trip (export-encrypt → browser-decrypt → plaintext) on real member memories; wrong-key/wrong-wallet returns null and never partial plaintext; verifier gate fires.
- **(b) Leakage audit:** trace + grep the encrypted export response and logs for any cleartext content/summary/tags/DEK/private-key; confirm no decrypt endpoint exists and the browser path posts nothing; confirm the `holder_key_unregistered` refusal can't be bypassed into a plaintext export.
- **(c) Compat + tamper:** legacy plaintext `.pmp` still imports/verifies; each of `content`/`dek_wrap`/`leaf` tampered independently → fail closed; the merkle leaf still matches the on-chain plaintext commitment so a decrypted pack verifies against what was sold.

---

## File touch-list (for the plan)

| File | Change |
|---|---|
| `apps/server/src/lib/pmp/encrypt-records-for-holder.ts` | **new**: generate fresh per-pack DEK → seal to holder + secretbox sensitive fields |
| `apps/server/src/routes/pmp-artifacts.routes.ts` | branch the export on `encrypt`; `'owner'` header; ciphertext writer |
| `packages/memorypack/*` | `.pmp` encrypted record shape + `encryption_scope:'owner'` + parse discriminator |
| `apps/dashboard/src/lib/decrypt-pmp.ts` | **new** — browser derive (Web Crypto HKDF + tweetnacl) + `decryptPmp` |
| `apps/dashboard/src/pages/ExportScreen.tsx` | "Decrypt locally" action + wallet-sign UX |
| `packages/shared/src/core/memory-envelope.ts` | export shared `HKDF_SALT`/`HKDF_INFO` constants (so browser matches) if not already |
| tests | server (`encryptRecordsForHolder`, export path), shared (server↔browser derivation parity), dashboard (`decryptPmp` round-trip + tamper) |

No new migration (reuses `encryption_keys` + `memory_dek_wraps`).
