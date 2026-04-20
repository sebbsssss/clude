# MemoryPack v0.1 — Portable Agent Memory Format

**Status:** Draft
**Authors:** Clude team
**Last updated:** 2026-04-16

## Motivation

An agent's memory is the most load-bearing part of its identity. When you
change providers, you lose the agent. Today that lock-in is the default
because every vendor stores memory in a proprietary shape, behind a
proprietary API, on a proprietary cluster.

MemoryPack is an open, file-level format for moving agent memory between
systems. It is intentionally simple: a JSONL stream of signed memory
records, optional anchors to a public chain, and a manifest. Any agent
runtime that implements the reader can ingest a MemoryPack produced by
any other runtime.

Clude uses MemoryPack as the wire format for its `clude export` /
`clude import` commands, and as the canonical shape committed on-chain
via Solana memo. Nothing about the format is Clude-specific — vendors
are invited to implement and extend it.

## Design goals

1. **Self-describing.** A MemoryPack file is usable without the producer.
2. **Signed.** Each record carries a producer signature; receivers MAY
   verify against a DID or wallet public key.
3. **Chain-anchorable but not chain-dependent.** Records MAY include a
   transaction reference; readers MUST work when that field is absent.
4. **Append-only friendly.** Records are independent. Merging two packs
   is concatenation plus de-duplication.
5. **Human-readable.** JSONL. A `cat | jq` pipeline is the reference
   debugger.

## File layout

A MemoryPack is a directory (or a `.tar.zst`) containing:

```
./manifest.json         # required, describes the pack
./records.jsonl         # required, one memory per line
./signatures.jsonl      # optional, detached signatures keyed by record hash
./anchors.jsonl         # optional, on-chain proofs
./blobs/                # optional, binary payloads referenced by hash
```

### `manifest.json`

```json
{
  "memorypack_version": "0.1",
  "producer": {
    "name": "clude",
    "version": "3.0.1",
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

- `record_schema` is a free-form identifier; receivers that don't
  recognise it MAY fall back to the minimal shape described below.
- `did` is recommended in the
  [`did:pkh`](https://github.com/w3c-ccg/did-pkh) form for wallet keys.

### `records.jsonl`

One JSON object per line. Minimal shape (the subset every reader MUST
handle):

```json
{
  "id": "01HZRF...ULID",
  "created_at": "2026-04-16T06:12:33Z",
  "kind": "episodic",
  "content": "User confirmed they want the newsletter cadence to stay weekly.",
  "tags": ["preferences", "product:newsletter"],
  "importance": 0.72,
  "source": "chat"
}
```

Extended fields producers MAY emit (readers MUST ignore unknown keys):

| Field | Shape | Notes |
|---|---|---|
| `embedding` | `number[]` | base-model hint; readers re-embed as needed |
| `embedding_model` | `string` | e.g. `text-embedding-3-small` |
| `metadata` | `object` | free-form; reserved keys prefixed `mp:` |
| `summary` | `string` | short-form for recall ranking |
| `access_count` | `integer` | for producers that track decay |
| `last_accessed_at` | `RFC3339` | for decay scoring |
| `parent_ids` | `string[]` | compaction lineage |
| `compacted_from` | `string[]` | IDs rolled up into this record |

`kind` is one of `episodic | semantic | procedural | relational`. Vendor
extensions SHOULD use `kind: "x-vendor-name"`.

### `signatures.jsonl`

One signature per record, keyed by `record_hash` (SHA-256 of the exact
record line as it appears in `records.jsonl`, trailing newline excluded):

```json
{
  "record_hash": "sha256:9f6c...",
  "signature": "base58:3K9T...",
  "algorithm": "ed25519",
  "public_key": "7xK3...base58"
}
```

Receivers that verify signatures MUST reject records where
`record_hash` is present in `signatures.jsonl` but the signature does
not verify. Records without a signature entry are accepted as unsigned
(compatibility with non-crypto producers).

### `anchors.jsonl`

```json
{
  "record_hash": "sha256:9f6c...",
  "chain": "solana-mainnet",
  "tx": "5gH2...base58",
  "slot": 248102003,
  "anchor_format": "memo-v1"
}
```

- `memo-v1`: the on-chain memo is the exact string
  `clude:v1:<record_hash>` (53 bytes, well under Solana's 566-byte memo
  cap).
- Readers MAY fetch the transaction to confirm the memo matches.

### `blobs/`

If a record references a binary blob (e.g. image attached to a memory),
the content is stored at `blobs/<sha256>.<ext>` and referenced from the
record as `"blob_ref": "sha256:..."`.

## Read algorithm

```
1. Parse manifest.json; reject if memorypack_version > 0.x.
2. Stream records.jsonl line by line.
3. For each record:
   a. If signatures.jsonl exists, compute sha256 of the line,
      look up signature, verify against manifest public_key.
      Reject on mismatch.
   b. If anchors.jsonl exists AND verify-chain=true, fetch tx,
      confirm memo contains `clude:v1:<record_hash>`.
   c. Insert into local store using native schema mapping.
4. Re-embed if local embedding model != manifest.embedding_model.
```

## Write algorithm

```
1. Emit manifest.json with producer identity.
2. For each memory: serialize to one JSONL line (stable key order).
3. Hash the line (sha256), sign with producer private key, append to
   signatures.jsonl.
4. If on-chain anchoring is enabled, submit memo tx, append result
   to anchors.jsonl.
```

## Versioning

`memorypack_version` uses semver-ish strings. Readers MUST accept all
`0.x` versions on a best-effort basis (ignore unknown fields, warn on
unknown `record_schema`). `1.0` will freeze the record shape above.

## Reference implementations

- **Clude CLI (`@clude/sdk` ≥ 3.1):** `clude export > mypack.tar.zst`
  and `clude import mypack.tar.zst`. Uses `record_schema:
  clude-memory-v3`.
- **`@clude/memorypack` (planned):** framework-agnostic TS reader and
  writer.

## Non-goals

- Real-time sync. MemoryPack is a snapshot/stream format; sync is a
  higher layer.
- Access control. Receivers decide who can read; MemoryPack only
  establishes authenticity.
- Embedding portability at vector level. We ship embeddings as a hint,
  not a contract.

## Open questions

- Should `anchor_chain` support Ethereum / Bitcoin attestation out of
  the box, or leave those to vendor extensions?
- Do we want a compressed "compact" mode for packs >100MB?
- How do revocations work — is it a separate `revocations.jsonl` or do
  we rely on the producer re-issuing?

## Feedback

File issues at https://github.com/sebbsssss/clude/issues with
label `memorypack`. PRs welcome, especially from non-Clude memory
systems that want to implement the reader.
