# GCP migration: the switch layer

_Design of record for the parallel-run migration. Companion to `docs/gcp-migration-plan.md` (the strategy)._

## Goal

Stand up a GCP "shadow" stack next to the live Railway + Supabase + Voyage infra, keep it continuously in sync, make every migratable layer selectable by a config flag, validate against the real quality gates, then flip per-layer (or all at once) and sunset the old layer. At cutover nothing is built, only a flag changes.

Decisions locked with the user (2026-07-04):
- **Per-layer flags plus one combined flip.** Each layer has its own switch and is validated independently. The final cutover can flip them one at a time or together via one profile.
- **Gate the embedding swap, keep Voyage as instant fallback.** Vertex embeddings ship only after the LongMemEval 85.0 harness ties or beats Voyage. Vertex lives in a shadow vector column, never overwriting the Voyage space.
- **Build the code foundation now**, in parallel with the user provisioning the GCP project, billing, and service account.

## The switches

One config block, `config.migration` (in `packages/shared/src/config.ts`), read through a pure selector module `packages/shared/src/core/migration-profile.ts`. Everything defaults to current behavior, so merging changes nothing until a flag is set.

| Env var | Values | Default | Switches |
|---|---|---|---|
| `DB_TARGET` | `supabase` \| `cloudsql` | `supabase` | Which backend `getDb()` connects to |
| `CLOUDSQL_PGREST_URL` | url | `""` | PostgREST endpoint in front of Cloud SQL (used when `DB_TARGET=cloudsql`) |
| `CLOUDSQL_SERVICE_KEY` | key | `""` | Service key for that endpoint |
| `EMBEDDING_ACTIVE` | `voyage` \| `vertex` | `voyage` | Which embedding vector space ingest + recall use |
| `RUN_INPROCESS_TIMERS` | `true` \| `false` | `true` | Whether this process runs the in-server singleton timers |
| `VERTEX_PROJECT` | project id | `""` (falls back to `GCP_PROJECT`) | GCP project for Vertex embeddings (`clude-query-sol-data`) |
| `VERTEX_LOCATION` | region | `us-central1` | Vertex region |
| `VERTEX_EMBEDDING_MODEL` | model | `gemini-embedding-001` | Vertex embedding model |
| `VERTEX_EMBEDDING_DIMENSIONS` | int | `1024` | MRL output dims (keep 1024 to reuse `vector(1024)` + HNSW) |
| `VERTEX_ACCESS_TOKEN` | token | `""` | Local/smoke OAuth override; empty in prod (Cloud Run metadata server mints it) |

The DB switch works because the Cloud SQL backend is fronted by PostgREST (self-hosted Supabase or a PostgREST container), which is API-compatible with `@supabase/supabase-js`. So `getDb()` only needs a different `(url, key)`; the ~600 `.from()`/`.rpc()` call sites do not change. This is the B1 path from the strategy doc.

## Slice plan

- **Slice 1: the spine. DONE.** `config.migration` block plus the pure `migration-profile` module (`resolveDbConnection`, `activeEmbeddingSpace`, `shouldRunInProcessTimers`, `assertValidMigrationProfile`, `describeMigrationProfile`) plus unit tests. No runtime path consumes it yet, so behavior is identical. Status: green (13 tests in `migration-profile.test.ts`).
- **Slice 2: wire the spine into the hot paths. DONE.**
  - `database.ts` — `getDb()` now calls `resolveDbConnection()` instead of reading `config.supabase` directly. Behavior-preserving when `DB_TARGET=supabase` (resolver returns the Supabase connection). Covered by `database-getdb.test.ts` (wiring + singleton).
  - `bootstrap.ts` — the three timer-start blocks (recall canary, marketplace delivery poller, title reconciliation) are wrapped in `if (shouldRunInProcessTimers())`, with an explicit log on the disabled branch. This is the fix for the single-instance trap: on Cloud Run the server sets `RUN_INPROCESS_TIMERS=false` and exactly one worker owns the timers.
  - `bootstrap.ts` calls `assertValidMigrationProfile()` first (a typo'd/under-configured flag fails fast instead of silently defaulting) and logs `describeMigrationProfile()` at boot.
  - Status: green — 22 tests pass (`database-getdb` + `migration-profile` + `init-database`); `@clude/shared` and `@clude/server` typecheck clean. Default flags = identical behavior, safe to merge to staging and verify on the Railway preview before any GCP resource exists.
- **Slice 3a: the Vertex embedding provider. DONE.**
  - Added a standalone Vertex path in `embeddings.ts` (not a `PROVIDERS` map entry — Vertex's contract is too different, and a separate function keeps the live Voyage/OpenAI/Ollama providers byte-identical and zero-risk). It uses the aiplatform `:predict` endpoint, body `{instances:[{content}],parameters:{outputDimensionality}}`, response `{predictions:[{embeddings:{values}}]}`, targeting `gemini-embedding-001` at 1024 dims (MRL) so `vector(1024)` + HNSW + `match_*` RPCs are unchanged.
  - **Auth is SDK-free** (no `google-auth-library`, matching the repo's plain-fetch ethos): `VERTEX_ACCESS_TOKEN` override for local/smoke, else a cached token minted from the Cloud Run / GCE **metadata server** using the attached service account.
  - API: `generateVertexEmbedding(text)`, `generateVertexEmbeddings(texts)`, and `generateEmbeddingForSpace(space, text)` — the recall/ingest seam that routes by `activeEmbeddingSpace()`. `config.vertex` block added. Independent of `EMBEDDING_PROVIDER`, so ingest can dual-write and the backfill can populate the shadow column while Voyage stays live.
  - Status: green — 6 tests in `embeddings-vertex.test.ts` (URL/auth/body shape, positional batch, dims, non-200 → null, voyage-delegation, metadata token); full `@clude/shared` suite (74 tests) + typecheck clean. Fully dormant until `config.vertex` is set and the space is selected.
- **Slice 3b: shadow column + backfill + recall selection. DONE (dormant; validated by the harness on GCP).**
  - Migration `040_vertex_shadow_embeddings.sql`: `embedding_vertex vector(1024)` on memories + memory_fragments, shadow HNSW indexes (m=16, ef_construction=128, ef_search=100), and `_vertex` RPC variants (`match_memories_vertex`, `match_memories_temporal_vertex`, `match_memory_fragments_vertex`) byte-identical to the Voyage originals but reading `embedding_vertex`.
  - `vectorRpcName(base)` (in migration-profile) selects the base or `_vertex` RPC by `activeEmbeddingSpace()`; `generateQueryEmbeddingForSpace(space, text)` embeds the query in the active space. Both unit-tested.
  - Recall wiring in `packages/brain/src/memory/memory.ts` (PRIMARY lane only): query embed via `generateQueryEmbeddingForSpace(activeEmbeddingSpace(), q)`, RPCs via `vectorRpcName(...)`. Ingest dual-writes `embedding_vertex` when `isVertexConfigured()` (VERTEX_PROJECT set), gated so it is a no-op today and safe before migration 040. Secondary lanes (auto-link, temporal-bonds, clinamen, entity graph, topic cache) stay Voyage during the parallel run (both columns populated).
  - `scripts/backfill-vertex-embeddings.ts`: resumable, keyset-paginated, rate-limit-aware corpus re-embed into the shadow column (runs on live GCP).
  - Behavior-preserving at default (EMBEDDING_ACTIVE=voyage, VERTEX_PROJECT unset). The vertex path cannot be VALIDATED without live Vertex, so it is gated on the LongMemEval 85.0 harness (that is the whole point of the gate). Rollback = flip `EMBEDDING_ACTIVE` back to `voyage`.
- **Slice 4: IaC and cutover runbooks. DONE.**
  - `infra/gcp/cloudbuild.yaml` (PRIVY_APP_ID as `--build-arg`), `infra/gcp/seed-secrets.sh` (Secret Manager), `infra/gcp/deploy-server.sh` (Cloud Run server, phase-1 pinned min=max=1). Worker options (Worker Pool / VM / add-health-endpoint), domains, PR-preview revision tags, webhook re-pointing, the DB replication runbook (prune -> Cloud SQL + pgvector -> DMS/pg_dump -> rebuild HNSW), the embedding cutover runbook, and per-layer cutover/rollback are all in `docs/gcp-migration/01-iac-and-cutover.md`.
  - Blocked only on the user provisioning the GCP project/SA/region to fill in and run.

## Test and rollback strategy

- Every slice is behavior-preserving at its default flag values, so each can merge to staging independently and be verified on the Railway preview before any GCP resource exists.
- Rollback for any layer is flipping its flag back. No redeploy of code is required to revert a layer, only the env var and (for DB) pointing back at Supabase, which stays the source of truth until the final sunset.
- The combined flip is one profile that sets `DB_TARGET=cloudsql`, `EMBEDDING_ACTIVE=vertex` (only if gated-in), `RUN_INPROCESS_TIMERS` per role, plus DNS at Cloud Run.

## Blocked on the user (GCP side)

Provisioning cannot be done from here. In parallel with the code foundation, the user needs to: create the GCP project with billing, finish ADC / a service account (`aiplatform.googleapis.com` for Vertex, plus Cloud SQL / Secret Manager / Artifact Registry / Cloud Run APIs), and share the project id + region so the IaC in Slice 4 can be filled in.
