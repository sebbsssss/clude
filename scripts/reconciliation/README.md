# C1 Shadow Reconciliation — calibration tooling

Turns `memory_reconciliation_log` (Memory 3.0 C1, migration 046) into the numbers that gate the
enforce path. Everything reconciliation does today is **shadow**: it records a proposed op, never
mutates a memory. Enforce (actually invalidating stale facts) is only built/enabled once this
tooling shows it is safe.

## Files
- `shadow-analysis.sql` — the full query set (histograms, percentiles, the labeling worklist). Paste
  into the Supabase SQL editor. Each query auto-scopes to the latest gate regime.
- `shadow-report.ts` — the headline report via REST counts. `npx tsx scripts/reconciliation/shadow-report.ts`
  (reads `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` from `.env`). Flags: `--gate-version <gv>`, `--since <ISO>`.

## The workflow

1. **Apply migration 046** (`packages/database/migrations/046_reconciliation_shadow_log.sql`).
2. **Collect gate-only data.** Set `MEMORY_RECONCILE=true` (router still off). Let it run on real
   traffic. Rows accumulate with `proposed_op` ∈ {add, needs_router, skip} and a `max_cosine`.
3. **Set LO.** Run the report (or query C). Read the `max_cosine` histogram: find the knee where
   candidates stop being the-same-fact and become merely same-topic. Set `MEMORY_RECONCILE_LO` there.
   (Remember: same-topic-different-fact pairs sit at high cosine, so the knee is not obvious — this
   is exactly why we measure instead of guessing.) Bump the gate version implicitly by changing the
   threshold (it is stamped into `gate_version`, so old-regime rows won't contaminate the new math).
4. **Turn the router on for a sample.** Set `MEMORY_RECONCILE_ROUTER=true`. Now `needs_router` rows
   become `add`/`update`/`noop` (still shadow). Watch the per-owner budget (query E) so no single
   owner dominates the sample.
5. **Label.** Pull the worklist (query G2). For each proposed supersession (`update`/`noop`), a human
   reads the **full content of BOTH** the new memory and its target — not just the summary the router
   saw — and labels it:
   - `duplicate` — the two really are the same fact (a correct `noop`).
   - `update` — the new one really does supersede the target (a correct `update`).
   - `distinct` — they are different facts; the router was **wrong** (a false-positive supersession).

   ```sql
   UPDATE memory_reconciliation_log
      SET label = 'distinct', labeled_at = now()   -- or 'duplicate' / 'update'
    WHERE id = <log_id>;
   ```
6. **Read the greenlight** (query F / the report verdict). Enforce may be built and turned on ONLY
   when, within one gate regime:
   - **>= 200** proposed supersessions are labeled, AND
   - the **false-positive rate < 2%** (`label = 'distinct'` over all labeled `update`/`noop`).

   Below 2% means the gate+router rarely proposes dropping a correct fact — safe to make it real.
   At or above 2%, enforce would drop correct facts (itself hallucination-inducing): do NOT ship it;
   raise LO, improve the router (e.g. give it content, not just summaries), and re-measure.

## Why the labeler must see content

The router (slice 1.5) sees candidate **summaries + event_date**, not decrypted content. Two facts
with identical summaries but different content ("flight booking" / departs 15:00 vs 17:00) can be
wrongly judged `noop`. The labeler reading full content catches exactly these — so the false-positive
rate honestly reflects the router's blind spot. If that blind spot is what blocks the greenlight, the
fix is a later slice that feeds content to the router, then re-run from step 4.
