// FAST no-embedding bulk seed via Postgres COPY. Loads the full corpus for BM25-at-scale.
// content_tokens is a GENERATED column -> BM25 (GIN idx_scale_content_tokens) works the instant
// rows land. NO Voyage call -> no rate-limit bottleneck. Embeddings are added later (Phase 2).
//
// Single serial COPY loop: read line -> build TSV -> COPY every CHUNK rows (awaited).
// No async embedding => the pg single-client-concurrency bug cannot occur.
//
// Requires the direct DB connection string via PG_URL (NEVER logged/committed). Uses pg +
// pg-copy-streams from /tmp/pgcopy.
//
// Usage:
//   PG_URL='postgresql://...' IN=/tmp/facts-2m.jsonl WALLET=bench:scale:v1 RESUME=1 \
//     node misc/scripts/copy-seed-nobed.mjs
import fs from 'fs';
import readline from 'readline';
import { createRequire } from 'module';
const require = createRequire('/tmp/pgcopy/');
const { Client } = require('pg');
const { from: copyFrom } = require('pg-copy-streams');

const PG_URL = process.env.PG_URL;
const IN = process.env.IN || '/tmp/facts-2m.jsonl';
const WALLET = process.env.WALLET || 'bench:scale:v1';
const CHUNK = Number(process.env.CHUNK || 25000); // rows per COPY txn (~2MB, well under timeout)
if (!PG_URL) { console.error('PG_URL required'); process.exit(1); }

function factToContent(f) {
  switch (f.category) {
    case 'block_time': return `Solana block slot ${f.sourceRef.replace('block:','')} had a block time of ${f.gold} UTC.`;
    case 'block_leader': return `The validator ${f.gold} led Solana slot ${f.sourceRef.replace('block:','')}.`;
    case 'block_txcount': return `Solana slot ${f.sourceRef.replace('block:','')} contained ${f.gold} transactions.`;
    case 'tx_fee': return `Solana transaction ${f.sourceRef.replace('tx:','')} paid a fee of ${f.gold} lamports.`;
    case 'tx_status': return `Solana transaction ${f.sourceRef.replace('tx:','')} had a status of ${f.gold}.`;
    case 'account_lamports': {
      const m = f.sourceRef.match(/^account:(.+)@(\d+)$/);
      if (m) return `Solana account ${m[1]} held ${f.gold} lamports at slot ${m[2]}.`;
      return `${f.question} ${f.gold}`;
    }
    default: return `${f.question} ${f.gold}`;
  }
}
// COPY text format escapes: backslash, tab, newline, CR.
const esc = (s) => String(s == null ? '' : s).replace(/\\/g,'\\\\').replace(/\t/g,'\\t').replace(/\n/g,'\\n').replace(/\r/g,'\\r');
const cols = '(owner_wallet, source_ref, category, content, summary, gold)';

async function copyChunk(client, lines) {
  if (!lines.length) return 0;
  await new Promise((res, rej) => {
    const stream = client.query(copyFrom(`COPY public.memories_scale_bench ${cols} FROM STDIN WITH (FORMAT text)`));
    stream.on('error', rej);
    stream.on('finish', res);
    stream.write(lines.join('\n') + '\n');
    stream.end();
  });
  return lines.length;
}

async function main() {
  const client = new Client({ connectionString: PG_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query('SET statement_timeout = 0');
  await client.query('SET synchronous_commit = off');
  console.error(`connected (timeout off). no-embedding COPY in ${CHUNK}-row chunks -> wallet ${WALLET}`);

  let alreadyN = 0;
  if (process.env.RESUME === '1') {
    const r = await client.query('SELECT count(*) n FROM public.memories_scale_bench WHERE owner_wallet=$1', [WALLET]);
    alreadyN = Number(r.rows[0].n);
    console.error(`resume: ${alreadyN} rows already present (skipping first ${alreadyN} file lines)`);
  }

  const rl = readline.createInterface({ input: fs.createReadStream(IN), crlfDelay: Infinity });
  let buf = [], read = 0, written = 0, t0 = Date.now();
  for await (const line of rl) {
    if (!line.trim()) continue;
    read++;
    if (read <= alreadyN) continue;
    const f = JSON.parse(line);
    const c = factToContent(f);
    buf.push([esc(WALLET), esc(f.id), esc(f.category), esc(c), esc(c), esc(f.gold)].join('\t'));
    if (buf.length >= CHUNK) {
      written += await copyChunk(client, buf); buf = [];
      const rate = Math.round(written / ((Date.now()-t0)/1000));
      console.error(`  loaded ${written} | ${rate}/s`);
    }
  }
  if (buf.length) written += await copyChunk(client, buf);
  console.error(`COPY DONE: loaded ${written} rows of ${read} read in ${Math.round((Date.now()-t0)/1000)}s`);
  await client.end();
}
main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
