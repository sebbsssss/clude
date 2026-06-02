// Phase 1: pull real Solana blocks from Helius and emit distinct facts as JSONL.
// Each fact: { category, question, gold, sourceRef } — same shape the existing grader
// (solana-grading.ts) + recall harness understand, so nothing downstream changes.
//
// Throughput: one getBlock ≈ 2,800 facts, so N facts ≈ N/2800 block calls.
// Usage:
//   TARGET=100000 OUT=/tmp/facts-100k.jsonl node misc/scripts/generate-solana-facts.mjs
//   TARGET=5000000 OUT=/tmp/facts-5m.jsonl CONCURRENCY=12 node misc/scripts/generate-solana-facts.mjs
import fs from 'fs';

const HK = fs.readFileSync('/Users/sebastien/Projects/cluude-bot/.env','utf8')
  .split('\n').find(l=>l.startsWith('HELIUS_API_KEY=')).split('=').slice(1).join('=').trim().replace(/^["']|["']$/g,'');
const URL = `https://mainnet.helius-rpc.com/?api-key=${HK}`;

const TARGET = Number(process.env.TARGET || 100000);
const OUT = process.env.OUT || '/tmp/facts.jsonl';
const CONCURRENCY = Number(process.env.CONCURRENCY || 8);
const START_SLOT = Number(process.env.START_SLOT || 0); // 0 = derive from current finalized

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function rpc(method, params, attempts = 6) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(URL, { method:'POST', headers:{'content-type':'application/json'},
        body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params }) });
      if (res.status === 429) { await sleep(1000 * (i+1)); continue; }
      const j = await res.json();
      if (j.error) {
        // skipped/missing slots are normal on Solana — signal caller to skip
        if (String(j.error.message||'').match(/skipped|not available|was skipped|Block not available/i)) return null;
        await sleep(500 * (i+1)); continue;
      }
      return j.result;
    } catch { await sleep(800 * (i+1)); }
  }
  return null;
}

// Extract all facts from one block. Returns array of {category, question, gold, sourceRef}.
function blockToFacts(slot, b) {
  const out = [];
  if (!b) return out;
  if (b.blockTime != null) {
    out.push({ category:'block_time', sourceRef:`block:${slot}`, gold:new Date(b.blockTime*1000).toISOString().replace('.000',''),
      question:`What was the block time (UTC) of Solana slot ${slot}?` });
  }
  const leader = b.rewards ? (b.rewards.find(x=>x.rewardType==='Fee')?.pubkey || b.rewards[0]?.pubkey) : null;
  if (leader) out.push({ category:'block_leader', sourceRef:`block:${slot}`, gold:leader,
    question:`Which validator led Solana slot ${slot}?` });
  const txs = b.transactions || [];
  out.push({ category:'block_txcount', sourceRef:`block:${slot}`, gold:String(txs.length),
    question:`How many transactions were in Solana slot ${slot}?` });
  for (const t of txs) {
    const sig = (t.transaction?.signatures||[])[0];
    if (!sig) continue;
    if (t.meta?.fee != null) out.push({ category:'tx_fee', sourceRef:`tx:${sig}`, gold:String(t.meta.fee),
      question:`What fee in lamports did Solana transaction ${sig} pay?` });
    out.push({ category:'tx_status', sourceRef:`tx:${sig}`, gold: t.meta?.err===null ? 'Success' : 'Fail',
      question:`Did Solana transaction ${sig} succeed or fail?` });
  }
  return out;
}

async function getBlock(slot) {
  return rpc('getBlock', [slot, { encoding:'json', maxSupportedTransactionVersion:0, transactionDetails:'full', rewards:true }]);
}

async function main() {
  let startSlot = START_SLOT;
  if (!startSlot) {
    const cur = await rpc('getSlot', [{ commitment:'finalized' }]);
    startSlot = cur - 200; // a little behind the tip for availability
  }
  console.error(`Target ${TARGET} facts, start slot ${startSlot}, concurrency ${CONCURRENCY} -> ${OUT}`);

  const stream = fs.createWriteStream(OUT);
  const seen = new Set(); // dedup by sourceRef::category
  let written = 0, slot = startSlot, blocks = 0, t0 = Date.now();

  while (written < TARGET) {
    // Fetch a window of slots concurrently
    const slots = [];
    for (let k = 0; k < CONCURRENCY; k++) slots.push(slot--);
    const results = await Promise.all(slots.map(s => getBlock(s).then(b => ({ s, b }))));
    for (const { s, b } of results) {
      if (!b) continue;
      blocks++;
      for (const f of blockToFacts(s, b)) {
        const key = f.sourceRef + '::' + f.category;
        if (seen.has(key)) continue;
        seen.add(key);
        stream.write(JSON.stringify({ id:key, ...f }) + '\n');
        if (++written >= TARGET) break;
      }
      if (written >= TARGET) break;
    }
    if (blocks % 40 === 0 || written >= TARGET) {
      const rate = Math.round(written / ((Date.now()-t0)/1000));
      console.error(`  ${written}/${TARGET} facts | ${blocks} blocks | ${rate} facts/s`);
    }
  }
  await new Promise(r => stream.end(r));
  console.error(`DONE: ${written} facts from ${blocks} blocks in ${Math.round((Date.now()-t0)/1000)}s -> ${OUT}`);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
