# PMP — Technical Deep Dive

**What this is:** the under-the-hood account of the Portable Memory Protocol as it
actually exists in this repo — not the pitch, the *primitives*. Wire format,
canonical hashing, owner-held envelope encryption, on-chain commitments, Merkle
packs with selective disclosure, the self-verifying `.pmp` artifact, the Base
title contract, and device pairing. Read the pitch in `x-article.md`; read this
when you want to know how it's wired.

> TL;DR — MCP gave agents context. PMP gives them **memory that is portable,
> cryptographically verifiable, owner-encrypted, and chain-neutral** — and every
> one of those four words is backed by code in this tree, not a roadmap slide.

---

## 0. The thesis, in one paragraph

The agent stack standardized context (MCP), communication (A2A), and payments
(x402) — each owned by a single vendor. Memory is the last open layer, and it's
the *one layer where the data belongs to the user, not the model*. So PMP is
built so that no provider — not even the reference provider — can read, alter,
or hold your memory hostage. The protocol is four HTTP verbs over a stable wire
format. Underneath those verbs sits a three-layer cryptosystem: a **canonical
content hash** that's byte-identical across providers, **owner-held envelope
encryption** where revocation is enforced by destroying a key rather than
flipping a flag, and **on-chain commitments** (Solana cNFT + Base ERC-721) that
are *hash-only by construction* so the public chain never sees a byte of content.

---

## 1. The wire protocol — four verbs, intentionally small

`docs/pmp/spec-v0.1.md` is the frozen interface. Everything provider-specific
(payment, encryption, gating, chain) hides behind these:

| Verb | Method + path | Contract |
|---|---|---|
| **DISCOVER** | `GET /v1/memories?query=&owner=&tags=&memory_types=&limit=&cursor=` | Opaque-cursor pagination (never offset/limit), CORS-open, returns `{count, memories[], next_cursor}` |
| **RETRIEVE** | `GET /v1/memories/:id` | `200` content · `402` gated (carries an **x402** block for native payment composability) · `410` revoked |
| **VERIFY** | `GET /v1/memories/:id/verify` | **Public, no-auth, cacheable.** Recomputes the hash from *current* state and compares to the on-chain commitment |
| **CONTRIBUTE** | `POST /v1/memories` | Writes a memory, returns an `Attestation` pointing at an on-chain commitment |

Two design decisions that matter more than they look:

- **VERIFY MUST recompute, never trust the stored hash.** The stored value is
  returned only for diagnostics. This is what makes drift detection real:
  `drift_detected` always wins over `verified_legacy`, because tamper-evidence
  that trusts the database is theater.
- **`verified_legacy` deliberately refuses to surface a tx pointer.** Pre-PMP
  commitment schemes embedded plaintext prefixes in public Solana memos (the
  `#197/#198` leak). The spec encodes this as a hard rule: legacy commitments
  confirm existence but MUST NOT return a signature or explorer link, because
  linking would re-expose the leaked content. Re-tokenising under the canonical
  hash-only scheme upgrades the memory to a safe, linkable `verified`.

---

## 2. The canonical content hash (`memory-hash-v1`) — interop's load-bearing wall

Cross-provider verification only works if two independent implementations
produce the **byte-identical** hash for the same memory. The spec pins this
exactly: `sha256(canonical_json)` where `canonical_json` is the
alphabetically-sorted JSON of a fixed field set:

```json
{
  "algorithm": "memory-hash-v1",
  "content": "<NFC-normalised, trimmed>",
  "created_at": "<ISO-8601 Z>",
  "memory_type": "<one of 5>",
  "owner_wallet": "<string|null>",
  "related_user": "<string|null>",
  "related_wallet": "<string|null>",
  "source": "<string|null>",
  "tags": ["<sorted, deduped, trimmed>"]
}
```

NFC normalization, trim, sorted+deduped tags, sorted keys — every degree of
freedom that could make two JSON encoders disagree is nailed down. The hash is
**versioned independently from the wire protocol** (the `memory-hash-v1` string
lives inside the hashed object), so the canonical form can evolve to
`memory-hash-v2` without a `/v2/` wire break. This is the seam that lets a
memory minted on Solana be verified from a Base contract with no bridge — both
chains commit to the same 32 bytes.

---

## 3. Owner-held envelope encryption — the crown jewel

This is the part that needs ChatGPT to translate. Source of truth:
`docs/pmp/memory-encryption-design.md` + `packages/shared/src/core/memory-envelope.ts`.

### 3.1 The core inversion

> **The privacy boundary is *revocation*, enforced cryptographically — not a
> policy flag.** When you revoke, the provider's wrapped key is *destroyed*. It
> is not marked inaccessible; it ceases to exist.

While *delegated*, the server can read your content — that's the honest
definition of delegation, and the design refuses to pretend otherwise. The
guarantee is that the moment you revoke, the server has **no cryptographic path
back to the plaintext**, live.

### 3.2 Three layers of keys

1. **Identity layer.** Every owner has an **X25519** encryption keypair; the
   provider has its own. Public keys live in a registry table
   (`encryption_keys`); private keys never co-locate.
2. **Envelope layer.** Every memory gets a random 32-byte **Data Encryption Key
   (DEK)**. Content is sealed with `nacl.secretbox` (**XSalsa20-Poly1305**)
   under the DEK. The DEK itself is wrapped with `nacl.box` (**X25519 sealed
   box, ephemeral sender**) once per authorized recipient.
3. **Delegation layer.** *The set of recipients a DEK is wrapped to **is** the
   access-control state.* Owner is always a recipient. Provider is a recipient
   **iff** delegated. There is no separate ACL — the cryptography *is* the ACL.

The primitives are tiny and pure (`memory-envelope.ts`): `generateDek`,
`encryptField` → `base64(nonce[24] || ct)`, `decryptField` (returns `null`,
never throws), `wrapDek`/`unwrapDek` (sealed box with the ephemeral pubkey
shipped alongside so the recipient can open it). No DB, no env, no logging in
that module — it's unit-test-grade crypto in isolation.

### 3.3 Sign-to-derive — the owner key never touches a server

The owner's keypair is **derived in the browser** from a wallet signature:

```
sig = PrivyEmbeddedWallet.signMessage("clude-memory-encryption-v1")   // ed25519
seed = HKDF-SHA256(sig, salt="clude-cortex-v1", info="memory-encryption-x25519-v2")[:32]
ownerKeypair = nacl.box.keyPair.fromSecretKey(seed)
```

The private key is **re-derived every session in the browser and never sent to
the server.** Only the *public* key is published to the registry. This is
"sign-to-derive" rather than raw-key-export because Privy embedded wallets
reliably expose signing, not raw key material.

### 3.4 The determinism guard — a genuinely subtle failure mode, closed

Sign-to-derive has a landmine: **if the wallet's signing isn't deterministic,
every session derives a different key and all prior memories become permanently
undecryptable.** RFC 8032 ed25519 *is* deterministic, but not every
adapter/curve guarantees it (EVM `personal_sign` over secp256k1 is *not*,
without RFC 6979). The design closes this two ways:

1. **Solana ed25519 wallets only.** EVM wallets are unsupported for encryption
   in v1 — documented and enforced in the dashboard.
2. **A verifier token.** On first derivation the client encrypts a known
   constant (`clude-key-verifier-v1`) and the server stores the ciphertext.
   Every subsequent session re-derives, decrypts the verifier, and asserts a
   match. **On mismatch the dashboard hard-stops before any data is written
   under a bad key.** A non-deterministic signer is caught at the door, not
   after it has silently bricked a corpus.

And a sharp cross-primitive-reuse fix (`memory-envelope.ts`, opsec L1): the
verifier ciphertext is public (it lives in the registry row *and* every `.pmp`
header), so it is **not** encrypted under the raw X25519 box secret that also
protects DEKs. A dedicated key is HKDF-derived under a distinct
`info="...verifier..."` label. Same secret, domain-separated — no key doing
double duty across two primitives.

### 3.5 The field lifecycle — why recall stays fast under encryption

The naive version of "encrypt everything" destroys recall. The design instead
treats the four sensitive fields *differently*, because the boundary is
revocation and **while delegated the server holds the DEK anyway** — so keeping
derived artifacts plaintext while delegated leaks *nothing extra*:

| Field | While delegated | On revoke |
|---|---|---|
| `content` | **ciphertext at rest** (decrypted only for the top-K winners) | stays ciphertext; provider loses the DEK |
| `summary` | plaintext (feeds embedding + candidate scoring) | sealed under DEK, plaintext cleared |
| `embedding` | plaintext in pgvector (vector search at native speed) | sealed under DEK, plaintext cleared |
| `content_tokens` (app-maintained tsvector) | plaintext (BM25/keyword recall) | set `NULL` |
| `ts_summary` (generated tsvector) | generated from `summary` only | auto-empties when `summary` clears |

So a database leak *while delegated* exposes the gist (summary/embedding/keywords)
but not full content; **on revoke, every plaintext artifact is sealed or cleared
and the server holds nothing.** Recall ranks on plaintext embedding + tokens +
summary + metadata, picks the top-K, and only then does an **O(K), not
O(corpus)** asymmetric unwrap-then-decrypt on `content`. Encryption sits off the
hot path.

### 3.6 The lexical split — a real Postgres trap, solved cleanly

The live keyword path (`bm25_search_memories`) queried one generated column,
`ts_summary = setweight(to_tsvector(summary)) || setweight(to_tsvector(LEFT(content,2000)))`.
Two problems the instant `content` becomes ciphertext: (1) the `LEFT(content,2000)`
term would index ciphertext garbage; (2) **a Postgres `GENERATED` column cannot
be conditionally cleared on revoke** — it recomputes from its sources
automatically. The fix splits the lexical surface:

- **`ts_summary`** regenerates from **`summary` only**. Because revoke already
  clears `summary`, `ts_summary` auto-empties *for free* — you clear the source,
  never the generated column.
- **`content_tokens`** is a *new, non-generated* tsvector the app populates from
  plaintext content at write time and sets to `NULL` on revoke — the only
  hand-maintained half.

Keeping a generated `ts_summary` is deliberate graceful degradation: keyword
recall drove the LongMemEval **34.8% → 68.4%** jump, so if a write path ever
forgets to populate `content_tokens`, summary-based keyword recall still works
rather than silently zeroing.

### 3.7 Revoke / re-delegate — who holds the key dictates who drives

- **Revoke is server-driven** because it *uses the access it's about to
  destroy*: unwrap the provider DEK one last time → seal `summary`+`embedding`
  and clear their plaintext → `content_tokens = NULL` → **delete the provider's
  `memory_dek_wraps` row** → `provider_delegated = false` → **evict any cached
  DEK** (a revoke mid dream-cycle stops reads *within* the session, not at
  session end). After this the server has no path to the DEK. Plain authenticated
  API call; no owner key needed.
- **Re-delegate is client-driven** because the server no longer has a DEK: the
  dashboard unwraps the owner DEK locally, re-wraps it to the provider pubkey,
  and posts it. **Validate-by-decrypt (opsec L10):** before accepting, the
  server unwraps the posted wrap → candidate DEK → tries to `secretbox.open` the
  memory's *stored ciphertext*. The Poly1305 tag authenticates only if the wrap
  carried the correct per-memory DEK, so a successful decrypt *proves* the wrap
  is genuine — no nonce challenge/response, no server-side state, one round trip.

**Honest limitation, documented rather than hidden:** deleting the provider wrap
removes it from the *live* DB, but Supabase PITR / WAL retains the deleted row
for the backup-retention window, and the provider holds those backups. So **v1
revocation is effective against the live system, not against point-in-time
backups within the retention window.** The strict fix (DEK rotation on revoke)
needs the client and contradicts server-driven revoke — deferred to v0.2 as
"hard revoke." Telling the user the exact shape of the gap is the security
posture, not a footnote.

### 3.8 The leak tests

Because the codebase has fire-and-forget logging habits, there's an explicit
test asserting **the DEK and the wraps never appear in any log line or any API
response body.** The crypto unit tests cover: encrypt→decrypt round-trip,
wrap→unwrap round-trip, wrong-key-fails, **independent random nonce per field**
(no reuse across content/summary/embedding), deterministic derivation from a
fixed signature, and tamper detection.

---

## 4. On-chain commitments — proof off-chain data, never the data

The split is strict: **the on-chain side is proof; the off-chain side is data;
both reference each other, and the chain never sees content.**

- **Solana:** each memory → a **compressed NFT via Light Protocol** at
  ~$0.0001/mint. The cNFT is **soulbound** (individual memories aren't sellable —
  that has privacy pathologies) and its metadata commits to the
  `memory-hash-v1` content hash.
- **Commitment payloads MUST be hash-only.** A compliant provider MUST NOT write
  content (or any prefix) to a public chain — only the canonical hash plus
  non-sensitive metadata (type, timestamp). The hash is computed over
  **plaintext** at write time and passed explicitly to the chain-commit, because
  `commitMemoryToChain` used to hash `row.content` *after* write — which becomes
  ciphertext once encryption lands, making the commitment meaningless and
  re-rolling on every re-encrypt (opsec C1, fixed).

`packages/tokenization/src/verify.ts` is the pure-read verifier surface:
`verifyMemory(contentHash, mint)` returns `verified` iff a commitment exists, and
`verifyPackInclusion(...)` runs the Merkle check. No auth, no side effects —
exactly what a public VERIFY endpoint needs.

---

## 5. Memory Packs + Merkle selective disclosure

A Pack is a curated bundle that becomes a **transferable** token (vs. the
soulbound individual memory). Its on-chain metadata commits to a single **Merkle
root** over its member memories (`sha256-merkle-v1`,
`packages/tokenization/src/pack-merkle.ts`):

- Leaves are the members' `content_hash` values (not re-hashed at the leaf).
- Inner node = `sha256(hex_decode(left) || hex_decode(right))`; odd layers
  duplicate the last node.

**Selective disclosure** is where ZK earns its keep without being flashy:
`GET /v1/packs/:id/preview?count=N` reveals up to N memories *plus their Merkle
inclusion proofs against the on-chain root*, while `unrevealed_count` tells you
how many remain sealed. A buyer can confirm the other 99 memories exist with
claimed properties (count, tags, author) **without seeing them**. The public
`GET /v1/packs/:id/verify` rebuilds the tree from persisted hashes and compares
to the on-chain root, returning `drift_detected` if content changed.

**The leaf-vs-inner confusion attack is taken seriously.** The construction is
vulnerable in the abstract (an inner-node hash claimed as a leaf), mitigated two
ways: (1) `memory_count` is committed separately on-chain so a verifier rejects
proofs implying a different tree size; (2) leaves are `memory-hash-v1` digests,
so a forged "inner-node-as-leaf" preimage would also have to be a valid
canonicalised memory — statistically impossible. v0.2 adds CT-style domain
separators (`0x00` leaf / `0x01` inner).

**Token-gated unlock** (`POST /v1/packs/:id/unlock`) proves wallet control + on-chain
holding in one request: a signed message `unlock:<pack_id>:<unix_ts>`, verified
for exact format, ±300s replay window, valid Ed25519, and current token holding
≥1. Success returns full content + per-memory inclusion proofs so the client can
**independently audit membership without re-trusting the provider.**

---

## 6. The Base title contract — `CludePackTitle`, money-grade and Howey-aware

`contracts/base/src/CludePackTitle.sol` is the EVM half: a 1-of-1 **ERC-721**
title for a pack, deliberately minimal and legally careful.

- **`ownerOf(tokenId)` is the single source of truth** — no balance checks
  anywhere, so a double-spend is *structurally impossible*.
- **On-chain content binding.** Each token carries an immutable `PackBinding`:
  `merkleRoot` (the `sha256-merkle-v1` root) + `manifestHash` (sha256 of the
  canonical `.pmp` manifest) + `memoryCount` + `mintedAt` + `creator`, packed
  into 3 storage slots. Ownership and verifiable content are **one asset** —
  `ownerOf` + `bindingOf` together prove "this address owns this *exact*
  verifiable pack."
- **Deterministic, collision-resistant tokenId:**
  `keccak256("clude-pmp-title:v1:" || packId)`. Server-precomputable (so the
  off-chain mirror row + unlock gate are ready the instant the mint mines) and a
  *free 1-of-1 supply guard* — a second mint of the same packId yields the same
  id and reverts in `_safeMint`. No counter to race.
- **Legally deliberate omissions.** No proxy/upgrade path (immutable = stronger
  trust for a money contract). **No ERC-2981 royalty** — removes the Howey
  "profit from the issuer's efforts on resale" factor; the `$CLUDE` fee is a flat
  service fee charged off-chain on the Solana rail, never a % cut here. **No
  operator god-transfer** — no role can move someone else's title, closing the
  honeypot. Pausing minting can never freeze a holder's owned asset.

Cross-chain VERIFY works *with no bridge* precisely because the Solana cNFT and
the Base title commit to the **same content-hash and Merkle-root format** — just
signed proofs over identical bytes.

---

## 7. The `.pmp` artifact — a self-verifying, offline-portable memory file

`packages/memorypack` is the file format that makes memory *portable* in the
literal sense: a `.pmp` you can hand someone on a USB stick and they can verify
end-to-end with zero server trust.

- **Directory or `.tar.zst`** (`writer.ts`). Tarball mode shells out to the
  system `tar --zstd` via `spawnSync` with an argv array — no shell, no quoting
  hazards — so it works on macOS/Linux GNU tar and Windows bsdtar alike.
- **Stable serialization.** `serializeRecord` emits a fixed key order, because
  the line bytes are exactly what gets hashed and signed. Determinism is the
  whole game.
- **ed25519 signatures** per record (`signatures.jsonl`), an **anchors.jsonl**
  for chain commitments, and a `pmp` manifest block that embeds the
  `merkle_root` — so a reader recomputes the pack root and compares it to
  `pmp.merkle_root` **with no server in the loop.**
- **Two mutually-exclusive encryption paths.** `encryption` = writer holds the
  key and seals records in place (`key_derivation: 'none'`, keys shipped out of
  band). `ownerEncryption` = records arrive *already ciphertext* and the writer
  only stamps the owner-sealed envelope so a single holder can recover the DEK
  from the file alone — the writer **never sees a key**. Mixing them is a thrown
  error (would double-encrypt and produce a manifest that lies about its DEK).
  Under `records+blobs`, attachment `filename`/`content_type` are dropped to
  avoid leaking metadata in cleartext.
- **Append-only revocation protocol** (v0.3+). `appendRevocations` writes signed
  soft-deletes to `revocations.jsonl` *without touching* records/signatures/
  anchors — immutable history, post-hoc tombstones. `appendRevocationAnchors`
  adds chain-anchored timing proofs (`memo-revoke-v1`). Tarball appends
  **extract → mutate → repack to a sibling temp → atomic rename**, so a
  mid-flight failure (tar exit, signal, JSON error) leaves the *original* intact
  — the audit trail never enters a half-written state.

There's a decompression-bomb guard test on the reader, too — untrusted `.pmp`
files are treated as hostile input, not friendly data.

---

## 8. Desktop device pairing — full memory egress, locked down

`apps/server/src/routes/pmp-devices.routes.ts` is the server side of the desktop
(Tauri) `.pmp` integration, and it's a clinic in anti-phishing:

- A new device posts an **ed25519 device pubkey**; the server stores only the
  **sha256 of a short code** (never plaintext), `expires_at = now+110s`.
- **Claim requires an authenticated Privy session** — a code read aloud to an
  attacker pairs *nothing* without the victim's login.
- Claim **surfaces the device name/platform** for explicit human confirmation
  ("is this *your* device?").
- Codes are single-use (`pending → claimed → consumed`) and a new pair emits a
  notification event.
- The owner wallet is read **only** from `req.verifiedWallet` — a client-supplied
  `?owner=`/`body.owner` is never trusted (the impersonation hole closed in
  `cc4f2871`).
- Device-pull = full memory egress, so it's **signature-gated** (ed25519 over a
  timestamped message, ±120s), **owner-scoped**, replay-bounded, and revocable.

Crypto reuse is intentional: the same `tweetnacl` + `bs58` detached-signature
path as the pack-gate. No new crypto surface invented where an existing,
audited one fits.

---

## 9. The SDK + cross-provider discovery

`packages/pmp-sdk` is the reference TypeScript SDK (`@pmp/sdk` on launch):

- `PmpClient` — thin typed wrappers over the four verbs.
- `verifyMemoryHashClientSide` — a **pure-function verifier** that needs no
  network round trip when the proof is bundled. Trust math, not an endpoint.
- `discoverAcrossProviders` — fans out DISCOVER across a registry of providers,
  so discovery is federated rather than centralized on the reference host.

The whole point: an agent builder `npm install`s once and gets multi-chain,
verifiable, portable memory behind a stable interface — and can swap the
reference provider for any conformant one without touching agent code.

---

## 10. Why this is the bullish case, restated technically

1. **Portability is real, not aspirational.** The `.pmp` artifact + the
   canonical hash mean memory leaves any single provider as a self-verifying
   file. Lock-in is structurally impossible.
2. **Verifiability is hash-only and chain-neutral.** The same `memory-hash-v1`
   and `sha256-merkle-v1` bytes are committed on Solana (cNFT) and Base
   (ERC-721), so cross-chain VERIFY needs no bridge — just signed proofs.
3. **Privacy is enforced by key destruction, not policy.** Owner-held envelope
   encryption with sign-to-derive keys the server never sees, a determinism
   guard that prevents silent corpus loss, decrypt-top-K so encryption stays off
   the recall hot path, and an honest, documented backup-window limitation.
4. **The economics fall out of the cryptography.** Soulbound memories +
   transferable Merkle-committed packs + token-gated unlock + selective
   disclosure = a peer-to-peer memory market where provenance is provable and
   the reference implementer earns by being the *best* implementation, not by
   owning a token.
5. **The hard parts are already handled in code.** Leaf/inner confusion,
   cross-primitive key reuse, non-deterministic signing, generated-column revoke
   semantics, hash-over-ciphertext, metadata leakage in encrypted blobs,
   pairing-code phishing, half-written audit trails — each is a named, closed
   issue in this tree, not an open risk.

MCP standardized context. PMP standardizes the layer where the data is *yours* —
and builds it so that being yours is a cryptographic fact, not a promise.

---

*Cross-references: `docs/pmp/spec-v0.1.md` (frozen wire protocol),
`docs/pmp/memory-encryption-design.md` (envelope crypto, full),
`docs/pmp/plan.md` (build & roll-out), `docs/pmp/x-article.md` (the pitch).
Code: `packages/shared/src/core/memory-envelope.ts`,
`packages/tokenization/src/{verify,pack-merkle}.ts`,
`packages/memorypack/src/writer.ts`, `packages/pmp-sdk/src/`,
`contracts/base/src/CludePackTitle.sol`,
`apps/server/src/routes/pmp-*.routes.ts`.*
