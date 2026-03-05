/**
 * Basic Memory — Store and recall memories with just Supabase.
 *
 * No embeddings or Anthropic key needed. Retrieval uses keyword + tag scoring.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_KEY=... npx tsx examples/basic-memory.ts
 */

import { Cortex } from 'clude-bot';

async function main() {
  const brain = new Cortex({
    supabase: {
      url: process.env.SUPABASE_URL!,
      serviceKey: process.env.SUPABASE_KEY!,
    },
  });

  await brain.init();

  // Store some memories
  await brain.store({
    type: 'episodic',
    content: 'User asked about Solana transaction fees and was surprised they were so low.',
    summary: 'User surprised by low Solana fees',
    tags: ['solana', 'fees', 'user-question'],
    importance: 0.6,
    source: 'example',
  });

  await brain.store({
    type: 'semantic',
    content: 'Solana transaction fees are typically 0.000005 SOL (~$0.001) per transaction.',
    summary: 'Solana fees are ~$0.001 per tx',
    tags: ['solana', 'fees', 'knowledge'],
    importance: 0.8,
    source: 'example',
  });

  // Recall memories about fees
  const memories = await brain.recall({
    query: 'how much do Solana transactions cost',
    limit: 5,
  });

  console.log(`Recalled ${memories.length} memories:\n`);
  for (const m of memories) {
    console.log(`[${m.memory_type}] ${m.summary}`);
    console.log(`  importance: ${m.importance} | decay: ${m.decay_factor.toFixed(3)}\n`);
  }

  // Format for an LLM prompt
  const context = brain.formatContext(memories);
  console.log('--- LLM context ---');
  console.log(context);

  brain.destroy();
}

main().catch(console.error);
