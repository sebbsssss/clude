/**
 * Hosted Mode — Zero-setup memory with just an API key.
 *
 * No Supabase, no Anthropic key, no infrastructure. Memories are stored
 * on CLUDE infrastructure, isolated by your API key.
 *
 * Get a key:
 *   npx @clude/sdk register
 *
 * Usage:
 *   CORTEX_API_KEY=clk_... npx tsx examples/hosted-mode.ts
 */

import { Cortex } from '@clude/sdk';

async function main() {
  const apiKey = process.env.CORTEX_API_KEY;
  if (!apiKey) {
    console.error('Set CORTEX_API_KEY env var. Get one with: npx @clude/sdk register');
    process.exit(1);
  }

  const brain = new Cortex({
    hosted: { apiKey },
  });

  await brain.init();
  console.log('Connected to Cortex.\n');

  // Store some memories
  const id1 = await brain.store({
    type: 'episodic',
    content: 'User asked about Solana transaction fees and was surprised they were so low.',
    summary: 'User surprised by low Solana fees',
    tags: ['solana', 'fees', 'user-question'],
    importance: 0.6,
    source: 'example',
  });
  console.log(`Stored episodic memory: ${id1}`);

  const id2 = await brain.store({
    type: 'semantic',
    content: 'Solana transaction fees are typically 0.000005 SOL (~$0.001) per transaction.',
    summary: 'Solana fees are ~$0.001 per tx',
    tags: ['solana', 'fees', 'knowledge'],
    importance: 0.8,
    source: 'example',
  });
  console.log(`Stored semantic memory: ${id2}`);

  // Recall memories about fees
  const memories = await brain.recall({
    query: 'how much do Solana transactions cost',
    limit: 5,
  });

  console.log(`\nRecalled ${memories.length} memories:\n`);
  for (const m of memories) {
    console.log(`  [${m.memory_type}] ${m.summary}`);
    console.log(`    importance: ${m.importance} | decay: ${m.decay_factor.toFixed(3)}\n`);
  }

  // Check stats
  const stats = await brain.stats();
  console.log('--- Stats ---');
  console.log(`Total memories: ${stats.total}`);
  console.log(`By type: ${JSON.stringify(stats.byType)}`);

  brain.destroy();
}

main().catch(console.error);
