import { createStore } from '../src/index.js';

async function main() {
  console.log('🧠 CLUDE Local — Scale + Edge Case Test\n');

  const store = createStore('/tmp/clude-stress/memory.db');
  store.clear();

  await store.warmup();

  // Seed 50 diverse memories to test ranking under noise
  const memories = [
    // User preferences
    { content: "User prefers dark mode and works primarily in TypeScript and React", type: 'semantic' as const, importance: 0.8 },
    { content: "User's favorite editor is VS Code with Vim keybindings", type: 'semantic' as const, importance: 0.6 },
    { content: "User timezone is UTC+8, based in Singapore", type: 'semantic' as const, importance: 0.5 },
    { content: "User prefers concise responses, no fluff or filler words", type: 'semantic' as const, importance: 0.7 },
    { content: "User drinks oat milk lattes, usually from a cafe called Common Man", type: 'episodic' as const, importance: 0.3 },

    // Technical
    { content: "Deploy to production using Railway with Dockerfile, takes about 2 minutes to build", type: 'procedural' as const, importance: 0.6 },
    { content: "The API rate limit is 100 requests per minute on the free tier, 1000 on pro", type: 'procedural' as const, importance: 0.7 },
    { content: "When deploying, always check that EMBEDDING_MODEL and EMBEDDING_QUERY_MODEL match", type: 'procedural' as const, importance: 0.9 },
    { content: "Use Voyage-4-Large for embeddings, 1024 dimensions, best-in-class text retrieval", type: 'procedural' as const, importance: 0.7 },
    { content: "Supabase RPC match_memories takes query_embedding, match_threshold, match_count as params", type: 'procedural' as const, importance: 0.5 },

    // CLUDE architecture
    { content: "CLUDE uses four memory types: episodic for raw events, semantic for knowledge, procedural for behaviors, self_model for identity", type: 'semantic' as const, importance: 1.0 },
    { content: "Dream cycles run every 6 hours: Phase I consolidation, Phase II reflection, Phase III emergence", type: 'semantic' as const, importance: 0.8 },
    { content: "CLUDE retrieval formula: score = recency * 0.5 + relevance * 3.0 + importance * 2.0 + vector_sim * 3.0 + graph_boost * 1.5", type: 'semantic' as const, importance: 0.9 },
    { content: "Venice AI provides private inference. CLUDE uses Venice for embedding and LLM calls", type: 'semantic' as const, importance: 0.8 },
    { content: "The CLUDE token CA is AWGCDT2gd8JadbYbYyZy1iKxfWokPNgrEQoU24zUpump on Solana", type: 'semantic' as const, importance: 1.0 },

    // Events
    { content: "Seb resigned from StarHub in February 2026 to pursue building independently", type: 'episodic' as const, importance: 0.9 },
    { content: "The Colosseum hackathon deadline was February 12, 2026. We submitted Clude as Blockchain as a Brain", type: 'episodic' as const, importance: 0.7 },
    { content: "FEiKU joined as marketing advisor, helped reposition Clude with Brain + Cortex naming", type: 'episodic' as const, importance: 0.7 },
    { content: "Benchmark hit 83.9/100 on March 4, 2026 after fixing knowledge seed scoring", type: 'episodic' as const, importance: 0.8 },
    { content: "Red Beard Ventures scheduled a VC call to discuss potential investment in CLUDE", type: 'episodic' as const, importance: 0.7 },

    // Noise (common conversational memories)
    { content: "Had a good conversation about the weather today, sunny and 32 degrees", type: 'episodic' as const, importance: 0.2 },
    { content: "User asked what time it was in New York", type: 'episodic' as const, importance: 0.1 },
    { content: "Discussed the latest SpaceX launch, Starship made it to orbit", type: 'episodic' as const, importance: 0.3 },
    { content: "User shared a meme about JavaScript being confusing", type: 'episodic' as const, importance: 0.1 },
    { content: "Talked about weekend plans, user mentioned going hiking", type: 'episodic' as const, importance: 0.2 },

    // More noise
    { content: "User mentioned they had sushi for lunch yesterday at Genki Sushi", type: 'episodic' as const, importance: 0.1 },
    { content: "Discussed whether cats or dogs make better pets", type: 'episodic' as const, importance: 0.1 },
    { content: "User asked about the best Netflix shows to watch", type: 'episodic' as const, importance: 0.2 },
    { content: "Morning standup meeting scheduled for 9am every weekday", type: 'procedural' as const, importance: 0.4 },
    { content: "Recommended the book Thinking Fast and Slow by Daniel Kahneman", type: 'episodic' as const, importance: 0.3 },

    // More technical to add density
    { content: "Git workflow: feature branches, squash merge to main, deploy on merge", type: 'procedural' as const, importance: 0.5 },
    { content: "The Supabase project URL is ilmkakcqakvwtfrsabrd.supabase.co", type: 'procedural' as const, importance: 0.4 },
    { content: "Railway service runs in Singapore region, asia-southeast1", type: 'procedural' as const, importance: 0.5 },
    { content: "Memory decay rates: episodic 7%/day, semantic 2%/day, procedural 3%/day, self_model 1%/day", type: 'semantic' as const, importance: 0.9 },
    { content: "Entity graph has 6 bond types: supports, contradicts, elaborates, causes, follows, relates", type: 'semantic' as const, importance: 0.7 },

    // Self model
    { content: "I tend to be too verbose in responses, should aim for conciseness", type: 'self_model' as const, importance: 0.6 },
    { content: "I work best when given clear context about what the user wants", type: 'self_model' as const, importance: 0.5 },
    { content: "Users appreciate when I show my reasoning, not just the answer", type: 'self_model' as const, importance: 0.6 },
    { content: "I should avoid using em-dashes, the user doesn't like them", type: 'self_model' as const, importance: 0.7 },
    { content: "My name is Yoshi, I'm Seb's AI assistant", type: 'self_model' as const, importance: 0.9 },
  ];

  console.log(`Storing ${memories.length} memories...`);
  const ts = performance.now();
  for (const m of memories) {
    await store.remember(m);
  }
  console.log(`  Done in ${(performance.now()-ts).toFixed(0)}ms\n`);

  // Hard queries
  const queries = [
    { q: "what programming language does the user prefer?", expect: "TypeScript" },
    { q: "how do I deploy to production?", expect: "Railway" },
    { q: "what's the token contract address?", expect: "AWGCDT" },
    { q: "what editor does the user use?", expect: "VS Code" },
    { q: "who is the marketing advisor?", expect: "FEiKU" },
    { q: "what are the memory decay rates?", expect: "7%/day" },
    { q: "what did the user eat for lunch?", expect: "sushi" },
    { q: "what's the benchmark score?", expect: "83.9" },
    { q: "how does the entity graph work?", expect: "bond types" },
    { q: "what does the user dislike in writing?", expect: "em-dash" },
    { q: "where is the server hosted?", expect: "Singapore" },
    { q: "what's my name?", expect: "Yoshi" },
    { q: "coffee preferences", expect: "oat milk" },
    { q: "how often do dream cycles run?", expect: "6 hours" },
    { q: "VC investment discussions", expect: "Red Beard" },
  ];

  let passed = 0;
  let totalMs = 0;

  for (const { q, expect } of queries) {
    const t = performance.now();
    const results = await store.recall({ query: q, limit: 3 });
    const ms = performance.now() - t;
    totalMs += ms;

    const top = results[0];
    const topContent = top?.content || '';
    const hit = topContent.toLowerCase().includes(expect.toLowerCase());
    
    // Also check position 2 and 3
    const inTop3 = results.some(r => r.content.toLowerCase().includes(expect.toLowerCase()));
    
    if (hit) passed++;
    const icon = hit ? '✅' : (inTop3 ? '🔶' : '❌');

    console.log(`${icon} "${q}" (${ms.toFixed(0)}ms)`);
    if (top) {
      console.log(`   sim=${top.similarity.toFixed(3)} | ${topContent.slice(0, 75)}`);
      if (!hit && inTop3) {
        const correct = results.find(r => r.content.toLowerCase().includes(expect.toLowerCase()))!;
        const pos = results.indexOf(correct) + 1;
        console.log(`   ↳ correct answer at #${pos} (sim=${correct.similarity.toFixed(3)})`);
      }
    }
  }

  console.log(`\n📊 Top-1 Accuracy: ${passed}/${queries.length} (${(passed/queries.length*100).toFixed(0)}%)`);
  console.log(`   Avg recall: ${(totalMs / queries.length).toFixed(0)}ms`);
  console.log(`   Memories: ${store.count()}`);

  store.close();
}

main().catch(console.error);
