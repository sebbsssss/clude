// Phase 2: read facts JSONL, batch-embed (Voyage), bulk-insert into the ISOLATED
// memories_scale_bench table with embedding + content_tokens populated.
// Resumable: skips facts whose (owner_wallet, source_ref+category content) already exist.
//
// Usage:
//   IN=/tmp/facts-100k.jsonl WALLET=bench:scale:v1 node --import tsx misc/scripts/bulk-seed-facts.mjs
//   IN=/tmp/facts-5m.jsonl WALLET=bench:scale:v1 BATCH=512 CONCURRENCY=8 node --import tsx misc/scripts/bulk-seed-facts.mjs
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/sebastien/Projects/cluude-bot/.env', override: true });
process.env.EMBEDDING_PROVIDER = 'voyage';
process.env.EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || process.env.VOYAGE_API_KEY || '';
process.env.EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'voyage-4-large';

import fs from 'fs';
import readline from 'readline';
const { getDb } = await import('@clude/shared/core/database');
const { generateEmbeddings } = await import('@clude/shared/core/embeddings');

const IN = process.env.IN || '/tmp/facts.jsonl';
const WALLET = process.env.WALLET || 'bench:scale:v1';
const EMBED_BATCH = Number(process.env.BATCH || 256);   // Voyage texts per call
const INSERT_BATCH = Number(process.env.INSERT_BATCH || 500);
const CONCURRENCY = Number(process.env.CONCURRENCY || 6); // parallel embed+insert workers
const db = getDb();

// Build the searchable content string from a fact (the statement form, like the existing benchmark).
function factToContent(f) {
  switch (f.category) {
    case 'block_time': return `Solana block slot ${f.sourceRef.replace('block:','')} had a block time of ${f.gold} UTC.`;
    case 'block_leader': return `The validator ${f.gold} led Solana slot ${f.sourceRef.replace('block:','')}.`;
    case 'block_txcount': return `Solana slot ${f.sourceRef.replace('block:','')} contained ${f.gold} transactions.`;
    case 'tx_fee': return `Solana transaction ${f.sourceRef.replace('tx:','')} paid a fee of ${f.gold} lamports.`;
    case 'tx_status': return `Solana transaction ${f.sourceRef.replace('tx:','')} had a status of ${f.gold}.`;
    default: return `${f.question} ${f.gold}`;
  }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function flush(rows, attempts = 8) {
  if (rows.length === 0) return 0;
  // content_tokens is a GENERATED column (computed from content on insert) — no per-row
  // RPC needed. One bulk upsert populates embedding + content_tokens together.
  // Retried with backoff so a transient 'fetch failed' never silently drops rows
  // during the long unattended run. ON CONFLICT ignore makes retries idempotent.
  const payload = rows.map(r => ({
    owner_wallet: WALLET,
    source_ref: r.id,
    category: r.category,
    content: r.content,
    summary: r.content,
    gold: r.gold,
    embedding: r.embedding ? JSON.stringify(r.embedding) : null,
    decay_factor: 1.0,
  }));
  for (let i = 0; i < attempts; i++) {
    try {
      const { error, count } = await db.from('memories_scale_bench')
        .upsert(payload, { onConflict: 'owner_wallet,source_ref', ignoreDuplicates: true, count: 'exact' });
      if (!error) return count ?? payload.length;
      console.error(`  [insert retry ${i+1}/${attempts}] ${error.message}`);
    } catch (e) {
      console.error(`  [insert retry ${i+1}/${attempts}] ${e.message}`);
    }
    await sleep(Math.min(2000 * Math.pow(2, i), 30000));
  }
  console.error('  INSERT GAVE UP on a chunk of', payload.length, '(will be picked up on resume)');
  return 0;
}

// Resume: load source_refs already seeded for this wallet so we skip them. Paginated
// (REST caps at 1000/select) since the set can be millions.
async function loadSeeded() {
  const seen = new Set();
  let from = 0;
  for (;;) {
    const { data, error } = await db.from('memories_scale_bench')
      .select('source_ref').eq('owner_wallet', WALLET).range(from, from + 999);
    if (error) { console.error('  resume load error:', error.message); break; }
    if (!data || data.length === 0) break;
    for (const r of data) seen.add(r.source_ref);
    if (data.length < 1000) break;
    from += 1000;
  }
  return seen;
}

// Embed (with retry on null) + insert one chunk. Self-contained worker unit.
async function embedAndInsert(chunk) {
  const contents = chunk.map(factToContent);
  let embs = await generateEmbeddings(contents);
  // Retry any nulls (transient Voyage failures) so rows aren't seeded without vectors.
  for (let attempt = 0; attempt < 4 && embs.some(e => e === null); attempt++) {
    await sleep(1500 * (attempt + 1));
    const missingIdx = embs.map((e, i) => e === null ? i : -1).filter(i => i >= 0);
    const retry = await generateEmbeddings(missingIdx.map(i => contents[i]));
    missingIdx.forEach((idx, k) => { if (retry[k]) embs[idx] = retry[k]; });
  }
  const rows = chunk.map((f, i) => ({ ...f, content: contents[i], embedding: embs[i] }));
  let n = 0;
  for (let i = 0; i < rows.length; i += INSERT_BATCH) n += await flush(rows.slice(i, i + INSERT_BATCH));
  return n;
}

async function main() {
  console.error(`Seeding ${IN} -> memories_scale_bench (wallet ${WALLET}), embed batch ${EMBED_BATCH}, concurrency ${CONCURRENCY}`);
  const resume = process.env.RESUME === '1';
  const alreadySeeded = resume ? await loadSeeded() : new Set();
  if (resume) console.error(`  resume: ${alreadySeeded.size} facts already seeded, skipping those`);
  const rl = readline.createInterface({ input: fs.createReadStream(IN), crlfDelay: Infinity });
  let seeded = 0, read = 0, skip = 0, t0 = Date.now();

  // Pool of CONCURRENCY in-flight embed+insert chunks. Refill as each completes.
  let chunk = [];
  const inflight = new Set();
  const launch = (c) => {
    const p = embedAndInsert(c).then(n => {
      seeded += n; inflight.delete(p);
      const rate = Math.round(seeded / ((Date.now()-t0)/1000));
      if (seeded % (EMBED_BATCH * CONCURRENCY) < EMBED_BATCH) console.error(`  read ${read} | seeded ${seeded} | ${rate}/s`);
    }).catch(e => { inflight.delete(p); console.error('  chunk failed:', e.message); });
    inflight.add(p);
  };

  for await (const line of rl) {
    if (!line.trim()) continue;
    const f = JSON.parse(line); read++;
    if (alreadySeeded.has(f.id)) { skip++; continue; }
    chunk.push(f);
    if (chunk.length >= EMBED_BATCH) {
      launch(chunk); chunk = [];
      if (inflight.size >= CONCURRENCY) await Promise.race(inflight);
    }
  }
  if (chunk.length) launch(chunk);
  await Promise.all(inflight);
  console.error(`DONE: seeded ${seeded} of ${read} read in ${Math.round((Date.now()-t0)/1000)}s (${Math.round(seeded/((Date.now()-t0)/1000))}/s)`);
}
main().catch(e => { console.error('FATAL', e); process.exit(1); });
