# MemoryPack v0.2 — Portable Agent Memory Format

**Status:** Reference implementation shipping in `@clude/sdk ≥ 3.1.0`
**Authors:** Clude team
**Last updated:** 2026-04-28

## Implementation status (v0.2)

| Feature | Status | Reference |
|---|---|---|
| Directory packs (manifest + records + sigs + anchors) | Shipped (v0.1) | `packages/brain/src/memorypack/{writer,reader}.ts` |
| ed25519 record signing | Shipped (v0.1) | `packages/brain/src/memorypack/sign.ts` |
| `.tar.zst` compressed packs | Shipped (v0.2) | `WriterOptions.format: 'tarball'` |
| `blobs/` attachment storage + index | Shipped (v0.2) | `WriterOptions.blobs` |
| Pack-level encryption (xsalsa20-poly1305) | Shipped (v0.2) | `WriterOptions.encryption.{key, scope}` |
| Reader auto-extracts tarballs (path-traversal hardened) | Shipped (v0.2) | `readMemoryPack(<.tar.zst>)` |
| Chain anchor verification (SPL Memo + signer binding) | Shipped (v0.2) | `verifyChainAnchors()` |
| `clude verify <pack>` standalone CLI | Shipped (v0.2) | `cli/verify.ts` |
| `clude snapshot` cron-friendly CLI | Shipped (v0.2) | `cli/snapshot.ts` |
| Reference test vectors (deterministic fixture) | Shipped (v0.2) | `__tests__/fixtures.ts` |
| Standalone `@clude/memorypack` npm package | Planned (v0.3) | extraction from `@clude/brain` |
| Content anchoring via IPFS/Arweave (opt-in) | Planned (v0.3) | — |

## Motivation

An agent's memory is the most load-bearing part of its identity. When you
change providers, you lose the agent. Today that lock-in is the default
because every vendor stores memory in a proprietary shape, behind a
proprietary API, on a proprietary cluster.

MemoryPack is an open, file-level format for moving agent memory between
systems. It is intentionally simple: a directory of JSONL records, a
manifest, optional ed25519 signatures, optional on-chain anchors. Any
agent runtime that implements the reader can ingest a MemoryPack
produced by any other runtime.

Clude uses MemoryPack as the wire format for `clude export --format
memorypack` and `clude import <pack-dir>`. Nothing about the format is
Clude-specific — vendors are invited to implement and extend it.

## Design goals

1. **Self-describing.** A MemoryPack directory is usable without the producer.
2. **Signed.** Each record MAY carry an ed25519 signature over its line hash; receivers verify against a wallet public key.
3. **Chain-anchorable but not chain-dependent.** Records MAY include a transaction reference; readers MUST work when that field is absent.
4. **Append-only friendly.** Records are independent. Merging two packs is concatenation plus de-duplication.
5. **Human-readable.** JSONL. A `cat records.jsonl | jq` pipeline is the reference debugger.

## File layout (v0.1)

A MemoryPack is a **directory** containing:

```
./manifest.json         # required, describes the pack
./records.jsonl         # required, one memory per line
./signatures.jsonl      # optional, ed25519 signatures keyed by record hash
./anchors.jsonl         # optional, on-chain proofs
```

v0.2 adds optional `blobs/` attachments + a `.tar.zst` packaged form;
both still surface a directory shape to the reader after extraction.

### `manifest.json`

```json
{
  "memorypack_version": "0.1",
  "producer": {
    "name": "clude",
    "version": "3.0.3",
    "agent_id": "agent_01HZ...",
    "did": "did:pkh:solana:7xK3...",
    "public_key": "7xK3...base58"
  },
  "created_at": "2026-04-16T06:30:00Z",
  "record_count": 1482,
  "record_schema": "clude-memory-v3",
  "signature_algorithm": "ed25519",
  "anchor_chain": "solana-mainnet"
}
```

- `record_schema` is a free-form identifier; receivers that don't recognise it MAY fall back to the minimal shape described below.
- `signature_algorithm` is only set when `signatures.jsonl` is present.
- `did` is recommended in the [`did:pkh`](https://github.com/w3c-ccg/did-pkh) form for wallet keys.

### `records.jsonl`

One JSON object per line, with **stable key order** — hashes depend on the exact byte sequence. Reference: `packages/brain/src/memorypack/writer.ts:serializeRecord`.

Minimal shape readers MUST handle:

```json
{
  "id": "01HZRF...ULID",
  "created_at": "2026-04-16T06:12:33Z",
  "kind": "episodic",
  "content": "User confirmed weekly newsletter cadence.",
  "tags": ["preferences", "product:newsletter"],
  "importance": 0.72,
  "source": "chat"
}
```

Extended fields producers MAY emit (readers MUST ignore unknown keys):

| Field | Shape | Notes |
|---|---|---|
| `summary` | `string` | short-form for recall ranking |
| `embedding` | `number[]` | base-model hint; readers re-embed as needed |
| `embedding_model` | `string` | e.g. `text-embedding-3-small` |
| `metadata` | `object` | free-form; reserved keys prefixed `mp:` |
| `access_count` | `integer` | for producers that track decay |
| `last_accessed_at` | `RFC3339` | for decay scoring |
| `parent_ids` | `string[]` | compaction lineage |
| `compacted_from` | `string[]` | IDs rolled up into this record |
| `blob_ref` | `sha256:...` | binary attachment, resolved via `blobs/` (v0.2) |

`kind` is one of `episodic | semantic | procedural | relational`. Vendor extensions SHOULD use `kind: "x-vendor-name"`.

### `signatures.jsonl`

Each line is one detached signature, keyed by record hash:

```json
{
  "record_hash": "sha256:9f6c...",
  "signature": "base58:3K9T...",
  "algorithm": "ed25519",
  "public_key": "7xK3...base58"
}
```

**Record hash computation:** the UTF-8 bytes of the record's JSONL line, excluding any trailing newline, SHA-256'd, prefixed with `sha256:`. Reference implementation: `packages/brain/src/memorypack/sign.ts:hashRecordLine`.

**Verification rule:** when `signatures.jsonl` is present, the reference reader requires **every** record to have a matching valid signature. If any signature is invalid OR any record lacks a signature, the reader rejects the pack.

This is stricter than "signatures are per-record optional." Reason: a tamperer who mutates a record line changes its hash, orphaning the original signature. Treating the mutated record as "unsigned" would silently accept it. We reject. If a producer has legitimate mixed signed/unsigned records, they should distribute them as separate packs.

Packs without `signatures.jsonl` are accepted as unsigned.

### `anchors.jsonl`

On-chain proofs (optional):

```json
{
  "record_hash": "sha256:9f6c...",
  "chain": "solana-mainnet",
  "tx": "5gH2...base58",
  "slot": 248102003,
  "anchor_format": "memo-v1"
}
```

**`memo-v1`:** the on-chain memo payload is the exact string `clude:v1:sha256:<hex>`, 73 bytes for a SHA-256 hash. Fits well under Solana's 566-byte memo cap.

Chain anchor verification (v0.2) — fetching the tx and confirming the memo matches `clude:v1:sha256:<record_hash_hex>` is implemented in `verifyChainAnchors()`. The verifier walks `tx.transaction.message.instructions`, requires at least one whose program ID is the canonical SPL Memo program (`MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` v3 or `Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo` v1), decodes that instruction's data as UTF-8, and exact-matches it against the expected memo. When `expectedSigner` is set, the verifier additionally requires that key is among the transaction's signers — without this binding any program could `msg!()` a clude memo and present it as a "verified" anchor. Optional `cluster` cross-checks `getGenesisHash()` so a devnet RPC can't accept a mainnet anchor.

## Read algorithm

The reference reader (`packages/brain/src/memorypack/reader.ts`) implements:

```
1. Parse manifest.json. Reject if memorypack_version is not 0.x.
2. Stream records.jsonl; each line becomes one MemoryPackRecord.
3. If signatures.jsonl exists:
   a. Load the public key from manifest.producer.public_key
      (or the caller's override).
   b. For each signature entry, verify it against the public key.
      Reject on any failure.
   c. For each record line, compute its hash and confirm a matching
      verified signature exists. Reject on any missing match.
4. Load anchors.jsonl if present (returned to caller; verification
   deferred to v0.2).
5. Re-embed downstream if local embedding model differs from
   manifest.embedding_model.
```

## Write algorithm

The reference writer (`packages/brain/src/memorypack/writer.ts`) implements:

```
1. Emit manifest.json with producer identity, record_count, and
   signature_algorithm iff a secret key is provided.
2. For each memory: serialize to one JSONL line via serializeRecord()
   (stable key order).
3. If secretKey provided: hash the line (sha256, UTF-8, no trailing
   newline), sign with ed25519, append signature entry.
4. Write records.jsonl and (if signing) signatures.jsonl.
5. Append caller-provided anchors.jsonl entries if supplied.
```

## Versioning

`memorypack_version` uses semver-ish strings. Readers MUST accept all `0.x` versions on a best-effort basis (ignore unknown fields, warn on unknown `record_schema`). `1.0` will freeze the record shape above.

## If Clude disappears tomorrow — recovery semantics

The on-chain anchor is **a receipt, not storage**. The Solana memo carries the SHA-256 of the memory content; the content itself lives in the producer's database (Supabase, local SQLite, or wherever the agent was hosted). Practical recovery:

- **Local mode (`CLUDE_LOCAL=true`):** memories live in `~/.clude/memories.json`. Clude going down doesn't touch them. The on-chain anchor lets a third party later verify your local copy wasn't tampered with.
- **Exported MemoryPack:** if you ever ran `clude export --format memorypack <dir>` and kept the directory, you have everything needed to re-import into any MemoryPack-compatible system.
- **Hosted mode, no export:** if both Clude and your hosted Supabase die and you never exported, the on-chain hash alone is not enough to reconstruct content. The hash proves what you remembered; it cannot recreate it.

The primitive we ship today is **portability + authenticity**, not distributed content storage. For customers who need content-level on-chain guarantees (compliance archival, regulatory long-term hold), see the Roadmap entry for content anchoring.

## Reference implementations

- **`@clude/sdk` ≥ 3.0.4:**
  - `clude export --format memorypack <dir>` — writes a v0.1 directory (signed if a wallet keypair is configured, unsigned otherwise).
  - `clude import <dir>` — auto-detects `manifest.json` and uses the MemoryPack reader with signature verification + tamper rejection.
  - On-chain memo writes use `clude:v1:sha256:<hex>` (memo-v1).
  - Module exports: `@clude/brain/memorypack` → `writeMemoryPack`, `readMemoryPack`, `hashRecordLine`, `signHash`, `verifyHash`.
- **`@clude/memorypack` (planned v0.2):** framework-agnostic standalone TS reader/writer with no Clude dependencies, publishable to npm so third-party memory vendors can implement the spec without installing the rest of Clude.

## Non-goals

- Real-time sync. MemoryPack is a snapshot format; sync is a higher layer.
- Access control. Receivers decide who can read; MemoryPack only establishes authenticity.
- Embedding portability at vector level. Embeddings ship as a hint; readers re-embed against their own model as needed.
- Content-level on-chain storage. The chain holds hashes, not content. See Roadmap for opt-in content anchoring.

## Snapshots and cron (v0.2)

`clude snapshot` writes a dated `.tar.zst` of your local memories to
`~/.clude/snapshots/clude-YYYYMMDD-HHMMSS.tar.zst` (UTC). The command
is cron-friendly:

- single-line stdout = the snapshot path on success
- errors → stderr only
- exit code drives the cron mailer

Example crontab (daily 03:00 local):

```
0 3 * * *  /usr/local/bin/node /usr/local/lib/node_modules/@clude/sdk/dist/cli/index.js snapshot
```

Pass `--encrypt-key <base64>` to encrypt the snapshot with a 32-byte
xsalsa20-poly1305 key (recommended for any snapshot you'll move
off-host). Pass `--out <path>` to override the default location.

## Reference test vectors

A canonical fixture lives at
`packages/brain/src/memorypack/__tests__/fixtures.ts`. Exports:

- `FIXTURE_RECORDS` — frozen input records.
- `FIXTURE_BLOB_DATA` + `FIXTURE_BLOB_HASH` — frozen blob payload + sha256.
- `FIXTURE_ENCRYPTION_KEY` — frozen 32-byte symmetric key.
- `FIXTURE_CLOCK` — deterministic timestamp generator.
- `EXPECTED_RECORD_HASHES` — frozen sha256 of the serialized records.

External implementers can reproduce the same hashes from the same
inputs and use them as a contract test against this spec.

## Roadmap

Tracked as GitHub issues with the `memorypack` label:

- **Content anchoring.** Opt-in `--anchor-content` that stores encrypted content via IPFS/Arweave and commits the CID rather than just the hash.
- **`@clude/memorypack` standalone npm package.** Splits the reader/writer into a zero-dependency package so competing vendors can implement the spec without installing Clude.
- **Streaming reader for very large packs.** Today `readMemoryPack` loads the entire pack in memory; a streaming variant lands when single packs cross ~100MB in the wild.

## Open questions

- Should `anchor_chain` support Ethereum / Bitcoin attestation natively, or leave those to vendor extensions?
- Streaming reader API for packs > 100MB?
- Revocations — `revocations.jsonl` or producer re-issuing?

## Feedback

File issues at https://github.com/sebbsssss/clude/issues with label `memorypack`. PRs welcome, especially from non-Clude memory systems that want to implement the reader.
