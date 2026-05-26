# Memory Encryption at Rest — Design

**Status:** Design, pending spec review + user approval
**Date:** 2026-05-19
**Owner:** Sebastien
**Related:** PMP v0.1, the on-chain content-leak fix (#197/#198)

---

## 1. Problem

Memory content is currently stored plaintext in Supabase, and historically a content prefix was written to public Solana memos (fixed forward in #197/#198, but the old memos are immutable). Before opening a memory protocol to real users, content must be encrypted at rest such that **the owner controls who can read it** — including the ability to revoke the provider's access — without breaking Clude's cognitive architecture (recall, dream cycles, which must read content to function).

## 2. Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Key source | Reuse the Privy wallet — derive the encryption keypair from a deterministic wallet signature |
| Delegation default | Delegated by default, revocable (globally or per-memory) |
| Encrypted fields | `content` + `summary` + `embedding` |
| Migration | Encrypt forward; migrate the bot corpus now; user memories lazily on first key publish |
| Construction | Per-memory envelope encryption with a wrapped-DEK table (Approach 1) |

**Core principle:** the privacy boundary is **revocation**, enforced cryptographically (the provider's wrapped DEK is destroyed), not a policy flag. While delegated, the server reads content — that is what delegation means.

**Field lifecycle (refined after review — fixes H3, H4).** The four sensitive fields do NOT all behave identically, because recall needs to *search* over some of them at full speed:

| Field | While delegated | On revoke |
|---|---|---|
| `content` | **ciphertext at rest** (decrypted on read for top-K) | stays ciphertext; provider loses the DEK |
| `summary` | **plaintext** (feeds embedding generation + candidate scoring) | encrypted under DEK, plaintext cleared |
| `embedding` | **plaintext** in pgvector (vector search) | encrypted under DEK, plaintext column cleared |
| `content_tokens` (content lexemes — new, app-maintained tsvector) | **plaintext** keyword artifact derived from content (BM25/keyword recall) | set `NULL` |
| `ts_summary` (summary lexemes — **existing**, repurposed) | generated from `summary` only; plaintext | auto-empties when `summary` is cleared (no special handling) |

Rationale: while delegated the server can read `content` anyway (it holds the DEK), so keeping summary/embedding/lexical plaintext exposes no *additional* capability — but it lets recall rank and keyword-match at native speed with no special-casing. `content` is the one field kept ciphertext-at-rest even while delegated, so a database leak (while delegated) exposes the gist (summary/embedding/keywords) but not the full content. On revoke, everything plaintext is sealed/cleared and the server has nothing. This is an explicit, documented at-rest tradeoff — the strict alternative (encrypt summary too) makes candidate scoring impossible.

**Why the lexical index is split across two columns (reconciles with the existing `ts_summary`).** The live BM25/keyword path (`bm25_search_memories` RPC) queries a single column, `ts_summary`, which today is `GENERATED ALWAYS AS (setweight(to_tsvector(summary),'A') || setweight(to_tsvector(LEFT(content,2000)),'B')) STORED`. Two problems once `content` is ciphertext: (1) the `LEFT(content,2000)` term would index ciphertext garbage; (2) **a GENERATED column cannot be conditionally cleared on revoke** — it is recomputed from its source columns automatically. The fix is to stop generating over `content` and split the lexical surface:
- **`ts_summary`** is repurposed to generate from **`summary` only**. Because we already clear `summary` (plaintext) on revoke, `ts_summary` auto-empties for free — we clear the *source*, never the generated column. No content ever flows through it.
- **`content_tokens`** is a new, *non-generated* tsvector that the app populates from the plaintext content at write time (and on re-delegate), and sets to `NULL` on revoke. This is the only hand-maintained half.

Graceful degradation is the reason for keeping a generated `ts_summary` rather than de-generating everything: if a write path ever forgets to populate `content_tokens`, summary-based keyword recall still works. Given keyword recall drove the LongMemEval 34.8%→68.4% gain, silently zeroing it on a missed write would be unacceptable.

## 3. Architecture

Three layers:

- **Identity layer** — each owner has an X25519 encryption keypair derived from their Privy wallet; the provider has its own X25519 keypair. Public keys live in a registry; private keys never co-locate.
- **Envelope layer** — each memory has a random Data Encryption Key (DEK). Fields are encrypted with the DEK (`nacl.secretbox`, XSalsa20-Poly1305). The DEK is wrapped (`nacl.box`, X25519) to each authorised recipient.
- **Delegation layer** — the set of recipients a DEK is wrapped to *is* the access-control state. Owner is always a recipient; provider is a recipient iff delegated.

## 4. Key management

### 4.1 Owner keypair (client-side, derived, never stored server-side)
Derived in the dashboard via **sign-to-derive**: the **Privy Solana (ed25519) embedded wallet** signs a fixed domain message `"clude-memory-encryption-v1"` via `signMessage`. → `HKDF-SHA256(signature, salt="clude-cortex-v1", info="memory-encryption-x25519-v2")` → 32-byte seed → `nacl.box.keyPair.fromSecretKey(seed)`. Sign-to-derive (not raw key export) because Privy embedded wallets reliably expose signing, not raw key material. The private key is re-derived each session in the browser and never sent to the server.

**Determinism is load-bearing and MUST NOT be assumed (fixes H2).** RFC 8032 ed25519 signing is deterministic, but not every wallet/adapter guarantees it (some add entropy; EVM/secp256k1 `personal_sign` is *not* deterministic without RFC 6979). If signing is non-deterministic, every session derives a different key and **all prior memories become permanently undecryptable**. Guard:
1. We mandate the Privy **Solana ed25519** wallet specifically; EVM wallets are unsupported for encryption in v1 (documented, enforced in the dashboard).
2. **Verifier token:** on first derivation the client encrypts a known constant (`"clude-key-verifier-v1"`) under the derived key and the server stores the ciphertext in `encryption_keys.verifier_ct`. On every subsequent session the client re-derives, decrypts the verifier, and asserts it matches. **On mismatch the dashboard hard-stops** ("this wallet's signatures aren't deterministic — encryption unsupported") and blocks new encrypted writes before any data is created under a bad key.

### 4.2 Provider keypair
A dedicated X25519 keypair generated once; private key in server secrets (Railway env `PMP_PROVIDER_ENC_SECRET`). Distinct from the bot's Solana wallet — separates "signs transactions" from "decrypts delegated memories."

### 4.3 Public-key registry — new table `encryption_keys`
`(owner_wallet PK, x25519_pubkey, created_at, updated_at)`. On first dashboard login the client derives its keypair and publishes the **public** key. The server reads this to wrap DEKs to an owner. No private keys, ever.

### 4.4 The bot is an owner
The bot's encryption keypair derives from the bot's Solana wallet (server-side — the server holds it). Registered like any owner, so migration can encrypt the bot corpus immediately. For the bot, owner == provider (self-delegated); both wraps point at server-controlled keys.

### 4.5 Domain separation
The legacy `encryption.ts` derives a *symmetric* key (HKDF info `memory-encryption`). The new asymmetric scheme uses info `memory-encryption-x25519-v2` and lives in a new module (`memory-envelope.ts`). The legacy scheme is deprecated, not extended — the two can never collide.

## 5. Write path

When a memory is stored (`storeMemory()` / PMP `CONTRIBUTE`):

1. **Plaintext processing first** (delegation is on): auto-summary if absent, generate embedding (from summary), infer concepts, auto-categorise tags, build the `content_tokens` lexical index from plaintext content (`ts_summary` is generated from `summary` automatically — see §9), and compute the canonical `memory-hash-v1` over the **plaintext content**.
2. **Hash over plaintext — and `commitMemoryToChain` MUST change (fixes C1).** The current `commitMemoryToChain` (memory.ts ~line 562) hashes `row.content` *after* it's been written, which becomes ciphertext once encryption lands. That is wrong: a public commitment to ciphertext bytes is meaningless and would change on every re-encrypt. The implementation MUST compute the hash from the **plaintext** content in this step and pass it explicitly to the chain-commit, never re-reading the stored (encrypted) column.
3. **Encrypt**: generate a random 32-byte DEK. `nacl.secretbox` over `content` only (at rest, always). `summary`, `embedding`, and the lexical columns (`content_tokens` + the summary-derived `ts_summary`) stay **plaintext while delegated** per the §2 lifecycle table. **Independent random 24-byte nonce per ciphertext field**, prepended (fixes L8).
4. **Wrap**: look up the owner's pubkey in `encryption_keys`; `nacl.box`-wrap the DEK to the owner pubkey and (delegated default) the provider pubkey. Insert two `memory_dek_wraps` rows.
5. **Store**: row with ciphertext `content`; plaintext `summary` + `embedding` (delegated); `encrypted: true`, `encryption_pubkey` = owner's, `provider_delegated: true`. Then populate `content_tokens` via the `set_memory_content_tokens` RPC, passing the plaintext content as a transient parameter (PostgREST cannot express `to_tsvector` inline, and the plaintext is a function argument — never stored as a column). `ts_summary` is maintained automatically by Postgres from `summary`. Tokenisation/chain commit uses the plaintext hash from step 1.
6. **No owner key yet (fixes M5)**: store plaintext, `encrypted: false`, **and return `encrypted: false` in the CONTRIBUTE/store response** so the caller is never misled into thinking content is sealed. The dashboard labels such memories "not yet encrypted." Lazy migration seals them on key publish. The bot always has a key.

The DEK exists in server memory only for steps 3–4; afterward it lives solely as the two wraps. **The DEK and the wraps MUST never be logged or returned in any API response (fixes L9)** — enforced by a test.

## 6. Read / recall path

Insight: **while delegated, the server can already read content (it holds the provider DEK), so keeping that memory's embedding plaintext exposes nothing extra.** The boundary is revocation.

1. **Vector + keyword search stay fast**: delegated memories keep `embedding` (pgvector) and the lexical columns (`content_tokens` + summary-derived `ts_summary`) plaintext. All indexes intact; vector recall AND BM25/keyword recall rank at full speed. `bm25_search_memories` is updated to match/rank over both lexical columns (`ts_summary OR content_tokens`, see §9). `summary` is plaintext too, so candidate scoring (which reads summary) works unchanged.
2. **Decrypt only winners**: rank on plaintext embedding/tokens/summary + metadata, select top-K, then for those K decrypt **`content`**: fetch provider wrap → `nacl.box.open` with provider private key → DEK → `secretbox.open`. O(K), not O(corpus). Replaces `decryptMemoryBatch`.
3. **Dream cycles**: same unwrap-then-decrypt, over bot memories (self-delegated) + delegated user memories. DEKs may be cached **per-memory** for the dream session, **but the cache is invalidated on revoke (fixes M6)** — a revoke during a running dream session evicts that memory's DEK so the server stops being able to read it within the session, not at session end.
4. **Revoked memories vanish**: `provider_delegated = false` excludes them from recall's candidate query; `embedding` and `summary` are sealed (encrypted under DEK) and their plaintext columns cleared — clearing `summary` also auto-empties the generated `ts_summary`; `content_tokens` set `NULL`; the server has no DEK. The owner's client decrypts locally.

## 7. Revocation & re-delegation

**Revoke (server-driven — uses the access it's about to destroy):** per affected memory, atomically: unwrap provider DEK one last time → encrypt `summary` + `embedding` under the DEK and clear their plaintext columns (clearing `summary` auto-empties the generated `ts_summary`) → set `content_tokens = NULL` → delete the `memory_dek_wraps` provider row → set `provider_delegated = false` → evict any cached DEK. After this the server has no path to the DEK. No owner private key needed → plain authenticated API call. Global revoke runs as a paced async job with progress.

**Backups caveat — be honest (fixes M7).** Deleting the provider wrap removes it from the *live* database, but Supabase point-in-time-recovery / WAL retains the deleted row for the backup-retention window — and the provider holds those backups. So **v1 revocation is effective against the live system, not against point-in-time backups within the retention window** (e.g. 7 days). This is documented to users. The strict fix — rotating the DEK on revoke (re-encrypt under a fresh DEK wrapped to the owner only) — requires the client (the server has no DEK after revoke) and contradicts server-driven revoke; it's deferred to v0.2 as the "hard revoke" option.

**Re-delegate (client-driven — server has no DEK):** dashboard unwraps the owner DEK locally → re-wraps to provider pubkey → posts it. Server re-inserts the provider row, decrypts the sealed `summary`/`embedding`, restores their plaintext columns (restoring `summary` auto-repopulates the generated `ts_summary`), rebuilds `content_tokens` via the `set_memory_content_tokens` RPC from the decrypted content, sets `provider_delegated = true`. **Challenge/response validation (fixes L10):** before accepting, the server issues a random nonce; the client returns it wrapped under the re-delegated DEK; the server unwraps with the provider private key and compares — proving the posted wrap actually yields a working provider DEK.

**Granularity:** per-memory immediate; global = paced job.

## 8. VERIFY interaction

The canonical hash is over **plaintext content** (computed at write time, §5 step 1–2), committed on-chain, stored in `content_hash`. **This requires the `commitMemoryToChain` change in §5 step 2** — it must hash the plaintext, not the stored (encrypted) column. For VERIFY of an encrypted memory:
- **Delegated**: server decrypts `content` (has provider DEK), recomputes the plaintext hash, compares to `content_hash` and to the on-chain commitment → full canonical `verified`.
- **Revoked**: server can't decrypt → can't recompute. Returns `verified: true, reason: 'committed_encrypted'` — confirms the on-chain commitment exists for the stored `content_hash`, but recompute requires the owner's key. The owner's client (which can decrypt) does the full recompute. The response carries no transaction link beyond what §VERIFY in the spec already allows.

## 9. Schema changes

```sql
-- Public-key registry
CREATE TABLE encryption_keys (
  owner_wallet  TEXT PRIMARY KEY,
  x25519_pubkey TEXT NOT NULL,
  verifier_ct   TEXT NOT NULL,         -- secretbox("clude-key-verifier-v1") under the derived key; re-checked each session (H2)
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Per-memory wrapped DEKs
CREATE TABLE memory_dek_wraps (
  memory_id   BIGINT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  recipient   TEXT   NOT NULL,         -- 'owner' | 'provider'
  wrapped_dek TEXT   NOT NULL,         -- base64(nonce || box(DEK)) — sealed-box (anonymous sender)
  wrap_pubkey TEXT   NOT NULL,         -- ephemeral sender X25519 pubkey, base64 (needed to open the box; recipient is implied by `recipient`)
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (memory_id, recipient)
);
CREATE INDEX idx_dek_wraps_memory ON memory_dek_wraps(memory_id);

-- memories: new columns
ALTER TABLE memories ADD COLUMN IF NOT EXISTS provider_delegated BOOLEAN DEFAULT TRUE;
ALTER TABLE memories ADD COLUMN IF NOT EXISTS content_tokens TSVECTOR;          -- content lexemes (app-maintained, NOT generated); plaintext while delegated, NULL on revoke (H3)
ALTER TABLE memories ADD COLUMN IF NOT EXISTS summary_ciphertext TEXT;          -- secretbox(summary) — populated only on revoke
ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding_ciphertext TEXT;        -- secretbox(embedding) — populated only on revoke, for owner-side local search
-- `encrypted` and `encryption_pubkey` already exist. `content` holds ciphertext when encrypted.
-- While delegated: summary + embedding plaintext in their existing columns; on revoke those are cleared and the *_ciphertext columns populated.
CREATE INDEX IF NOT EXISTS idx_memories_delegated ON memories(provider_delegated) WHERE encrypted = TRUE;
CREATE INDEX IF NOT EXISTS idx_memories_content_tokens ON memories USING GIN(content_tokens);

-- Repurpose the EXISTING `ts_summary` generated column (H3 reconciliation).
-- Today it is GENERATED ALWAYS AS (summary 'A' || LEFT(content,2000) 'B') STORED.
-- Two problems once `content` is ciphertext: (1) the LEFT(content,2000) term indexes
-- ciphertext garbage; (2) a GENERATED column cannot be conditionally cleared on revoke.
-- Fix: regenerate from `summary` ONLY. Because revoke already clears `summary`,
-- `ts_summary` auto-empties — we clear the source, never the generated column.
-- A generation expression can't be altered in place, so drop & re-add (rewrites the column;
-- existing index is dropped with it and re-created). One-time migration cost.
--
-- !! EXECUTION ORDER (see §11): this drop-and-readd removes content coverage from
-- `ts_summary` for the WHOLE corpus the instant it runs. It MUST run only AFTER
-- `content_tokens` has been backfilled for all rows, so content is always covered by
-- at least one lexical column (no corpus-wide keyword-recall gap). Do NOT execute this
-- block top-to-bottom — content_tokens add + backfill come first.
ALTER TABLE memories DROP COLUMN ts_summary;
ALTER TABLE memories ADD COLUMN ts_summary tsvector GENERATED ALWAYS AS (
  setweight(to_tsvector('english', COALESCE(summary, '')), 'A')
) STORED;
CREATE INDEX IF NOT EXISTS idx_memories_ts_summary ON memories USING GIN(ts_summary);
```

**Populating `content_tokens` (PostgREST can't express `to_tsvector` inline).** A tiny RPC builds the tsvector server-side from a transient plaintext parameter (never stored as a column):

```sql
CREATE OR REPLACE FUNCTION set_memory_content_tokens(p_memory_id bigint, p_text text)
RETURNS void LANGUAGE sql AS $$
  UPDATE memories
  SET content_tokens = CASE
        WHEN p_text IS NULL OR p_text = '' THEN NULL
        ELSE to_tsvector('english', p_text)
      END
  WHERE id = p_memory_id;
$$;
-- Write/re-delegate: call with plaintext content. Revoke: call with NULL (or UPDATE ... SET content_tokens = NULL).
```

**`bm25_search_memories` updated to match/rank over both lexical columns** (was `ts_summary` only):

```sql
-- inside bm25_search_memories, replace the SELECT/WHERE:
SELECT m.id,
  (ts_rank_cd(m.ts_summary, tsquery_val, 32)
   + ts_rank_cd(COALESCE(m.content_tokens, ''::tsvector), tsquery_val, 32))::float AS rank
FROM memories m
WHERE (m.ts_summary @@ tsquery_val OR m.content_tokens @@ tsquery_val)
  AND m.decay_factor >= min_decay
  AND (filter_owner IS NULL OR m.owner_wallet = filter_owner)
  AND (filter_types IS NULL OR m.memory_type = ANY(filter_types))
  AND (filter_tags IS NULL OR m.tags && filter_tags)
ORDER BY rank DESC
LIMIT match_count;
```

## 10. Components

| Module | Responsibility |
|---|---|
| `packages/shared/src/core/memory-envelope.ts` (new) | DEK generation, secretbox encrypt/decrypt, box wrap/unwrap, key derivation. Pure crypto, unit-tested. |
| `packages/shared/src/core/encryption-keys.ts` (new) | Registry read/write (`encryption_keys`), provider keypair loading from env. |
| `packages/shared/src/core/encryption.ts` (deprecate) | Legacy symmetric scheme. **`decryptMemoryBatch` is removed** — its call sites in `memory.ts` (≈956, 978, 1099, 1427, 1805, 1982, 2008) switch to the §6 decrypt-top-K path (unwrap provider DEK → `secretbox.open` on `content` for the selected K only), not a whole-batch decrypt. `configureEncryption`/`encryptContent`/`decryptContent` stay only until the bot-corpus migration retires the old-format rows, then the module is deleted. |
| `packages/brain/src/memory/memory.ts` (modify) | `storeMemory` write path (§5, incl. `set_memory_content_tokens` call); recall decrypt-top-K replacing `decryptMemoryBatch` (§6). |
| `apps/server/src/routes/encryption.routes.ts` (new) | `POST /v1/keys` (publish pubkey), `POST /v1/memories/:id/revoke`, `POST /v1/memories/:id/redelegate`, `POST /v1/keys/revoke-all`. |
| `apps/server/src/bin/encryption-migrate.ts` (new) | The migration job (§5, §11). |
| `apps/dashboard` (modify) | Key derivation (sign-to-derive), client-side decrypt, privacy panel, per-memory lock. |

## 11. Migration

**Strict step ordering — content must always be covered by ≥1 lexical column (no recall gap).** The naive order (repurpose `ts_summary` first, then backfill) opens a corpus-wide window where content-only keyword terms match *neither* column: the moment `ts_summary` is regenerated summary-only, content coverage is gone for every row, while `content_tokens` is still `NULL` until the paged backfill reaches that row. Backfilling could take a long time over 100K+ rows. So `content_tokens` is added and **fully backfilled while the old `ts_summary` still carries the content term**, and only then is `ts_summary` repurposed:

1. **Add `content_tokens` column + GIN index** (starts `NULL`). `ts_summary` still generates over content — content fully covered.
2. **Deploy the updated `bm25_search_memories`** (matches `ts_summary OR content_tokens`). Safe now: `content_tokens` empty contributes nothing, `ts_summary` still covers content.
3. **Backfill `content_tokens`** — paged job calling `set_memory_content_tokens(id, content)` for all rows **while `content` is still plaintext**. Content is now covered by *both* columns (harmless overlap). If encryption ran before this, content would already be ciphertext and the lexemes unrecoverable server-side — hence backfill precedes encryption.
4. **Repurpose `ts_summary`** (drop-and-readd, summary-only) + re-create its index. Content is now covered solely by `content_tokens`, which is fully populated → no gap at any instant.
5. **Bot corpus — now.** One-time paced job; server derives the bot key; encrypt each memory, wrap to bot+provider, flip `encrypted`. `content_tokens` already populated; `ts_summary` auto-maintained from summary.
6. **User memories — lazy.** On pubkey publish, per-user job encrypts that owner's plaintext memories (`content_tokens` already populated by step 3; new writes populate it inline per §5).

- **Verify-after-encrypt:** before flipping `encrypted: true`, decrypt the just-written ciphertext and assert it equals the original plaintext; mismatch aborts that memory and logs. No memory is lost to a bad encryption.
- Idempotent (only `encrypted: false` rows), resumable from row state, killswitch-gated. The `content_tokens` backfill is independently idempotent (re-running over a row just recomputes the same tsvector).

## 12. Error handling

- **No owner key at write** → store plaintext + `encrypted: false`; lazy migration later.
- **Decrypt failure during recall** → skip that memory, log, return the rest (never 500 the whole recall).
- **Re-delegate wrap invalid** → reject with 422; the server validates by decrypting a test value first.
- **Provider key rotation** → out of scope v1; would require re-wrapping all provider DEKs (documented as a future op).

## 13. Testing

- **Crypto unit tests** (`memory-envelope.ts`): encrypt→decrypt round-trip; wrap→unwrap round-trip; wrong-key fails; **independent nonce per field** (no reuse); deterministic derivation from a fixed signature; tamper detection.
- **Verifier-token test (H2)**: a non-deterministic signer (mock that adds entropy) is detected and hard-stops before any write.
- **Write-path tests**: encrypted memory stores **ciphertext content** + two wraps + plaintext summary/embedding + populated `content_tokens` + generated `ts_summary` (summary lexemes, no content lexemes — assert a content-only word is absent from `ts_summary` but present in `content_tokens`) + `content_hash` computed over **plaintext** (not the stored ciphertext).
- **Recall tests**: vector AND keyword recall both work on a delegated encrypted memory; `bm25_search_memories` matches a content-only term via `content_tokens` and a summary term via `ts_summary`; top-K decrypts `content`; revoked memory excluded from candidates and from keyword search (both lexical columns empty).
- **Revoke/re-delegate tests**: revoke deletes provider wrap + seals summary/embedding + clears `summary` (asserting `ts_summary` auto-empties) + sets `content_tokens = NULL` + sets flag + evicts cached DEK; re-delegate restores summary (asserting `ts_summary` repopulates) + rebuilds `content_tokens` + passes the challenge/response; server can't decrypt post-revoke.
- **Leak tests**: DEK and wraps never appear in logs or in any API response body.
- **Migration tests**: verify-after-encrypt catches a deliberately corrupted encryption; idempotency; resume; `encrypted:false` surfaced when no owner key. **No-recall-gap test**: simulate the migration mid-flight (some rows backfilled, others not; `ts_summary` not yet repurposed) and assert a content-only keyword term still resolves for every row — proving the §11 ordering leaves no window where content is uncovered by both lexical columns.

## 14. Security considerations

- Owner private key never leaves the browser; derived per session; protected by the verifier-token check (§4.1) against non-deterministic-signing data loss.
- Provider private key in server secrets; compromise = provider can read all *delegated* content (not revoked). Rotation deferred to v0.2 (would require re-wrapping all provider DEKs).
- Sign-to-derive message is domain-separated and constant; the derived key is distinct from the signing key. **Solana ed25519 wallet only**; EVM wallets unsupported for encryption in v1.
- DEK is per-memory and random; one DEK compromise ≠ corpus compromise. **Independent random nonce per ciphertext field** (no nonce reuse across content/summary/embedding).
- **DEK and wraps never logged or returned in any API response** — enforced by an explicit test, given the codebase's fire-and-forget logging habits.
- Revocation is forward-only and cryptographic against the **live DB**; **point-in-time backups within the retention window still contain the deleted provider wrap** (§7) — documented limitation; "hard revoke" (DEK rotation) is v0.2.
- DEK cache in dream sessions is invalidated on revoke (§6.3) — no read-after-revoke within a running session.
- The "no owner key yet" fallback stores plaintext and **signals `encrypted:false` to the caller** — no silent false sense of encryption.
- The on-chain historical leak is **not** fixed by this (immutable); handled separately.

## 15. Out of scope (future)

- Threshold encryption (provider can't decrypt even when delegated) — the v0.2 privacy upgrade.
- Client-side embedding/summary generation (true zero-knowledge from byte one) — Approach 3, deferred.
- Provider key rotation tooling.
- Cross-device owner key sync beyond what Privy provides.

## 16. Open questions / risks

- **Recall latency**: per-memory `box.open` for top-K adds asymmetric crypto to the hot path. Mitigation: K is small (25–50); benchmark before launch.
- **Dashboard key UX**: first-login sign-to-derive prompt — needs clear copy so users understand why they're signing.
- **Embedding size on revoke**: storing `embedding_ciphertext` ~doubles storage for revoked memories. Acceptable; revisit if it matters.
