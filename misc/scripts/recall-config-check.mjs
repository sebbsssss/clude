// Quick validation: does the relevance-first recall config surface the evidence facts that the
// default (recency/importance-heavy) config buries? Reuses user 0's already-stored memories.
// Run TWICE with different env weights to compare. Read-only (no writes).
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/sebastien/Projects/cluude-bot/.env', override: true });
process.env.EMBEDDING_PROVIDER = 'voyage';
process.env.EMBEDDING_API_KEY = process.env.EMBEDDING_API_KEY || process.env.VOYAGE_API_KEY || '';
process.env.EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'voyage-4-large';

import fs from 'fs';
const { withOwnerWallet } = await import('@clude/shared/core/owner-context');
const { recallMemories } = await import('@clude/brain/memory');
const { RETRIEVAL_WEIGHT_RECENCY, RETRIEVAL_WEIGHT_IMPORTANCE, RETRIEVAL_WEIGHT_VECTOR, RETRIEVAL_WEIGHT_RELEVANCE } =
  await import('@clude/shared/utils');

const WALLET = process.env.WALLET || 'bench:halumem:2f1f897e-d67f-dbc5-6a7b-b7634a9e294f';
const N = Number(process.env.N || 25);
const K = Number(process.env.K || 20);
const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
// token-overlap match: evidence content is "found" if >=60% of its content words appear in a recalled memory
function found(evContent, recalled) {
  const ew = new Set(norm(evContent).split(' ').filter(w=>w.length>2));
  if (!ew.size) return false;
  for (const m of recalled) {
    const mw = new Set(norm((m.content||'')+' '+(m.summary||'')).split(' '));
    let hit=0; for (const w of ew) if (mw.has(w)) hit++;
    if (hit/ew.size >= 0.6) return true;
  }
  return false;
}

async function main() {
  console.log(`config: RECENCY=${RETRIEVAL_WEIGHT_RECENCY} IMPORTANCE=${RETRIEVAL_WEIGHT_IMPORTANCE} RELEVANCE=${RETRIEVAL_WEIGHT_RELEVANCE} VECTOR=${RETRIEVAL_WEIGHT_VECTOR} | wallet ${WALLET}`);
  const line = fs.readFileSync('/tmp/halumem-medium.jsonl','utf8').split('\n')[0];
  const user = JSON.parse(line);
  // answerable questions: have non-empty evidence
  const qs = [];
  for (const s of user.sessions) for (const q of (s.questions||[])) if ((q.evidence||[]).length) qs.push(q);
  const sample = qs.slice(0, N);
  let hit = 0;
  for (const q of sample) {
    const recalled = await withOwnerWallet(WALLET, () => recallMemories({ query: q.question, limit: K, skipExpansion: true, trackAccess: false }));
    const ok = (q.evidence||[]).some(e => found(e.memory_content, recalled||[]));
    if (ok) hit++;
    process.stdout.write(`\r  ${sample.indexOf(q)+1}/${sample.length} | evidence-in-top${K}: ${hit}`);
  }
  console.log(`\nEVIDENCE RECALL@${K}: ${hit}/${sample.length} = ${(100*hit/sample.length).toFixed(0)}%  (fraction of answerable Qs whose gold evidence surfaced)`);
}
main().catch(e=>{ console.error('FATAL', e.message); process.exit(1); });
