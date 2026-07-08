# Moving the Clude stack to GCP: analysis and plan

_Analysis date: 2026-07-04. Based on a read of the actual repo (deploy config, Dockerfile, integration call sites) plus per-component GCP mapping and an adversarial review._

## TL;DR (the honest verdict)

- **Compute-only move: moderate, ~3/5.** A few days of infra plumbing. No application rewrite. The Dockerfile already runs on Cloud Run unchanged.
- **Full move including the database: hard, ~4/5, multi-week.** The database is the _only_ genuinely hard part. Everything else is easy.
- **It will not save money.** Railway is roughly $20 to $40/mo flat. GCP compute-only lands around $60 to $120/mo, or $300 to $550/mo if you also move the DB to Cloud SQL. This is a control / consolidation / credits move, not a savings move.
- **Recommendation:** if you have a real GCP reason (Vertex credits, procurement, single-cloud consolidation), do **Path A** (compute to Cloud Run, keep everything else) now and defer the database. If the only driver is cost or developer experience, **stay on Railway**, this move makes both worse.

## The one insight that decides everything

Your dependencies split into two classes:

1. **Hosting-agnostic HTTP APIs (easy).** These are just an endpoint plus an API key. Moving compute to GCP does not touch them at all: carry the key into Secret Manager and you are done. This covers: **Voyage** ("Voyager", embeddings + reranker), **Anthropic**, **OpenRouter**, **Privy** (JWT verify), **Stripe**, **Helius / Solana RPC**, **Tavily**, **Telegram**, **X**, and **Modal** (your training loop is plain Python, portable).

2. **Stateful infrastructure (hard).** Exactly one thing: **Supabase**. And it is deeply wired in.

So "move my whole stack to GCP" is really two very different projects: a small compute move, and a separate, large database migration. Keeping them separate is the key to not making a mess.

## What your stack actually is (from the code, not memory)

- **One Docker image on Railway.** The container `CMD` runs only the server: `node apps/server/dist/index.js`.
- **The server is a monolith.** One Express app serves the JSON API, all three frontends as static files (`apps/web` landing, the `chat` SPA at `/chat`, the `dashboard` SPA at `/dashboard`), MCP + OAuth discovery, and the Stripe / Helius webhooks. It reads `process.env.PORT` and exposes `/health`.
- **The server also runs three in-process timers** from `apps/server/src/bootstrap.ts`: the recall canary (hourly), the marketplace delivery poller, and the Base title-mint reconciliation poller. These assume exactly one long-lived instance.
- **A second process exists: `apps/workers`.** It is the autonomous bot (dream cycle every 6h, X mention poller, mood tweeter, price oracle, sentiment monitor, task executor). It is built into the same image but is **not** the container command, so on Railway it runs as a separate service off the same image. It has its own graceful SIGTERM handling.
- **Frontends are pure Vite static SPAs**, built at Docker-build time and baked into the image. `apps/web` is 24 hand-written HTML files, no build step.
- **Node 22, pnpm monorepo, native deps** (`better-sqlite3`, `keccak`, `sharp`) that need `python3 / make / g++` in the build stage. This repo has a documented history of Docker builds that pass locally and in GitHub CI but fail the container build, and a failed deploy stays silent (health stays 200).
- **Supabase is used as three products:** Postgres via the PostgREST query builder (roughly 600 `.from()` and `.rpc()` call sites, `memories` alone has 113), 18 custom SQL RPC functions, and one Storage bucket (`cc-images`, 2 call sites). Plus pgvector with HNSW indexes for recall, 39 migrations, and a privileged `exec_sql` boot path. There is **no** Supabase Auth, **no** database RLS (owner scoping is app-level `.eq('owner_wallet')`), and **no** Realtime. That narrows the lock-in surface, but the PostgREST coupling is broad.
- **No Modal or GPU code in this repo.** The only Python file is a benchmark script. Your Modal fine-tuning is the separate CludeMem project, so it is not part of migrating _this_ stack.

## Component matrix

| Component | Current | GCP target | Complexity | Verdict | $/mo direction |
|---|---|---|---|---|---|
| App server (monolith) | Railway (Docker) | Cloud Run, min=1, CPU always | 3 | move | up |
| Worker process (bot) | Railway 2nd service | Cloud Run Worker Pool, 1 instance | 3 | move | included |
| Static SPAs | Baked in image | Keep baked (phase 1); GCS+CDN later | 2 | move | egress cost if kept in container |
| **Database (Supabase)** | Supabase Cloud (on AWS) | Cloud SQL PG16 + pgvector, or keep Supabase | **5** | defer | up a lot |
| Storage bucket `cc-images` | Supabase Storage | GCS bucket | 1 | move | negligible |
| Embeddings + reranker | Voyage AI | **Keep Voyage** | 1 | keep | $0 |
| LLM inference | Anthropic / OpenRouter | **Keep** | 1 | keep | $0 |
| Auth (JWT verify) | Privy | **Keep** | 1 | keep | $0 |
| Payments | Stripe | **Keep**, re-point webhook | 1 | keep | $0 |
| Solana RPC + payment webhook | Helius | **Keep**, re-point webhook | 1 | keep | $0 |
| Web search / Telegram / X | Tavily / Telegram / X | **Keep** | 1 | keep | $0 |
| ML fine-tuning (CludeMem) | Modal (separate project) | **Keep Modal**; GCS/BigQuery for data only | 2 | keep | ~$0 |
| Secrets (~20) | Railway env | Secret Manager | 2 | move | ~$1 |
| Build | Railway builder | Cloud Build + Artifact Registry | 2 | move | build minutes + storage |

## The things that will actually bite you

These are the traps the adversarial review flagged. They matter more than the happy-path steps.

1. **Single-instance assumptions (the real hidden work).** The three `bootstrap.ts` timers _and_ the entire `apps/workers` loop assume exactly one long-lived process. On Cloud Run with scale-to-zero they never fire (payments and deliveries silently stall). With more than one instance they fire N times (duplicate tweets, dreams, deliveries, mints). You must either pin the server to `min=max=1` or extract those three timers into the worker before you scale. This is a code change, not an infra toggle, and Railway's single-instance model currently hides the bug.

2. **`PRIVY_APP_ID` is a build-time bake, not a runtime env.** It is compiled into the chat and dashboard Vite bundles at `vite build` (`Dockerfile:56-57` to `VITE_PRIVY_APP_ID`). On GCP it must be a Cloud Build `--build-arg`, not a Cloud Run runtime env. Get this wrong and the SPAs ship with an undefined Privy app id, browser login silently breaks, and `/health` stays green so nothing alerts.

3. **Native Docker build fragility.** The multi-stage build compiles `better-sqlite3`, `keccak`, `sharp`. Cloud Build's environment differs subtly from local Docker. Given this repo's history of silent build failures, budget real iteration on the build stage and add a post-deploy smoke check (probe a new route, grep the bundle) rather than trusting a 200 on `/health`.

4. **The cross-cloud database tax (only in Path A).** If compute moves to GCP but Supabase stays on AWS, every recall crosses clouds. The 6-phase recall pipeline makes multiple `.rpc()` round-trips per request, so at ~20 to 40ms RTT each you add hundreds of ms per recall to the core product path, plus AWS egress billed per GB on every response. Path A is low code risk but this latency is a permanent tax. Mitigate by co-locating Supabase's region against your GCP region, or accept it as temporary until Path B.

5. **`exec_sql` + `INIT_DB_MODE` boot blocker (only in Path B).** `initDatabase()` calls a privileged `exec_sql` RPC that does not exist on raw Cloud SQL, and the DDL grants to a `service_role` that does not exist there either. If boot DDL runs and that RPC is missing, startup fails hard on the first fresh clone. Treat RPC and boot parity as a gated, tested step.

6. **Cost surprise.** Two always-on Cloud Run units (server min=1 plus a worker at 1 instance, both CPU-always-allocated) are billed 24/7 whether requests arrive or not. This is the well-known Cloud Run min-instances budget trap. Expect the bill to go up, not down.

## About each thing you named

- **Railway → Cloud Run.** This is the main work, and it is plumbing, not re-architecture. Two Cloud Run services from one image: the server (HTTP, min=1, CPU always), and the workers (Worker Pool or min=max=1, command overridden to `node apps/workers/dist/index.js`, no HTTP). GKE Autopilot is the alternative if your service count grows, but it is overkill for two processes today.
- **Voyage ("Voyager") → keep it.** It is a pluggable HTTP client keyed by `EMBEDDING_API_KEY`. Zero changes. Do **not** switch to Vertex embeddings as part of this: any model or dimension change forces re-embedding ~745K memories plus fragments and rebuilding the HNSW index, a one-time cost that dwarfs any monthly saving. Only consider it if you hold large Vertex credits.
- **Modal → keep it, and note it is not in this repo.** Your CludeMem QLoRA fine-tune is plain Python with pinned images, fully portable, and bills per-second with no idle charge. GCP's whole-job-lifetime Vertex billing is worse for bursty short runs. Where GCP genuinely helps is the data plane: put training data and adapters in GCS, use BigQuery for corpus curation, push images to Artifact Registry, and (only at sustained daily-plus run volume) GKE + Spot L4 with a self-hosted permitted teacher model. QLoRA on Gemma fits an L4, so the old "zero A100/H100 quota" worry does not apply here.
- **Helius / Solana RPC → keep it.** It is a managed SaaS endpoint, not a GCP-relocatable component. On GCP it stays an outbound HTTPS call plus a re-pointed inbound webhook URL. The RPC code is generic JSON-RPC, so you could swap to any provider by changing one URL. Self-hosting a Solana validator on Compute Engine is a cost trap (512GB to 1TB RAM, multi-TB NVMe, and egress that can be 10 to 100x the Helius bill). Do not.

## Path A: lift-and-shift compute (recommended)

Move only compute to Cloud Run. Keep Supabase, Helius, Voyage, Anthropic, Stripe, Privy, and Modal exactly where they are. This captures most of any GCP-native benefit at a fraction of the risk and touches zero application logic.

1. Provision the GCP project. Enable Cloud Run, Cloud Build, Artifact Registry, Secret Manager. Create an Artifact Registry Docker repo.
2. Port ~20 secrets into Secret Manager: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `EMBEDDING_API_KEY` (plus query variant), `TAVILY_API_KEY`, `TELEGRAM_BOT_TOKEN`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `HELIUS_WEBHOOK_SECRET`, `HELIUS_RPC_URL`, `PRIVY_APP_SECRET`, `PRIVY_JWKS_URL`, `BOT_WALLET_PRIVATE_KEY` (this is the live treasury key, tightest IAM, and rotate any secret that has transited chat), `CLUUDE_TOKEN_MINT`, and the five `X_*` keys. Grant the runtime service account `secretAccessor`.
3. Write a Cloud Build config that builds the existing Dockerfile. Pass `PRIVY_APP_ID` as a `--build-arg` substitution, not a runtime env. Iterate on the native build stage. Push the image to Artifact Registry.
4. **Fix the singleton problem first.** Extract the three `bootstrap.ts` timers into the workers process, or pin the server to `max-instances=1` as an interim safety.
5. Deploy the server: `gcloud run deploy cluude-server`, port 3000, `--min-instances=1 --no-cpu-throttling`, 1 vCPU / 1 GiB, `/health` as startup and liveness probe. Verify `/api`, the MCP `.well-known`, and the `/chat` and `/dashboard` SPAs all serve.
6. Deploy the workers as a Cloud Run Worker Pool from the same image, command overridden to `node apps/workers/dist/index.js`, exactly 1 instance, CPU always on, no HTTP endpoint. Confirm the existing SIGTERM shutdown fires.
7. Re-point inbound webhooks to the new Cloud Run URL: Stripe (in the Stripe dashboard) and Helius `/webhook/helius/usdc` (in the Helius dashboard). Carry both webhook secrets so the fail-closed verification keeps passing. If you add any GCP WAF or rate limiter in front, exclude `/webhook/helius/*`.
8. Map custom domains via Cloud Run built-in domain mapping (avoids the ~$18/mo external Load Balancer). Point `clude.io` and `mcp.clude.io` DNS. Mind the existing Cloudflare-vs-host quirk on `mcp.clude.io`.
9. Replace Railway PR previews with Cloud Run revision tags: CI deploys each PR as `--tag pr-NNN --no-traffic` and posts the stable tagged URL for board verification (mirrors the staging to board-approval flow).
10. Cut over DNS. Monitor one full dream cycle (6h) plus a delivery poll to confirm the timers fire exactly once. Then decommission Railway, checking custom-domain bindings first, because deleting a Railway service with a bound domain causes an immediate outage.

Result: the app is on GCP, the database is still on Supabase. You accept the cross-cloud latency and egress tax on the recall path (see trap 4).

## Path B: full migration including the database (defer until needed)

Everything in Path A, plus the database. Only do this if the Path A cross-cloud latency becomes intolerable, or a data-residency / consolidation mandate forces the DB in-cloud.

0. **Prune first, independent of GCP.** Roughly 94% of the 14GB is benchmark and demo seed. Drop `memories_scale_bench`, delete benchmark and demo wallets, `VACUUM FULL` and `REINDEX`. You then migrate ~1 to 2GB instead of 14GB: smaller instance, faster restore, less egress. Snapshot before you start.
1. **Decision gate, pick the seam.** (B1) Keep the `getDb()` PostgREST API by running self-hosted Supabase OSS or a PostgREST sidecar in front of Cloud SQL, so the ~600 call sites stay unchanged and you operate one extra component. (B2) Raw Cloud SQL plus rewrite ~600 call sites onto node-postgres or Kysely, the cleanest long-term but multi-week with real regression risk on the recall, encryption, and entitlement paths. **Recommend B1.**
2. Provision Cloud SQL for PostgreSQL (Enterprise Plus, PG16, same region as compute). `CREATE EXTENSION vector;` (Cloud SQL ships pgvector 0.8.1 with HNSW). Size RAM to hold the vector index in memory. AlloyDB is not warranted at this scale.
3. Recreate the schema: replay the boot DDL plus all 39 migrations, then create all 18 RPC functions (`match_memories_temporal`, `bm25_search_memories`, `get_entity_cooccurrence`, `exec_sql`, and the rest). Verify every `.rpc()` name and signature the code calls. A single missing function silently kills recall, this codebase has been bitten by exactly that.
4. Move the data: post-prune `pg_dump -Fc` then `pg_restore -j`. **Rebuild the HNSW indexes after load**, they do not dump usefully and the rebuild is CPU and RAM heavy on 745K rows. For near-zero downtime, evaluate Database Migration Service logical replication, but confirm pgvector version parity or DMS fails the whole job.
5. Rewire the boot path in `packages/shared/src/core/database.ts`: create an `exec_sql(query text)` function on the target, or set `INIT_DB_MODE` to skip boot DDL and run migrations via a normal tool.
6. Move Storage: create a GCS bucket, add a tiny storage abstraction, swap the 2 `cc-images` call sites in `chat.routes.ts`.
7. Change the connection env (B1) or swap the client at the `getDb()` seam (B2). Carry the new connection secret into Secret Manager.
8. Cut over: run source and target in sync (DMS) or take a maintenance window. Verify row counts and **run the LongMemEval harness (85.0% fresh baseline) as the quality gate** to confirm vector recall returns identical top-k and owner scoping still isolates tenants. Flip the env, drain, re-point webhooks.

## Should you even do this?

**Reasons that justify it:** Vertex or Gemini credits you already hold that offset the higher compute bill; a plan to run CludeMem training at daily-plus cadence where in-VPC Spot GPUs beat per-token APIs; a consolidation, data-residency, or enterprise-procurement requirement (one cloud, one IAM model, one audit boundary). That last one is the real strategic reason, not cost.

**Reasons to stay on Railway:** cost (GCP is 2 to 4x more here at this scale, there are no savings on the table); developer experience (Railway already does the two-services-one-image pattern and PR previews with far less overhead); and the fact that the migration forces you to fix latent single-instance bugs that Railway currently hides, work you would be doing to enable GCP, not because the product needs it.

**Bottom line:** the honest migration is "move compute to GCP, keep the managed data / RPC / inference APIs where they are." Scope the Supabase migration out of phase 1 as a separate, deliberate project. Do not bundle a database move, an embeddings switch, and a nonexistent Modal migration into "the GCP move."
