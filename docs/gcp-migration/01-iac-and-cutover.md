# GCP migration: IaC and cutover runbook

_Slice 4. Operational companion to `00-switch-layer.md` (the design). Project `clude-query-sol-data`, region `us-central1` (override with `GCP_REGION`). Every step keeps the live Railway + Supabase + Voyage stack untouched until a flag is flipped._

Files: `infra/gcp/cloudbuild.yaml`, `infra/gcp/seed-secrets.sh`, `infra/gcp/deploy-server.sh`, `packages/database/migrations/040_vertex_shadow_embeddings.sql`, `scripts/backfill-vertex-embeddings.ts`.

## 0. One-time project setup

```bash
gcloud config set project clude-query-sol-data
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com \
  aiplatform.googleapis.com sqladmin.googleapis.com datamigration.googleapis.com
gcloud artifacts repositories create clude --repository-format=docker --location=us-central1
```

Service account for the runtime (Cloud Run) and Vertex: grant `roles/aiplatform.user`, `roles/secretmanager.secretAccessor`, and (for the DB move) `roles/cloudsql.client`. The ADC helper (`bash <(curl -sSL .../setup_adc.sh)`) wires local credentials for running the backfill and smoke tests.

## 1. Build (Cloud Build to Artifact Registry)

`PRIVY_APP_ID` is a BUILD arg (baked into the Vite bundles), never a runtime env.

```bash
gcloud builds submit --config infra/gcp/cloudbuild.yaml \
  --substitutions=_PRIVY_APP_ID=<privy-app-id>,SHORT_SHA=$(git rev-parse --short HEAD)
```

The native stage compiles `better-sqlite3` / `keccak` / `sharp`. This repo has a history of builds that pass local + GH CI but fail the container build, and a failed deploy stays silent (health 200). Budget iteration here and add a post-deploy smoke check (probe a new route + grep the served bundle), do not trust a 200 on `/health` alone.

## 2. Secrets

```bash
GCP_PROJECT=clude-query-sol-data ./infra/gcp/seed-secrets.sh path/to/prod.env
```

`BOT_WALLET_PRIVATE_KEY` is the live treasury signer: after seeding, scope its per-secret IAM to only the runtime SA, and rotate any secret that has transited a chat/log. `PRIVY_APP_ID` is deliberately absent (build arg). `CLOUDSQL_*` are only needed once you cut the DB over.

## 3. Deploy

### Server (HTTP)

```bash
IMAGE_TAG=$(git rev-parse --short HEAD) ./infra/gcp/deploy-server.sh
```

Phase 1 pins the server to `min=max=1` with `RUN_INPROCESS_TIMERS=true`, reproducing today's Railway single-instance behavior exactly (the three in-server timers run on the one instance, cannot duplicate). Verify `/health`, `/api`, the MCP `.well-known`, and the `/chat` + `/dashboard` SPAs.

### Worker (autonomous bot loops)

The worker (`node apps/workers/dist/index.js`) is a pure loop process with no HTTP listener, so it does NOT fit a standard Cloud Run service (which health-checks a port). Pick one:

- **Cloud Run Worker Pool** (recommended, GA 2026): no HTTP endpoint, runs the same image with the command overridden, at exactly 1 instance, CPU always allocated. Verify the exact `gcloud run worker-pools deploy` flags against your gcloud version.
- **Compute Engine VM** (`e2-small`) running the image via `docker run` with `--command`: simplest, fully predictable, ~$15/mo.
- Add a tiny `/health` HTTP listener to `apps/workers` so it can run as a normal Cloud Run service `min=max=1`.

Set `RUN_INPROCESS_TIMERS=false` on the worker unless/until the three server timers are extracted into it (Phase 2 below).

### Domains and PR previews

- Custom domains via Cloud Run built-in domain mapping (avoids the ~$18/mo external load balancer). Point `clude.io` and `mcp.clude.io`; mind the existing Cloudflare-vs-host quirk on `mcp.clude.io`.
- PR previews: deploy each PR as a no-traffic tagged revision (`gcloud run deploy --tag pr-NNN --no-traffic`) and post the stable `https://pr-NNN---cluude-server-...run.app` URL for board verification, mirroring the staging to board-approval flow.

### Re-point webhooks (payments break silently if missed)

Update the endpoint URL in the Stripe dashboard and the Helius dashboard (`/webhook/helius/usdc`). Carry `STRIPE_WEBHOOK_SECRET` and `HELIUS_WEBHOOK_SECRET` so the fail-closed verification keeps passing. If you add a GCP WAF / rate limiter, exclude `/webhook/helius/*` (Helius retries burst).

## 4. Database cutover (Supabase to Cloud SQL, layer flag `DB_TARGET`)

The app talks to Supabase via the PostgREST query-builder API at ~600 call sites, so Cloud SQL is fronted by a PostgREST-compatible endpoint (self-hosted Supabase or a PostgREST container). Then `getDb()` only needs a different `(url, key)`, which is exactly what `resolveDbConnection()` + `CLOUDSQL_PGREST_URL` / `CLOUDSQL_SERVICE_KEY` provide. No call-site changes (the B1 path).

1. **Prune first (independent of GCP).** ~94% of the 14GB is benchmark/demo seed. Drop `memories_scale_bench`, delete benchmark/demo wallets, `VACUUM FULL` + `REINDEX`. You then migrate ~1-2GB. Snapshot before you start.
2. **Provision Cloud SQL for PostgreSQL** (Enterprise Plus, PG16, same region as compute). `CREATE EXTENSION vector;` (Cloud SQL ships pgvector 0.8.1, HNSW). Size RAM to hold the vector index.
3. **Recreate schema:** replay the boot DDL + all migrations (including `040`), then create all custom RPC functions. Verify every `.rpc()` name + signature the app calls (a single missing function silently kills recall). Provide an `exec_sql(query text)` function on the target, or set `INIT_DB_MODE` to skip boot DDL and run migrations with a normal tool.
4. **Move data:** post-prune `pg_dump -Fc` then `pg_restore -j`. **Rebuild HNSW indexes after load** (they do not dump usefully; CPU/RAM heavy on ~745K rows). For near-zero downtime evaluate Database Migration Service logical replication, but confirm pgvector version parity or DMS fails the whole job.
5. **Move Storage:** the `cc-images` bucket (2 call sites in `chat.routes.ts`) to a GCS bucket behind a small storage abstraction.
6. **Cut over:** stand up the PostgREST endpoint in front of Cloud SQL, set `CLOUDSQL_PGREST_URL` / `CLOUDSQL_SERVICE_KEY`, then flip `DB_TARGET=cloudsql` on a canary revision. Verify with the recall canary + a LongMemEval repro. **Rollback = flip `DB_TARGET` back to `supabase`** (Supabase stays the source of truth until final sunset).

Cross-cloud note: while compute is on GCP and the DB is still on Supabase-on-AWS, every recall crosses clouds (~20-40ms per round-trip, multiple per request, plus AWS egress). This is the main reason to finish the DB move rather than run split for long.

## 5. Embedding cutover (Voyage to Vertex, layer flag `EMBEDDING_ACTIVE`)

Gated: Vertex ships only if it ties or beats the Voyage LongMemEval 85.0 baseline. Voyage stays the instant rollback.

1. **Apply migration 040** (`embedding_vertex` shadow column + `_vertex` RPCs). Migrations are gitignored and hand-applied in this repo: apply it from `packages/database/migrations/040_vertex_shadow_embeddings.sql` (a tracked, review copy also lives at `docs/gcp-migration/040_vertex_shadow_embeddings.sql`). For a large table, SKIP the in-migration index creation and build the shadow HNSW indexes CONCURRENTLY after the backfill (an index over an all-NULL column is useless).
2. **Enable ingest dual-write:** set `VERTEX_PROJECT` on the server. New memories then write both `embedding` (Voyage) and `embedding_vertex` (Vertex). Zero behavior change to reads.
3. **Backfill the corpus:**
   ```bash
   VERTEX_PROJECT=clude-query-sol-data VERTEX_ACCESS_TOKEN="$(gcloud auth print-access-token)" \
     pnpm exec tsx scripts/backfill-vertex-embeddings.ts
   ```
   Resumable, read-only on the Voyage space.
4. **Build shadow HNSW indexes** CONCURRENTLY once the column is populated (see migration 040 header for the exact statements).
5. **Validate:** run the LongMemEval harness with `EMBEDDING_ACTIVE=vertex`. Only proceed if it ties or beats 85.0.
6. **Cut over:** flip `EMBEDDING_ACTIVE=vertex`. Recall now embeds queries with Vertex and reads `embedding_vertex` via the `_vertex` RPCs. **Rollback = flip back to `voyage`** (the Voyage column and RPCs are untouched).

Note: only the PRIMARY recall lane is space-aware in this slice. Auto-link, the experimental temporal-bonds lane, clinamen, entity-graph, and topic-cache stay on the Voyage space during the parallel run (both columns are populated, so they keep working). Migrate those and drop the Voyage column only after the cutover is proven and permanent.

## 6. Timer-ownership scale-out (Phase 2, optional)

To autoscale the server past 1 instance: extract the three timers from `apps/server/src/bootstrap.ts` (recall canary, marketplace delivery poller, title-mint reconciliation) into the worker, set the server `RUN_INPROCESS_TIMERS=false` and raise `--max-instances`, and keep the worker at exactly 1 instance. Until then the server stays pinned at `min=max=1` (Phase 1), which is the safe default and matches today's behavior.

## 7. Sunset

Once every layer is on GCP and verified over at least one full dream cycle (6h) plus a marketplace delivery poll, decommission Railway. Check custom-domain bindings first: deleting a Railway service with a bound domain causes an immediate outage.
