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
import { runIRCoT, type LLMCallFn } from '../src/experimental/ircot';

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
    ircot: false,
    queryExpansion: false,
    bm25: false,
    rerank: false,
    answerModel: '',
    noDialogTurns: false,
    hyde: false,
    fullContext: false,
    extractFacts: false,
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
      case '--ircot':
        opts.ircot = true;
        break;
      case '--query-expansion':
        opts.queryExpansion = true;
        break;
      case '--bm25':
        opts.bm25 = true;
        break;
      case '--rerank':
        opts.rerank = true;
        break;
      case '--answer-model':
        opts.answerModel = args[++i] || '';
        break;
      case '--no-dialog-turns':
        opts.noDialogTurns = true;
        break;
      case '--hyde':
        opts.hyde = true;
        break;
      case '--full-context':
        opts.fullContext = true;
        break;
      case '--extract-facts':
        opts.extractFacts = true;
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
let ANSWER_MODEL: string;

/** Rerank memories by relevance to the question using an LLM */
async function rerankMemories(memories: any[], question: string, topK: number = 20): Promise<any[]> {
  if (memories.length <= topK) return memories;

  // Build numbered list of memory snippets for the LLM
  const snippets = memories.map((m: any, i: number) => {
    const content = (m.content || m.summary || '').slice(0, 200);
    return `[${i}] ${content}`;
  }).join('\n');

  const resp = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 200,
    system: `You are a relevance ranker. Given a question and a numbered list of memory snippets, select the ${topK} most relevant snippets that would help answer the question. Output ONLY the indices as comma-separated numbers, most relevant first. Example: 3,7,0,12,5`,
    messages: [{
      role: 'user',
      content: `Question: ${question}\n\nMemory snippets:\n${snippets}\n\nTop ${topK} most relevant indices:`,
    }],
  });

  const text = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
  const indices = text.match(/\d+/g)?.map(Number).filter(i => i >= 0 && i < memories.length) || [];

  // Deduplicate while preserving order
  const seen = new Set<number>();
  const uniqueIndices: number[] = [];
  for (const idx of indices) {
    if (!seen.has(idx)) {
      seen.add(idx);
      uniqueIndices.push(idx);
    }
  }

  // If LLM didn't return enough, pad with remaining memories in original order
  if (uniqueIndices.length < topK) {
    for (let i = 0; i < memories.length && uniqueIndices.length < topK; i++) {
      if (!seen.has(i)) uniqueIndices.push(i);
    }
  }

  return uniqueIndices.slice(0, topK).map(i => memories[i]);
}

async function generateAnswer(context: string, question: string): Promise<string> {
  const resp = await anthropic.messages.create({
    model: ANSWER_MODEL,
    max_tokens: 300,
    system: `You are answering questions about conversations between two people based on memory context.

Rules:
- Carefully read ALL the provided context before answering.
- Extract specific details: names, dates, places, numbers, preferences, opinions.
- If the context contains partial information, provide what you can reasonably infer.
- If the context discusses something related, use reasoning to connect the dots.
- For temporal questions (when/how long ago), calculate dates from session timestamps and relative time references (e.g., "last week", "yesterday").
- Answer directly with the specific information requested.
- NEVER say "I don't know" — always provide your best answer from the available context, even if uncertain.
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

/** LLM call function for IRCoT reasoning */
function makeLLMCallFn(): LLMCallFn {
  return async (systemPrompt: string, userMessage: string): Promise<string> => {
    const resp = await anthropic.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });
    return resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
  };
}

/** Expand a question into alternative search queries for multi-query retrieval.
 * Designed for keyword-only search — focuses on vocabulary diversity, not semantic similarity. */
async function expandQuery(question: string): Promise<string[]> {
  const resp = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 300,
    system: `You help search a conversation memory database using keyword matching. Given a question, generate 4 alternative search queries that use DIFFERENT keywords to maximize recall.

Rules:
1. Extract ALL named entities (people, places, companies, products) from the question
2. Generate queries using synonyms, related terms, and likely conversational vocabulary
3. For temporal questions, include date-related terms and time expressions
4. For preference questions, include opinion words (love, hate, favorite, prefer, enjoy, dislike)
5. Each query should use DIFFERENT keywords from the others — avoid repeating the same words

Output ONLY the 4 queries, one per line. No numbering, no explanation.`,
    messages: [{ role: 'user', content: question }],
  });
  const text = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
  return text.split('\n').map(l => l.trim()).filter(l => l.length > 2);
}

/** Reciprocal Rank Fusion: merge multiple ranked lists into a single ranking.
 * RRF(d) = Σ 1/(k + rank_i(d)) for each list i that contains document d.
 * k=60 is the standard constant from the RRF paper. */
function reciprocalRankFusion(rankedLists: any[][], k: number = 60): any[] {
  const scores = new Map<number, { score: number; memory: any }>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const mem = list[rank];
      const id = mem.id;
      const rrfScore = 1.0 / (k + rank + 1); // rank is 0-indexed, RRF uses 1-indexed
      if (scores.has(id)) {
        scores.get(id)!.score += rrfScore;
      } else {
        scores.set(id, { score: rrfScore, memory: mem });
      }
    }
  }

  // Sort by RRF score descending
  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(entry => entry.memory);
}

/** Extract structured facts from a batch of dialog turns using LLM.
 * Each fact is a self-contained statement with rich vocabulary for keyword search. */
async function extractFactsFromDialog(
  turns: DialogTurn[],
  sessionNum: number,
  dateTime: string | null,
): Promise<string[]> {
  if (turns.length === 0) return [];

  const dialog = turns.map(t => `[${t.speaker}] ${t.text}`).join('\n');

  const resp = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 1000,
    system: `Extract key facts, events, preferences, and relationships from this conversation excerpt.

Rules:
- Each fact must be a COMPLETE, self-contained sentence (understandable without the dialog)
- Include WHO said/did what (use full names, not pronouns)
- Include WHEN if dates or temporal references are mentioned
- Include WHERE if locations are mentioned
- Extract preferences: "X likes/loves/hates/prefers Y"
- Extract events: "X did/went/started/finished Y"
- Extract relationships: "X is Y's friend/colleague/partner"
- Extract opinions: "X thinks/believes/feels Y"
- Use rich vocabulary — include synonyms of key concepts
- One fact per line
- Output ONLY the facts, nothing else

Example input: [Alice] I just got a new puppy! A golden retriever named Max.
Example output: Alice got a new pet dog, a golden retriever puppy named Max.`,
    messages: [{ role: 'user', content: dialog }],
  });

  const text = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
  return text.split('\n').map(l => l.trim()).filter(l => l.length > 10);
}

/** HyDE: Generate hypothetical answer vocabulary to augment the search query */
async function hydeAugment(question: string): Promise<string> {
  const resp = await anthropic.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 100,
    system: `Given a question about a conversation between two people, generate a short hypothetical answer that contains likely vocabulary from the actual conversation. Include names, specific terms, and likely answer words. Output ONLY the hypothetical answer snippet, no explanation.`,
    messages: [{ role: 'user', content: question }],
  });
  const hypo = resp.content[0].type === 'text' ? resp.content[0].text.trim() : '';
  // Combine question + hypothetical answer for broader keyword matching
  return `${question} ${hypo}`;
}

/** Build context optimized for benchmark QA — chronologically ordered, structured by type. */
function formatBenchmarkContext(memories: any[]): string {
  if (memories.length === 0) return 'No relevant memories found.';

  // Sort all memories chronologically by session number, then by created_at
  const sorted = [...memories].sort((a: any, b: any) => {
    const sessionA = a.metadata?.session || 0;
    const sessionB = b.metadata?.session || 0;
    if (sessionA !== sessionB) return sessionA - sessionB;
    return (new Date(a.created_at || 0).getTime()) - (new Date(b.created_at || 0).getTime());
  });

  const lines: string[] = [];

  // Group by session for chronological context
  const bySession = new Map<number, any[]>();
  const noSession: any[] = [];
  for (const m of sorted) {
    const session = m.metadata?.session;
    if (session) {
      if (!bySession.has(session)) bySession.set(session, []);
      bySession.get(session)!.push(m);
    } else {
      noSession.push(m);
    }
  }

  // Output chronologically by session
  const sessionNums = Array.from(bySession.keys()).sort((a, b) => a - b);
  for (const sessionNum of sessionNums) {
    const sessionMems = bySession.get(sessionNum)!;
    const date = sessionMems.find((m: any) => m.metadata?.event_date)?.metadata?.event_date || '';
    lines.push(`## Session ${sessionNum}${date ? ` (${date})` : ''}`);

    // Within a session, show observations/facts first, then dialog
    const observations = sessionMems.filter((m: any) =>
      m.memory_type === 'semantic' && (m.tags?.includes('observation') || m.tags?.includes('event'))
    );
    const summaries = sessionMems.filter((m: any) =>
      m.memory_type === 'semantic' && m.tags?.includes('session_summary')
    );
    const dialog = sessionMems.filter((m: any) => m.memory_type === 'episodic');
    const rest = sessionMems.filter((m: any) =>
      !observations.includes(m) && !summaries.includes(m) && !dialog.includes(m)
    );

    for (const m of summaries) {
      lines.push(`Summary: ${m.content || m.summary}`);
    }
    for (const m of observations) {
      lines.push(`- ${m.content || m.summary}`);
    }
    for (const m of dialog) {
      lines.push(`- ${m.content || m.summary}`);
    }
    for (const m of rest) {
      lines.push(`- ${m.content || m.summary}`);
    }
    lines.push('');
  }

  if (noSession.length > 0) {
    lines.push('## General Context');
    for (const m of noSession) {
      const date = m.metadata?.event_date || '';
      lines.push(`- ${date ? `[${date}] ` : ''}${m.content || m.summary}`);
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

  ANSWER_MODEL = opts.answerModel || JUDGE_MODEL;
  console.log(`Config: embeddings ${hasEmbeddings ? '✓' : '✗'}  anthropic ✓  judge: ${JUDGE_MODEL}  answer: ${ANSWER_MODEL}`);
  console.log(`Options: conversations=${opts.maxConversations}  categories=[${[...opts.categories].join(',')}]  recall_limit=${opts.recallLimit}  ircot=${opts.ircot}  query_expansion=${opts.queryExpansion}  bm25=${opts.bm25}  rerank=${opts.rerank}  no_dialog=${opts.noDialogTurns}  hyde=${opts.hyde}`);
  console.log();

  // Enable BM25 experiment flag if CLI flag set
  if (opts.bm25) process.env.EXP_BM25_SEARCH = 'true';

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

    if (!opts.noDialogTurns) {
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
    } // end if (!opts.noDialogTurns)

    const seedTime = ms(seedStart);
    console.log(`   Seeded: ${seeded}/${opts.noDialogTurns ? 0 : totalTurns} dialog turns in ${(seedTime / 1000).toFixed(1)}s`);

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
    // Structure: { session_N_observation: { SpeakerName: [[text, dia_id], ...] } }
    if (conv.observation) {
      for (const [sessionKey, speakerObs] of Object.entries(conv.observation)) {
        const sessionNum = sessionKey.match(/session_(\d+)/)?.[1] || sessionKey;
        const session = sessions.find(s => s.sessionNum === parseInt(sessionNum));
        // speakerObs is an object keyed by speaker name, each value is an array of [text, dia_id] tuples
        if (typeof speakerObs !== 'object' || speakerObs === null) continue;
        for (const [speaker, obsList] of Object.entries(speakerObs as Record<string, any>)) {
          if (!Array.isArray(obsList)) continue;
          for (const obs of obsList) {
            // Each observation is a [text, dia_id] tuple
            const obsText = Array.isArray(obs) ? obs[0] : obs;
            const obsDiaId = Array.isArray(obs) ? obs[1] : undefined;
            if (!obsText || String(obsText).length < 10) continue;
            await cortex.store({
              type: 'semantic',
              content: String(obsText),
              summary: String(obsText).slice(0, 300),
              source: BENCHMARK_SOURCE,
              tags: ['locomo', `session_${sessionNum}`, 'observation', speaker.toLowerCase()],
              importance: 0.7,
              metadata: {
                session: parseInt(sessionNum),
                speaker,
                benchmark: true,
                ...(obsDiaId ? { dia_id: obsDiaId } : {}),
                ...(session?.dateTime ? { event_date: session.dateTime } : {}),
              },
            });
            seeded++;
          }
        }
      }
    }

    // ── Seed event summaries as semantic memories ──
    // Structure: { events_session_N: { SpeakerName: [event_text, ...], date: "..." } }
    if ((conv as any).event_summary) {
      for (const [evKey, evData] of Object.entries((conv as any).event_summary)) {
        const sessionNum = evKey.match(/events_session_(\d+)/)?.[1] || evKey;
        const session = sessions.find(s => s.sessionNum === parseInt(sessionNum));
        if (typeof evData !== 'object' || evData === null) continue;
        const evObj = evData as Record<string, any>;
        const eventDate = evObj.date || session?.dateTime || null;
        for (const [speaker, events] of Object.entries(evObj)) {
          if (speaker === 'date' || !Array.isArray(events)) continue;
          for (const event of events) {
            if (!event || String(event).length < 5) continue;
            const eventText = `[${eventDate || `Session ${sessionNum}`}] ${speaker}: ${event}`;
            await cortex.store({
              type: 'semantic',
              content: eventText,
              summary: eventText.slice(0, 300),
              source: BENCHMARK_SOURCE,
              tags: ['locomo', `session_${sessionNum}`, 'event', speaker.toLowerCase()],
              importance: 0.8,
              metadata: {
                session: parseInt(sessionNum),
                speaker,
                benchmark: true,
                ...(eventDate ? { event_date: eventDate } : {}),
              },
            });
            seeded++;
          }
        }
      }
    }

    // ── Extract and seed structured facts from dialog (per-session) ──
    // Uses direct DB inserts to avoid cortex.store() side effects (entity extraction, etc.)
    // that can hang on external API calls
    if (opts.extractFacts && !opts.noDialogTurns) {
      console.log('   Extracting facts from dialog turns...');
      let factCount = 0;
      const factBatch: any[] = [];

      for (const session of sessions) {
        // Process in chunks of 20 turns to stay within context window
        for (let i = 0; i < session.turns.length; i += 20) {
          const chunk = session.turns.slice(i, i + 20);
          try {
            const facts = await extractFactsFromDialog(chunk, session.sessionNum, session.dateTime);
            for (const fact of facts) {
              factBatch.push({
                memory_type: 'semantic',
                content: fact,
                summary: fact.slice(0, 300),
                source: BENCHMARK_SOURCE,
                owner_wallet: BENCHMARK_OWNER_WALLET,
                tags: ['locomo', `session_${session.sessionNum}`, 'extracted_fact'],
                importance: 0.7,
                decay_factor: 0.98,
                metadata: {
                  session: session.sessionNum,
                  benchmark: true,
                  ...(session.dateTime ? { event_date: session.dateTime } : {}),
                },
              });
              factCount++;
            }
          } catch (err: any) {
            // Non-fatal — skip this chunk
            if (!err.message?.includes('529')) {
              console.error(`   Fact extraction failed for session ${session.sessionNum}: ${err.message}`);
            }
          }
        }
      }

      // Batch insert facts directly into DB (50 per batch)
      for (let i = 0; i < factBatch.length; i += 50) {
        const batch = factBatch.slice(i, i + 50);
        const { error } = await db.from('memories').insert(batch);
        if (error) {
          console.error(`   Fact batch insert error: ${error.message}`);
        }
      }
      seeded += factCount;
      console.log(`   Extracted facts: ${factCount}`);
    }

    console.log(`   Total seeded (with summaries/observations/events): ${seeded}`);

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

    // For full-context mode, fetch ALL benchmark memories once and reuse for every question
    let allBenchmarkMemories: any[] | null = null;
    if (opts.fullContext) {
      const { data: allMems } = await db
        .from('memories')
        .select('*')
        .eq('owner_wallet', BENCHMARK_OWNER_WALLET)
        .order('created_at', { ascending: true });
      allBenchmarkMemories = allMems || [];
      console.log(`   Full-context mode: ${allBenchmarkMemories.length} memories loaded`);
    }

    // Smaller QA batches when embeddings enabled to avoid rate-limiting the embedding API
    const qaBatchSize = hasEmbeddings ? 2 : (opts.fullContext ? 3 : 5);
    for (let qi = 0; qi < qaToEval.length; qi += qaBatchSize) {
      const batch = qaToEval.slice(qi, qi + qaBatchSize);

      // Speaker names for entity-focused supplementary recall
      const speakerA = conv.conversation.speaker_a;
      const speakerB = conv.conversation.speaker_b;

      const batchResults = await Promise.allSettled(
        batch.map(async (qa): Promise<QAResult> => {
          // Recall — owner_wallet isolation ensures only benchmark memories are searched
          const recallStart = process.hrtime.bigint();
          let memories: any[];

          // Full-context mode: use all memories, skip recall entirely
          if (opts.fullContext && allBenchmarkMemories) {
            memories = allBenchmarkMemories;
          } else {

          // HyDE: Augment query with hypothetical answer vocabulary for better keyword matching
          const recallQuery = opts.hyde
            ? await hydeAugment(qa.question)
            : qa.question;

          if (opts.queryExpansion) {
            // Multi-query retrieval with RRF (Reciprocal Rank Fusion)
            // Each query gets FULL recall limit, then results are merged via RRF scoring
            const expansions = await expandQuery(qa.question);
            const allQueries = [qa.question, ...expansions];
            const recallResults = await Promise.allSettled(
              allQueries.map(q => cortex.recall({
                query: q,
                limit: opts.recallLimit,
                skipExpansion: true,
                trackAccess: false,
              }))
            );
            const rankedLists: any[][] = [];
            for (const result of recallResults) {
              if (result.status === 'fulfilled' && result.value.length > 0) {
                rankedLists.push(result.value);
              }
            }
            memories = reciprocalRankFusion(rankedLists).slice(0, opts.recallLimit);
          } else {
            memories = await cortex.recall({
              query: recallQuery,
              limit: opts.recallLimit,
              skipExpansion: true,
              trackAccess: false,
            });
          }

          // Supplementary entity-focused recall (disabled — adds noise, hurts accuracy)
          // TODO: re-enable with smaller limit (10-15) if precision improves

          // Exp 3: IRCoT for multi-hop questions (category 2)
          if (opts.ircot && qa.category === 2) {
            const ircotResult = await runIRCoT(
              qa.question,
              memories,
              async (recallOpts) => cortex.recall({ ...recallOpts, skipExpansion: true }) as any,
              makeLLMCallFn(),
              { maxSteps: 3, recallLimit: 10 },
            );
            memories = ircotResult.memories;
          }

          } // end if (!opts.fullContext)

          const recallTime = ms(recallStart);

          // Rerank memories by relevance to the question
          if (opts.rerank && memories.length > 20) {
            memories = await rerankMemories(memories, qa.question, 20);
          }

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
      answerModel: ANSWER_MODEL,
      recallLimit: opts.recallLimit,
      ircot: opts.ircot,
      queryExpansion: opts.queryExpansion,
      bm25: opts.bm25,
      rerank: opts.rerank,
      noDialogTurns: opts.noDialogTurns,
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
