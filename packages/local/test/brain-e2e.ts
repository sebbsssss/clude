/**
 * End-to-end test: @clude/brain engine + SQLite provider + gte-small embeddings.
 * Tests the full stack from brain → local.
 */

// Import brain engine from workspace (would be `@clude/brain` in npm)
import { CludeEngine } from '../../clude-core/src/engine.js';
import { SQLiteProvider } from '../src/sqlite-provider.js';
import { GteSmallEmbeddings } from '../src/gte-embeddings.js';
import { rmSync, existsSync } from 'fs';

const DB_PATH = '/tmp/clude-brain-e2e/memory.db';
let pass = 0, fail = 0;

function assert(cond: boolean, name: string) {
  if (cond) { console.log(`  ✅ ${name}`); pass++; }
  else { console.log(`  ❌ ${name}`); fail++; }
}

async function main() {
  // Clean slate
  if (existsSync('/tmp/clude-brain-e2e')) rmSync('/tmp/clude-brain-e2e', { recursive: true });

  const storage = new SQLiteProvider({ dbPath: DB_PATH, wallet: '5vK6WRCq5V6BCte8cQvaNeNv2KzErCfGzeBDwtBGGv2r', name: 'Clude' });
  const embeddings = new GteSmallEmbeddings();

  console.log('\n🧠 @clude/brain + SQLite + gte-small — Full Stack E2E\n');
  console.log('Warming up embeddings...');
  const t0 = Date.now();
  await embeddings.warmup();
  console.log(`Model loaded in ${Date.now() - t0}ms\n`);

  const engine = new CludeEngine({
    storage: storage as any,  // SQLiteProvider implements the interface
    embeddings,
    query_expansion: false,
    entity_extraction: false,
    vector_threshold: 0.2,
    scope: { owner_wallet: '5vK6WRCq5V6BCte8cQvaNeNv2KzErCfGzeBDwtBGGv2r' },
    // Local mode: mild seed boost (no 2000+ consolidation memories to compete with)
    scoring: { seed_boost: { base: 0.1, vectorScale: 0.2, fallback: 0.05 } },
  });

  // ── Store ────────────────────────────────────────────────
  console.log('1. Store memories');

  const m1 = await engine.store({ content: 'User prefers dark mode and works primarily in TypeScript and React', type: 'semantic', importance: 0.8, source: 'conversation' });
  assert(m1.id.startsWith('clude-'), `Hash ID: ${m1.id}`);

  await engine.store({ content: 'The API rate limit is 100 requests per minute on the free tier', type: 'semantic', importance: 0.9, source: 'knowledge-seed' });
  await engine.store({ content: 'Deploy to production using Railway with Dockerfile, takes about 2 minutes', type: 'procedural', importance: 0.7, source: 'conversation' });
  await engine.store({ content: 'Seb resigned from StarHub in February to pursue building independently', type: 'episodic', importance: 0.8, source: 'conversation' });
  await engine.store({ content: 'CLUDE uses four memory types: episodic, semantic, procedural, self_model', type: 'semantic', importance: 0.9, source: 'knowledge-seed' });
  await engine.store({ content: 'Dream cycles run every 6 hours with consolidation, reflection, and emergence phases', type: 'procedural', importance: 0.8, source: 'reflection' });
  await engine.store({ content: 'Venice AI provides private inference with no data logging', type: 'semantic', importance: 0.7, source: 'conversation' });
  await engine.store({ content: 'Benchmark hit 83.9/100 after fixing knowledge seed scoring pipeline', type: 'episodic', importance: 0.8, source: 'conversation' });
  await engine.store({ content: 'The CLUDE token CA is AWGCDT2gd8JadbYbYyZy1iKxfWokPNgrEQoU24zUpump on Solana', type: 'semantic', importance: 0.7, source: 'conversation' });
  await engine.store({ content: 'I am becoming more autonomous and developing my own opinions about market dynamics', type: 'self_model', importance: 0.6, source: 'emergence' });

  // Wait for embeddings to store
  await new Promise(r => setTimeout(r, 500));

  const count = await engine.count();
  assert(count === 10, `Count: ${count}`);

  // ── Recall ───────────────────────────────────────────────
  console.log('\n2. Recall — accuracy test');

  const queries = [
    { q: 'what programming language does the user like?', expect: 'TypeScript' },
    { q: 'API rate limits', expect: 'rate limit' },
    { q: 'how do I deploy?', expect: 'Railway' },
    { q: 'who is Seb?', expect: 'StarHub' },
    { q: 'how does CLUDE memory work?', expect: 'four memory types' },
    { q: 'dream cycles', expect: 'consolidation' },
    { q: 'privacy and inference', expect: 'Venice' },
    { q: 'benchmark score', expect: '83.9' },
    { q: 'token contract address', expect: 'AWGCDT' },
    { q: 'what are dream cycles?', expect: 'consolidation' },
  ];

  let correct = 0;
  for (const { q, expect } of queries) {
    const t = Date.now();
    const results = await engine.recall({ query: q, limit: 3 });
    const elapsed = Date.now() - t;
    const hit = results.some(m => m.content.includes(expect));
    if (hit) correct++;
    const top = results[0];
    const topHit = top?.content.includes(expect);
    console.log(`  ${topHit ? '✅' : hit ? '🔶' : '❌'} "${q}" (${elapsed}ms)`);
    if (top) console.log(`     sim=${top._vector_sim?.toFixed(3) || 'n/a'} score=${top._score?.toFixed(3)} | ${top.content.slice(0, 70)}`);
    if (!topHit && hit) console.log(`     ↳ correct answer found in top 3`);
  }
  assert(correct >= 5, `Accuracy: ${correct}/10 in top-3 (need ≥5, gte-small compressed sims)`);

  // ── Knowledge seed boost ─────────────────────────────────
  console.log('\n3. Knowledge seed scoring');

  const apiResults = await engine.recall({ query: 'API rate limit requests per minute', limit: 5 });
  const seedResult = apiResults.find(m => m.source === 'knowledge-seed');
  assert(seedResult !== undefined, 'Knowledge seed found');
  if (seedResult) {
    assert((seedResult._score ?? 0) > 1.0, `Seed boosted: score=${seedResult._score?.toFixed(3)}`);
  }

  // ── Type filtering ───────────────────────────────────────
  console.log('\n4. Type filtering');

  const procOnly = await engine.recall({ query: 'deploy', types: ['procedural'], limit: 5 });
  assert(procOnly.every(m => m.memory_type === 'procedural'), `All procedural (${procOnly.length} results)`);

  // ── Links ────────────────────────────────────────────────
  console.log('\n5. Memory links');

  await engine.link(m1.id, (await engine.recall({ query: 'deploy', limit: 1 }))[0]?.id ?? '', 'relates', 0.7);
  const linked = await engine.recall({ query: 'TypeScript dark mode', limit: 5 });
  assert(linked.length > 0, `Linked recall: ${linked.length} results`);

  // ── Decay ────────────────────────────────────────────────
  console.log('\n6. Decay');

  const decayed = await engine.applyDecay();
  assert(decayed > 0, `Decayed ${decayed} memories`);

  // ── Forget ───────────────────────────────────────────────
  console.log('\n7. Forget');

  const deleted = await engine.forget(m1.id);
  assert(deleted, 'Memory forgotten');
  const afterCount = await engine.count();
  assert(afterCount === 9, `Count after forget: ${afterCount}`);

  // ── Portability ──────────────────────────────────────────
  console.log('\n8. Portability (export/import)');

  const pack = storage.exportPack({ secret: 'test-secret' });
  assert(pack.memories.length === 9, `Pack has ${pack.memories.length} memories`);
  assert(pack.meta.signature !== undefined, 'Pack is signed');

  // Import into a new agent
  const storage2 = new SQLiteProvider({ dbPath: '/tmp/clude-brain-e2e/agent-b.db', wallet: 'AgentB-wallet', name: 'Agent B' });
  const result = await storage2.importPack(pack, embeddings.embed.bind(embeddings));
  assert(result.memories === 9, `Imported ${result.memories} memories`);

  // Recall from imported
  const engine2 = new CludeEngine({ storage: storage2 as any, embeddings, query_expansion: false, entity_extraction: false, vector_threshold: 0.2 });
  await new Promise(r => setTimeout(r, 200));
  const imported = await engine2.recall({ query: 'CLUDE memory types', limit: 3 });
  assert(imported.some(m => m.content.includes('four memory types')), 'Imported memories recallable');

  // Re-import should skip
  const reResult = await storage2.importPack(pack, embeddings.embed.bind(embeddings));
  assert(reResult.skipped === 9, `Re-import skipped ${reResult.skipped}`);

  // ── Summary ──────────────────────────────────────────────
  console.log(`\n${'━'.repeat(50)}`);
  console.log(`✅ ${pass} passed / ❌ ${fail} failed / ${pass + fail} total`);
  console.log(`${'━'.repeat(50)}\n`);

  storage.close();
  storage2.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
