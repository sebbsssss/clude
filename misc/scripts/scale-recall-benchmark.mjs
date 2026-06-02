// Phase 4: measure retrieval accuracy + latency over the ISOLATED memories_scale_bench
// table (millions of near-identical Solana facts). Self-contained hybrid recall (vector +
// BM25 over the scale_* RPCs) so it never touches prod recall or the prod `memories` table.
//
// For each sampled fact: ask its question, recall top-K, check whether the EXACT correct
// fact (matching source_ref + category) is recalled, and at what rank. Records p50/p95
// recall latency. This is the "needle in a sea of N" proof.
//
// Usage:
//   WALLET=bench:scale:v1 SAMPLE=500 K=8 BM25_WEIGHT=3 node --import tsx misc/scripts/scale-recall-benchmark.mjs
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/sebastien/Projects/cluude-bot/.env', override: true });
process.env.EMBEDDING_PROVIDER = 'voyage';
process.env.EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || process.env.VOYAGE_API_KEY || '';
process.env.EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'voyage-4-large';

const { getDb } = await import('@clude/shared/core/database');
const { generateEmbeddings } = await import('@clude/shared/core/embeddings');

const WALLET = process.env.WALLET || 'bench:scale:v1';
const SAMPLE = Number(process.env.SAMPLE || 500);
const K = Number(process.env.K || 8);
const BM25_WEIGHT = Number(process.env.BM25_WEIGHT || 3);
const VECTOR_WEIGHT = Number(process.env.VECTOR_WEIGHT || 4);
const db = getDb();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function retry(fn, n = 6) {
  for (let i = 0; i < n; i++) { try { return await fn(); } catch (e) { await sleep(1000 * (i+1)); } }
  return null;
}

// Reconstruct the question for a fact row from its category + source_ref (mirror of the generator).
function questionFor(row) {
  const ref = (row.source_ref || '').replace(/::.*$/, ''); // strip the ::category suffix from id
  const slot = ref.replace(/^block:/, '');
  const sig = ref.replace(/^tx:/, '');
  switch (row.category) {
    case 'block_time': return `What was the block time (UTC) of Solana slot ${slot}?`;
    case 'block_leader': return `Which validator led Solana slot ${slot}?`;
    case 'block_txcount': return `How many transactions were in Solana slot ${slot}?`;
    case 'tx_fee': return `What fee in lamports did Solana transaction ${sig} pay?`;
    case 'tx_status': return `Did Solana transaction ${sig} succeed or fail?`;
    default: return row.summary; // fallback
  }
}

// Hybrid recall over the bench table: vector (scale_match) + bm25 (scale_bm25), merged by
// weighted score. Returns ordered candidate ids. Mirrors the prod scoring intuition:
// vectorWeight*vsim + bm25Weight*rank, so an exact lexical match outranks a near-vector sibling.
async function hybridRecall(qEmb, qText) {
  const [vec, bm] = await Promise.all([
    retry(() => db.rpc('scale_match', { query_embedding: JSON.stringify(qEmb), match_threshold: 0.15, match_count: K * 6, filter_owner: WALLET }).then(r => r.data || [])),
    retry(() => db.rpc('scale_bm25', { search_query: qText, match_count: K * 6, filter_owner: WALLET }).then(r => r.data || [])),
  ]);
  const score = new Map();
  for (const r of (vec || [])) score.set(r.id, (score.get(r.id) || 0) + VECTOR_WEIGHT * r.similarity);
  for (const r of (bm || [])) score.set(r.id, (score.get(r.id) || 0) + BM25_WEIGHT * Math.min(r.rank, 1));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, K).map(([id]) => id);
}

async function main() {
  // Corpus size
  const { count: total } = await db.from('memories_scale_bench').select('id', { count: 'exact', head: true }).eq('owner_wallet', WALLET);
  console.log(`Scale recall benchmark: wallet ${WALLET}, corpus ${total} facts, sampling ${SAMPLE}, top-K ${K}`);

  // Sample facts evenly across categories. Pull a spread by id range.
  const { data: cats } = await db.from('memories_scale_bench').select('category').eq('owner_wallet', WALLET).limit(2000);
  const catSet = [...new Set((cats || []).map(c => c.category))];
  const perCat = Math.max(1, Math.floor(SAMPLE / Math.max(1, catSet.length)));
  let sample = [];
  for (const cat of catSet) {
    // random-ish offset by ordering on id with a pseudo-random gate via modulo on id
    const { data } = await db.from('memories_scale_bench')
      .select('id, source_ref, category, gold, summary').eq('owner_wallet', WALLET).eq('category', cat).limit(perCat);
    if (data) sample.push(...data);
  }
  console.log(`Sampled ${sample.length} facts across ${catSet.length} categories`);

  const lat = [];
  const byCat = {};
  let hit = 0;
  for (let i = 0; i < sample.length; i++) {
    const row = sample[i];
    const q = questionFor(row);
    const qEmb = (await generateEmbeddings([q]))[0];
    if (!qEmb) continue;
    const t0 = process.hrtime.bigint();
    const ids = await hybridRecall(qEmb, q);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    lat.push(ms);
    const rank = ids.indexOf(row.id);
    const ok = rank >= 0 && rank < K;
    if (ok) hit++;
    const c = byCat[row.category] || (byCat[row.category] = { n: 0, hit: 0, rankSum: 0 });
    c.n++; if (ok) { c.hit++; c.rankSum += rank; }
    if ((i + 1) % 50 === 0) process.stdout.write(`\r  ${i+1}/${sample.length} | recall@${K} ${(hit/(i+1)*100).toFixed(1)}%`);
  }
  console.log();

  lat.sort((a, b) => a - b);
  const p = (q) => lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * q))].toFixed(0) : '0';
  console.log('\n=== SCALE RECALL RESULTS ===');
  console.log(`  Corpus:          ${total} facts`);
  console.log(`  Sample:          ${sample.length}`);
  console.log(`  Recall@${K}:        ${(hit / sample.length * 100).toFixed(1)}%  (exact fact in top-${K})`);
  console.log(`  Latency p50/p95: ${p(0.5)}ms / ${p(0.95)}ms`);
  console.log('  Per-category recall@'+K+':');
  for (const [cat, c] of Object.entries(byCat)) {
    console.log(`    ${cat.padEnd(16)} ${(c.hit/c.n*100).toFixed(0)}%  (avg rank ${c.hit? (c.rankSum/c.hit).toFixed(1):'-'}, n=${c.n})`);
  }
  // Write a result file for the report
  const out = {
    corpus: total, sample: sample.length, recallAtK: hit / sample.length, k: K,
    latencyP50: Number(p(0.5)), latencyP95: Number(p(0.95)),
    byCategory: Object.fromEntries(Object.entries(byCat).map(([k, c]) => [k, { recall: c.hit/c.n, n: c.n }])),
    runAt: new Date().toISOString(), wallet: WALLET,
  };
  const fs = await import('fs');
  fs.writeFileSync('/tmp/scale-recall-result.json', JSON.stringify(out, null, 2));
  console.log('\n  Result written to /tmp/scale-recall-result.json');
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
