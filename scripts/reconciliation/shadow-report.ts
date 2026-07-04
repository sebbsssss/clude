/**
 * Memory 3.0 C1 — SHADOW reconciliation calibration report.
 *
 * Prints the headline numbers from memory_reconciliation_log via Supabase REST count-queries (no
 * exec_sql needed): coverage, trigger rate, the max_cosine histogram for setting LO, the router op
 * split, and THE greenlight metric — false-positive-supersession rate over the labeled sample.
 *
 * Enforce may ship only when >= 200 proposed supersessions are labeled AND the FP rate is < 2%.
 *
 * Run:  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/reconciliation/shadow-report.ts
 *       [--gate-version <gv>]   (default: latest regime)
 *       [--since <ISO date>]    (default: all time)
 *
 * For per-owner budget percentiles + the labeling worklist, use scripts/reconciliation/shadow-analysis.sql.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
config();

const GREENLIGHT_MIN_LABELED = 200;
const GREENLIGHT_MAX_FP_PCT = 2.0;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY.');
  process.exit(1);
}
const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });
const since = arg('--since');

/** COUNT(*) over shadow rows in the chosen regime, with extra filters applied by `build`. */
async function count(gv: string, build: (q: any) => any = (q) => q): Promise<number> {
  let q = db.from('memory_reconciliation_log').select('*', { count: 'exact', head: true })
    .eq('mode', 'shadow').eq('gate_version', gv);
  if (since) q = q.gte('created_at', since);
  const { count: n, error } = await build(q);
  if (error) throw new Error(error.message);
  return n ?? 0;
}

async function resolveGateVersion(): Promise<string | null> {
  const explicit = arg('--gate-version');
  if (explicit) return explicit;
  const { data, error } = await db.from('memory_reconciliation_log')
    .select('gate_version').eq('mode', 'shadow').order('created_at', { ascending: false }).limit(1);
  if (error) {
    if (/could not find the table|does not exist|schema cache/i.test(error.message)) {
      console.log('memory_reconciliation_log not found — apply migration 046, then run shadow (MEMORY_RECONCILE=true) to collect data.');
      process.exit(0);
    }
    throw new Error(error.message);
  }
  return data?.[0]?.gate_version ?? null;
}

function pct(num: number, den: number): string {
  return den === 0 ? 'n/a' : `${((100 * num) / den).toFixed(2)}%`;
}
function bar(n: number, max: number, width = 30): string {
  return '█'.repeat(max === 0 ? 0 : Math.round((n / max) * width));
}

async function main(): Promise<void> {
  const gv = await resolveGateVersion();
  if (!gv) { console.log('No shadow rows found in memory_reconciliation_log yet.'); return; }

  console.log('=== C1 Shadow Reconciliation Report ===');
  console.log(`gate_version: ${gv}`);
  console.log(`window:       ${since ? `since ${since}` : 'all time'}\n`);

  // Coverage
  const [total, skipped, noEmbed, evaluated] = await Promise.all([
    count(gv),
    count(gv, (q) => q.eq('proposed_op', 'skip')),
    count(gv, (q) => q.eq('proposed_op', 'skip').eq('reason', 'no_embedding')),
    count(gv, (q) => q.neq('proposed_op', 'skip')),
  ]);
  console.log('COVERAGE');
  console.log(`  rows: ${total}   evaluated: ${evaluated}   skipped: ${skipped} (no_embedding: ${noEmbed})\n`);

  // Trigger rate
  const withPrior = await count(gv, (q) => q.in('proposed_op', ['needs_router', 'update', 'noop']));
  console.log('TRIGGER RATE (a similar prior fact existed)');
  console.log(`  ${withPrior} / ${evaluated} evaluated = ${pct(withPrior, evaluated)}\n`);

  // Bands
  const bands = await Promise.all(
    (['hi', 'mid', 'lo', 'none'] as const).map((b) => count(gv, (q) => q.eq('band', b)).then((n) => [b, n] as const)),
  );
  console.log('BANDS');
  for (const [b, n] of bands) console.log(`  ${b.padEnd(5)} ${String(n).padStart(7)}`);
  console.log('');

  // max_cosine histogram (LO tuning)
  const edges = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0001];
  const buckets = await Promise.all(
    edges.slice(0, -1).map((lo, i) =>
      count(gv, (q) => q.gte('max_cosine', lo).lt('max_cosine', edges[i + 1])).then((n) => ({ lo, n }))),
  );
  const bmax = Math.max(1, ...buckets.map((b) => b.n));
  console.log('MAX_COSINE HISTOGRAM (find LO at the knee)');
  for (const { lo, n } of buckets) console.log(`  [${lo.toFixed(2)},${(lo + 0.05).toFixed(2)}) ${String(n).padStart(6)} ${bar(n, bmax)}`);
  console.log('');

  // Router
  const routerUsed = await count(gv, (q) => q.eq('router_used', true));
  if (routerUsed > 0) {
    const [rAdd, rUpd, rNoop] = await Promise.all([
      count(gv, (q) => q.eq('router_used', true).eq('proposed_op', 'add')),
      count(gv, (q) => q.eq('router_used', true).eq('proposed_op', 'update')),
      count(gv, (q) => q.eq('router_used', true).eq('proposed_op', 'noop')),
    ]);
    console.log(`ROUTER (routed: ${routerUsed})`);
    console.log(`  add: ${rAdd}   update: ${rUpd}   noop: ${rNoop}\n`);
  } else {
    const needsRouter = await count(gv, (q) => q.eq('proposed_op', 'needs_router'));
    console.log(`ROUTER: off (gate-only). ${needsRouter} rows are needs_router — enable MEMORY_RECONCILE_ROUTER to classify them.\n`);
  }

  // Greenlight
  const [proposedSuper, labeled, falsePos] = await Promise.all([
    count(gv, (q) => q.eq('router_used', true).in('proposed_op', ['update', 'noop'])),
    count(gv, (q) => q.eq('router_used', true).in('proposed_op', ['update', 'noop']).not('label', 'is', null)),
    count(gv, (q) => q.eq('router_used', true).in('proposed_op', ['update', 'noop']).eq('label', 'distinct')),
  ]);
  console.log('*** ENFORCE GREENLIGHT — false-positive supersession ***');
  console.log(`  proposed supersessions: ${proposedSuper}   labeled: ${labeled}   false positives: ${falsePos}`);
  console.log(`  fp rate (labeled): ${pct(falsePos, labeled)}`);
  const fpPct = labeled === 0 ? Infinity : (100 * falsePos) / labeled;
  const verdict =
    labeled < GREENLIGHT_MIN_LABELED
      ? `NOT YET — need ${GREENLIGHT_MIN_LABELED - labeled} more labeled supersessions (have ${labeled}/${GREENLIGHT_MIN_LABELED})`
      : fpPct < GREENLIGHT_MAX_FP_PCT
        ? `GREENLIT — fp ${fpPct.toFixed(2)}% < ${GREENLIGHT_MAX_FP_PCT}% on ${labeled} labeled. Enforce may be built.`
        : `BLOCKED — fp ${fpPct.toFixed(2)}% >= ${GREENLIGHT_MAX_FP_PCT}%. Do NOT enforce; the gate/router is dropping correct facts.`;
  console.log(`  VERDICT: ${verdict}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
