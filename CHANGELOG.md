# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).

## [3.1.0] — 2026-04-28

MemoryPack v0.2 — encryption, blob attachments, tarball packs, hardened
chain-anchor verifier, auditor CLI, cron-friendly snapshot. Fully
backward compatible: v0.1 packs still read by the new reader.

### Added
- **`writeMemoryPack({ format: 'tarball' })`** — compresses the pack as `.tar.zst`. Stable inner-dir name (no PID/timestamp leak). Runs `tar` via `spawnSync` with argv array — no shell, Windows-safe.
- **`writeMemoryPack({ encryption: { key, scope } })`** — pack-level xsalsa20-poly1305 encryption. `scope: 'records'` ciphers `record.content`; `scope: 'records+blobs'` also ciphers blob bytes and omits `filename`/`content_type` from `blobs/index.jsonl` to avoid plaintext metadata leak.
- **`writeMemoryPack({ blobs })`** — attach binary content. Stored at `blobs/sha256/<hex>` with a manifest at `blobs/index.jsonl`. Producers reference attachments via `record.blob_ref: sha256:<hex>`.
- **`writeMemoryPack({ clock })`** — deterministic timestamp injection for reference test vectors and reproducible snapshots.
- **`readMemoryPack` accepts tarballs** — auto-detected by `.tar.zst` extension or by being a file (not a directory). Extracts to a per-call temp dir, reads, cleans up on success and failure.
- **Tarball extraction is path-traversal hardened** — pre-lists members with `tar -tvf` and rejects symlinks, hardlinks, absolute paths, `..` segments, and characters outside `[A-Za-z0-9._/-]`. Adds `--no-same-owner --no-same-permissions` for defense in depth.
- **`readMemoryPack({ decryptionKey })`** — decrypts in place when manifest declares encryption. Validates key length, handles missing nonce gracefully, strips nonce from in-memory record after successful decrypt.
- **`ReaderResult.verifiedBlobs`** — set of blob hashes that round-tripped against the index. **`ReaderResult.minimalRecords`** — spec-compliant minimal projection that **excludes** records still marked `encrypted=true` so consumers ignoring `result.warnings` can't accidentally surface base64 ciphertext as plaintext content.
- **`verifyChainAnchors(anchors, opts)`** — async chain anchor verifier with SPL Memo program ID checking, exact memo data matching, and signer binding (`opts.expectedSigner`). Optional cluster cross-check via `getGenesisHash()`. Replaces the v0.1 log-string-regex approach which trusted any program's arbitrary log output (anchors were forgeable for ~5000 lamports per record).
- **`clude verify <pack>`** — auditor CLI for directory or `.tar.zst` packs. Optional `--verify-chain --rpc-url --cluster --decrypt-key --strict-signatures --strict-chain --public-key`. Exit code drives CI usage.
- **`clude snapshot`** — cron-friendly tarball of local memories. Single-line stdout = the snapshot path; errors → stderr; default output `~/.clude/snapshots/clude-YYYYMMDD-HHMMSS.tar.zst`.
- **Reference test vectors** — `packages/brain/src/memorypack/__tests__/fixtures.ts` exposes `FIXTURE_RECORDS`, `FIXTURE_BLOB_DATA`, `FIXTURE_ENCRYPTION_KEY`, `FIXTURE_CLOCK`, and `EXPECTED_RECORD_HASHES`. External MemoryPack implementers can use these as a contract test.

### Changed
- `MEMORYPACK_VERSION` bumped from `0.1` to `0.2` (additive — readers remain compatible with `0.1` packs).
- `MemoryPackManifest` adds `pack_format`, `encryption`, `blobs_count`.
- `MemoryPackRecord` adds `encrypted`, `nonce`. `serializeRecord` keeps stable key order including the new fields.
- Directory-mode writer **clears stale prior outputs** before writing — signed→unsigned re-export over the same dir no longer leaves an orphan `signatures.jsonl` that would fail verification on the next read.
- `WriterOptions.anchors` moved from positional 4th arg into options (no caller change needed; positional path was unused).

### Fixed
- Signature verification now runs over **ciphertext bytes** (the stored line) BEFORE decryption — tampering caught regardless of whether the reader has a key.
- `blob_ref` cross-check runs even when `blobs/index.jsonl` is absent. Previously a record claiming a blob a pack didn't physically contain passed silently; now warns with diagnostic detail.
- Decryption with the wrong key emits a per-record warning instead of throwing, so a verifier can still report on the rest of the pack.

### Security review (folded in)
- SPL Memo program ID + signer binding closes the v0.1 anchor forgery vector (any program could `msg!()` a `clude:v1:...` string under the old regex check).
- Tarball extraction symlink/path-traversal hardening blocks the classic symlink-then-write escape used to write outside the extraction tmp dir.
- `records+blobs` encryption scope ciphers the blob bytes AND omits filename/content_type from the index to avoid plaintext metadata leak even when filenames are sensitive (e.g. `medical-report.pdf`).
- Windows `tar` invocation switched to `spawnSync` with argv array; the previous POSIX `shellQuote` was a no-op on `cmd.exe` and produced literal-quote-character file names.

## [3.0.1] — 2026-04-17

### Changed
- **BREAKING: npm package is now `@clude/sdk` (scoped).** Original plan to publish as unscoped `clude` was blocked by npm's name-collision policy (`clui`/`code`/`clone`). Scoped package lives under the `@clude` organization on npm.
- **Self-contained publish bundle.** The monorepo refactor had broken publish since 2.7.8 — `scripts/build-publish.mjs` uses esbuild to inline `@clude/shared` and `@clude/brain` into a single tarball.

### Migration
- `npx clude-bot <cmd>` → `npx @clude/sdk <cmd>` (or `npm i -g @clude/sdk` then `clude <cmd>` — binary name is still `clude`)
- `import { Cortex } from 'clude-bot'` → `from '@clude/sdk'`
- MCP args `["clude-bot", "mcp-serve"]` → `["@clude/sdk", "mcp-serve"]`
- Config files (`~/.clude/config.json`, `~/.clude/brain.db`, `CLUDE_*` env vars) unchanged — no user-side data migration needed.

## [3.0.0] — 2026-04-17 (unpublished)

Initial unscoped rename attempt. Superseded by 3.0.1 after npm rejected `clude` as too similar to existing names.

## [2.6.0] — 2026-03-02

### Added
- **Hosted Cortex mode** — Zero-setup memory via API key (`npx clude-bot register`)
- **Owner wallet isolation** — Multi-tenant memory scoping with `scopeToOwner()` and `AsyncLocalStorage`
- **Cortex REST API** — 9 endpoints at `/api/cortex/*` (store, recall, stats, recent, self-model, link, hydrate, summaries, register)
- **Dashboard dual-mode auth** — Privy wallet login (legacy endpoints) + Cortex API key login (`/api/cortex/*` endpoints)
- **CLI register command** — `npx clude-bot register` for hosted mode onboarding
- **CLI init wizard** — Hosted vs self-hosted mode selection in `npx clude-bot init`
- **HTTP transport** — SDK client for hosted mode (`src/sdk/http-transport.ts`)
- **Hosted mode example** — `examples/hosted-mode.ts`
- **NPM publish workflow** — Auto-publish on GitHub Release via `.github/workflows/publish.yml`

### Changed
- `CortexConfig.supabase` is now optional (hosted mode only needs `hosted.apiKey`)
- Dashboard pages degrade gracefully in hosted mode (entity graph, memory packs show "requires self-hosted")
- `getOwnerWallet()` checks `AsyncLocalStorage` before module-level fallback for concurrent request safety
- 4 RPC functions accept `filter_owner` parameter for server-side tenant isolation
- README restructured with hosted mode as primary Quick Start path

## [2.5.1] — 2026-03-01

### Fixed
- npm onboarding: add bin entry point and postinstall banner

## [2.5.0] — 2026-02-28

### Added
- Entity co-occurrence expansion in memory recall pipeline
- Contradiction resolution phase in dream cycle (finds unresolved `contradicts` links, resolves via Claude, stores semantic resolution with `resolves` links)
- Entity-aware recall with bond-typed graph traversal and importance re-scoring
- `resolves` memory link type for contradiction resolution outcomes
- `get_unresolved_contradictions` and `get_entity_cooccurrence` Supabase RPC functions
- Entity knowledge graph: person, project, concept, token, wallet, location, event
- Deep Venice integration: cognitive model router, embeddings, stats API, web search
- Content filter on demo store endpoint (blocks hate speech and spam)
- Security: block CA spoofing attacks and URL prompt injection
- Context awareness to prevent confusion about other projects
- 10 Days campaign page, API routes, and tweet tracker

### Changed
- Upgraded cognitive router to Claude Opus/Sonnet via Venice
- Optimized cognitive model routing for cost/quality balance
- Improved memory retrieval accuracy: word boundaries, stopwords, rebalanced weights
- Routed X replies through Venice AI

### Fixed
- Backtest issues: await decay update, add resolves bond weight, deterministic tiebreak
- Memory corruption: exclude demo from recall, block cop-out consolidation, skip empty tweets
- Replace generic guardrail fallback with contextual responses
- Block Clude from engaging specific problematic threads

## [2.4.0] — 2026-02-15

### Changed
- Slimmed npm package to pure memory SDK — bot internals no longer shipped
- Removed unused `@solana/spl-token` dependency
- Fixed all npm audit vulnerabilities

### Added
- Memory recall in exit interviews, opinion, and wallet-roast features
- Wallet-based memory recall
- Thread context support
- Security guardrails with keyword-based patterns
- Env-var-backed character configuration (persona content removed from source)
- Smart tweet truncation at word boundaries
- Atomic claim to prevent duplicate responses
- Timing logs for memory recall in response pipeline

### Fixed
- Duplicate memory storage
- Allium 403 spam and Helius serializer crash
- Guardrail false positive from word-count regex
- Missing column migrations in `initDatabase` startup
- Railway deploy: install all deps in production Docker stage

## [2.3.0] — 2026-01-28

### Added
- Molecular memory architecture documentation (`docs/MOLECULAR_MEMORY.md`)
- Hash-based memory IDs (Beads-inspired, collision-resistant)
- Memory compaction for old faded episodic memories
- Knowledge graph with typed bonds (causal, semantic, temporal, contradictory)
- Venice permissionless inference support (Llama, DeepSeek, Qwen)
- Configurable primary/fallback inference providers

### Fixed
- Thinking tokens for Claude models on Venice
- TypeScript errors in inference, venice-client, and dream-cycle modules

## [2.2.0] — 2026-01-15

### Added
- Hybrid memory retrieval (vector similarity + keyword + tag scoring)
- Granular vector decomposition with per-fragment embeddings
- Type-specific decay rates (episodic 0.93, semantic 0.98, procedural 0.97, self_model 0.99)
- Structured concept ontology with 12 controlled vocabulary labels
- Progressive disclosure: `recallSummaries()` and `hydrate()` API
- Pluggable embedding providers (Voyage AI, OpenAI) via `EMBEDDING_PROVIDER`
- Helius webhook signature verification (timing-safe)
- Rate limiting on webhook and API endpoints
- Solana address validation
