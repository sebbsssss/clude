# Changelog

All notable changes to `@clude/memorypack` are documented here. The package follows [Semantic Versioning](https://semver.org/).

## [0.7.0] — 2026-04-29

`appendRevocations` and `appendRevocationAnchors` now accept `.tar.zst` paths transparently. Operators with tarball packs no longer have to extract / append / re-tarball by hand.

### Added

- Tarball-aware code path in both append functions: when the input path is a tarball, the function extracts to a temp directory, runs the directory-mode append against the inner pack, repacks atomically, and cleans up.
- Atomic re-tarball: writes to `<original>.new-<pid>-<ts>` then renames into place. A failed extract / append / repack leaves the **original tarball untouched** — your audit trail never enters a half-written state.

### Behaviour

- Empty `revocations` / `anchors` input is a no-op (early return) — does NOT touch the tarball file. Mtime + bytes preserved.
- Tarballs that decompress to multiple top-level directories are rejected (matches the reader's contract).
- Tarballs whose extension is `.tar.zst` are routed through the tarball path. Other file paths are also routed through (in case someone renames a pack), then handled by the tar binary; truly malformed inputs fail at extraction.
- Directory-mode behaviour is unchanged — covered by an explicit regression test.

### Concurrency

Concurrent appends to the same tarball are NOT safe — last writer wins. Same constraint as concurrent writes to a directory pack; callers needing multi-process coordination must layer their own locking. Single-producer flows (the common case) are unaffected.

### Tests

9 new tests, 92 total in this package, all green:

- Append revocations to a tarball → read-back via `readMemoryPack` confirms presence
- Append revocation anchors to a tarball → read-back confirms paired anchor
- `streamMemoryPack` surfaces the appended anchor on tarballs too
- Multiple appends stack across calls
- Empty input is a no-op (mtime + bytes unchanged on the tarball file)
- Successful append leaves no orphan staging files in the workdir
- Tarball with multiple top-level dirs is rejected
- Directory-mode regression guard

### Limitations (deferred to v0.8)

- @solana/web3.js test mocks for `verifyChainAnchors` / `verifyRevocationAnchors`.
- Backdating-detection (`maxClockSkew`) on revocation anchors.
- Symbol.asyncDispose for the streaming reader.

## [0.6.0] — 2026-04-29

Chain-anchored revocations. Pin the `revoked_at` of a soft-deleted record to a Solana transaction so a producer can't backdate a deletion claim.

### Added

- `revocation_anchors.jsonl` file in the spec.
- `MemoryPackRevocationAnchor` type and `anchor_format: "memo-revoke-v1"`.
- `expectedRevocationMemo(record_hash, revoked_at)` — exposes the canonical on-chain memo string a producer should commit, mirroring `expectedMemoForRecordHash`.
- `appendRevocationAnchors(packDir, anchors)` — append-only writer (directory-only, mirroring `appendRevocations`).
- `verifyRevocationAnchors(anchors, opts)` — Solana RPC verifier. Same semantics as `verifyChainAnchors`: SPL Memo program required, exact-match the memo bytes, signer-binding via `expectedSigner`, optional `cluster` cross-check via `getGenesisHash`, sequential by default to keep RPC pressure low.
- `result.revocationAnchors` and `result.verifiedRevocationAnchors` on both `readMemoryPack` and `streamMemoryPack`.
- CLI surfaces a "Revocation anchors" panel when present, and verifies them under `--verify-chain`. `--strict-chain` makes any mismatch a fail.

### On-chain memo format

```
revoke:v1:sha256:<record_hex>:<revoked_at>
```

~95 bytes for SHA-256 + RFC3339, well under Solana's 566-byte memo cap.

### Reader semantics

- `revocation_anchors.jsonl` is loaded eagerly but **not RPC-verified by `readMemoryPack`** — chain verification is out of band, like `verifyChainAnchors`.
- The reader cross-checks that each anchor's `(record_hash, revoked_at)` pair matches a verified entry in `revocations.jsonl`. Anchors with no matching pair are **skipped with a warning** — they cannot prove anything if there's no signed revocation backing them.
- Anchors with unsupported `anchor_format` are skipped with a warning (forward-safe for future memo versions).
- Malformed JSON lines are skipped with a warning.
- One bad anchor never throws — keeps the audit trail intact.

### Writer hygiene

`writeMemoryPack` now also clears prior `revocation_anchors.jsonl` alongside `revocations.jsonl` and the rest. Re-export means "fresh pack."

### Tests

12 new tests in this PR (83 total in the package, all green):

- `expectedRevocationMemo` formatting + size bounds
- `appendRevocationAnchors`: shape, append-not-overwrite, tarball reject, missing-manifest reject, no-op on empty input
- Reader: exposes anchors, skips mismatched pair, skips unsupported format, skips malformed lines
- Stream: exposes anchors alongside the iterator
- Writer: wipes prior `revocation_anchors.jsonl` on re-export

Solana RPC verification (`verifyRevocationAnchors`) is structurally identical to the v0.2 `verifyChainAnchors` and shares its untested-with-mocks status. Mocking @solana/web3.js is a separate testing-infra PR.

### Producer flow

```ts
// 1. Soft-delete (already shipped in 0.4.0)
appendRevocations(dir, [{ record_hash, reason: 'gdpr' }], { secretKey, publicKey });

// 2. Send a Solana tx with memo `revoke:v1:sha256:<hex>:<rfc3339>`
//    using whatever wallet/lib you prefer. Use expectedRevocationMemo()
//    to get the exact bytes.

// 3. Record the chain anchor
appendRevocationAnchors(dir, [{
  record_hash, revoked_at, chain: 'solana-mainnet', tx, slot,
}]);
```

### Limitations (deferred to v0.7)

- Tarball-aware `appendRevocationAnchors` — operators with `.tar.zst` packs still need extract / append / re-tarball.
- @solana/web3.js mocking infrastructure — adds confidence to RPC-touching code.
- Backdating-detection: today the verifier confirms the memo bytes but doesn't compare the chain block timestamp to `revoked_at`. A future option `maxClockSkew` could reject anchors whose block time is hours/days off from the signed timestamp.

## [0.5.0] — 2026-04-28

Standalone CLI verifier. Auditors can install `@clude/memorypack` alone (~30 KB) and run `npx @clude/memorypack verify <pack>` without touching the rest of Clude.

### Added

- New CLI binary `memorypack` declared via the package's `bin` field. Available as `npx @clude/memorypack verify <pack>` or as a globally installed `memorypack verify` after `npm install -g`.
- `dist/cli.js` (preserved shebang `#!/usr/bin/env node`).
- New subpath export `@clude/memorypack/cli` for programmatic callers that want to invoke the CLI surface (`runVerify`, `parseArgs`, `printUsage`, `printVersion`).
- Verifier surfaces the v0.4 revocations panel when `revocations.jsonl` is present.

### CLI flags

```
verify <pack>                Validate a pack (directory or .tar.zst)
  --public-key <base58>      Override the manifest public key
  --strict-signatures        Fail if any record is unsigned
  --verify-chain             Also verify Solana on-chain anchors
  --strict-chain             Fail on any chain verification mismatch
  --rpc-url <url>            Solana RPC URL
  --cluster <name>           Cross-check RPC genesis hash
  --decrypt-key <base64>     Pack-level decryption key (32 bytes)
--version                    Print the package version
--help                       Print usage
```

Exit codes: `0` if every check passed, `1` otherwise. `NO_COLOR=1` honored for CI logs.

### Tests

11 new CLI tests (subprocess-invoked against the built `dist/cli.js`):

- `--version`, `--help`, bare invocation, unknown command exit codes
- `parseArgs` unit tests (every flag + error cases)
- Round-trip verify on a synthesized signed pack (exit 0)
- Tampered pack → exit 1 with REJECTED
- Encrypted pack with correct decrypt key → exit 0 + decryption diagnostic
- `--strict-signatures` rejects unsigned packs

Total: 70 tests passing.

### Not in this release

- Tarball-aware `appendRevocations` — still requires extract / append / re-tarball.
- Chain-anchored revocations.
- Production IPFS / Arweave content anchoring.

## [0.4.0] — 2026-04-28

Signed revocations — soft-delete protocol for GDPR right-to-erasure, PII leaks, and corrections.

### Added

- `appendRevocations(packDir, revocations, opts)` — appends signed entries to `revocations.jsonl` without touching records, signatures, manifest, or anchors. Append-only, forward-only.
- `signRevocation` / `verifyRevocation` / `revocationPayload` — primitives for vendors that want to operate below the writer.
- `MemoryPackRevocation` type and `revocations.jsonl` file in the spec.
- `result.revocations` and `result.revokedRecordHashes` on both `readMemoryPack` and `streamMemoryPack`.

### Behaviour

- Canonical signed payload: `revoke:v1:<record_hash>:<revoked_at>`, ed25519 + bs58. Same envelope as record signatures, so a producer's existing keypair signs both.
- The reader **rejects** revocations whose `public_key` doesn't match `manifest.producer.public_key` (or the caller's `publicKey` override). Mismatch becomes a warning, not a throw — one bad entry shouldn't poison the audit trail.
- The reader **rejects** revocations whose signature doesn't verify. Same warning-not-throw posture.
- Records stay in `result.records` after revocation. Soft-delete: applications decide whether to surface as `[redacted]`, omit, or display with a flag. The reader exposes `revokedRecordHashes` for filtering.
- `writeMemoryPack` clears any prior `revocations.jsonl` on re-export. Callers wanting carry-over must explicitly re-`appendRevocations` after writing.

### Limitations (deferred to v0.5)

- Tarball packs are not supported by `appendRevocations` — operators must extract, append, then re-tarball. Direct append-to-tarball is v0.5.
- Chain-anchored revocations. The signed entry is local-only; pinning revocation timestamps to a chain (so a producer can't backdate a revocation) is a future enhancement.

## [0.3.0] — 2026-04-28

Streaming reader for packs that don't fit in memory.

### Added

- `streamMemoryPack(path, opts)` — returns `{ manifest, anchors, records: AsyncIterable<StreamedRecord>, warnings }`.
- `StreamReaderOptions`, `StreamedRecord`, `StreamMemoryPackResult` — exported types.

### Behaviour

- Manifest, signatures, and anchors are loaded eagerly (small files). Signatures are verified up front so the call to `streamMemoryPack` can throw on tampering before the iterator yields a single record.
- Records are streamed line-by-line via Node `readline` from `records.jsonl`. Per-record cost is one `JSON.parse` + one sha256 + one signature lookup + (optionally) one xsalsa20-poly1305 decrypt.
- Tarballs (`.tar.zst`) are extracted to a temp directory first; the temp dir is cleaned up after iteration completes (success or throw).
- Memory footprint is bounded — the only state retained across the iteration is the signature map (typically < 1% of pack size) and the manifest. The 5000-record bounded-heap test caps peak heap delta under 10 MB.

### Limitations (deferred to v0.4)

- True streaming through tar (no temp-dir extraction). Today's tarball flow extracts the whole pack first.
- Lazy blob resolution. The streaming reader does not load `blobs/`. Callers that need blobs alongside records should use `readMemoryPack` instead.
- Resource leak on abandoned iterators. If a consumer breaks out of the `for await` loop without exhausting it, the temp dir for tarballs is not cleaned up until process exit. Acceptable for v0.3; v0.4 should expose a `Symbol.asyncDispose` handle.

## [0.2.0] — 2026-04-28

First standalone release. Mirrors the v0.2 reference implementation merged into the main Clude repo via PRs #103–#108.

### Added

- `writeMemoryPack` — writer with `format: 'directory' | 'tarball'`, `encryption.{key, scope}`, `blobs`, deterministic `clock` injection for test vectors.
- `readMemoryPack` — reader with auto-extract for `.tar.zst` tarballs, in-place decryption when `decryptionKey` supplied, blob-bytes-vs-index hash verification, minimal-shape projection for unknown record schemas.
- `verifyChainAnchors` — out-of-band Solana RPC helper that fetches each anchor's transaction, parses its SPL Memo, and confirms the payload matches `clude:v1:sha256:<record_hash_hex>`. Supports optional `expectedSigner` binding so a tx without the producer's wallet doesn't pass.
- `serializeRecord` — stable JSONL serialization with deterministic key order. Treat as a contract: external implementers MUST produce byte-identical output for the canonical fixture.
- `hashRecordLine`, `hashBuffer`, `signHash`, `verifyHash` — primitive surface re-exported for vendors that want to operate below the writer.
- `encryptString` / `decryptString` / `encryptBuffer` / `decryptBuffer` — xsalsa20-poly1305 helpers using NaCl secretbox.
- `randomNonce`, `ENCRYPTION_KEY_BYTES`, `ENCRYPTION_NONCE_BYTES` — constants for callers managing keys themselves.
- Reference test vectors in `src/__tests__/fixtures.ts` — deterministic seed + records + clock + `EXPECTED_RECORD_HASHES`. Use as contract tests for third-party readers.

### Notes

- This is the v0.2 spec. `0.1` packs (no `pack_format`, no encryption, no blobs index) are accepted by this reader on a best-effort basis; the file layout is forward-compatible.
- `@solana/web3.js` is an **optional** peer dependency. Install it only if you need `verifyChainAnchors()`.
- Distributed under MIT. Vendors are explicitly invited to implement this format.

### Roadmap (post-0.2)

Tracked in the main Clude repo:

- Production IPFS / Arweave content anchoring
- Multi-chain anchors (Ethereum L2 attestation, Bitcoin OP_RETURN)
- Streaming reader for packs > 100MB
- Revocations format
- Source-of-truth migration: `@clude/brain` will eventually depend on this package rather than ship its own copy.
