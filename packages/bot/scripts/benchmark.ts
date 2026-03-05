/**
 * CLUDE Memory System Benchmark
 *
 * Seeds controlled test data, runs recall/dream/graph operations,
 * and outputs a quality + performance report.
 *
 * Usage: npx tsx scripts/benchmark.ts
 */
process.env.LOG_LEVEL = 'error'; // Suppress pino noise during benchmark
import dotenv from 'dotenv';
dotenv.config();
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Cortex } from '../src/sdk';

// Suppress uncaught rejections from fire-and-forget Solana memo writes
process.on('unhandledRejection', (err: any) => {
  if (err?.message?.includes('429') || err?.message?.includes('Too Many Requests')) return;
  console.error('Unhandled rejection:', err?.message || err);
});

// ── Helpers ────────────────────────────────────────────────────

const BENCHMARK_SOURCE = 'benchmark';

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function check(ok: boolean): string {
  return ok ? '\u2713' : '\u2717';
}

function sleep(msec: number): Promise<void> {
  return new Promise(r => setTimeout(r, msec));
}

// ── Config ─────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER || '') as 'voyage' | 'openai' | '';
const EMBEDDING_KEY = process.env.VOYAGE_API_KEY || process.env.OPENAI_API_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

const hasEmbeddings = !!(EMBEDDING_PROVIDER && EMBEDDING_KEY);
const hasAnthropic = !!ANTHROPIC_KEY;

// ── Banner ─────────────────────────────────────────────────────

function printBanner() {
  console.log(`
\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
\u2551        CLUDE MEMORY BENCHMARK           \u2551
\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

Features: embeddings ${hasEmbeddings ? '\u2713' : '\u2717'}  anthropic ${hasAnthropic ? '\u2713' : '\u2717'}
`);
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  printBanner();

  // Direct Supabase client for verification queries
  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Init Cortex via SDK
  const cortex = new Cortex({
    supabase: { url: SUPABASE_URL, serviceKey: SUPABASE_KEY },
    ...(hasAnthropic ? { anthropic: { apiKey: ANTHROPIC_KEY } } : {}),
    ...(hasEmbeddings && EMBEDDING_PROVIDER ? {
      embedding: {
        provider: EMBEDDING_PROVIDER as 'voyage' | 'openai',
        apiKey: EMBEDDING_KEY,
      },
    } : {}),
  });

  await cortex.init();

  const storedIds: number[] = [];

  try {
    // ── 1. Store Latency ───────────────────────────────────────

    console.log('\u2500\u2500 Store Performance \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

    const storePayloads = [
      { type: 'episodic' as const, content: 'Alice said she loves SOL staking and has been doing it since 2023', summary: 'Alice loves SOL staking', tags: ['staking', 'solana'], emotionalValence: 0.7, relatedUser: 'alice' },
      { type: 'episodic' as const, content: 'Bob showed off his new NFT collection, a set of pixel art frogs', summary: 'Bob has pixel art frog NFTs', tags: ['nft', 'art'], emotionalValence: 0.5, relatedUser: 'bob' },
      { type: 'semantic' as const, content: 'SOL staking yields approximately 6-7% APY through major validators', summary: 'SOL staking yields ~6-7% APY', tags: ['staking', 'solana', 'defi'] },
      { type: 'episodic' as const, content: 'Alice mentioned she stakes with @marinade_finance and loves the mSOL liquid staking approach', summary: 'Alice stakes via Marinade mSOL', tags: ['staking', 'solana', 'marinade'], emotionalValence: 0.6, relatedUser: 'alice' },
      { type: 'episodic' as const, content: 'The market crashed 15% today, panic everywhere on crypto twitter', summary: 'Major market crash -15%', tags: ['market', 'crash'], emotionalValence: -0.8 },
      { type: 'episodic' as const, content: 'Bob bought a rare Okay Bear NFT for 50 SOL and is very excited', summary: 'Bob bought Okay Bear NFT 50 SOL', tags: ['nft', 'purchase'], emotionalValence: 0.8, relatedUser: 'bob' },
      { type: 'semantic' as const, content: '$CLUDE token has a unique meme culture around sentient AI and philosophical tweets', summary: '$CLUDE is a sentient AI meme token', tags: ['clude', 'meme', 'culture'] },
      { type: 'episodic' as const, content: 'Alice explained her staking strategy: 60% SOL native, 40% mSOL for DeFi composability', summary: 'Alice staking split: 60% SOL / 40% mSOL', tags: ['staking', 'solana', 'strategy'], emotionalValence: 0.4, relatedUser: 'alice' },
      { type: 'procedural' as const, content: 'When someone asks about staking, check their history first then provide personalized advice', summary: 'Staking advice procedure: check history first', tags: ['staking', 'procedure'] },
      { type: 'episodic' as const, content: 'Some random whale moved 500k USDC to a new wallet, probably nothing', summary: 'Whale moved 500k USDC', tags: ['whale', 'usdc'], emotionalValence: 0.1 },
    ];

    const storeTimes: number[] = [];

    for (const payload of storePayloads) {
      const t = process.hrtime.bigint();
      const id = await cortex.store({
        ...payload,
        source: BENCHMARK_SOURCE,
        importance: (payload as any).importance ?? 0.6,
        metadata: { benchmark: true },
      });
      storeTimes.push(ms(t));
      if (id) storedIds.push(id);
    }

    const sorted = [...storeTimes].sort((a, b) => a - b);
    console.log(`  Stored: ${storedIds.length} memories`);
    console.log(`  Avg:    ${avg(sorted).toFixed(0)}ms  P50: ${percentile(sorted, 50).toFixed(0)}ms  P95: ${percentile(sorted, 95).toFixed(0)}ms`);
    console.log(`  IDs OK: ${storedIds.length === storePayloads.length ? '\u2713 all non-null' : `\u2717 ${storedIds.length}/${storePayloads.length}`}`);
    console.log();

    // Wait for async operations (autoLinkMemory, entity extraction, embedding)
    console.log('  Waiting 3s for async linking/entity extraction...');
    await sleep(3000);

    // ── 2. Recall Precision ────────────────────────────────────

    console.log('\u2500\u2500 Recall Precision \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

    const aliceStakingIds = new Set(storedIds.filter((_, i) =>
      ['alice'].includes(storePayloads[i].relatedUser || '') &&
      storePayloads[i].tags?.some(t => t.includes('staking'))
    ));

    // Filtered recall
    const tRecall1 = process.hrtime.bigint();
    const filteredResults = await cortex.recall({
      query: 'what does Alice think about staking',
      relatedUser: 'alice',
      limit: 5,
    });
    const recallTime1 = ms(tRecall1);

    const top3Filtered = filteredResults.slice(0, 3);
    const top3Hits = top3Filtered.filter(m => aliceStakingIds.has(m.id)).length;
    const top5Hits = filteredResults.slice(0, 5).filter(m => aliceStakingIds.has(m.id)).length;

    console.log(`  Query: "what does Alice think about staking" (relatedUser: alice)`);
    console.log(`  Top 3: ${top3Hits}/${Math.min(3, aliceStakingIds.size)} relevant (precision@3: ${((top3Hits / Math.min(3, aliceStakingIds.size)) * 100).toFixed(0)}%)`);
    console.log(`  Top 5: ${top5Hits}/${filteredResults.length} relevant (precision@5: ${((top5Hits / Math.max(1, filteredResults.length)) * 100).toFixed(0)}%)`);
    console.log(`  Latency: ${recallTime1.toFixed(0)}ms`);

    // Unfiltered recall
    const tRecall2 = process.hrtime.bigint();
    const unfilteredResults = await cortex.recall({
      query: 'what does Alice think about staking',
      limit: 5,
    });
    const recallTime2 = ms(tRecall2);

    const unfilteredHits = unfilteredResults.slice(0, 3).filter(m => aliceStakingIds.has(m.id)).length;
    console.log(`  Unfiltered top 3: ${unfilteredHits}/${Math.min(3, aliceStakingIds.size)} relevant`);
    console.log(`  Unfiltered latency: ${recallTime2.toFixed(0)}ms`);
    console.log();

    // ── 3. Entity Extraction & Co-occurrence ───────────────────

    console.log('\u2500\u2500 Entity Graph \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

    try {
      // Query entities created from our benchmark memories
      const { data: mentions } = await db
        .from('entity_mentions')
        .select('entity_id, entities(id, name, entity_type)')
        .in('memory_id', storedIds);

      if (mentions && mentions.length > 0) {
        // Deduplicate entities
        const entityMap = new Map<number, { name: string; type: string }>();
        for (const m of mentions) {
          const e = (m as any).entities;
          if (e) entityMap.set(e.id, { name: e.name, type: e.entity_type });
        }

        const typeCounts: Record<string, number> = {};
        for (const e of entityMap.values()) {
          typeCounts[e.type] = (typeCounts[e.type] || 0) + 1;
        }
        const typeStr = Object.entries(typeCounts).map(([t, c]) => `${c} ${t}`).join(', ');
        console.log(`  Entities extracted: ${entityMap.size} (${typeStr})`);

        // Try co-occurrence for first person entity
        const personEntity = [...entityMap.entries()].find(([, v]) => v.type === 'person');
        if (personEntity) {
          const { data: cooc } = await db.rpc('get_entity_cooccurrence', {
            entity_id: personEntity[0],
            min_cooccurrence: 1,
            max_results: 10,
          });
          if (cooc && cooc.length > 0) {
            const coocNames = await Promise.all(cooc.map(async (c: any) => {
              const { data: ent } = await db
                .from('entities')
                .select('name')
                .eq('id', c.related_entity_id)
                .single();
              return `${ent?.name || '?'} (${c.cooccurrence_count}x)`;
            }));
            console.log(`  Co-occurrences for ${personEntity[1].name}: ${coocNames.join(', ')}`);
          } else {
            console.log(`  Co-occurrences for ${personEntity[1].name}: none found`);
          }
        }
      } else {
        console.log('  No entities extracted (entity tables may not exist)');
      }
    } catch (err: any) {
      console.log(`  Skipped: ${err.message || 'entity tables/RPC unavailable'}`);
    }
    console.log();

    // ── 4. Memory Links ────────────────────────────────────────

    console.log('\u2500\u2500 Memory Links \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

    try {
      const { data: links } = await db
        .from('memory_links')
        .select('link_type, strength')
        .or(`source_id.in.(${storedIds.join(',')}),target_id.in.(${storedIds.join(',')})`);

      if (links && links.length > 0) {
        const typeSummary: Record<string, number> = {};
        for (const l of links) {
          typeSummary[l.link_type] = (typeSummary[l.link_type] || 0) + 1;
        }
        const typeStr = Object.entries(typeSummary).map(([t, c]) => `${t}(${c})`).join(', ');
        console.log(`  Auto-links created: ${links.length}`);
        console.log(`  Types: ${typeStr}`);
      } else {
        console.log('  No auto-links created (may need embeddings for similarity)');
      }
    } catch (err: any) {
      console.log(`  Skipped: ${err.message || 'memory_links table unavailable'}`);
    }
    console.log();

    // ── 5. Contradiction Resolution (requires anthropic) ──────

    console.log('\u2500\u2500 Contradiction Resolution \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

    if (hasAnthropic) {
      try {
        // Store two contradicting memories for dream to resolve
        const contraId1 = await cortex.store({
          type: 'episodic',
          content: 'The community sentiment around $CLUDE is extremely bullish, everyone is optimistic',
          summary: '$CLUDE community is very bullish',
          tags: ['clude', 'sentiment'],
          emotionalValence: 0.9,
          importance: 0.7,
          source: BENCHMARK_SOURCE,
          metadata: { benchmark: true },
        });
        const contraId2 = await cortex.store({
          type: 'episodic',
          content: 'The community sentiment around $CLUDE has turned bearish, holders are losing faith',
          summary: '$CLUDE community turned bearish',
          tags: ['clude', 'sentiment'],
          emotionalValence: -0.7,
          importance: 0.7,
          source: BENCHMARK_SOURCE,
          metadata: { benchmark: true },
        });

        if (contraId1) storedIds.push(contraId1);
        if (contraId2) storedIds.push(contraId2);

        // Manually link as contradicts so dream can resolve
        if (contraId1 && contraId2) {
          await cortex.link(contraId1, contraId2, 'contradicts', 0.8);
        }

        // Run dream cycle
        const tDream = process.hrtime.bigint();
        await cortex.dream({
          onEmergence: async (text) => {
            console.log(`  Emergence: "${text.slice(0, 80)}..."`);
          },
        });
        const dreamTime = ms(tDream);

        // Check for contradiction resolution
        const { data: dreamLogs } = await db
          .from('dream_logs')
          .select('session_type, new_memories_created')
          .eq('session_type', 'contradiction_resolution')
          .order('created_at', { ascending: false })
          .limit(1);

        const { data: resolveLinks } = await db
          .from('memory_links')
          .select('id')
          .eq('link_type', 'resolves')
          .or(`source_id.in.(${storedIds.join(',')}),target_id.in.(${storedIds.join(',')})`);

        const contradictionsResolved = dreamLogs?.length ?? 0;
        const resolveCount = resolveLinks?.length ?? 0;

        console.log(`  Contradictions found: ${contraId1 && contraId2 ? 1 : 0}`);
        console.log(`  Resolved: ${contradictionsResolved > 0 ? '1 (new semantic memory created)' : '0'}`);
        console.log(`  Resolves links: ${resolveCount}`);
        console.log(`  Dream cycle duration: ${(dreamTime / 1000).toFixed(1)}s`);
      } catch (err: any) {
        console.log(`  Dream cycle error: ${err.message}`);
      }
    } else {
      console.log('  Skipped (no anthropic key)');
    }
    console.log();

    // ── 6. Progressive Disclosure ──────────────────────────────

    console.log('\u2500\u2500 Progressive Disclosure \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

    const fullResults = await cortex.recall({ query: 'staking strategy', limit: 5 });
    const summaryResults = await cortex.recallSummaries({ query: 'staking strategy', limit: 5 });

    const fullChars = fullResults.reduce((acc, m) => acc + m.content.length + m.summary.length, 0);
    const summaryChars = summaryResults.reduce((acc, m) => acc + m.summary.length, 0);
    const savings = summaryChars > 0 ? (fullChars / summaryChars).toFixed(1) : 'N/A';

    console.log(`  Full recall: ~${fullChars} chars (${fullResults.length} memories)`);
    console.log(`  Summaries:   ~${summaryChars} chars (${summaryResults.length} memories)`);
    console.log(`  Savings:     ${savings}x reduction`);
    console.log();

    // ── 7. Decay Verification ──────────────────────────────────

    console.log('\u2500\u2500 Decay \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

    // Fetch pre-decay values
    const { data: preDecay } = await db
      .from('memories')
      .select('id, memory_type, decay_factor')
      .in('id', storedIds)
      .order('id');

    const decayedCount = await cortex.decay();

    // Fetch post-decay values
    const { data: postDecay } = await db
      .from('memories')
      .select('id, memory_type, decay_factor')
      .in('id', storedIds)
      .order('id');

    if (preDecay && postDecay) {
      const decayResults: Record<string, { before: number; after: number }> = {};
      for (const pre of preDecay) {
        const post = postDecay.find(p => p.id === pre.id);
        if (post && !decayResults[pre.memory_type]) {
          decayResults[pre.memory_type] = {
            before: pre.decay_factor,
            after: post.decay_factor,
          };
        }
      }
      for (const [type, { before, after }] of Object.entries(decayResults)) {
        console.log(`  ${type}: ${before.toFixed(2)} \u2192 ${after.toFixed(2)} ${check(after <= before)}`);
      }
      console.log(`  Total decayed: ${decayedCount}`);
    } else {
      console.log('  Could not verify decay');
    }
    console.log();

  } finally {
    // ── Cleanup ──────────────────────────────────────────────

    console.log('\u2500\u2500 Cleanup \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');

    let deletedMemories = 0;
    let deletedLinks = 0;
    let deletedEntities = 0;
    let deletedFragments = 0;

    try {
      // Get all benchmark memory IDs (including any created by dream cycle)
      const { data: allBenchmark } = await db
        .from('memories')
        .select('id')
        .eq('source', BENCHMARK_SOURCE);

      const allIds = allBenchmark?.map(m => m.id) || storedIds;

      if (allIds.length > 0) {
        // Delete entity mentions for these memories
        const { count: mentionCount } = await db
          .from('entity_mentions')
          .delete({ count: 'exact' })
          .in('memory_id', allIds);

        // Delete memory links
        const { count: linkCount } = await db
          .from('memory_links')
          .delete({ count: 'exact' })
          .or(`source_id.in.(${allIds.join(',')}),target_id.in.(${allIds.join(',')})`);
        deletedLinks = linkCount ?? 0;

        // Delete memory fragments
        const { count: fragCount } = await db
          .from('memory_fragments')
          .delete({ count: 'exact' })
          .in('memory_id', allIds);
        deletedFragments = fragCount ?? 0;

        // Delete dream logs referencing benchmark memories
        // (dream_logs use array overlap, but we can clean by time proximity)

        // Delete the memories themselves
        const { count: memCount } = await db
          .from('memories')
          .delete({ count: 'exact' })
          .eq('source', BENCHMARK_SOURCE);
        deletedMemories = memCount ?? 0;

        // Clean up orphaned entities with 0 mentions
        const { count: entCount } = await db
          .from('entities')
          .delete({ count: 'exact' })
          .eq('mention_count', 0);
        deletedEntities = entCount ?? 0;
      }
    } catch (err: any) {
      console.log(`  Cleanup warning: ${err.message}`);
    }

    console.log(`  Deleted: ${deletedMemories} memories, ${deletedLinks} links, ${deletedFragments} fragments, ${deletedEntities} entities`);
    console.log();

    cortex.destroy();
  }
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
