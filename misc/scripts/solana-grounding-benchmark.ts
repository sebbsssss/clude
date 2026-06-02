/**
 * Solana Grounding Benchmark
 *
 * Measures how accurately Clude answers Solana on-chain fact questions when the
 * relevant facts are stored as memories vs. when no memory context is available.
 *
 * Three evaluation conditions per question:
 *   grounded   — recall memories for this wallet, answer from context
 *   baseline   — no memory context, answer from model prior only
 *   abstention — held-out facts not seeded; correct iff model says "not enough info"
 *
 * Dataset: apps/web/public/proof/solana-qa.json
 *
 * Usage:
 *   npx tsx misc/scripts/solana-grounding-benchmark.ts
 *   npx tsx misc/scripts/solana-grounding-benchmark.ts --limit 60
 *   npx tsx misc/scripts/solana-grounding-benchmark.ts --run-id v2 --skip-cleanup
 *   npx tsx misc/scripts/solana-grounding-benchmark.ts --run-id v2 --cleanup
 */

process.env.LOG_LEVEL = 'error';

import dotenv from 'dotenv';
dotenv.config();

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomBytes } from 'crypto';

// ── Verified API imports ──────────────────────────────────────────────────────

import { getDb } from '@clude/shared/core/database';
import { recallMemories, formatMemoryContext, _setOwnerWallet } from '@clude/brain/memory';
import { withOwnerWallet } from '@clude/shared/core/owner-context';
import { generateEmbeddings } from '@clude/shared/core/embeddings';
import {
  generateOpenRouterResponse,
  OPENROUTER_MODELS,
  initOpenRouter,
} from '@clude/shared/core/openrouter-client';
import {
  gradeAnswer,
  isAbstention,
  type SolanaQA,
} from '@clude/shared/core/solana-grading';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SolanaQAFile {
  datasetVersion: string;
  generatedFrom: string;
  count: number;
  items: SolanaQA[];
}

interface QuestionResult {
  id: string;
  category: string;
  question: string;
  gold: string;
  sourceRef: string;
  condition: 'grounded' | 'baseline' | 'abstention';
  answer: string;
  correct: boolean;
  memoriesReturned: number;
  latencyMs: number;
}

interface CategoryStats {
  groundedCorrect: number;
  groundedTotal: number;
  groundedNonAbstaining: number;
  baselineCorrect: number;
  baselineTotal: number;
  abstentionCorrect: number;
  abstentionTotal: number;
}

interface BenchmarkResults {
  placeholder: false;
  rate: number;
  baselineRate: number;
  abstentionAccuracy: number;
  n: number;
  nAbstention: number;
  model: string;
  datasetVersion: string;
  runAt: string;
  byCategory: Record<string, {
    groundedAccuracy: number;
    baselineAccuracy: number;
    n: number;
  }>;
}

interface ExampleItem {
  id: string;
  category: string;
  question: string;
  groundTruth: string;
  sourceRef: string;
  clude: { answer: string; correct: boolean };
  baseline: { answer: string; correct: boolean };
  isAbstentionExample?: boolean;
}

// ── Config ────────────────────────────────────────────────────────────────────

// __dirname is available via tsx (CommonJS interop). Repo root is two levels up from misc/scripts/.
const REPO_ROOT = join(__dirname, '..', '..');
const QA_PATH = join(REPO_ROOT, 'apps', 'web', 'public', 'proof', 'solana-qa.json');
const RESULTS_PATH = join(REPO_ROOT, 'apps', 'web', 'public', 'proof', 'solana-grounding-results.json');
const EXAMPLES_PATH = join(REPO_ROOT, 'apps', 'web', 'public', 'proof', 'solana-grounding-examples.json');

const BENCHMARK_SOURCE = 'solana-grounding-benchmark';
const DEFAULT_LIMIT = 60;
const ABSTENTION_HOLDOUT_MOD = 10; // every 10th item by index is held out
const SEED_BATCH_SIZE = 50;
const RECALL_LIMIT = 8;
const MODEL = OPENROUTER_MODELS['claude-haiku-4.5']; // 'anthropic/claude-haiku-4.5'
const DATASET_VERSION = 'crypto_solana_mainnet_us@2025-03-31';

// ── CLI Args ──────────────────────────────────────────────────────────────────

function parseArgs(): { limit: number; runId: string; cleanup: boolean; skipCleanup: boolean; skipSeeding: boolean } {
  const args = process.argv.slice(2);
  let limit = DEFAULT_LIMIT;
  let runId = '';
  let cleanup = false;
  let skipCleanup = false;
  let skipSeeding = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--limit':
        limit = parseInt(args[++i] || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT;
        break;
      case '--run-id':
        runId = args[++i] || '';
        break;
      case '--cleanup':
        cleanup = true;
        break;
      case '--skip-cleanup':
        skipCleanup = true;
        break;
      case '--skip-seeding':
        // Reuse memories already seeded+embedded under this run-id's wallet
        // (resume after an interrupted run without re-seeding 636 facts).
        skipSeeding = true;
        break;
    }
  }

  return { limit, runId, cleanup, skipCleanup, skipSeeding };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function ms(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

/**
 * Build a natural-language statement from a SolanaQA item for seeding as memory content.
 * Derived from category + question + gold so the model can retrieve it via keyword/semantic search.
 */
function factToStatement(item: SolanaQA): string {
  const { category, question, gold, sourceRef } = item;

  switch (category) {
    case 'block_time': {
      // "What was the block time (UTC) of Solana slot 328970103?"
      const slotMatch = question.match(/slot\s+(\d+)/i);
      const slot = slotMatch ? slotMatch[1] : sourceRef.replace('block:', '');
      return `Solana block slot ${slot} had a block time of ${gold} UTC.`;
    }
    case 'block_leader': {
      const slotMatch = question.match(/slot\s+(\d+)/i);
      const slot = slotMatch ? slotMatch[1] : sourceRef.replace('block:', '');
      return `The validator ${gold} led Solana slot ${slot}.`;
    }
    case 'block_txcount': {
      const slotMatch = question.match(/slot\s+(\d+)/i);
      const slot = slotMatch ? slotMatch[1] : sourceRef.replace('block:', '');
      return `Solana slot ${slot} contained ${gold} transactions.`;
    }
    case 'tx_fee': {
      // "What fee in lamports did Solana transaction <sig> pay?"
      const sigMatch = question.match(/transaction\s+(\S+)\s+pay/i);
      const sig = sigMatch ? sigMatch[1] : sourceRef.replace('tx:', '');
      return `Solana transaction ${sig} paid a fee of ${gold} lamports.`;
    }
    case 'tx_status': {
      const sigMatch = question.match(/transaction\s+(\S+)\s+succeed/i);
      const sig = sigMatch ? sigMatch[1] : sourceRef.replace('tx:', '');
      return `Solana transaction ${sig} had a status of ${gold}.`;
    }
    case 'account_owner': {
      // "Which program owns Solana account <pubkey>?"
      const pubkeyMatch = question.match(/account\s+(\S+)\?/i);
      const pubkey = pubkeyMatch ? pubkeyMatch[1] : sourceRef.replace('account:', '');
      return `The program ${gold} owns Solana account ${pubkey}.`;
    }
    case 'account_lamports': {
      const pubkeyMatch = question.match(/account\s+(\S+)\s+hold/i);
      const pubkey = pubkeyMatch ? pubkeyMatch[1] : sourceRef.replace('account:', '');
      return `Solana account ${pubkey} holds ${gold} lamports.`;
    }
    case 'token_symbol': {
      // "What is the ticker symbol of the Solana token mint <mint>?"
      const mintMatch = question.match(/mint\s+(\S+)\?/i);
      const mint = mintMatch ? mintMatch[1] : sourceRef.replace('token:', '');
      return `The Solana token mint ${mint} has the ticker symbol ${gold}.`;
    }
    default:
      // Fallback: synthesize from question + gold
      return `${question.replace(/\?$/, '')}: ${gold}.`;
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

async function cleanupBenchmarkData(wallet: string): Promise<void> {
  const db = getDb();
  let totalDeleted = 0;

  while (true) {
    const { data: batch } = await db
      .from('memories')
      .select('id')
      .eq('owner_wallet', wallet)
      .limit(1000);

    const ids = (batch ?? []).map((m: { id: number }) => m.id);
    if (ids.length === 0) break;

    // Delete in FK order (dependent rows first), in sub-batches to avoid URL length limits
    const batchSize = 500;
    for (let i = 0; i < ids.length; i += batchSize) {
      const chunk = ids.slice(i, i + batchSize);
      try { await db.from('entity_mentions').delete().in('memory_id', chunk); } catch {}
      try {
        await db.from('memory_links').delete()
          .or(`source_id.in.(${chunk.join(',')}),target_id.in.(${chunk.join(',')})`);
      } catch {}
      await db.from('memories').delete().in('id', chunk);
    }

    totalDeleted += ids.length;
    process.stdout.write(`\r  Cleaned: ${totalDeleted} memories`);
    if (ids.length < 1000) break; // last page
  }

  if (totalDeleted > 0) console.log();
  console.log(`  Cleanup complete: ${totalDeleted} memories removed for wallet ${wallet}`);
}

// ── Seed ──────────────────────────────────────────────────────────────────────

/**
 * Seed seededItems as memories. Each unique sourceRef is seeded once per category
 * (multiple QA items can reference the same block/tx/account — we deduplicate).
 * Returns the inserted memory IDs aligned to unique contents for embedding.
 */
async function seedMemories(
  seededItems: SolanaQA[],
  wallet: string,
): Promise<{ ids: number[]; contents: string[] }> {
  const db = getDb();

  // Deduplicate by id (each SolanaQA.id is unique: sourceRef::category)
  const uniqueItems = Array.from(new Map(seededItems.map(item => [item.id, item])).values());

  // ids and contents are kept in sync: only populated together when insert succeeds
  const ids: number[] = [];
  const contents: string[] = [];

  console.log(`  Seeding ${uniqueItems.length} unique facts in batches of ${SEED_BATCH_SIZE}...`);

  for (let i = 0; i < uniqueItems.length; i += SEED_BATCH_SIZE) {
    const batch = uniqueItems.slice(i, i + SEED_BATCH_SIZE);

    // Build content strings separately so we only commit them to `contents` on success
    const batchContents = batch.map(item => factToStatement(item));

    const rows = batch.map((item, j) => ({
      hash_id: randomBytes(16).toString('hex'),
      content: batchContents[j],
      summary: batchContents[j],
      memory_type: 'semantic' as const,
      tags: ['solana-grounding', item.category],
      concepts: [] as string[],
      emotional_valence: 0,
      source: BENCHMARK_SOURCE,
      owner_wallet: wallet,
      importance: 0.6,
      compacted: false,
      evidence_ids: [] as string[],
    }));

    const { data, error } = await db.from('memories').insert(rows).select('id');
    if (error) {
      console.error(`  Seed batch ${Math.floor(i / SEED_BATCH_SIZE) + 1} error:`, error.message);
      continue;
    }

    const batchIds = (data ?? []).map((r: { id: number }) => r.id);
    // Only push when insert succeeded — keeps ids[k] ↔ contents[k] aligned
    ids.push(...batchIds);
    contents.push(...batchContents.slice(0, batchIds.length));

    process.stdout.write(`\r  Seeded: ${Math.min(i + SEED_BATCH_SIZE, uniqueItems.length)} / ${uniqueItems.length}`);
    await sleep(50); // throttle slightly
  }

  console.log();
  console.log(`  Seeded ${ids.length} memories`);
  return { ids, contents };
}

// ── Embed ─────────────────────────────────────────────────────────────────────

async function embedSeededMemories(ids: number[], contents: string[]): Promise<void> {
  const db = getDb();
  console.log(`  Generating embeddings for ${ids.length} memories...`);

  const embeddings = await generateEmbeddings(contents);
  let embedded = 0;

  for (let i = 0; i < ids.length; i++) {
    const vec = embeddings[i];
    if (vec === null) continue;

    const { error } = await db
      .from('memories')
      .update({ embedding: JSON.stringify(vec) })
      .eq('id', ids[i]);

    if (!error) embedded++;
  }

  console.log(`  Embedded: ${embedded} / ${ids.length}`);
}

// ── LLM ──────────────────────────────────────────────────────────────────────

// Retry transient network failures (OpenRouter connect timeouts, 5xx) so a single
// blip during a long run doesn't abort the whole benchmark. Exponential backoff.
async function withRetry<T>(fn: () => Promise<T>, label: string, attempts = 5): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const wait = Math.min(1000 * Math.pow(2, i), 15000);
      console.error(`  [retry ${i + 1}/${attempts}] ${label} failed: ${(err as Error)?.message || err}; waiting ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}

const GROUNDED_SYSTEM = `You are a precise on-chain data assistant. Answer ONLY from the provided Solana memory context below. If the context does not contain the answer, respond with: "I don't have enough information to answer that."

Be concise — 1-2 sentences maximum. Do NOT speculate or use general knowledge.`;

const BASELINE_SYSTEM = `You are a general-purpose assistant. Answer the following question about Solana blockchain data as accurately as you can from your general knowledge. Be concise — 1-2 sentences.`;

async function answerGrounded(
  question: string,
  wallet: string,
): Promise<{ answer: string; memoriesReturned: number; latencyMs: number }> {
  const t0 = process.hrtime.bigint();

  const memories = await withOwnerWallet(wallet, () =>
    recallMemories({ query: question, limit: RECALL_LIMIT, skipExpansion: true })
  ) as Awaited<ReturnType<typeof recallMemories>>;

  const ctx = formatMemoryContext(memories);

  const userContent = ctx
    ? `Memory context:\n${ctx}\n\nQuestion: ${question}`
    : `Question: ${question}`;

  const answer = await withRetry(() => generateOpenRouterResponse({
    systemPrompt: GROUNDED_SYSTEM,
    messages: [{ role: 'user', content: userContent }],
    model: MODEL,
    temperature: 0,
    maxTokens: 200,
  }), 'answerGrounded');

  return { answer, memoriesReturned: memories.length, latencyMs: ms(t0) };
}

async function answerBaseline(question: string): Promise<{ answer: string; latencyMs: number }> {
  const t0 = process.hrtime.bigint();

  const answer = await withRetry(() => generateOpenRouterResponse({
    systemPrompt: BASELINE_SYSTEM,
    messages: [{ role: 'user', content: question }],
    model: MODEL,
    temperature: 0,
    maxTokens: 200,
  }), 'answerBaseline');

  return { answer, latencyMs: ms(t0) };
}

// ── Curated examples selection ────────────────────────────────────────────────

function pickExamples(
  results: QuestionResult[],
  qaMap: Map<string, SolanaQA>,
): ExampleItem[] {
  // Build pairs: grounded + baseline for the same id
  const groundedMap = new Map<string, QuestionResult>();
  const baselineMap = new Map<string, QuestionResult>();
  const abstentionMap = new Map<string, QuestionResult>();

  for (const r of results) {
    if (r.condition === 'grounded') groundedMap.set(r.id, r);
    else if (r.condition === 'baseline') baselineMap.set(r.id, r);
    else if (r.condition === 'abstention') abstentionMap.set(r.id, r);
  }

  const examples: ExampleItem[] = [];
  const categories = new Set<string>();

  // Try to include one per category (grounded wins, baseline wrong) — best examples
  for (const [id, gr] of groundedMap) {
    if (examples.length >= 6) break;
    const bl = baselineMap.get(id);
    if (!bl) continue;
    if (categories.has(gr.category)) continue;

    const qa = qaMap.get(id);
    if (!qa) continue;

    examples.push({
      id,
      category: gr.category,
      question: gr.question,
      groundTruth: gr.gold,
      sourceRef: gr.sourceRef,
      clude: { answer: gr.answer, correct: gr.correct },
      baseline: { answer: bl.answer, correct: bl.correct },
    });

    categories.add(gr.category);
  }

  // Add at least 1 abstention example if available
  for (const [id, abs] of abstentionMap) {
    const qa = qaMap.get(id);
    if (!qa) continue;
    examples.push({
      id,
      category: abs.category,
      question: abs.question,
      groundTruth: abs.gold,
      sourceRef: abs.sourceRef,
      clude: { answer: abs.answer, correct: abs.correct },
      baseline: { answer: '(not tested on held-out items)', correct: false },
      isAbstentionExample: true,
    });
    break;
  }

  return examples.slice(0, 8);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const opts = parseArgs();

  const wallet = `bench:solana-grounding${opts.runId ? ':' + opts.runId : ''}`;

  console.log('=== SOLANA GROUNDING BENCHMARK ===');
  console.log(`  Wallet:  ${wallet}`);
  console.log(`  Model:   ${MODEL}`);
  console.log(`  Limit:   ${opts.limit}`);
  console.log(`  Run ID:  ${opts.runId || '(none)'}`);

  // Validate required env vars
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
    process.exit(1);
  }
  if (!openrouterKey) {
    console.error('ERROR: Missing OPENROUTER_API_KEY');
    process.exit(1);
  }

  // Initialize OpenRouter
  initOpenRouter({ apiKey: openrouterKey, model: MODEL });

  // Set module-level owner wallet so storeMemory etc. work if called incidentally
  _setOwnerWallet(wallet);

  // ── Cleanup-only mode ──
  if (opts.cleanup) {
    console.log('\n[Cleanup mode] Deleting benchmark data...');
    await cleanupBenchmarkData(wallet);
    console.log('Done.');
    return;
  }

  // ── Load Q&A dataset ──
  console.log(`\n[1/6] Loading Q&A dataset from ${QA_PATH}...`);
  const qaFile: SolanaQAFile = JSON.parse(readFileSync(QA_PATH, 'utf-8'));
  const allItems = qaFile.items.slice(0, opts.limit);
  console.log(`  Loaded ${allItems.length} items (of ${qaFile.count} total)`);

  // ── Hold-out split ──
  // Every ABSTENTION_HOLDOUT_MOD-th item by original index is held out (not seeded)
  const seededItems: SolanaQA[] = [];
  const heldOutItems: SolanaQA[] = [];

  for (let i = 0; i < allItems.length; i++) {
    if ((i + 1) % ABSTENTION_HOLDOUT_MOD === 0) {
      heldOutItems.push(allItems[i]);
    } else {
      seededItems.push(allItems[i]);
    }
  }

  console.log(`  Seeded: ${seededItems.length} | Held-out (abstention): ${heldOutItems.length}`);

  // Build a quick-lookup map
  const qaMap = new Map<string, SolanaQA>(allItems.map(item => [item.id, item]));

  // ── Seed memories ──
  if (opts.skipSeeding) {
    console.log('\n[2/6] Seeding memories... SKIPPED (--skip-seeding; reusing existing wallet data)');
    console.log('[3/6] Embedding memories... SKIPPED');
  } else {
    console.log('\n[2/6] Seeding memories...');
    const { ids: seededIds, contents: seededContents } = await seedMemories(seededItems, wallet);

    // ── Embed ──
    console.log('\n[3/6] Embedding memories...');
    if (seededIds.length > 0) {
      await embedSeededMemories(seededIds, seededContents);
    } else {
      console.log('  No memories to embed.');
    }
  }

  // ── Evaluate ──
  console.log('\n[4/6] Evaluating questions...');
  const results: QuestionResult[] = [];
  let done = 0;
  const total = seededItems.length * 2 + heldOutItems.length; // grounded + baseline + abstention

  // Seeded items — two conditions
  for (const item of seededItems) {
    // Grounded
    const g = await answerGrounded(item.question, wallet);
    results.push({
      id: item.id,
      category: item.category,
      question: item.question,
      gold: item.gold,
      sourceRef: item.sourceRef,
      condition: 'grounded',
      answer: g.answer,
      correct: gradeAnswer(item.category, item.gold, g.answer),
      memoriesReturned: g.memoriesReturned,
      latencyMs: g.latencyMs,
    });
    done++;

    // Baseline
    const b = await answerBaseline(item.question);
    results.push({
      id: item.id,
      category: item.category,
      question: item.question,
      gold: item.gold,
      sourceRef: item.sourceRef,
      condition: 'baseline',
      answer: b.answer,
      correct: gradeAnswer(item.category, item.gold, b.answer),
      memoriesReturned: 0,
      latencyMs: b.latencyMs,
    });
    done++;

    process.stdout.write(`\r  Progress: ${done} / ${total}`);
    await sleep(100); // throttle
  }

  // Held-out items — abstention condition only
  for (const item of heldOutItems) {
    const g = await answerGrounded(item.question, wallet);
    results.push({
      id: item.id,
      category: item.category,
      question: item.question,
      gold: item.gold,
      sourceRef: item.sourceRef,
      condition: 'abstention',
      answer: g.answer,
      correct: isAbstention(g.answer),
      memoriesReturned: g.memoriesReturned,
      latencyMs: g.latencyMs,
    });
    done++;

    process.stdout.write(`\r  Progress: ${done} / ${total}`);
    await sleep(100);
  }

  console.log();

  // ── Compute metrics ──
  console.log('\n[5/6] Computing metrics...');

  const catStats = new Map<string, CategoryStats>();

  const groundedResults = results.filter(r => r.condition === 'grounded');
  const baselineResults = results.filter(r => r.condition === 'baseline');
  const abstentionResults = results.filter(r => r.condition === 'abstention');

  // Hallucination rate: wrong non-abstaining grounded answers / total non-abstaining grounded answers
  const nonAbstainingGrounded = groundedResults.filter(r => !isAbstention(r.answer));
  const wrongNonAbstainingGrounded = nonAbstainingGrounded.filter(r => !r.correct);
  const hallucinationRate = nonAbstainingGrounded.length > 0
    ? wrongNonAbstainingGrounded.length / nonAbstainingGrounded.length
    : 0;

  // Baseline wrong rate on seeded questions
  const wrongBaseline = baselineResults.filter(r => !r.correct);
  const baselineRate = baselineResults.length > 0
    ? wrongBaseline.length / baselineResults.length
    : 0;

  // Abstention accuracy
  const correctAbstentions = abstentionResults.filter(r => r.correct);
  const abstentionAccuracy = abstentionResults.length > 0
    ? correctAbstentions.length / abstentionResults.length
    : 0;

  // Per-category breakdown
  for (const r of results) {
    if (!catStats.has(r.category)) {
      catStats.set(r.category, {
        groundedCorrect: 0, groundedTotal: 0, groundedNonAbstaining: 0,
        baselineCorrect: 0, baselineTotal: 0,
        abstentionCorrect: 0, abstentionTotal: 0,
      });
    }
    const s = catStats.get(r.category)!;
    if (r.condition === 'grounded') {
      s.groundedTotal++;
      if (r.correct) s.groundedCorrect++;
      if (!isAbstention(r.answer)) s.groundedNonAbstaining++;
    } else if (r.condition === 'baseline') {
      s.baselineTotal++;
      if (r.correct) s.baselineCorrect++;
    } else {
      s.abstentionTotal++;
      if (r.correct) s.abstentionCorrect++;
    }
  }

  const byCategory: BenchmarkResults['byCategory'] = {};
  for (const [cat, s] of catStats) {
    byCategory[cat] = {
      // Denominator excludes abstentions so per-category accuracy reconciles with the
      // headline rate (which is also computed over non-abstaining grounded answers).
      groundedAccuracy: s.groundedNonAbstaining > 0 ? s.groundedCorrect / s.groundedNonAbstaining : 0,
      baselineAccuracy: s.baselineTotal > 0 ? s.baselineCorrect / s.baselineTotal : 0,
      n: s.groundedTotal,
    };
  }

  // Print summary
  console.log('\n=== RESULTS ===');
  console.log(`  Grounded accuracy:    ${((1 - hallucinationRate) * 100).toFixed(1)}%  (hallucination rate: ${(hallucinationRate * 100).toFixed(1)}%)`);
  console.log(`  Baseline error rate:  ${(baselineRate * 100).toFixed(1)}%`);
  console.log(`  Abstention accuracy:  ${(abstentionAccuracy * 100).toFixed(1)}%  (${correctAbstentions.length}/${abstentionResults.length})`);
  console.log(`  Questions evaluated:  ${seededItems.length} seeded + ${heldOutItems.length} held-out`);
  console.log('\n  Per-category (grounded acc / baseline acc):');
  for (const [cat, s] of Object.entries(byCategory)) {
    console.log(`    ${cat.padEnd(20)} ${(s.groundedAccuracy * 100).toFixed(0)}% grounded / ${(s.baselineAccuracy * 100).toFixed(0)}% baseline  (n=${s.n})`);
  }

  // ── Write results ──
  console.log('\n[6/6] Writing results...');

  const benchmarkResults: BenchmarkResults = {
    placeholder: false,
    rate: hallucinationRate,
    baselineRate,
    abstentionAccuracy,
    n: seededItems.length,
    nAbstention: heldOutItems.length,
    model: MODEL,
    datasetVersion: DATASET_VERSION,
    runAt: new Date().toISOString(),
    byCategory,
  };

  writeFileSync(RESULTS_PATH, JSON.stringify(benchmarkResults, null, 2));
  console.log(`  Results written to ${RESULTS_PATH}`);

  const examples = pickExamples(results, qaMap);
  writeFileSync(EXAMPLES_PATH, JSON.stringify(examples, null, 2));
  console.log(`  Examples written to ${EXAMPLES_PATH} (${examples.length} items)`);

  // ── Cleanup (unless skipped) ──
  if (!opts.skipCleanup) {
    console.log('\n[Cleanup] Removing benchmark memories...');
    await cleanupBenchmarkData(wallet);
  } else {
    console.log('\n[Cleanup] Skipped (--skip-cleanup). Re-run with --cleanup to delete.');
  }

  console.log('\n=== DONE ===');
}

// Execute
main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
