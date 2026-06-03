// Full-corpus recall sweep over memories_scale_bench (read-only). Runs scale_recall_sweep()
// in id-range batches via one direct connection (statement_timeout=0), so it isn't bound by the
// MCP/pooler query timeout. Accumulates per-category n/hits and prints the authoritative recall@K
// over ALL rows. Touches only the isolated bench table — never prod memories or the live path.
//
// Usage: PG_URL='postgresql://...' WALLET=bench:scale:2m K=8 BATCH=250000 node misc/scripts/scale-recall-sweep.mjs
import { createRequire } from 'module';
const require = createRequire('/tmp/pgcopy/');
const { Client } = require('pg');

const PG_URL = process.env.PG_URL;
const WALLET = process.env.WALLET || 'bench:scale:2m';
const K = Number(process.env.K || 8);
const BATCH = Number(process.env.BATCH || 250000);
if (!PG_URL) { console.error('PG_URL required'); process.exit(1); }

async function main() {
  const c = new Client({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query('SET statement_timeout = 0');
  const { rows: [r] } = await c.query(
    'SELECT min(id) lo, max(id) hi, count(*) n FROM public.memories_scale_bench WHERE owner_wallet=$1', [WALLET]);
  const lo = Number(r.lo), hi = Number(r.hi), total = Number(r.n);
  console.error(`sweep: ${total} facts, ids [${lo}, ${hi}], recall@${K}, batch ${BATCH}`);

  const acc = {};   // category -> {n, hits}
  const t0 = Date.now();
  let done = 0;
  for (let s = lo; s <= hi; s += BATCH) {
    const e = Math.min(s + BATCH - 1, hi);
    const { rows } = await c.query('SELECT category, n, hits FROM public.scale_recall_sweep($1,$2,$3)', [s, e, K]);
    for (const row of rows) {
      const a = acc[row.category] || (acc[row.category] = { n: 0, hits: 0 });
      a.n += Number(row.n); a.hits += Number(row.hits);
    }
    done += (e - s + 1);
    const tot = Object.values(acc).reduce((p, a) => ({ n: p.n + a.n, hits: p.hits + a.hits }), { n: 0, hits: 0 });
    const pct = tot.n ? (100 * tot.hits / tot.n).toFixed(4) : '0';
    console.error(`  ${Math.min(done, total)}/${total} swept | running recall ${pct}% | ${Math.round((Date.now()-t0)/1000)}s`);
  }

  let N = 0, H = 0;
  console.error('\n=== FULL-CORPUS RECALL@' + K + ' ===');
  for (const [cat, a] of Object.entries(acc).sort()) {
    N += a.n; H += a.hits;
    console.error(`  ${cat.padEnd(16)} ${a.hits}/${a.n}  ${(100*a.hits/a.n).toFixed(4)}%  (${a.n - a.hits} misses)`);
  }
  console.error(`  ${'ALL'.padEnd(16)} ${H}/${N}  ${(100*H/N).toFixed(4)}%  (${N - H} misses)`);
  console.error(`done in ${Math.round((Date.now()-t0)/1000)}s`);
  // machine-readable line
  console.log(JSON.stringify({ corpus: N, hits: H, recall: H/N, k: K,
    byCategory: Object.fromEntries(Object.entries(acc).map(([c,a])=>[c,{n:a.n,hits:a.hits,recall:a.hits/a.n}])) }));
  await c.end();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
