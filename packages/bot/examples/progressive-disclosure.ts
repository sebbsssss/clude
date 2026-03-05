/**
 * Progressive Disclosure — Token-efficient memory retrieval.
 *
 * Uses recallSummaries() to get lightweight previews (~50 tokens each),
 * then hydrate() to fetch full content only for the most relevant ones.
 * This saves tokens when working with large context windows.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_KEY=... npx tsx examples/progressive-disclosure.ts
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

  // Step 1: Get lightweight summaries (cheap — ~50 tokens each)
  const summaries = await brain.recallSummaries({
    query: 'what do users think about the product',
    limit: 10,
  });

  console.log(`Got ${summaries.length} summaries:\n`);
  for (const s of summaries) {
    console.log(`  #${s.id} [${s.type}] ${s.summary}`);
  }

  // Step 2: Pick the top 3 most relevant and hydrate full content
  const topIds = summaries.slice(0, 3).map((s) => s.id);

  if (topIds.length > 0) {
    const full = await brain.hydrate(topIds);

    console.log(`\nHydrated ${full.length} memories:\n`);
    for (const m of full) {
      console.log(`--- Memory #${m.id} (${m.memory_type}) ---`);
      console.log(m.content);
      console.log();
    }
  } else {
    console.log('\nNo memories found. Store some first using basic-memory.ts');
  }

  brain.destroy();
}

main().catch(console.error);
