import { createStore } from '../src/index.js';

async function main() {
  console.log('🧠 CLUDE Local — Full Test (gte-small)\n');

  const store = createStore('/tmp/clude-test-v2/memory.db');
  store.clear(); // fresh start

  // Warmup model
  const tw = performance.now();
  await store.warmup();
  console.log(`Model loaded in ${(performance.now()-tw).toFixed(0)}ms\n`);

  // Store diverse memories
  const memories = [
    { content: "User prefers dark mode and works primarily in TypeScript and React", type: 'semantic' as const, importance: 0.8 },
    { content: "The API rate limit is 100 requests per minute on the free tier", type: 'procedural' as const, importance: 0.7 },
    { content: "Deploy to production using Railway with Dockerfile, takes about 2 minutes", type: 'procedural' as const },
    { content: "Seb resigned from StarHub in February to pursue building independently", type: 'episodic' as const, importance: 0.9 },
    { content: "CLUDE uses four memory types: episodic for raw events, semantic for knowledge, procedural for learned behaviors, and self_model for identity", type: 'semantic' as const, importance: 1.0 },
    { content: "The Colosseum hackathon deadline was February 12, 2026. We submitted Clude as Blockchain as a Brain", type: 'episodic' as const, importance: 0.7 },
    { content: "Venice AI provides private inference. CLUDE uses Venice for embedding and LLM calls to ensure user data stays private", type: 'semantic' as const, importance: 0.8 },
    { content: "When deploying, always check that EMBEDDING_MODEL and EMBEDDING_QUERY_MODEL match to avoid vector space mismatch", type: 'procedural' as const, importance: 0.9 },
    { content: "The CLUDE token CA is AWGCDT2gd8JadbYbYyZy1iKxfWokPNgrEQoU24zUpump on Solana", type: 'semantic' as const, importance: 1.0 },
    { content: "Dream cycles run every 6 hours: Phase I consolidation, Phase II reflection, Phase III emergence", type: 'semantic' as const, importance: 0.8 },
  ];

  console.log('Storing 10 memories...');
  const ts = performance.now();
  for (const m of memories) {
    await store.remember(m);
  }
  const storeMs = performance.now() - ts;
  console.log(`  Done in ${storeMs.toFixed(0)}ms (${(storeMs/10).toFixed(0)}ms avg per memory)\n`);
  console.log(`Total: ${store.count()} memories\n`);

  // Recall tests — including the tricky ones
  const queries = [
    { q: "what programming language does the user like?", expect: "TypeScript" },
    { q: "API rate limits", expect: "100 requests" },
    { q: "how do I deploy?", expect: "Railway" },
    { q: "who is Seb?", expect: "StarHub" },
    { q: "how does CLUDE memory work?", expect: "four memory types" },
    { q: "what happened in the hackathon?", expect: "Colosseum" },
    { q: "privacy and inference", expect: "Venice" },
    { q: "embedding model mismatch", expect: "EMBEDDING_MODEL" },
    { q: "token contract address", expect: "AWGCDT" },
    { q: "what are dream cycles?", expect: "consolidation" },
  ];

  let passed = 0;
  let totalRecallMs = 0;

  for (const { q, expect } of queries) {
    const t1 = performance.now();
    const results = await store.recall({ query: q, limit: 3 });
    const ms = performance.now() - t1;
    totalRecallMs += ms;

    const top = results[0];
    const hit = top && top.content.includes(expect);
    const icon = hit ? '✅' : '❌';
    if (hit) passed++;

    console.log(`${icon} "${q}" (${ms.toFixed(0)}ms)`);
    if (top) {
      console.log(`   sim=${top.similarity.toFixed(3)} score=${top.score.toFixed(3)} | ${top.content.slice(0, 80)}`);
    } else {
      console.log(`   No results`);
    }
  }

  console.log(`\n📊 Results: ${passed}/${queries.length} correct`);
  console.log(`   Avg recall: ${(totalRecallMs / queries.length).toFixed(0)}ms`);

  // Keyword search test
  console.log('\n🔍 Keyword search "Solana":');
  const kw = store.search('Solana');
  for (const m of kw) {
    console.log(`   ${m.content.slice(0, 80)}`);
  }

  store.close();
  console.log('\n✅ Done!');
}

main().catch(console.error);
