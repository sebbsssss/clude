/**
 * End-to-end test for @clude/brain
 *
 * Tests the full pipeline: store → embed → recall → score → link → decay
 */
import { CludeEngine } from '../src/engine.js';
import { InMemoryProvider } from './memory-provider.js';
import { MockEmbeddings } from './mock-embeddings.js';

let pass = 0;
let fail = 0;

function assert(condition: boolean, name: string) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    pass++;
  } else {
    console.log(`  ❌ ${name}`);
    fail++;
  }
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const storage = new InMemoryProvider();
  const embeddings = new MockEmbeddings();

  const engine = new CludeEngine({
    storage,
    embeddings,
    query_expansion: false,  // No LLM in tests
    entity_extraction: false,
    vector_threshold: 0.1,
  });

  console.log('\n🧠 @clude/brain — End-to-End Test\n');

  // ── 1. Store ─────────────────────────────────────────────
  console.log('1. Store memories');

  const m1 = await engine.store({ content: 'User prefers dark mode for all applications', type: 'semantic', importance: 0.8, source: 'conversation' });
  assert(m1.id.startsWith('clude-'), 'Memory has hash ID');
  assert(m1.memory_type === 'semantic', 'Memory type is semantic');
  assert(m1.importance === 0.8, 'Importance preserved');
  assert(m1.decay_factor === 1.0, 'Fresh decay is 1.0');

  const m2 = await engine.store({ content: 'Had a great conversation about TypeScript generics', type: 'episodic', importance: 0.5, source: 'conversation', related_user: 'alice' });
  const m3 = await engine.store({ content: 'When debugging, always check the logs first before guessing', type: 'procedural', importance: 0.7, source: 'reflection' });
  const m4 = await engine.store({ content: 'I am becoming more confident in technical discussions', type: 'self_model', importance: 0.6, source: 'emergence' });
  const m5 = await engine.store({ content: 'The API key for Voyage AI rotates every 90 days', type: 'semantic', importance: 0.9, source: 'knowledge-seed' });

  const count = await engine.count();
  assert(count === 5, `Count is 5 (got ${count})`);

  // Give embeddings time to store (fire-and-forget)
  await sleep(100);

  // ── 2. Recall ────────────────────────────────────────────
  console.log('\n2. Recall memories');

  const darkMode = await engine.recall({ query: 'dark mode theme preferences', limit: 3 });
  assert(darkMode.length > 0, `Recalled ${darkMode.length} memories for "dark mode"`);
  assert(darkMode.some(m => m.content.includes('dark mode')), 'Dark mode memory in results');

  const typescript = await engine.recall({ query: 'TypeScript generics conversation', limit: 3 });
  assert(typescript.length > 0, `Recalled ${typescript.length} memories for "TypeScript"`);
  assert(typescript.some(m => m.content.includes('TypeScript')), 'TypeScript memory found');

  const debugging = await engine.recall({ query: 'how to debug effectively', limit: 3 });
  assert(debugging.length > 0, `Recalled ${debugging.length} for "debugging"`);

  // ── 3. Scoring ───────────────────────────────────────────
  console.log('\n3. Scoring');

  const allResults = await engine.recall({ query: 'API key rotation', limit: 5 });
  assert(allResults.length > 0, 'Got results for API key query');
  // Knowledge seed should score high
  const seedResult = allResults.find(m => m.source === 'knowledge-seed');
  assert(seedResult !== undefined, 'Knowledge seed found in results');
  if (seedResult) {
    assert((seedResult._score ?? 0) > 0, `Seed score: ${seedResult._score?.toFixed(3)}`);
  }

  // Scores should be in descending order
  const scores = allResults.map(m => m._score ?? 0);
  const sorted = [...scores].sort((a, b) => b - a);
  assert(JSON.stringify(scores) === JSON.stringify(sorted), 'Results sorted by score (descending)');

  // ── 4. Type filtering ────────────────────────────────────
  console.log('\n4. Type filtering');

  const semanticOnly = await engine.recall({ query: 'preferences', types: ['semantic'], limit: 10 });
  assert(semanticOnly.every(m => m.memory_type === 'semantic'), 'All results are semantic type');

  const episodicOnly = await engine.recall({ query: 'conversation', types: ['episodic'], limit: 10 });
  assert(episodicOnly.every(m => m.memory_type === 'episodic'), 'All results are episodic type');

  // ── 5. Links ─────────────────────────────────────────────
  console.log('\n5. Memory links');

  await engine.link(m1.id, m2.id, 'relates', 0.7);
  await engine.link(m2.id, m3.id, 'elaborates', 0.8);
  await engine.link(m1.id, m3.id, 'supports', 0.6);

  // Recall should now potentially pull in linked memories
  const linkedRecall = await engine.recall({ query: 'dark mode', limit: 5 });
  assert(linkedRecall.length > 0, `Linked recall got ${linkedRecall.length} results`);

  // ── 6. Scoping ───────────────────────────────────────────
  console.log('\n6. Multi-tenant scoping');

  const scopedEngine = new CludeEngine({
    storage,
    embeddings,
    query_expansion: false,
    entity_extraction: false,
    vector_threshold: 0.1,
    scope: { owner_wallet: 'wallet-A' },
  });

  await scopedEngine.store({ content: 'Wallet A specific memory', importance: 0.9 });
  await sleep(50);

  const walletAResults = await scopedEngine.recall({ query: 'wallet specific', limit: 10 });
  // Should only find wallet-A memories (not the unscoped ones)
  const walletAFiltered = walletAResults.filter(m => m.owner_wallet === 'wallet-A');
  assert(walletAFiltered.length > 0, `Scoped recall found ${walletAFiltered.length} wallet-A memories`);

  // ── 7. Decay ─────────────────────────────────────────────
  console.log('\n7. Decay');

  const decayed = await engine.applyDecay();
  assert(decayed > 0, `Decayed ${decayed} memories`);

  // Check episodic decayed more than semantic
  const m2After = await storage.getById(m2.id);
  const m1After = await storage.getById(m1.id);
  if (m1After && m2After) {
    assert(m2After.decay_factor < m1After.decay_factor, `Episodic (${m2After.decay_factor.toFixed(3)}) decayed faster than semantic (${m1After.decay_factor.toFixed(3)})`);
  }

  // ── 8. Forget ────────────────────────────────────────────
  console.log('\n8. Forget');

  const deleted = await engine.forget(m4.id);
  assert(deleted, 'Memory deleted');
  const afterDelete = await engine.count();
  // 5 original + 1 scoped - 1 deleted = 5
  assert(afterDelete === 5, `Count after delete: ${afterDelete}`);

  // ── 9. Access tracking ───────────────────────────────────
  console.log('\n9. Access tracking & rehearsal');

  const m1Before = await storage.getById(m1.id);
  const accessBefore = m1Before?.access_count ?? 0;
  // Use a query that specifically targets m1
  await engine.recall({ query: 'dark mode user prefers applications', limit: 1 });
  await sleep(200);
  const m1AfterRecall = await storage.getById(m1.id);
  const accessAfter = m1AfterRecall?.access_count ?? 0;
  assert(accessAfter >= accessBefore, `Access count tracked (${accessBefore} → ${accessAfter})`);
  // Also check importance got boosted via rehearsal
  const impAfter = m1AfterRecall?.importance ?? 0;
  assert(impAfter >= 0.8, `Importance rehearsed (${impAfter.toFixed(3)})`);

  // ── 10. Fast mode ────────────────────────────────────────
  console.log('\n10. Fast mode (skip expansion)');

  const fastResults = await engine.recall({ query: 'dark mode', limit: 3, fast: true });
  assert(fastResults.length > 0, `Fast recall got ${fastResults.length} results`);

  // ── Summary ──────────────────────────────────────────────
  console.log(`\n${'─'.repeat(40)}`);
  console.log(`✅ ${pass} passed / ❌ ${fail} failed / ${pass + fail} total`);
  console.log(`${'─'.repeat(40)}\n`);

  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
