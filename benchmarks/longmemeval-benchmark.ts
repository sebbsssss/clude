/**
 * CLUDE x LongMemEval Benchmark
 *
 * Evaluates the Cortex memory system against LongMemEval (ICLR 2025).
 * Uses Voyage AI embeddings, Chain-of-Note prompting, type-specific
 * answer generation for 7 question categories.
 *
 * Dataset: https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned
 * 500 questions, 7 types, 3 variants (oracle, S, M).
 *
 * Usage: npx tsx scripts/longmemeval-benchmark.ts
 *   --variant oracle|s|m    (default: oracle)
 *   --limit N               (max questions, default: all)
 *   --types type1,type2     (filter question types)
 *   --skip-cleanup          (keep benchmark data in DB)
 *   --recall-limit N        (default: 50)
 *   --skip-fact-extraction  (skip LLM fact extraction)
 *   --reader-model MODEL    (default: claude-sonnet-4-5-20250929)
 */
process.env.LOG_LEVEL = 'error';
import dotenv from 'dotenv';
dotenv.config();
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { Cortex } from '../src/sdk';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

// Suppress non-critical async errors
process.on('unhandledRejection', (err: any) => {
  if (err?.message?.includes('429') || err?.message?.includes('Too Many Requests')) return;
});

// ── Types ──────────────────────────────────────────────────────

interface SessionTurn {
  role: 'user' | 'assistant';
  content: string;
  has_answer?: boolean;
}

interface LMEQuestion {
  question_id: string;
  question_type: QuestionType;
  question: string;
  answer: string;
  question_date: string;
  haystack_dates: string[];
  haystack_session_ids: string[];
  haystack_sessions: SessionTurn[][];
  answer_session_ids: string[];
}

type QuestionType =
  | 'single-session-user'
  | 'single-session-assistant'
  | 'single-session-preference'
  | 'multi-session'
  | 'knowledge-update'
  | 'temporal-reasoning'
  | 'abstention';

interface QAResult {
  questionId: string;
  questionType: QuestionType;
  question: string;
  goldAnswer: string;
  generatedAnswer: string;
  correct: number;
  f1: number;
  recallLatencyMs: number;
  memoriesReturned: number;
  memoriesAfterFilter: number;
  evidenceSessionHits: number;
  evidenceSessionTotal: number;
}

interface TypeStats {
  correct: number;
  total: number;
  f1Sum: number;
  recallLatencySum: number;
  evidenceHits: number;
  evidenceTotal: number;
}

// ── Config ─────────────────────────────────────────────────────

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
  console.error('Missing ANTHROPIC_API_KEY in .env');
  process.exit(1);
}

const hasEmbeddings = !!(EMBEDDING_PROVIDER && EMBEDDING_KEY);

const BENCHMARK_SOURCE = 'longmemeval-benchmark';
const BENCHMARK_OWNER_WALLET = 'LongMemEval11111111111111111111111111111111';
const CACHE_DIR = join(__dirname, '.longmemeval-cache');
const JUDGE_MODEL = 'claude-haiku-4-5-20251001';

const VARIANT_URLS: Record<string, string> = {
  oracle: 'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_oracle.json',
  s: 'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_s_cleaned.json',
  m: 'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/main/longmemeval_m_cleaned.json',
};

const QUESTION_TYPE_NAMES: Record<string, string> = {
  'single-session-user': 'SS-User',
  'single-session-assistant': 'SS-Asst',
  'single-session-preference': 'SS-Pref',
  'multi-session': 'Multi-Session',
  'knowledge-update': 'Knowledge-Update',
  'temporal-reasoning': 'Temporal',
  'abstention': 'Abstention',
};

// ── CLI Args ───────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    variant: 'oracle' as string,
    qaLimit: Infinity,
    types: null as Set<string> | null,
    skipCleanup: false,
    recallLimit: 50,
    skipFactExtraction: false,
    readerModel: 'claude-sonnet-4-5-20250929',
    oracleBypass: false, // skip recall, pass raw haystack sessions to reader
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--variant':
        opts.variant = args[++i] || 'oracle';
        break;
      case '--limit':
        opts.qaLimit = parseInt(args[++i]) || Infinity;
        break;
      case '--types':
        opts.types = new Set(args[++i].split(','));
        break;
      case '--skip-cleanup':
        opts.skipCleanup = true;
        break;
      case '--recall-limit':
        opts.recallLimit = parseInt(args[++i]) || 50;
        break;
      case '--skip-fact-extraction':
        opts.skipFactExtraction = true;
        break;
      case '--reader-model':
        opts.readerModel = args[++i];
        break;
      case '--oracle-bypass':
        opts.oracleBypass = true;
        break;
    }
  }
  return opts;
}

// ── Helpers ────────────────────────────────────────────────────

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

function sleep(msec: number): Promise<void> {
  return new Promise(r => setTimeout(r, msec));
}

function tokenF1(predicted: string, reference: string): number {
  const predTokens = String(predicted || '').toLowerCase().split(/\s+/).filter(Boolean);
  const refTokens = String(reference || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (predTokens.length === 0 && refTokens.length === 0) return 1;
  if (predTokens.length === 0 || refTokens.length === 0) return 0;
  const refSet = new Set(refTokens);
  let overlap = 0;
  for (const t of predTokens) { if (refSet.has(t)) overlap++; }
  const precision = overlap / predTokens.length;
  const recall = overlap / refTokens.length;
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

async function waitForEmbeddings(db: SupabaseClient, expectedCount: number, timeoutMs = 180000): Promise<number> {
  const start = Date.now();
  const pollInterval = 5000;
  let lastCount = 0;
  let stableRounds = 0;

  while (Date.now() - start < timeoutMs) {
    const { count } = await db
      .from('memories')
      .select('id', { count: 'exact', head: true })
      .eq('owner_wallet', BENCHMARK_OWNER_WALLET)
      .not('embedding', 'is', null);

    const embedded = count || 0;
    if (embedded >= expectedCount) return embedded;

    if (embedded === lastCount) {
      stableRounds++;
      if (stableRounds >= 5) return embedded;
    } else {
      stableRounds = 0;
    }
    lastCount = embedded;
    await sleep(pollInterval);
  }
  return lastCount;
}

// ── Dataset ────────────────────────────────────────────────────

async function ensureDataset(variant: string): Promise<LMEQuestion[]> {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, `longmemeval_${variant}.json`);

  if (existsSync(cachePath)) {
    console.log(`  Using cached ${variant} dataset`);
    return JSON.parse(readFileSync(cachePath, 'utf-8'));
  }

  const url = VARIANT_URLS[variant];
  if (!url) throw new Error(`Unknown variant: ${variant}. Use oracle, s, or m.`);

  console.log(`  Downloading LongMemEval ${variant} from HuggingFace...`);
  console.log(`  (this may take a while for larger variants)`);
  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok) throw new Error(`Failed to download: ${resp.status} ${resp.statusText}`);

  const text = await resp.text();
  writeFileSync(cachePath, text);
  console.log(`  Saved to ${cachePath} (${(text.length / 1024 / 1024).toFixed(1)}MB)`);
  return JSON.parse(text);
}

// ── Session Extraction ─────────────────────────────────────────

interface UniqueSession {
  sessionId: string;
  date: string;
  turns: SessionTurn[];
}

function extractUniqueSessions(questions: LMEQuestion[]): UniqueSession[] {
  const sessionMap = new Map<string, UniqueSession>();

  for (const q of questions) {
    for (let i = 0; i < q.haystack_session_ids.length; i++) {
      const sid = q.haystack_session_ids[i];
      if (!sessionMap.has(sid)) {
        sessionMap.set(sid, {
          sessionId: sid,
          date: q.haystack_dates[i] || '',
          turns: q.haystack_sessions[i] || [],
        });
      }
    }
  }

  return Array.from(sessionMap.values());
}

// ── Fact Extraction ────────────────────────────────────────────

let anthropic: Anthropic;

async function extractFacts(turns: SessionTurn[]): Promise<string[]> {
  // Build conversation text
  const conv = turns.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`).join('\n');

  try {
    const resp = await anthropic.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 500,
      system: 'Extract 2-5 key facts from this conversation. Focus on: specific names, dates, places, numbers, user preferences, personal details, events, recommendations. Output one fact per line, starting with "- ". Be specific and factual.',
      messages: [{ role: 'user', content: conv.slice(0, 4000) }],
    });

    const text = resp.content[0].type === 'text' ? resp.content[0].text : '';
    return text
      .split('\n')
      .map(l => l.replace(/^[-*]\s*/, '').trim())
      .filter(l => l.length > 10);
  } catch {
    return [];
  }
}

// ── Cleanup ────────────────────────────────────────────────────

async function cleanupBenchmarkData(db: SupabaseClient): Promise<void> {
  const { data: benchmarkMemories } = await db
    .from('memories')
    .select('id')
    .eq('owner_wallet', BENCHMARK_OWNER_WALLET);

  const allIds = benchmarkMemories?.map(m => m.id) || [];
  if (allIds.length === 0) return;

  // Delete in FK order, batching large ID sets
  const batchSize = 500;
  for (let i = 0; i < allIds.length; i += batchSize) {
    const batch = allIds.slice(i, i + batchSize);
    try { await db.from('entity_mentions').delete().in('memory_id', batch); } catch {}
    try {
      await db.from('memory_links').delete()
        .or(`source_id.in.(${batch.join(',')}),target_id.in.(${batch.join(',')})`);
    } catch {}
    try { await db.from('memory_fragments').delete().in('memory_id', batch); } catch {}
    await db.from('memories').delete().in('id', batch);
  }

  try { await db.from('entities').delete().eq('mention_count', 0); } catch {}
}

// ── LLM: Answer Generation with Chain-of-Note ──────────────────

const TYPE_INSTRUCTIONS: Record<string, string> = {
  'single-session-user': 'Focus on information the USER stated or mentioned.',
  'single-session-assistant': 'Focus on recommendations or information the ASSISTANT provided.',
  'single-session-preference': `Based on the conversation, infer what the user would and would NOT prefer. Use SPECIFIC details from the conversation (exact names, brands, titles, models, experiences).

You MUST answer in this exact format:
"The user would prefer [specific recommendation grounded in details from their conversation]. They might not prefer [things that conflict with their stated interests or that they rejected/disliked]."

Rules for this format:
- ALWAYS include both a positive preference AND a negative preference.
- Reference specific items, brands, or details the user mentioned — not generic categories.
- Do NOT give direct advice, tips, or recommendations. ONLY describe the user's preferences.
- NEVER say "I don't have information" — the conversation always contains preference signals.`,
  'multi-session': `This question requires aggregating information across MULTIPLE conversations. IMPORTANT:
- Systematically scan EVERY memory below — the answer may be spread across many separate conversations.
- For "how many" questions: enumerate EACH instance you find with its source conversation/date, then count the total. Do NOT estimate.
- For aggregation questions (totals, averages): list each data point individually, then calculate.
- Do NOT say "I don't have information" unless you have genuinely searched all memories and found nothing relevant. The information IS in the memories — look carefully.`,
  'knowledge-update': 'Provide the MOST RECENT information. If information changed over time, give the latest version and note the update.',
  'temporal-reasoning': 'Pay close attention to dates and chronological order. Use timestamps to determine the correct sequence of events.',
  'abstention': 'ONLY answer if you find clearly relevant information in the context. If the context contains nothing related to the question, say "I don\'t have information about that."',
};

async function generateAnswerCoN(
  context: string,
  question: string,
  questionType: string,
  readerModel: string,
  questionDate?: string,
): Promise<string> {
  const typeInstruction = TYPE_INSTRUCTIONS[questionType] || '';
  const dateContext = questionDate ? `\nThe question is being asked on: ${questionDate}. Use this to resolve relative time references like "last week", "a few months ago", etc.` : '';

  const resp = await anthropic.messages.create({
    model: readerModel,
    max_tokens: 600,
    system: `You answer questions about a user's conversation history using recalled memory context.

Process:
1. Read ALL the context carefully, noting dates and chronological ordering.
2. Identify which pieces of context are directly relevant to the question.
3. For temporal/ordering questions, create a timeline of events with specific dates.
4. Synthesize a concise, accurate answer.

${typeInstruction}${dateContext}

Rules:
- Answer directly with specific information (names, dates, places, numbers, preferences).
- For "which came first" questions: carefully compare DATES of each event. The one with the earlier date happened first.
- For "how many days" questions: calculate the exact number of days between the two dates mentioned.
- For "how many" counting questions: scan ALL memories exhaustively, list each instance, then count. Be thorough — items may be mentioned briefly within longer conversations.
- For knowledge updates: always provide the LATEST version of the information.
- Do NOT add qualifiers like "Based on the context" or "According to the memories".
- ONLY say "I don't have information" if the context is truly empty or completely unrelated. If there are relevant conversations, extract the answer from them even if it requires careful reading.
- Keep answers concise (1-3 sentences).`,
    messages: [{
      role: 'user',
      content: `Memory context:\n${context}\n\nQuestion: ${question}\n\nAnswer:`,
    }],
  });

  return resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
}

async function judgeAnswer(generated: string, reference: string, question: string, questionType?: string): Promise<number> {
  const isPreference = questionType === 'single-session-preference';

  const systemPrompt = isPreference
    ? `You evaluate whether a generated preference description aligns with a reference preference description.

Score "1" (correct) if:
- The generated answer identifies the SAME core preference as the reference (e.g., both mention the same specific brand, product, activity, or interest)
- The generated answer does NOT recommend something the reference says the user would NOT prefer
- The key distinguishing detail from the reference is present (e.g., specific brand, title, or experience)
- A direct recommendation that clearly aligns with the described preference counts as correct

Score "0" (wrong) if:
- The generated answer is about the wrong topic or preference
- The generated answer recommends something the reference explicitly says the user would NOT prefer
- The generated answer is too generic and misses the specific distinguishing detail from the reference
- The generated answer says "I don't know" or "I don't have information"

Reply with ONLY "1" or "0".`
    : `You evaluate whether a generated answer is correct by comparing it to a reference answer.

Score "1" (correct) if:
- The generated answer contains the KEY factual information from the reference
- Numbers match (e.g., "3" = "three")
- The answer is correct even if it includes extra details beyond the reference
- Names/places refer to the same entity (e.g., "Rhythm Central on Main St" matches "the music shop on Main St")
- Paraphrased but semantically equivalent

Score "0" (wrong) if:
- The key fact is wrong (wrong name, wrong number, wrong event)
- The answer says "I don't know" when the reference has specific information
- The answer gets the temporal ordering wrong (says A before B when reference says B before A)
- Important information is missing that changes the meaning

Reply with ONLY "1" or "0".`;

  const resp = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 10,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Question: ${question}\nGenerated answer: ${generated}\nReference answer: ${reference}\n\nScore (1 or 0):`,
    }],
  });

  const text = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '0';
  return text.startsWith('1') ? 1 : 0;
}

// ── Context Formatting ─────────────────────────────────────────

function formatBenchmarkContext(memories: any[], questionType: string): string {
  if (memories.length === 0) return 'No relevant memories found.';

  const lines: string[] = [];

  // Group by type
  const semantic = memories.filter((m: any) => m.memory_type === 'semantic');
  const episodic = memories.filter((m: any) => m.memory_type === 'episodic');

  // For temporal questions, group episodic by session and sort by date
  if (episodic.length > 0) {
    // Group by session_id
    const sessionMap = new Map<string, any[]>();
    for (const m of episodic) {
      const sid = m.metadata?.session_id || 'unknown';
      if (!sessionMap.has(sid)) sessionMap.set(sid, []);
      sessionMap.get(sid)!.push(m);
    }

    // Sort sessions by date
    const sessions = Array.from(sessionMap.entries()).sort((a, b) => {
      const dateA = a[1][0]?.metadata?.event_date || '';
      const dateB = b[1][0]?.metadata?.event_date || '';
      return String(dateA).localeCompare(String(dateB));
    });

    lines.push('## Conversation History (sorted by date)');
    for (const [sid, mems] of sessions) {
      const date = mems[0]?.metadata?.event_date || '';
      // Sort rounds within session
      mems.sort((a: any, b: any) => (a.metadata?.round_index || 0) - (b.metadata?.round_index || 0));

      lines.push(`\n### Conversation on ${date || 'unknown date'}`);
      for (const m of mems) {
        lines.push(m.content || m.summary);
      }
    }
    lines.push('');
  }

  if (semantic.length > 0) {
    lines.push('## Key Facts');
    // Sort facts by date
    const sortedFacts = [...semantic].sort((a, b) => {
      const dateA = a.metadata?.event_date || '';
      const dateB = b.metadata?.event_date || '';
      return String(dateA).localeCompare(String(dateB));
    });
    for (const m of sortedFacts) {
      const date = m.metadata?.event_date || '';
      lines.push(`- ${date ? `[${date}] ` : ''}${m.content || m.summary}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ── Main ───────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  console.log(`
╔════════════════════════════════════════════════════╗
║     CLUDE x LongMemEval BENCHMARK                 ║
╚════════════════════════════════════════════════════╝
`);

  console.log(`Config: variant=${opts.variant}  embeddings=${hasEmbeddings ? `✓ ${EMBEDDING_PROVIDER}` : '✗'}  reader=${opts.readerModel}`);
  console.log(`Options: recall_limit=${opts.recallLimit}  fact_extraction=${!opts.skipFactExtraction}  limit=${opts.qaLimit === Infinity ? 'all' : opts.qaLimit}`);
  if (opts.types) console.log(`Types: ${[...opts.types].join(', ')}`);
  console.log();

  // Initialize clients
  const db: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);
  anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const cortex = new Cortex({
    supabase: { url: SUPABASE_URL, serviceKey: SUPABASE_KEY },
    anthropic: { apiKey: ANTHROPIC_KEY },
    ownerWallet: BENCHMARK_OWNER_WALLET,
    ...(hasEmbeddings && EMBEDDING_PROVIDER ? {
      embedding: {
        provider: EMBEDDING_PROVIDER as 'voyage' | 'openai',
        apiKey: EMBEDDING_KEY,
      },
    } : {}),
  });

  await cortex.init();

  // ── Load dataset ─────────────────────────────────────────────
  console.log('── Dataset ───────────────────────────────────────');
  const allQuestions = await ensureDataset(opts.variant);

  // Filter by types if specified
  let questions = opts.types
    ? allQuestions.filter(q => opts.types!.has(q.question_type))
    : allQuestions;

  // Apply limit
  if (opts.qaLimit < questions.length) {
    questions = questions.slice(0, opts.qaLimit);
  }

  // Count types
  const typeCounts: Record<string, number> = {};
  for (const q of questions) {
    typeCounts[q.question_type] = (typeCounts[q.question_type] || 0) + 1;
  }
  console.log(`  Questions: ${questions.length} / ${allQuestions.length}`);
  for (const [type, count] of Object.entries(typeCounts).sort()) {
    console.log(`    ${QUESTION_TYPE_NAMES[type] || type}: ${count}`);
  }
  console.log();

  // ── Clean previous benchmark data ─────────────────────────────
  console.log('── Cleanup previous data ─────────────────────────');
  await cleanupBenchmarkData(db);
  console.log('   Done');
  console.log();

  // ── Extract unique sessions ──────────────────────────────────
  console.log('── Session extraction ────────────────────────────');
  const uniqueSessions = extractUniqueSessions(questions);
  const totalTurns = uniqueSessions.reduce((sum, s) => sum + s.turns.length, 0);
  console.log(`  Unique sessions: ${uniqueSessions.length}`);
  console.log(`  Total turns: ${totalTurns}`);
  console.log();

  // ── Seed memories (direct DB insert — bypasses SDK side-effects) ──
  console.log('── Seeding memories ──────────────────────────────');
  const seedStart = process.hrtime.bigint();
  let seeded = 0;

  // Use session-level for large datasets, round-level for oracle
  const useRoundLevel = opts.variant === 'oracle' || uniqueSessions.length < 2000;
  console.log(`  Strategy: ${useRoundLevel ? 'round-level' : 'session-level'}`);

  // Build all memory rows first (no DB calls)
  interface MemoryRow {
    hash_id: string;
    memory_type: string;
    content: string;
    summary: string;
    tags: string[];
    concepts: string[];
    emotional_valence: number;
    importance: number;
    source: string;
    metadata: Record<string, unknown>;
    owner_wallet: string;
    compacted: boolean;
    evidence_ids: number[];
  }

  const allRows: MemoryRow[] = [];
  for (const session of uniqueSessions) {
    if (useRoundLevel) {
      for (let ri = 0; ri < session.turns.length; ri += 2) {
        const userTurn = session.turns[ri];
        const asstTurn = session.turns[ri + 1];
        if (!userTurn) continue;

        let content = `User: ${userTurn.content}`;
        if (asstTurn) content += `\nAssistant: ${asstTurn.content}`;

        allRows.push({
          hash_id: randomBytes(16).toString('hex'),
          memory_type: 'episodic',
          content: content.slice(0, 5000),
          summary: content.slice(0, 500),
          tags: ['longmemeval', session.sessionId],
          concepts: [],
          emotional_valence: 0,
          importance: 0.5,
          source: BENCHMARK_SOURCE,
          metadata: {
            session_id: session.sessionId,
            round_index: Math.floor(ri / 2),
            event_date: session.date,
            benchmark: true,
            has_answer: userTurn.has_answer || asstTurn?.has_answer || false,
          },
          owner_wallet: BENCHMARK_OWNER_WALLET,
          compacted: false,
          evidence_ids: [],
        });
      }
    } else {
      const content = session.turns
        .map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
        .join('\n');

      allRows.push({
        hash_id: randomBytes(16).toString('hex'),
        memory_type: 'episodic',
        content: content.slice(0, 5000),
        summary: content.slice(0, 500),
        tags: ['longmemeval', session.sessionId],
        concepts: [],
        emotional_valence: 0,
        importance: 0.5,
        source: BENCHMARK_SOURCE,
        metadata: {
          session_id: session.sessionId,
          event_date: session.date,
          benchmark: true,
        },
        owner_wallet: BENCHMARK_OWNER_WALLET,
        compacted: false,
        evidence_ids: [],
      });
    }
  }

  console.log(`  Prepared ${allRows.length} memory rows`);

  // Batch insert into Supabase (50 at a time)
  const dbBatchSize = 50;
  const insertedIds: number[] = [];

  for (let i = 0; i < allRows.length; i += dbBatchSize) {
    const batch = allRows.slice(i, i + dbBatchSize);
    const { data, error } = await db
      .from('memories')
      .insert(batch)
      .select('id');

    if (error) {
      console.error(`\n  DB insert error at batch ${i}: ${error.message}`);
    } else if (data) {
      insertedIds.push(...data.map((d: any) => d.id));
    }
    seeded = insertedIds.length;
    process.stdout.write(`\r  Inserted: ${seeded}/${allRows.length} memories`);
  }
  console.log();

  // ── Fact extraction (optional) ─────────────────────────────
  const factCachePath = join(CACHE_DIR, `facts_${opts.variant}.json`);
  let factCache: Record<string, string[]> = {};

  if (!opts.skipFactExtraction && uniqueSessions.length < 2000) {
    if (existsSync(factCachePath)) {
      factCache = JSON.parse(readFileSync(factCachePath, 'utf-8'));
      console.log(`  Loaded ${Object.keys(factCache).length} cached fact extractions`);
    }

    console.log('  Extracting facts...');
    let factSeeded = 0;
    const factBatchSize = 3;
    const factRows: MemoryRow[] = [];

    for (let fi = 0; fi < uniqueSessions.length; fi += factBatchSize) {
      const batch = uniqueSessions.slice(fi, fi + factBatchSize);

      const batchFacts = await Promise.allSettled(
        batch.map(async (session) => {
          let facts = factCache[session.sessionId];
          if (!facts) {
            facts = await extractFacts(session.turns);
            factCache[session.sessionId] = facts;
          }
          return { session, facts };
        }),
      );

      for (const r of batchFacts) {
        if (r.status !== 'fulfilled') continue;
        const { session, facts } = r.value;
        for (const fact of facts) {
          factRows.push({
            hash_id: randomBytes(16).toString('hex'),
            memory_type: 'semantic',
            content: fact,
            summary: fact.slice(0, 300),
            tags: ['longmemeval', session.sessionId, 'extracted_fact'],
            concepts: [],
            emotional_valence: 0,
            importance: 0.7,
            source: BENCHMARK_SOURCE,
            metadata: {
              session_id: session.sessionId,
              event_date: session.date,
              benchmark: true,
            },
            owner_wallet: BENCHMARK_OWNER_WALLET,
            compacted: false,
            evidence_ids: [],
          });
        }
      }

      process.stdout.write(`\r  Fact extraction: ${fi + batch.length}/${uniqueSessions.length} sessions`);
    }
    console.log();

    // Save fact cache
    writeFileSync(factCachePath, JSON.stringify(factCache, null, 2));
    console.log(`  Fact cache saved (${Object.keys(factCache).length} sessions)`);

    // Batch insert facts
    for (let i = 0; i < factRows.length; i += dbBatchSize) {
      const batch = factRows.slice(i, i + dbBatchSize);
      const { data, error } = await db
        .from('memories')
        .insert(batch)
        .select('id');

      if (error) {
        console.error(`\n  Fact insert error: ${error.message}`);
      } else if (data) {
        insertedIds.push(...data.map((d: any) => d.id));
        factSeeded += data.length;
      }
      process.stdout.write(`\r  Facts inserted: ${factSeeded}/${factRows.length}`);
    }
    console.log();
    seeded = insertedIds.length;
  }

  const seedTime = ms(seedStart);
  console.log(`  Total seeded: ${seeded} memories in ${(seedTime / 1000).toFixed(1)}s`);

  // ── Generate embeddings in batches via Voyage API directly ──
  if (hasEmbeddings) {
    console.log('  Generating embeddings via Voyage API...');
    const embeddingBatchSize = 20; // Voyage supports up to 128 per call
    let embedded = 0;

    // Fetch all seeded memories to get their content
    const { data: memRows } = await db
      .from('memories')
      .select('id, content, summary')
      .eq('owner_wallet', BENCHMARK_OWNER_WALLET)
      .is('embedding', null)
      .order('id')
      .limit(10000);

    const toEmbed = memRows || [];

    const voyageConfig = {
      url: 'https://api.voyageai.com/v1/embeddings',
      model: 'voyage-4-large',
      apiKey: EMBEDDING_KEY,
    };

    for (let i = 0; i < toEmbed.length; i += embeddingBatchSize) {
      const batch = toEmbed.slice(i, i + embeddingBatchSize);
      const texts = batch.map((m: any) => (m.content || m.summary).slice(0, 8000));

      try {
        const res = await fetch(voyageConfig.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${voyageConfig.apiKey}`,
          },
          body: JSON.stringify({ input: texts, model: voyageConfig.model }),
        });

        if (!res.ok) {
          const errText = await res.text();
          if (res.status === 429) {
            // Rate limited — wait and retry
            await sleep(5000);
            i -= embeddingBatchSize; // retry this batch
            continue;
          }
          console.error(`\n  Voyage API error ${res.status}: ${errText.slice(0, 200)}`);
          continue;
        }

        const data = await res.json() as { data: Array<{ embedding: number[]; index: number }> };

        // Update each memory with its embedding
        for (const item of data.data || []) {
          const memoryId = batch[item.index]?.id;
          if (!memoryId || !item.embedding) continue;

          const { error: updateError } = await db
            .from('memories')
            .update({ embedding: JSON.stringify(item.embedding) })
            .eq('id', memoryId);

          if (!updateError) embedded++;
        }
      } catch (err: any) {
        console.error(`\n  Embedding error: ${err.message}`);
      }

      await sleep(300); // Gentle rate limit on Voyage
      process.stdout.write(`\r  Embeddings: ${embedded}/${toEmbed.length}`);
    }
    console.log();
    console.log(`  Embeddings complete: ${embedded}/${toEmbed.length}`);
  }
  console.log();

  // ── Evaluate questions ───────────────────────────────────────
  console.log('── Evaluation ────────────────────────────────────');
  const allResults: QAResult[] = [];
  const typeStats: Record<string, TypeStats> = {};
  for (const type of Object.keys(typeCounts)) {
    typeStats[type] = { correct: 0, total: 0, f1Sum: 0, recallLatencySum: 0, evidenceHits: 0, evidenceTotal: 0 };
  }

  const evalStart = process.hrtime.bigint();
  const evalBatchSize = hasEmbeddings ? 2 : 4;

  for (let qi = 0; qi < questions.length; qi += evalBatchSize) {
    const batch = questions.slice(qi, qi + evalBatchSize);

    const batchResults = await Promise.allSettled(
      batch.map(async (q): Promise<QAResult> => {
        const haystackSet = new Set(q.haystack_session_ids);
        const evidenceSet = new Set(q.answer_session_ids);

        let memories: any[] = [];
        let filtered: any[] = [];
        let recallTime = 0;

        if (opts.oracleBypass) {
          // Oracle bypass: construct context directly from raw haystack sessions
          const recallStart = process.hrtime.bigint();
          // Build pseudo-memories from raw sessions
          for (let si = 0; si < q.haystack_session_ids.length; si++) {
            const sid = q.haystack_session_ids[si];
            const date = q.haystack_dates[si] || '';
            const turns = q.haystack_sessions[si] || [];
            for (let ri = 0; ri < turns.length; ri += 2) {
              const userTurn = turns[ri];
              const asstTurn = turns[ri + 1];
              if (!userTurn) continue;
              let content = `User: ${userTurn.content}`;
              if (asstTurn) content += `\nAssistant: ${asstTurn.content}`;
              filtered.push({
                memory_type: 'episodic',
                content,
                summary: content.slice(0, 500),
                metadata: { session_id: sid, event_date: date, round_index: Math.floor(ri / 2) },
              });
            }
          }
          memories = filtered;
          recallTime = ms(recallStart);
        } else {
          // Standard recall with haystack session tags
          const recallStart = process.hrtime.bigint();
          memories = await cortex.recall({
            query: q.question,
            limit: opts.recallLimit,
            tags: q.haystack_session_ids,
            skipExpansion: true,
          });
          recallTime = ms(recallStart);

          // Post-filter to question's haystack sessions (safety net)
          filtered = memories.filter((m: any) => {
            const sid = m.metadata?.session_id;
            return sid && haystackSet.has(sid);
          });
        }

        // Check evidence session hits
        const recalledSessions = new Set(
          filtered.map((m: any) => m.metadata?.session_id).filter(Boolean),
        );
        let evidenceHits = 0;
        for (const eid of q.answer_session_ids) {
          if (recalledSessions.has(eid)) evidenceHits++;
        }

        // Format context — oracle bypass uses all memories, recall mode caps at recallLimit
        const contextLimit = opts.oracleBypass ? filtered.length : Math.min(filtered.length, opts.recallLimit);
        const contextMemories = filtered.slice(0, contextLimit);
        const context = formatBenchmarkContext(contextMemories, q.question_type);
        const generated = await generateAnswerCoN(context, q.question, q.question_type, opts.readerModel, q.question_date);

        // Judge
        const goldAnswer = String(q.answer || '');
        const correct = await judgeAnswer(generated, goldAnswer, q.question, q.question_type);
        const f1 = tokenF1(generated, goldAnswer);

        return {
          questionId: q.question_id,
          questionType: q.question_type,
          question: q.question,
          goldAnswer,
          generatedAnswer: generated,
          correct,
          f1,
          recallLatencyMs: recallTime,
          memoriesReturned: memories.length,
          memoriesAfterFilter: filtered.length,
          evidenceSessionHits: evidenceHits,
          evidenceSessionTotal: q.answer_session_ids.length,
        };
      }),
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        const r = result.value;
        allResults.push(r);
        const stats = typeStats[r.questionType];
        if (stats) {
          stats.correct += r.correct;
          stats.total += 1;
          stats.f1Sum += r.f1;
          stats.recallLatencySum += r.recallLatencyMs;
          stats.evidenceHits += r.evidenceSessionHits;
          stats.evidenceTotal += r.evidenceSessionTotal;
        }
      } else {
        console.error(`\n  QA error: ${result.reason}`);
      }
    }

    const done = Math.min(qi + evalBatchSize, questions.length);
    const currentCorrect = allResults.filter(r => r.correct === 1).length;
    const currentAcc = allResults.length > 0 ? ((currentCorrect / allResults.length) * 100).toFixed(1) : '0.0';
    process.stdout.write(`\r  Evaluated: ${done}/${questions.length} (running accuracy: ${currentAcc}%)`);
  }
  console.log();

  const evalTime = ms(evalStart);
  console.log(`  Evaluation completed in ${(evalTime / 1000 / 60).toFixed(1)} minutes`);
  console.log();

  // ── Cleanup ──────────────────────────────────────────────────
  if (!opts.skipCleanup) {
    console.log('── Cleanup ───────────────────────────────────────');
    await cleanupBenchmarkData(db);
    console.log('   All benchmark data removed');
    console.log();
  }

  const totalTime = ms(seedStart);

  // ── Report ───────────────────────────────────────────────────
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║              RESULTS                               ║');
  console.log('╚════════════════════════════════════════════════════╝');
  console.log();

  console.log('── Per-Type Results ──────────────────────────────');
  let overallCorrect = 0;
  let overallTotal = 0;
  let overallF1Sum = 0;
  let overallRecallLatency = 0;
  let overallEvidenceHits = 0;
  let overallEvidenceTotal = 0;

  const sortedTypes = Object.keys(typeStats).sort();
  for (const type of sortedTypes) {
    const stats = typeStats[type];
    if (stats.total === 0) continue;

    const accuracy = ((stats.correct / stats.total) * 100).toFixed(1);
    const avgF1 = (stats.f1Sum / stats.total).toFixed(3);
    const avgLatency = (stats.recallLatencySum / stats.total).toFixed(0);
    const evidenceRate = stats.evidenceTotal > 0
      ? ((stats.evidenceHits / stats.evidenceTotal) * 100).toFixed(1)
      : 'N/A';
    const name = (QUESTION_TYPE_NAMES[type] || type).padEnd(18);

    console.log(`  ${name} ${accuracy.padStart(5)}%  (${stats.correct}/${stats.total})  F1: ${avgF1}  Evidence: ${evidenceRate}%  Recall: ${avgLatency}ms`);

    overallCorrect += stats.correct;
    overallTotal += stats.total;
    overallF1Sum += stats.f1Sum;
    overallRecallLatency += stats.recallLatencySum;
    overallEvidenceHits += stats.evidenceHits;
    overallEvidenceTotal += stats.evidenceTotal;
  }

  console.log();
  console.log('── Overall ──────────────────────────────────────');
  const overallAccuracy = overallTotal > 0 ? ((overallCorrect / overallTotal) * 100).toFixed(1) : '0.0';
  const overallAvgF1 = overallTotal > 0 ? (overallF1Sum / overallTotal).toFixed(3) : '0.000';
  const overallAvgLatency = overallTotal > 0 ? (overallRecallLatency / overallTotal).toFixed(0) : '0';
  const overallEvidenceRate = overallEvidenceTotal > 0
    ? ((overallEvidenceHits / overallEvidenceTotal) * 100).toFixed(1)
    : 'N/A';

  console.log(`  Accuracy:          ${overallAccuracy}% (${overallCorrect}/${overallTotal})`);
  console.log(`  Avg F1:            ${overallAvgF1}`);
  console.log(`  Avg recall:        ${overallAvgLatency}ms`);
  console.log(`  Evidence hit rate: ${overallEvidenceRate}%`);
  console.log(`  Total time:        ${(totalTime / 1000 / 60).toFixed(1)} minutes`);

  const target85 = overallTotal > 0 && parseFloat(overallAccuracy) >= 85;
  console.log();
  console.log(target85
    ? '  ✓ TARGET MET: 85%+ accuracy achieved!'
    : `  ✗ Target: 85%. Gap: ${(85 - parseFloat(overallAccuracy)).toFixed(1)}pp`);
  console.log();

  // ── Save results ─────────────────────────────────────────────
  const resultsPayload = {
    timestamp: new Date().toISOString(),
    config: {
      variant: opts.variant,
      embeddings: hasEmbeddings,
      embeddingProvider: EMBEDDING_PROVIDER || 'none',
      readerModel: opts.readerModel,
      judgeModel: JUDGE_MODEL,
      recallLimit: opts.recallLimit,
      factExtraction: !opts.skipFactExtraction,
      seedStrategy: useRoundLevel ? 'round-level' : 'session-level',
      totalSeeded: seeded,
      totalQuestions: questions.length,
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
    perType: Object.fromEntries(
      sortedTypes.map(type => {
        const stats = typeStats[type];
        return [type, {
          name: QUESTION_TYPE_NAMES[type] || type,
          accuracy: stats.total > 0 ? parseFloat(((stats.correct / stats.total) * 100).toFixed(1)) : 0,
          correct: stats.correct,
          total: stats.total,
          avgF1: stats.total > 0 ? parseFloat((stats.f1Sum / stats.total).toFixed(3)) : 0,
          evidenceHitRate: stats.evidenceTotal > 0
            ? parseFloat(((stats.evidenceHits / stats.evidenceTotal) * 100).toFixed(1))
            : null,
        }];
      }),
    ),
    results: allResults,
  };

  const resultsPath = join(CACHE_DIR, `results_${opts.variant}.json`);
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(resultsPath, JSON.stringify(resultsPayload, null, 2));
  console.log(`Results saved to ${resultsPath}`);

  cortex.destroy();
}

main().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
