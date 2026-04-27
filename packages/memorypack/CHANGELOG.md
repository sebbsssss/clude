# Changelog

All notable changes to `@clude/memorypack` are documented here. The package follows [Semantic Versioning](https://semver.org/).

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
