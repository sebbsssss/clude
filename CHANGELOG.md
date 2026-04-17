# Changelog

All notable changes to this project will be documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/).

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
