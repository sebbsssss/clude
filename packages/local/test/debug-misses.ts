import { createStore } from '../src/index.js';

async function main() {
  const store = createStore('/tmp/clude-stress/memory.db');
  
  // Debug the 3 misses + 1 near-miss
  const queries = [
    "what did the user eat for lunch?",
    "where is the server hosted?",
    "coffee preferences",
    "what does the user dislike in writing?",
  ];
  
  for (const q of queries) {
    console.log(`\n━━━ "${q}" ━━━`);
    const results = await store.recall({ query: q, limit: 5, threshold: 0.0 });
    for (let i = 0; i < Math.min(5, results.length); i++) {
      const r = results[i];
      console.log(`  #${i+1} sim=${r.similarity.toFixed(3)} score=${r.score.toFixed(3)} imp=${r.importance} | ${r.content.slice(0, 80)}`);
    }
  }
  store.close();
}
main().catch(console.error);
