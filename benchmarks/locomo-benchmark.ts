/**
 * CLUDE × LoCoMo Benchmark
 *
 * Real evaluation against the LoCoMo dataset (ACL 2024).
 * Seeds conversation data into Cortex, tests recall + answer generation,
 * and scores against gold answers with LLM-as-judge.
 *
 * Dataset: https://github.com/snap-research/locomo
 * 10 conversations, ~1,986 QA pairs, 5 categories.
 *
 * Usage: npx tsx scripts/locomo-benchmark.ts
 *   --conversations N  (default: all 10)
 *   --categories 1,2,3 (default: 1,2,3,4 — excludes adversarial)
 *   --limit N          (max QA pairs per conversation, default: all)
 *   --skip-cleanup     (keep benchmark data in DB after run)
 *   --recall-limit N   (memories to retrieve per query, default: 15)
 */
process.env.LOG_LEVEL = 'error';
import dotenv from 'dotenv';
dotenv.config();
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { Cortex } from '../src/sdk';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';

// Suppress uncaught rejections from fire-and-forget operations
process.on('unhandledRejection', (err: any) => {
  if (err?.message?.includes('429') || err?.message?.includes('Too Many Requests')) return;
  // Don't crash on non-critical async errors during benchmark
});

// ── Types ─────────────────────────────────────────────────────

interface DialogTurn {
  speaker: string;
  dia_id: string;
  text: string;
  img_url?: string;
  blip_caption?: string;
}

interface QAPair {
  question: string;
  answer: string;
  category: number; // 1-5
  evidence: string[]; // dia_id references
}

interface LoCoMoConversation {
  sample_id: string;
  conversation: {
    speaker_a: string;
    speaker_b: string;
    [key: string]: any; // session_N, session_N_date_time
  };
  observation?: Record<string, string[]>;
  session_summary?: Record<string, string>;
  event_summary?: Record<string, Record<string, string[]>>;
  qa: QAPair[];
}

interface QAResult {
  conversationId: string;
  question: string;
  goldAnswer: string;
  generatedAnswer: string;
  category: number;
  correct: number; // 0 or 1
  f1: number;
  recallLatencyMs: number;
  memoriesReturned: number;
  evidenceHits: number;
  evidenceTotal: number;
}

interface CategoryStats {
  correct: number;
  total: number;
  f1Sum: number;
  recallLatencySum: number;
  memoriesReturnedSum: number;
  evidenceHits: number;
  evidenceTotal: number;
}

// ── Config ────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;
const EMBEDDING_PROVIDER = (process.env.EMBEDDING_PROVIDER || '') as 'voyage' | 'openai' | '';
const EMBEDDING_KEY = process.env.EMBEDDING_API_KEY || process.env.VOYAGE_API_KEY || process.env.OPENAI_API_KEY || '';

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}
if (!ANTHROPIC_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in .env (required for answer generation + judging)');
  process.exit(1);
}

const hasEmbeddings = !!(EMBEDDING_PROVIDER && EMBEDDING_KEY);

const BENCHMARK_SOURCE = 'locomo-benchmark';
// Deterministic fake wallet for memory isolation — ensures benchmark doesn't mix with production data
const BENCHMARK_OWNER_WALLET = 'LoCoMoBenchmark111111111111111111111111111111';
const CACHE_DIR = join(__dirname, '.locomo-cache');
const DATASET_PATH = join(CACHE_DIR, 'locomo10.json');
const RESULTS_PATH = join(CACHE_DIR, 'results.json');
const DATASET_URL = 'https://raw.githubusercontent.com/snap-research/locomo/main/data/locomo10.json';

// Judge model — Haiku for cost efficiency
const JUDGE_MODEL = 'claude-haiku-4-5-20251001';

// ── CLI Args ──────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    maxConversations: 10,
    categories: new Set([1, 2, 3, 4]),
    qaLimit: Infinity,
    skipCleanup: false,
    recallLimit: 25,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--conversations':
        opts.maxConversations = parseInt(args[++i]) || 10;
        break;
      case '--categories':
        opts.categories = new Set(args[++i].split(',').map(Number));
        break;
      case '--limit':
        opts.qaLimit = parseInt(args[++i]) || Infinity;
        break;
      case '--skip-cleanup':
        opts.skipCleanup = true;
        break;
      case '--recall-limit':
        opts.recallLimit = parseInt(args[++i]) || 15;
        break;
    }
  }

  return opts;
}

// ── Helpers ───────────────────────────────────────────────────

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function sleep(msec: number): Promise<void> {
  return new Promise(r => setTimeout(r, msec));
}

/** Token-level F1 score between two strings */
function tokenF1(predicted: string, reference: string): number {
  const predTokens = String(predicted || '').toLowerCase().split(/\s+/).filter(Boolean);
  const refTokens = String(reference || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (predTokens.length === 0 && refTokens.length === 0) return 1;
  if (predTokens.length === 0 || refTokens.length === 0) return 0;

  const refSet = new Set(refTokens);
  const predSet = new Set(predTokens);

  let overlap = 0;
  for (const t of predTokens) {
    if (refSet.has(t)) overlap++;
  }

  const precision = overlap / predTokens.length;
  const recall = overlap / refTokens.length;

  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

const CATEGORY_NAMES: Record<number, string> = {
  1: 'Single-hop',
  2: 'Multi-hop',
  3: 'Temporal',
  4: 'Open-domain',
  5: 'Adversarial',
};

/** Poll DB until embeddings are generated for a given set of memory IDs, or timeout. */
async function waitForEmbeddings(db: SupabaseClient, expectedCount: number, timeoutMs: number = 90000): Promise<number> {
  const start = Date.now();
  const pollInterval = 3000;
  let lastCount = 0;
  let stableRounds = 0;

  while (Date.now() - start < timeoutMs) {
    const { count } = await db
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('owner_wallet', BENCHMARK_OWNER_WALLET)
      .not('embedding', 'is', null);

    const embedded = count || 0;

    if (embedded >= expectedCount) {
      return embedded;
    }

    // If count hasn't changed for 3 polls, embeddings are likely stuck/done
    if (embedded === lastCount) {
      stableRounds++;
      if (stableRounds >= 3) return embedded;
    } else {
      stableRounds = 0;
    }
    lastCount = embedded;

    await sleep(pollInterval);
  }

  return lastCount;
}

/** Extract session numbers and their dialog turns from a conversation object */
function extractSessions(conv: LoCoMoConversation['conversation']): {
  sessionNum: number;
  dateTime: string | null;
  turns: DialogTurn[];
}[] {
  const sessions: { sessionNum: number; dateTime: string | null; turns: DialogTurn[] }[] = [];

  for (const key of Object.keys(conv)) {
    const match = key.match(/^session_(\d+)$/);
    if (!match) continue;
    const num = parseInt(match[1]);
    const turns = conv[key] as DialogTurn[];
    const dateTime = conv[`session_${num}_date_time`] || null;
    sessions.push({ sessionNum: num, dateTime, turns });
  }

  sessions.sort((a, b) => a.sessionNum - b.sessionNum);
  return sessions;
}

// ── Dataset Download ──────────────────────────────────────────

async function ensureDataset(): Promise<LoCoMoConversation[]> {
  mkdirSync(CACHE_DIR, { recursive: true });

  if (existsSync(DATASET_PATH)) {
    console.log('  Using cached dataset');
    return JSON.parse(readFileSync(DATASET_PATH, 'utf-8'));
  }

  console.log('  Downloading LoCoMo dataset from GitHub...');
  const resp = await fetch(DATASET_URL);
  if (!resp.ok) throw new Error(`Failed to download dataset: ${resp.status} ${resp.statusText}`);

  const text = await resp.text();
  writeFileSync(DATASET_PATH, text);
  console.log(`  Saved to ${DATASET_PATH}`);
  return JSON.parse(text);
}

// ── Cleanup ───────────────────────────────────────────────────

async function cleanupBenchmarkData(db: SupabaseClient): Promise<void> {
  // Get all benchmark memory IDs (scoped by both source AND owner_wallet for safety)
  const { data: benchmarkMemories } = await db
    .from('memories')
    .select('id')
    .eq('owner_wallet', BENCHMARK_OWNER_WALLET);

  const allIds = benchmarkMemories?.map(m => m.id) || [];
  if (allIds.length === 0) return;

  // Delete in correct order for FK constraints
  try {
    await db.from('entity_mentions').delete().in('memory_id', allIds);
  } catch { /* table may not exist */ }

  try {
    await db.from('memory_links').delete()
      .or(`source_id.in.(${allIds.join(',')}),target_id.in.(${allIds.join(',')})`);
  } catch { /* table may not exist */ }

  try {
    await db.from('memory_fragments').delete().in('memory_id', allIds);
  } catch { /* table may not exist */ }

  await db.from('memories').delete().eq('owner_wallet', BENCHMARK_OWNER_WALLET);

  // Clean orphaned entities
  try {
    await db.from('entities').delete().eq('mention_count', 0);
  } catch { /* table may not exist */ }
}

// ── LLM Calls ─────────────────────────────────────────────────

let anthropic: Anthropic;

async function generateAnswer(context: string, question: string): Promise<string> {
  const resp = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 300,
    system: `You are answering questions about conversations between people based on memory context.

Rules:
- Use the provided context to answer the question.
- Extract specific details: names, dates, places, numbers, preferences, opinions.
- If the context contains partial information, provide what you can infer from it.
- If the context discusses something related, use reasoning to connect the dots.
- Answer directly with the specific information requested. Do NOT add qualifiers like "Based on the context" or "According to the memories".
- Only say "I don't know" if the context contains absolutely nothing related to the question.
- Keep answers concise (1-3 sentences).`,
    messages: [{
      role: 'user',
      content: `Memory context:\n${context}\n\nQuestion: ${question}\n\nAnswer:`,
    }],
  });

  return resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
}

async function judgeAnswer(generated: string, reference: string, question: string): Promise<number> {
  const resp = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 10,
    system: `You are a strict evaluator. Compare a generated answer to a reference answer for the given question. Reply with ONLY "1" if the generated answer captures the key information from the reference (even if worded differently), or "0" if it is wrong, incomplete on key facts, or says "I don't know" when the reference has a clear answer.`,
    messages: [{
      role: 'user',
      content: `Question: ${question}\nGenerated answer: ${generated}\nReference answer: ${reference}\n\nScore (1 or 0):`,
    }],
  });

  const text = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '0';
  return text.startsWith('1') ? 1 : 0;
}

/** Build context optimized for benchmark QA — uses full content, not just summary. */
function formatBenchmarkContext(memories: any[]): string {
  if (memories.length === 0) return 'No relevant memories found.';

  const lines: string[] = [];

  // Separate by type for structured context
  const semantic = memories.filter((m: any) => m.memory_type === 'semantic');
  const episodic = memories.filter((m: any) => m.memory_type === 'episodic');
  const other = memories.filter((m: any) => m.memory_type !== 'semantic' && m.memory_type !== 'episodic');

  if (semantic.length > 0) {
    lines.push('## Key Facts & Summaries');
    for (const m of semantic) {
      const content = m.content || m.summary;
      const date = m.metadata?.event_date || '';
      lines.push(`- ${date ? `[${date}] ` : ''}${content}`);
    }
    lines.push('');
  }

  if (episodic.length > 0) {
    lines.push('## Conversation History');
    for (const m of episodic) {
      const content = m.content || m.summary;
      const date = m.metadata?.event_date || '';
      const session = m.metadata?.session ? `Session ${m.metadata.session}` : '';
      const prefix = [date, session].filter(Boolean).join(', ');
      lines.push(`- ${prefix ? `[${prefix}] ` : ''}${content}`);
    }
    lines.push('');
  }

  if (other.length > 0) {
    lines.push('## Additional Context');
    for (const m of other) {
      lines.push(`- ${m.content || m.summary}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log(`
╔════════════════════════════════════════════╗
║     CLUDE × LoCoMo BENCHMARK              ║
╚════════════════════════════════════════════╝
`);

  console.log(`Config: embeddings ${hasEmbeddings ? '✓' : '✗'}  anthropic ✓  judge: ${JUDGE_MODEL}`);
  console.log(`Options: conversations=${opts.maxConversations}  categories=[${[...opts.categories].join(',')}]  recall_limit=${opts.recallLimit}`);
  console.log();

  // Initialize clients
  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const cortex = new Cortex({
    supabase: { url: SUPABASE_URL, serviceKey: SUPABASE_KEY },
    anthropic: { apiKey: ANTHROPIC_KEY },
    ownerWallet: BENCHMARK_OWNER_WALLET, // Isolate benchmark memories from production
    ...(hasEmbeddings && EMBEDDING_PROVIDER ? {
      embedding: {
        provider: EMBEDDING_PROVIDER as 'voyage' | 'openai',
        apiKey: EMBEDDING_KEY,
      },
    } : {}),
  });

  await cortex.init();

  // Download dataset
  console.log('── Dataset ─────────────────────────────────────');
  const dataset = await ensureDataset();
  const conversations = dataset.slice(0, opts.maxConversations);

  let totalQA = 0;
  let evaluableQA = 0;
  for (const conv of conversations) {
    for (const qa of conv.qa) {
      totalQA++;
      if (opts.categories.has(qa.category)) evaluableQA++;
    }
  }
  console.log(`  Conversations: ${conversations.length}`);
  console.log(`  Total QA pairs: ${totalQA}`);
  console.log(`  Evaluable (categories ${[...opts.categories].join(',')}): ${evaluableQA}`);
  console.log();

  // Results tracking
  const allResults: QAResult[] = [];
  const categoryStats: Record<number, CategoryStats> = {};
  for (const cat of opts.categories) {
    categoryStats[cat] = { correct: 0, total: 0, f1Sum: 0, recallLatencySum: 0, memoriesReturnedSum: 0, evidenceHits: 0, evidenceTotal: 0 };
  }

  const overallStart = process.hrtime.bigint();

  // Process each conversation
  for (let ci = 0; ci < conversations.length; ci++) {
    const conv = conversations[ci];
    const sessions = extractSessions(conv.conversation);
    const totalTurns = sessions.reduce((acc, s) => acc + s.turns.length, 0);
    const qaToEval = conv.qa.filter(q => opts.categories.has(q.category)).slice(0, opts.qaLimit);

    console.log(`── Conversation ${ci + 1}/${conversations.length}: ${conv.sample_id} ──`);
    console.log(`   Speakers: ${conv.conversation.speaker_a} & ${conv.conversation.speaker_b}`);
    console.log(`   Sessions: ${sessions.length}  Turns: ${totalTurns}  QA: ${qaToEval.length}`);

    // Clean up any previous benchmark data
    await cleanupBenchmarkData(db);

    // ── Seed memories ──────────────────────────────────────
    const seedStart = process.hrtime.bigint();
    let seeded = 0;
    const diaIdToMemoryId = new Map<string, number>();

    // Smaller batches + delay when embeddings are enabled to avoid rate limits
    const storeBatchSize = hasEmbeddings ? 5 : 10;
    const storeBatchDelay = hasEmbeddings ? 800 : 0;

    for (const session of sessions) {
      for (let i = 0; i < session.turns.length; i += storeBatchSize) {
        const batch = session.turns.slice(i, i + storeBatchSize);
        const results = await Promise.allSettled(
          batch.map(async (turn) => {
            let content = `[${turn.speaker}] ${turn.text}`;
            if (turn.blip_caption) content += ` [Image: ${turn.blip_caption}]`;

            const id = await cortex.store({
              type: 'episodic',
              content,
              summary: content.slice(0, 500),
              source: BENCHMARK_SOURCE,
              tags: ['locomo', `session_${session.sessionNum}`, turn.speaker.toLowerCase()],
              importance: 0.5,
              metadata: {
                dia_id: turn.dia_id,
                session: session.sessionNum,
                speaker: turn.speaker,
                benchmark: true,
                ...(session.dateTime ? { event_date: session.dateTime } : {}),
              },
            });
            if (id) diaIdToMemoryId.set(turn.dia_id, id);
            return id;
          })
        );

        seeded += results.filter(r => r.status === 'fulfilled' && r.value !== null).length;
        if (storeBatchDelay > 0) await sleep(storeBatchDelay);
      }
    }

    const seedTime = ms(seedStart);
    console.log(`   Seeded: ${seeded}/${totalTurns} memories in ${(seedTime / 1000).toFixed(1)}s`);

    // ── Seed session summaries as semantic memories ──
    if (conv.session_summary) {
      for (const [sessionKey, summary] of Object.entries(conv.session_summary)) {
        if (!summary) continue;
        const sessionNum = sessionKey.match(/session_(\d+)/)?.[1] || sessionKey;
        const session = sessions.find(s => s.sessionNum === parseInt(sessionNum));
        await cortex.store({
          type: 'semantic',
          content: summary,
          summary: summary.slice(0, 300),
          source: BENCHMARK_SOURCE,
          tags: ['locomo', `session_${sessionNum}`, 'session_summary'],
          importance: 0.8,
          metadata: {
            session: parseInt(sessionNum),
            benchmark: true,
            ...(session?.dateTime ? { event_date: session.dateTime } : {}),
          },
        });
        seeded++;
      }
    }

    // ── Seed observations as semantic memories ──
    if (conv.observation) {
      for (const [sessionKey, observations] of Object.entries(conv.observation)) {
        if (!Array.isArray(observations)) continue;
        const sessionNum = sessionKey.match(/session_(\d+)/)?.[1] || sessionKey;
        const session = sessions.find(s => s.sessionNum === parseInt(sessionNum));
        for (const obs of observations) {
          if (!obs || obs.length < 10) continue;
          await cortex.store({
            type: 'semantic',
            content: obs,
            summary: obs.slice(0, 300),
            source: BENCHMARK_SOURCE,
            tags: ['locomo', `session_${sessionNum}`, 'observation'],
            importance: 0.7,
            metadata: {
              session: parseInt(sessionNum),
              benchmark: true,
              ...(session?.dateTime ? { event_date: session.dateTime } : {}),
            },
          });
          seeded++;
        }
      }
    }

    console.log(`   Total seeded (with summaries/observations): ${seeded}`);

    // Wait for async operations (embeddings, entity extraction)
    if (hasEmbeddings) {
      console.log('   Waiting for embeddings to complete (polling every 3s, up to 90s)...');
      const embedded = await waitForEmbeddings(db, seeded);
      console.log(`   Embeddings ready: ${embedded}/${seeded}`);
    } else {
      await sleep(2000);
    }

    // ── Evaluate QA pairs ──────────────────────────────────
    let evaluated = 0;

    // Smaller QA batches when embeddings enabled to avoid rate-limiting the embedding API
    const qaBatchSize = hasEmbeddings ? 2 : 5;
    for (let qi = 0; qi < qaToEval.length; qi += qaBatchSize) {
      const batch = qaToEval.slice(qi, qi + qaBatchSize);

      const batchResults = await Promise.allSettled(
        batch.map(async (qa): Promise<QAResult> => {
          // Recall — owner_wallet isolation ensures only benchmark memories are searched
          const recallStart = process.hrtime.bigint();
          const memories = await cortex.recall({
            query: qa.question,
            limit: opts.recallLimit,
            skipExpansion: true, // Uses 12x match_count multiplier for wider candidate pool
          });
          const recallTime = ms(recallStart);

          // Format context with full content (not just truncated summaries)
          const context = formatBenchmarkContext(memories);

          // Generate answer
          const generated = await generateAnswer(context, qa.question);

          // Normalize gold answer (some entries are arrays or non-strings)
          const goldAnswer = Array.isArray(qa.answer) ? qa.answer.join(', ') : String(qa.answer || '');

          // Judge
          const correct = await judgeAnswer(generated, goldAnswer, qa.question);

          // F1
          const f1 = tokenF1(generated, goldAnswer);

          // Evidence hit rate: check if recalled memories contain evidence dia_ids
          let evidenceHits = 0;
          const evidenceTotal = qa.evidence.length;
          const recalledDiaIds = new Set(
            memories
              .map(m => (m.metadata as any)?.dia_id)
              .filter(Boolean)
          );
          for (const eid of qa.evidence) {
            if (recalledDiaIds.has(eid)) evidenceHits++;
          }

          return {
            conversationId: conv.sample_id,
            question: qa.question,
            goldAnswer: goldAnswer,
            generatedAnswer: generated,
            category: qa.category,
            correct,
            f1,
            recallLatencyMs: recallTime,
            memoriesReturned: memories.length,
            evidenceHits,
            evidenceTotal,
          };
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          const r = result.value;
          allResults.push(r);

          const stats = categoryStats[r.category];
          if (stats) {
            stats.correct += r.correct;
            stats.total += 1;
            stats.f1Sum += r.f1;
            stats.recallLatencySum += r.recallLatencyMs;
            stats.memoriesReturnedSum += r.memoriesReturned;
            stats.evidenceHits += r.evidenceHits;
            stats.evidenceTotal += r.evidenceTotal;
          }

          evaluated++;
        } else {
          console.error(`   QA evaluation failed: ${result.reason}`);
        }
      }

      // Progress
      process.stdout.write(`\r   Evaluated: ${evaluated}/${qaToEval.length}`);
    }

    console.log(); // newline after progress

    // Show per-conversation summary
    const convResults = allResults.filter(r => r.conversationId === conv.sample_id);
    const convCorrect = convResults.filter(r => r.correct === 1).length;
    console.log(`   Result: ${convCorrect}/${convResults.length} correct (${((convCorrect / Math.max(1, convResults.length)) * 100).toFixed(1)}%)`);
    console.log();
  }

  // ── Final cleanup ───────────────────────────────────────────
  if (!opts.skipCleanup) {
    console.log('── Cleanup ─────────────────────────────────────');
    await cleanupBenchmarkData(db);
    console.log('   All benchmark data removed');
    console.log();
  }

  const totalTime = ms(overallStart);

  // ── Report ──────────────────────────────────────────────────
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║              RESULTS                           ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log();

  console.log('── Per-Category Results ─────────────────────────');
  let overallCorrect = 0;
  let overallTotal = 0;
  let overallF1Sum = 0;
  let overallRecallLatency = 0;
  let overallMemories = 0;
  let overallEvidenceHits = 0;
  let overallEvidenceTotal = 0;

  for (const cat of [...opts.categories].sort()) {
    const stats = categoryStats[cat];
    if (!stats || stats.total === 0) continue;

    const accuracy = ((stats.correct / stats.total) * 100).toFixed(1);
    const avgF1 = (stats.f1Sum / stats.total).toFixed(3);
    const avgLatency = (stats.recallLatencySum / stats.total).toFixed(0);
    const evidenceRate = stats.evidenceTotal > 0
      ? ((stats.evidenceHits / stats.evidenceTotal) * 100).toFixed(1)
      : 'N/A';

    console.log(`  ${CATEGORY_NAMES[cat]} (Cat ${cat}):  ${accuracy}%  (${stats.correct}/${stats.total})  F1: ${avgF1}  Evidence: ${evidenceRate}%  Recall: ${avgLatency}ms`);

    overallCorrect += stats.correct;
    overallTotal += stats.total;
    overallF1Sum += stats.f1Sum;
    overallRecallLatency += stats.recallLatencySum;
    overallMemories += stats.memoriesReturnedSum;
    overallEvidenceHits += stats.evidenceHits;
    overallEvidenceTotal += stats.evidenceTotal;
  }

  console.log();
  console.log('── Overall ─────────────────────────────────────');
  const overallAccuracy = overallTotal > 0 ? ((overallCorrect / overallTotal) * 100).toFixed(1) : '0.0';
  const overallAvgF1 = overallTotal > 0 ? (overallF1Sum / overallTotal).toFixed(3) : '0.000';
  const overallAvgLatency = overallTotal > 0 ? (overallRecallLatency / overallTotal).toFixed(0) : '0';
  const overallAvgMemories = overallTotal > 0 ? (overallMemories / overallTotal).toFixed(1) : '0';
  const overallEvidenceRate = overallEvidenceTotal > 0
    ? ((overallEvidenceHits / overallEvidenceTotal) * 100).toFixed(1)
    : 'N/A';

  console.log(`  Accuracy:         ${overallAccuracy}% (${overallCorrect}/${overallTotal})`);
  console.log(`  Avg F1:           ${overallAvgF1}`);
  console.log(`  Avg recall:       ${overallAvgLatency}ms (${overallAvgMemories} memories avg)`);
  console.log(`  Evidence hit rate: ${overallEvidenceRate}%`);
  console.log(`  Total time:       ${(totalTime / 1000 / 60).toFixed(1)} minutes`);
  console.log();

  // ── Save results ────────────────────────────────────────────
  const resultsPayload = {
    timestamp: new Date().toISOString(),
    config: {
      embeddings: hasEmbeddings,
      embeddingProvider: EMBEDDING_PROVIDER || 'none',
      judgeModel: JUDGE_MODEL,
      recallLimit: opts.recallLimit,
      conversations: conversations.length,
      categories: [...opts.categories],
    },
    summary: {
      accuracy: parseFloat(overallAccuracy),
      avgF1: parseFloat(overallAvgF1),
      avgRecallLatencyMs: parseFloat(overallAvgLatency),
      evidenceHitRate: overallEvidenceTotal > 0 ? parseFloat(overallEvidenceRate!) : null,
      totalEvaluated: overallTotal,
      totalCorrect: overallCorrect,
      totalTimeMinutes: parseFloat((totalTime / 1000 / 60).toFixed(1)),
    },
    perCategory: Object.fromEntries(
      [...opts.categories].sort().map(cat => {
        const stats = categoryStats[cat];
        return [cat, {
          name: CATEGORY_NAMES[cat],
          accuracy: stats.total > 0 ? parseFloat(((stats.correct / stats.total) * 100).toFixed(1)) : 0,
          correct: stats.correct,
          total: stats.total,
          avgF1: stats.total > 0 ? parseFloat((stats.f1Sum / stats.total).toFixed(3)) : 0,
          evidenceHitRate: stats.evidenceTotal > 0
            ? parseFloat(((stats.evidenceHits / stats.evidenceTotal) * 100).toFixed(1))
            : null,
        }];
      })
    ),
    results: allResults,
  };

  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(RESULTS_PATH, JSON.stringify(resultsPayload, null, 2));
  console.log(`Results saved to ${RESULTS_PATH}`);

  cortex.destroy();
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
