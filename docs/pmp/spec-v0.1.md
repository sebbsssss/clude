# PMP — Portable Memory Protocol v0.1

**Status:** Working draft. Frozen on launch (target 2026-05-25). Breaking changes thereafter go to v0.2.

**Editor:** Sebastien Sim
**License:** Apache-2.0

---

## 1. Introduction

PMP is an open HTTP protocol that lets AI agents discover, retrieve, verify, and contribute memories across independent providers and chains. The wire format is small and deliberately stable; chain-specific commitments, encryption, gating, and pricing are provider-defined behind the four verbs.

This is v0.1. It covers the read/write path with on-chain commitments. v0.2 adds compliance attestations (ATTEST) and subscription streams (SUBSCRIBE).

## 2. Conformance

An implementation is **PMP-compliant** at v0.1 if it:

1. Exposes all four verbs over HTTPS at the paths specified in §4.
2. Returns JSON responses matching the schemas in §5.
3. Uses the error semantics in §6.
4. For every persisted memory, attaches an attestation pointing to an on-chain commitment that any third party can independently verify.
5. Publishes a public verifier endpoint at `GET /v1/memories/:id/verify` that anyone can hit without authentication.

Implementations MAY add provider-specific extension fields under `x_` prefixed keys. They MUST NOT change the meaning of standard fields.

## 3. Transport and content

- All requests/responses use HTTPS and `Content-Type: application/json; charset=utf-8`.
- Requests with bodies use UTF-8 JSON.
- Responses include `Access-Control-Allow-Origin: *` for the read endpoints (DISCOVER, RETRIEVE, VERIFY). CONTRIBUTE is provider-defined.
- Pagination uses opaque cursors when needed (`?cursor=...`), never offset/limit-style.

## 4. The four verbs

### 4.1 DISCOVER — find memories

```
GET /v1/memories?query=<text>&owner=<id>&tags=<tag>&memory_types=<type>&limit=<n>&cursor=<opaque>
```

**Query parameters (all optional):**

| Param | Type | Default | Notes |
|---|---|---|---|
| `query` | string | — | Free-text search across content + summary |
| `owner` | string | — | Filter to a specific owner identifier (chain-prefixed, e.g. `solana:GsbwXf...`) |
| `tags` | string or string[] | — | Filter to memories with all listed tags |
| `memory_types` | string or string[] | all | One of: `episodic`, `semantic`, `procedural`, `self_model`, `introspective` |
| `limit` | int | 25 | Max 100 |
| `cursor` | string | — | Continuation from a prior response's `next_cursor` |

**Response 200:**

```json
{
  "count": 3,
  "memories": [ <Memory>, <Memory>, <Memory> ],
  "next_cursor": "opaque-string-or-null"
}
```

**Errors:** 422 if `memory_types` contains an unknown type. 429 if rate-limited.

### 4.2 RETRIEVE — fetch one memory

```
GET /v1/memories/:id
```

`:id` is the memory's stable identifier — typically a hash-prefixed slug like `mem-abcd1234`.

**Response 200:** a single `<Memory>` object.

**Response 402 (gated):**

```json
{
  "error": "payment_required",
  "reason": "pack_gated",
  "x402": { ... }
}
```

The `x402` block follows the [x402 specification](https://x402.org) for composability with payment-required flows.

**Response 410 (revoked):** the memory has been compacted or deleted by its owner.

```json
{ "error": "revoked", "reason": "compacted", "hint": "superseded_by:mem-xyz" }
```

**Other errors:** 404, 429.

### 4.3 VERIFY — prove a memory is real

```
GET /v1/memories/:id/verify
```

Public endpoint. No authentication. Cacheable for short windows.

**Response 200:**

```json
{
  "id": "mem-abcd1234",
  "verified": true,
  "reason": "verified",
  "recomputed_hash": "sha256-hex...",
  "stored_hash": "sha256-hex...",
  "commitment": {
    "chain": "solana",
    "assetId": "<PDA / cNFT mint / ERC-721 token id>",
    "txSig": "<tx signature>",
    "treeAddress": null,
    "leafIndex": null
  }
}
```

**`verified` reasons:**

| Reason | `verified` | Meaning |
|---|---|---|
| `verified` | `true` | Content hash matches the canonical `memory-hash-v1` commitment on-chain |
| `verified_legacy` | `true` | The memory is committed on-chain via a provider's pre-PMP scheme. The provider could not match the full canonical hash but can prove an on-chain transaction exists for this memory. Clients SHOULD treat this as on-chain-but-not-canonical and MAY surface the transaction for manual inspection. |
| `not_committed` | `false` | The memory exists in the provider's index but never landed on-chain |
| `drift_detected` | `false` | The current content differs from what was originally committed (tampering or unrecorded edit). Takes precedence over `verified_legacy` — drift always wins. |
| `revoked` | `false` | The memory was superseded by a compaction and its hash is no longer authoritative |

VERIFY MUST recompute the content hash from the current memory state, not trust the stored value. The stored value is returned for diagnostics.

When a transaction signature is available (either path), the response SHOULD include a `solscan_url` (or chain-appropriate explorer URL) so a human can click through to the on-chain proof directly.

### 4.4 CONTRIBUTE — write a new memory

```
POST /v1/memories
Content-Type: application/json
Authorization: <provider-defined>
```

**Request body:**

```json
{
  "content": "string, required",
  "type": "episodic|semantic|procedural|self_model|introspective, required",
  "summary": "string, optional — server may auto-summarise",
  "tags": ["array of strings, optional"],
  "importance": 0.5,
  "source": "string, optional — provider-defined trigger label"
}
```

**Response 201:**

```json
{
  "id": "mem-abcd1234",
  "type": "episodic",
  "owner": "solana:GsbwXf...",
  "created_at": "2026-05-25T09:00:00.000Z",
  "tags": ["q3-roadmap"],
  "attestation": { <Attestation> }
}
```

If the on-chain commit fails after the memory is durably stored, the provider:
1. MUST return 201 with `attestation: null` (the memory still exists).
2. SHOULD include `{ "tokenization_status": "failed" }` so the caller knows.
3. MUST mark the row for backfill retry.

**Errors:** 401, 422, 429, 500.

## 5. Schemas

### 5.1 Memory

```json
{
  "id": "mem-abcd1234",
  "type": "episodic|semantic|procedural|self_model|introspective",
  "content": "<utf-8 string>",
  "owner": "solana:<base58 pubkey> | null",
  "created_at": "<ISO-8601 with Z>",
  "tags": ["string", "..."],
  "attestation": <Attestation> | null
}
```

### 5.2 Attestation

```json
{
  "chain_id": "solana | base | <other>",
  "asset_id": "<chain-specific identifier>",
  "content_hash": "sha256-<64 hex chars>",
  "tx_sig": "<chain-specific tx signature>",
  "tree_address": "<merkle tree address or null>",
  "leaf_index": "<integer or null>",
  "verifier_url": "https://<provider>/v1/memories/<id>/verify"
}
```

### 5.3 Canonical content hash (`memory-hash-v1`)

For interop, `content_hash` is computed as `sha256(canonical_json)` where `canonical_json` is the alphabetically-sorted JSON of:

```json
{
  "algorithm": "memory-hash-v1",
  "content": "<NFC-normalised, trimmed>",
  "created_at": "<ISO-8601 Z>",
  "memory_type": "<one of 5>",
  "owner_wallet": "<string or null>",
  "related_user": "<string or null>",
  "related_wallet": "<string or null>",
  "source": "<string or null>",
  "tags": ["<sorted, deduplicated, trimmed>"]
}
```

Implementations MUST produce byte-identical canonical JSON for the same memory across providers. Reference implementation: [`@clude/tokenization`](https://github.com/portablememoryprotocol/reference-solana/tree/main/packages/tokenization).

## 6. Errors

| Status | Code | When |
|---|---|---|
| 400 | `bad_request` | Generic malformed request |
| 401 | `unauthenticated` | Auth required, missing/invalid credential |
| 402 | `payment_required` | RETRIEVE on a gated memory; x402 payload included |
| 403 | `forbidden` | Authenticated but not authorised for this resource |
| 404 | `not_found` | Memory id does not exist on this provider |
| 410 | `revoked` | Memory superseded by compaction or deleted |
| 422 | `invalid_body` / `invalid_id` | Schema validation failed |
| 429 | `rate_limited` | Provider rate limit hit; `Retry-After` header set |
| 500 | `<verb>_failed` | Internal error; clients SHOULD retry with backoff |

Error response body:

```json
{ "error": "<code>", "reason": "<optional>", "hint": "<optional>" }
```

## 7. Authentication

Authentication is provider-defined. The reference implementation uses Privy JWTs for CONTRIBUTE and treats reads as optionally-authed. Providers MAY adopt any scheme — wallet signatures, OAuth, API keys — as long as their public docs explain the handshake.

**Recommendation:** for cross-provider portability, support both `Authorization: Bearer <jwt>` and Solana wallet signature auth via a `X-PMP-Wallet-Signature` header.

## 8. Versioning

- Path-versioned: `/v1/...`.
- Semver semantics: v1.x additions are backward-compatible. Breaking changes go to v2.
- A provider MAY support multiple major versions concurrently at different path prefixes.
- The `content_hash` algorithm string (`memory-hash-v1`) is independently versioned to allow canonical-form evolution without breaking the wire protocol.

## 9. Pack endpoints (early ship — formally v0.2)

Pack endpoints were originally reserved for v0.2 but the reference implementation
ships them under `/v1/packs/*` because the marketplace surface is needed for the
v0.1 launch. The endpoints are forward-compatible with the v0.2 spec text and
are listed here so independent implementations have a stable target.

### 9.1 `POST /v1/packs`

Create a new Pack from a list of owned memory ids. Tokenises the Pack atomically:
builds the Merkle tree, commits the root on-chain, persists the Pack row and
its leaf index. Body:

```json
{
  "name": "Solana DeFi memories",
  "description": "...",
  "version": "1.0.0",
  "memory_hash_ids": ["clude-aaaa", "clude-bbbb"],
  "manifest_id": null,
  "gate_uri": "https://provider.example/v1/packs/.../unlock"
}
```

Server validates each `memory_hash_ids[i]` is (a) owned by the caller, and
(b) already tokenised (`tokenization_status = 'minted'`). Caps `memory_hash_ids`
at 10,000 entries per Pack.

Returns 201 with the Pack object including its on-chain attestation.

### 9.2 `GET /v1/packs/:id`

Retrieve Pack metadata. Returns 200 with name, version, author, memory_count,
and attestation. Returns 404 if not found.

### 9.3 `GET /v1/packs/:id/preview?count=N`

Selective disclosure. Returns `N` (max 10) revealed memories from the Pack
plus their Merkle inclusion proofs against the on-chain root. The
`unrevealed_count` field tells the client how many memories remain sealed.
The server cross-checks that the rebuilt root from the persisted leaves
matches the on-chain commitment and returns 500 on any mismatch.

### 9.4 `GET /v1/packs/:id/verify`

Public verifier (no auth). Rebuilds the Merkle tree from the persisted
content hashes, compares to the on-chain root, and returns:

```json
{
  "id": "pack-...",
  "verified": true,
  "reason": "verified",
  "memory_count": 100,
  "recomputed_root": "<hex>",
  "committed_root": "<hex>",
  "commitment": { "chain": "solana", "asset_id": "...", "tx_sig": "...", "tokenized_at": "..." }
}
```

`reason: "drift_detected"` if the content has changed since tokenisation,
`reason: "not_tokenised"` for draft packs.

### 9.5 `POST /v1/packs/:id/unlock`

Token-gated full content access. The caller proves wallet control and
on-chain token holding in a single request:

```json
{
  "wallet": "<base58 Solana pubkey>",
  "message": "unlock:pack-abc123:1716123456",
  "signature": "<base58 Ed25519 signature>"
}
```

The signed message MUST follow the format `unlock:<pack_id>:<unix_ts_seconds>`.
The server verifies:

1. The message format is exact, with `pack_id` matching the URL.
2. The timestamp is within ±300 seconds of server time (replay protection).
3. The signature is valid Ed25519 over the UTF-8 message bytes for `wallet`.
4. `wallet` currently holds at least 1 unit of the Pack token on-chain.

On success (200), returns all Pack memories with full content plus their
Merkle inclusion proofs — so the client can independently audit each
memory's membership in the Pack without re-trusting the provider.

Failure status codes:

| Reason | Status |
|---|---|
| `malformed_message`, `pack_id_mismatch`, `invalid_wallet` | 422 |
| `message_expired`, `invalid_signature` | 401 |
| `not_token_holder` | 403 |
| `rpc_unavailable` | 503 |

**Encryption note (v0.1 vs v0.2):** v0.1 ships *authorization* (server gates
the API), not *encryption*. Memory content is plaintext (or encrypted to a
server-held key) at rest. v0.2 will introduce threshold encryption so the
server cannot unilaterally read Pack content — `/unlock` will return
decryption shares instead of plaintext.

## 9b. Reserved for v0.2

The following are placeholders. Implementations SHOULD NOT serve these endpoints in v0.1.

- `POST /v1/memories/:id/attest` — generate a zk-proof attestation over a memory corpus (compliance).
- `GET /v1/subscribe?query=...` — Server-Sent Events stream of new memories matching a query.
- Threshold-encrypted Pack content (replaces the v0.1 server-trusted unlock model).

## 10. Security considerations

- **Content-hash domain separation:** v0.1 does not domain-separate leaf vs inner Merkle nodes. Implementations MUST cross-check the Pack's `memory_count` on-chain when verifying inclusion proofs to prevent leaf/inner confusion attacks.
- **Drift detection:** VERIFY recomputes the hash from current state. Providers SHOULD return `drift_detected` if the stored hash mismatches the recomputed one and SHOULD NOT silently re-tokenise.
- **Replay:** CONTRIBUTE responses include a tx signature; clients SHOULD verify the on-chain receipt independently before treating the attestation as authoritative.
- **Owner scope:** providers MUST scope reads to the authenticated owner unless `owner` is explicitly passed. Cross-tenant leakage is the most common failure mode.

## 11. Reference implementation

The Solana reference implementation lives at `https://github.com/portablememoryprotocol/reference-solana` and runs at `https://api.portablememoryprotocol.com`. Backed by [Clude](https://clude.io). License: Apache-2.0 for the spec and SDK, MIT for the reference impl.

## 12. Acknowledgements

PMP draws on the design language of MCP (Anthropic), x402 (Coinbase), and A2A (Google). Composes natively with x402 for monetisation and MCP for tool surfaces.
