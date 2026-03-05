/**
 * 🐝 CLUDE Swarm Demo — Multiple agents sharing memory through Clude
 *
 * Run: SUPABASE_URL=... SUPABASE_KEY=... VOYAGE_API_KEY=... VENICE_API_KEY=... npx tsx examples/swarm-demo.ts
 *
 * Shows:
 * 1. Three agents (Researcher, Coder, Reviewer) share a single memory engine
 * 2. Agent A stores knowledge → Agent B recalls it instantly
 * 3. Agents build collective intelligence in real-time
 */

import { SupabaseProvider } from '../src/supabase-provider.js';
import { VoyageEmbeddings } from '../src/voyage-embeddings.js';
import { VeniceLLM } from '../src/venice-llm.js';

// ── Config ───────────────────────────────────────────────────

const OWNER_WALLET = process.env.OWNER_WALLET || '5vK6WRCq5V6BCte8cQvaNeNv2KzErCfGzeBDwtBGGv2r';

const storage = new SupabaseProvider({
  url: process.env.SUPABASE_URL!,
  serviceKey: process.env.SUPABASE_KEY!,
});

const embeddings = new VoyageEmbeddings({
  apiKey: process.env.VOYAGE_API_KEY!,
});

const llm = new VeniceLLM({
  apiKey: process.env.VENICE_API_KEY!,
  model: 'llama-3.3-70b',
});

const scope = { owner_wallet: OWNER_WALLET };

// ── Agent abstraction ────────────────────────────────────────

interface Agent {
  name: string;
  role: string;
  emoji: string;
}

const agents: Agent[] = [
  { name: 'Researcher', role: 'Finds and validates information', emoji: '🔬' },
  { name: 'Coder', role: 'Writes and reviews code', emoji: '💻' },
  { name: 'Reviewer', role: 'Evaluates quality and catches issues', emoji: '🔍' },
];

function log(agent: Agent, msg: string) {
  console.log(`  ${agent.emoji} [${agent.name}] ${msg}`);
}

// ── Store a memory (any agent can do this) ───────────────────

async function remember(agent: Agent, content: string, summary: string, type: 'episodic' | 'semantic' = 'semantic') {
  const embedding = await embeddings.embed(summary);
  const hashId = `clude-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  const mem = await storage.insert({
    id: hashId,
    memory_type: type,
    content,
    summary,
    tags: [agent.name.toLowerCase(), 'swarm-demo'],
    concepts: [],
    emotional_valence: 0,
    importance: 0.7,
    access_count: 0,
    source: `agent:${agent.name.toLowerCase()}`,
    metadata: { agent: agent.name, role: agent.role },
    created_at: new Date().toISOString(),
    last_accessed: new Date().toISOString(),
    decay_factor: 1.0,
    owner_wallet: OWNER_WALLET,
  });

  await storage.storeEmbedding(mem.id, embedding);
  log(agent, `Stored: "${summary}"`);
  return mem;
}

// ── Recall memories (any agent can access all shared memories) ──

async function recall(agent: Agent, query: string, limit = 3) {
  const queryEmb = await embeddings.embedQuery(query);
  const results = await storage.vectorSearch({
    embedding: queryEmb,
    threshold: 0.25,
    limit,
    scope,
  });

  if (results.length === 0) {
    log(agent, `Recall "${query}" → nothing found`);
    return [];
  }

  const memories = await storage.getByIds(results.map(r => r.id), scope);
  log(agent, `Recall "${query}" → ${memories.length} memories found:`);
  for (const m of memories) {
    const sim = results.find(r => r.id === m.id)?.similarity || 0;
    const source = (m.metadata as any)?.agent || m.source;
    console.log(`    📎 [${sim.toFixed(2)}] (from ${source}) ${m.summary}`);
  }
  return memories;
}

// ── Think using LLM + recalled context ───────────────────────

async function think(agent: Agent, task: string): Promise<string> {
  // First recall relevant context
  const context = await recall(agent, task, 5);
  const contextStr = context.map(m => `- ${m.summary}: ${m.content}`).join('\n');

  const response = await llm.generate({
    system: `You are ${agent.name}, a ${agent.role}. You work in a swarm of AI agents that share memory through Clude. Be concise (2-3 sentences max).`,
    prompt: contextStr
      ? `Context from shared memory:\n${contextStr}\n\nTask: ${task}`
      : `Task: ${task}`,
    max_tokens: 150,
    temperature: 0.7,
  });

  log(agent, `Thinks: "${response.trim()}"`);
  return response.trim();
}

// ── Demo Scenario ────────────────────────────────────────────

async function main() {
  console.log('\n🐝 CLUDE SWARM DEMO');
  console.log('═'.repeat(50));
  console.log('Three agents sharing memory through Clude\n');

  const [researcher, coder, reviewer] = agents;

  // ── Step 1: Researcher discovers knowledge ──
  console.log('\n📍 Step 1: Researcher discovers knowledge\n');

  await remember(researcher, 
    'Voyage-4-Large produces 1024-dim embeddings with tight cosine distributions (0.3-0.7 range for most queries). Use threshold 0.25 instead of standard 0.4.',
    'Voyage-4-Large embedding threshold should be 0.25, not 0.4',
    'semantic'
  );

  await remember(researcher,
    'gte-small (384 dims) clusters everything between 0.8-0.92 similarity. Need normSim spread to differentiate. Good for local/edge, not production.',
    'gte-small has compressed similarity space, needs normalization',
    'semantic'
  );

  // ── Step 2: Coder builds on researcher's findings ──
  console.log('\n📍 Step 2: Coder uses shared knowledge\n');

  const coderThought = await think(coder, 'How should I configure vector search thresholds for our embedding model?');
  
  await remember(coder,
    `Based on shared research: ${coderThought}`,
    'Implemented adaptive vector threshold based on embedding model',
    'procedural'
  );

  // ── Step 3: Reviewer synthesizes everything ──
  console.log('\n📍 Step 3: Reviewer synthesizes collective knowledge\n');

  const reviewerThought = await think(reviewer, 'Review our embedding and vector search approach. Are there any issues?');

  await remember(reviewer,
    `Review findings: ${reviewerThought}`,
    'Review of embedding pipeline and vector search configuration',
    'semantic'
  );

  // ── Step 4: Any agent can now recall the full picture ──
  console.log('\n📍 Step 4: New agent joins and has full context\n');

  const newAgent: Agent = { name: 'Newcomer', role: 'Just joined the swarm', emoji: '🆕' };
  await recall(newAgent, 'What do I need to know about our embedding and search setup?', 5);

  // ── Stats ──
  console.log('\n' + '═'.repeat(50));
  const count = await storage.count(scope);
  console.log(`📊 Total shared memories: ${count}`);
  console.log('═'.repeat(50) + '\n');

  // Cleanup demo memories
  const demoMems = await storage.queryBySource({ source: 'agent:researcher', scope });
  const demoMems2 = await storage.queryBySource({ source: 'agent:coder', scope });
  const demoMems3 = await storage.queryBySource({ source: 'agent:reviewer', scope });
  for (const m of [...demoMems, ...demoMems2, ...demoMems3]) {
    if (m.tags.includes('swarm-demo')) await storage.delete(m.id, scope);
  }
  console.log('🧹 Cleaned up demo memories\n');
}

main().catch(err => { console.error('❌', err); process.exit(1); });
