import { createStore } from '../src/index.js';

async function main() {
  console.log('🧠 CLUDE Local — Scale Test (100+ memories)\n');

  const store = createStore('/tmp/clude-scale/memory.db');
  store.clear();
  await store.warmup();

  // 100 diverse memories across all types
  const memories = [
    // User identity (10)
    { content: "User's name is Sebastien, goes by Seb", type: 'semantic' as const, importance: 0.9 },
    { content: "Seb is based in Singapore, timezone UTC+8", type: 'semantic' as const, importance: 0.7 },
    { content: "User previously worked at StarHub, resigned February 2026", type: 'episodic' as const, importance: 0.8 },
    { content: "User's email is wsebastian@gmail.com", type: 'semantic' as const, importance: 0.6 },
    { content: "User's Telegram handle is @sebbsssss", type: 'semantic' as const, importance: 0.5 },
    { content: "Seb has a wife and family, prioritizes family time", type: 'semantic' as const, importance: 0.7 },
    { content: "User is building independently after leaving corporate job", type: 'episodic' as const, importance: 0.8 },
    { content: "User knows TypeScript, Python, React, Solidity", type: 'semantic' as const, importance: 0.7 },
    { content: "User prefers direct communication, no marketing fluff", type: 'self_model' as const, importance: 0.8 },
    { content: "User's X/Twitter handle is @sebbsssss", type: 'semantic' as const, importance: 0.5 },

    // Technical project (15)
    { content: "Clude is a persistent memory system for AI agents built on Solana", type: 'semantic' as const, importance: 1.0 },
    { content: "Clude uses four memory types: episodic, semantic, procedural, self_model", type: 'semantic' as const, importance: 0.9 },
    { content: "Voyage-4-Large is the embedding model, 1024 dimensions", type: 'procedural' as const, importance: 0.8 },
    { content: "Supabase handles the database layer with pgvector extension", type: 'procedural' as const, importance: 0.7 },
    { content: "Railway handles deployment, Singapore region", type: 'procedural' as const, importance: 0.6 },
    { content: "Dream cycles consolidate memories every 6 hours in three phases", type: 'semantic' as const, importance: 0.9 },
    { content: "Entity graph tracks relationships between concepts with 6 bond types", type: 'semantic' as const, importance: 0.8 },
    { content: "Venice AI provides private LLM inference, no data logging", type: 'semantic' as const, importance: 0.8 },
    { content: "The CLUDE token contract address is AWGCDT2gd8JadbYbYyZy1iKxfWokPNgrEQoU24zUpump", type: 'semantic' as const, importance: 1.0 },
    { content: "Benchmark suite scores 83.9/100 overall, 100/100 on LoCoMo", type: 'episodic' as const, importance: 0.9 },
    { content: "Hebbian reinforcement: frequently accessed memories get importance boost", type: 'semantic' as const, importance: 0.7 },
    { content: "Memory decay formula: episodic 7%/day, semantic 2%/day, procedural 3%/day", type: 'semantic' as const, importance: 0.8 },
    { content: "Query expansion uses llama-3.2-3b via Venice for alternative phrasings", type: 'procedural' as const, importance: 0.6 },
    { content: "Cortex v2 is the portable memory SDK, local-first with cloud sync", type: 'semantic' as const, importance: 0.9 },
    { content: "Knowledge seeds are high-importance memories that anchor factual knowledge", type: 'semantic' as const, importance: 0.8 },

    // Events timeline (15)
    { content: "February 12, 2026: Submitted Clude to Colosseum Agent Hackathon", type: 'episodic' as const, importance: 0.8 },
    { content: "FEiKU joined as marketing advisor in late February", type: 'episodic' as const, importance: 0.7 },
    { content: "Red Beard Ventures reached out for a VC call about investing in Clude", type: 'episodic' as const, importance: 0.8 },
    { content: "March 1: First benchmark run scored 69.2/100 with grok-3 judge", type: 'episodic' as const, importance: 0.6 },
    { content: "March 3: Switched LLM judge to Claude Opus for better consistency", type: 'episodic' as const, importance: 0.6 },
    { content: "March 4: Benchmark hit 83.9/100 after fixing knowledge seed pipeline", type: 'episodic' as const, importance: 0.8 },
    { content: "March 4: Registered Clude on 8004 Agent Registry on Solana mainnet", type: 'episodic' as const, importance: 0.9 },
    { content: "All 9,102 memories were re-embedded with Voyage-4-Large successfully", type: 'episodic' as const, importance: 0.7 },
    { content: "Dashboard deployed on Railway at terrific-purpose-production.up.railway.app", type: 'episodic' as const, importance: 0.5 },
    { content: "LoCoMo benchmark achieved 100% accuracy with per-turn chunking", type: 'episodic' as const, importance: 0.9 },
    { content: "Pump.fun accelerator application drafted, needs personal sections", type: 'episodic' as const, importance: 0.6 },
    { content: "gmoney raised concerns about privacy and cost at scale for Clude", type: 'episodic' as const, importance: 0.6 },
    { content: "Venice partnership announced, deep integration with private inference", type: 'episodic' as const, importance: 0.8 },
    { content: "Local SDK built with SQLite and gte-small embeddings, 10ms recall", type: 'episodic' as const, importance: 0.8 },
    { content: "10 Days of Building Clude campaign designed with 100M token rewards", type: 'episodic' as const, importance: 0.6 },

    // Conversations and noise (30)
    { content: "Had lunch at Genki Sushi, user ordered salmon and tuna rolls", type: 'episodic' as const, importance: 0.2 },
    { content: "Discussed the difference between RAG and long-term memory", type: 'episodic' as const, importance: 0.5 },
    { content: "User asked about the weather in Singapore, 32 degrees and humid", type: 'episodic' as const, importance: 0.1 },
    { content: "Talked about Elon Musk's Mars colony supply chain logistics", type: 'episodic' as const, importance: 0.3 },
    { content: "User shared a meme about JavaScript type coercion", type: 'episodic' as const, importance: 0.1 },
    { content: "Discussed cats vs dogs, user prefers cats", type: 'episodic' as const, importance: 0.2 },
    { content: "Morning standup at 9am, reviewed sprint backlog", type: 'episodic' as const, importance: 0.3 },
    { content: "User recommended the book Thinking Fast and Slow", type: 'episodic' as const, importance: 0.3 },
    { content: "Talked about the SpaceX Starship launch reaching orbit", type: 'episodic' as const, importance: 0.2 },
    { content: "User mentioned they drink oat milk lattes from Common Man cafe", type: 'episodic' as const, importance: 0.3 },
    { content: "Reviewed Netflix recommendations, user likes sci-fi and thrillers", type: 'episodic' as const, importance: 0.2 },
    { content: "Discussed Bitcoin hitting $150k, user bullish on crypto long-term", type: 'episodic' as const, importance: 0.4 },
    { content: "User went hiking at MacRitchie Reservoir over the weekend", type: 'episodic' as const, importance: 0.2 },
    { content: "Talked about React Server Components vs traditional SPA approach", type: 'episodic' as const, importance: 0.4 },
    { content: "User mentioned their wife's birthday is in April", type: 'episodic' as const, importance: 0.5 },
    { content: "Discussed the SuperMemory competitive landscape, they focus on developer infra", type: 'episodic' as const, importance: 0.5 },
    { content: "User asked about flight prices from Singapore to Tokyo", type: 'episodic' as const, importance: 0.2 },
    { content: "Talked about the Solana ecosystem growth and TVL numbers", type: 'episodic' as const, importance: 0.4 },
    { content: "User had a dentist appointment on Tuesday morning", type: 'episodic' as const, importance: 0.1 },
    { content: "Discussed why context windows are not a substitute for real memory", type: 'episodic' as const, importance: 0.6 },
    { content: "User mentioned they use a standing desk and Herman Miller chair", type: 'episodic' as const, importance: 0.2 },
    { content: "Talked about the importance of sleep for memory consolidation", type: 'episodic' as const, importance: 0.4 },
    { content: "User plays badminton on Wednesday evenings", type: 'episodic' as const, importance: 0.2 },
    { content: "Discussed AGI timelines, user thinks 2028-2030 is realistic", type: 'episodic' as const, importance: 0.5 },
    { content: "User mentioned their favorite restaurant is Burnt Ends for special occasions", type: 'episodic' as const, importance: 0.3 },
    { content: "Talked about the MCP protocol and how it enables agent interop", type: 'episodic' as const, importance: 0.5 },
    { content: "User got a new iPhone 17 Pro, migrating from Android", type: 'episodic' as const, importance: 0.3 },
    { content: "Discussed the tradeoffs between PostgreSQL and SQLite for local storage", type: 'episodic' as const, importance: 0.4 },
    { content: "User's favorite programming font is JetBrains Mono", type: 'episodic' as const, importance: 0.3 },
    { content: "Talked about the tokenomics: 20% vesting, 10% hackathon with 3-month cliff", type: 'episodic' as const, importance: 0.7 },

    // Self-model (10)
    { content: "I tend to be too verbose, should be more concise", type: 'self_model' as const, importance: 0.6 },
    { content: "I should never use em-dashes in responses, user strongly dislikes them", type: 'self_model' as const, importance: 0.8 },
    { content: "I work best when given clear context about what the user wants", type: 'self_model' as const, importance: 0.5 },
    { content: "Users appreciate when I show reasoning, not just answers", type: 'self_model' as const, importance: 0.6 },
    { content: "I should send tweet options as separate message bubbles for easy copy", type: 'self_model' as const, importance: 0.5 },
    { content: "I should write like Erik Voorhees when drafting Venice-related posts", type: 'self_model' as const, importance: 0.6 },
    { content: "I should avoid marketing fluff and be direct in all communications", type: 'self_model' as const, importance: 0.7 },
    { content: "My name is Yoshi, I'm Seb's AI assistant", type: 'self_model' as const, importance: 0.9 },
    { content: "I should check emails, calendar, and weather proactively during heartbeats", type: 'self_model' as const, importance: 0.4 },
    { content: "I should use HTML for infographics instead of AI image generation for text accuracy", type: 'self_model' as const, importance: 0.5 },

    // Procedural (10)
    { content: "To deploy: git push to main, Railway auto-builds from Dockerfile", type: 'procedural' as const, importance: 0.7 },
    { content: "Run benchmarks with: cd clude-benchmark-v2 && python3 run_live.py", type: 'procedural' as const, importance: 0.6 },
    { content: "Supabase SQL editor for running migrations manually", type: 'procedural' as const, importance: 0.5 },
    { content: "EMBEDDING_MODEL and EMBEDDING_QUERY_MODEL must always match", type: 'procedural' as const, importance: 0.9 },
    { content: "Knowledge seeds need owner_wallet set or they're invisible to queries", type: 'procedural' as const, importance: 0.8 },
    { content: "Use short punchy summaries for embeddings, not verbose descriptions", type: 'procedural' as const, importance: 0.7 },
    { content: "Git workflow: feature branches, squash merge to main", type: 'procedural' as const, importance: 0.4 },
    { content: "Venice API requires API key in Authorization header", type: 'procedural' as const, importance: 0.5 },
    { content: "Pinata JWT needed for IPFS uploads during 8004 registration", type: 'procedural' as const, importance: 0.5 },
    { content: "Railway environment variables set via dashboard or API with PATCH", type: 'procedural' as const, importance: 0.5 },
  ];

  console.log(`Storing ${memories.length} memories...`);
  const ts = performance.now();
  for (const m of memories) {
    await store.remember(m);
  }
  console.log(`  Done in ${(performance.now()-ts).toFixed(0)}ms (${(memories.length / ((performance.now()-ts)/1000)).toFixed(0)} mem/sec)\n`);

  // 25 queries spanning all categories
  const queries = [
    // Identity
    { q: "what's the user's name?", expect: "Sebastien" },
    { q: "where does the user live?", expect: "Singapore" },
    { q: "what was the user's previous job?", expect: "StarHub" },
    { q: "what's the user's email?", expect: "wsebastian" },
    
    // Technical
    { q: "what embedding model does Clude use?", expect: "Voyage" },
    { q: "what database does Clude use?", expect: "Supabase" },
    { q: "what is the token contract address?", expect: "AWGCDT" },
    { q: "how does memory consolidation work?", expect: "dream" },
    { q: "what are the four memory types?", expect: "episodic" },
    
    // Events
    { q: "when was the hackathon deadline?", expect: "February 12" },
    { q: "who is advising on marketing?", expect: "FEiKU" },
    { q: "what's the latest benchmark score?", expect: "83.9" },
    { q: "which VCs are interested?", expect: "Red Beard" },
    { q: "what happened with the 8004 registry?", expect: "Registered" },
    
    // Personal/casual
    { q: "what did the user have for lunch?", expect: "sushi" },
    { q: "what kind of coffee does the user drink?", expect: "oat milk" },
    { q: "does the user prefer cats or dogs?", expect: "cats" },
    { q: "when is the wife's birthday?", expect: "April" },
    { q: "where does the user play sports?", expect: "badminton" },
    { q: "what's the user's favorite restaurant?", expect: "Burnt Ends" },
    
    // Self/meta
    { q: "what's my name?", expect: "Yoshi" },
    { q: "what punctuation should I avoid?", expect: "em-dash" },
    { q: "how should I format tweet options?", expect: "separate message" },
    
    // Cross-domain
    { q: "what's the vesting schedule for tokens?", expect: "20%" },
    { q: "how does Clude compare to SuperMemory?", expect: "SuperMemory" },
  ];

  let passed = 0;
  let top3 = 0;
  let totalMs = 0;

  for (const { q, expect } of queries) {
    const t = performance.now();
    const results = await store.recall({ query: q, limit: 3 });
    const ms = performance.now() - t;
    totalMs += ms;

    const top = results[0];
    const topContent = top?.content || '';
    const hit = topContent.toLowerCase().includes(expect.toLowerCase());
    const inTop3 = results.some(r => r.content.toLowerCase().includes(expect.toLowerCase()));
    
    if (hit) { passed++; top3++; }
    else if (inTop3) { top3++; }
    
    const icon = hit ? '✅' : (inTop3 ? '🔶' : '❌');
    console.log(`${icon} "${q}" (${ms.toFixed(0)}ms)`);
    if (top) {
      console.log(`   sim=${top.similarity.toFixed(3)} score=${top.score.toFixed(3)} | ${topContent.slice(0, 80)}`);
    }
    if (!hit && inTop3) {
      const correct = results.find(r => r.content.toLowerCase().includes(expect.toLowerCase()))!;
      console.log(`   ↳ correct at #${results.indexOf(correct)+1} (sim=${correct.similarity.toFixed(3)})`);
    }
  }

  console.log(`\n📊 Results (${memories.length} memories, ${queries.length} queries):`);
  console.log(`   Top-1 Accuracy: ${passed}/${queries.length} (${(passed/queries.length*100).toFixed(0)}%)`);
  console.log(`   Top-3 Accuracy: ${top3}/${queries.length} (${(top3/queries.length*100).toFixed(0)}%)`);
  console.log(`   Avg recall: ${(totalMs / queries.length).toFixed(0)}ms`);
  console.log(`   Store speed: ${((performance.now()-ts) < 1 ? '<1' : (memories.length / ((performance.now()-ts)/1000)).toFixed(0))} mem/sec`);

  store.close();
}

main().catch(console.error);
