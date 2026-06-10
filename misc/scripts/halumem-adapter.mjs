// HaluMem benchmark adapter for Clude (the TypeScript cognitive-memory system).
//
// Reads the HaluMem-Medium dataset, drives Clude's REAL recall pipeline (vector +
// BM25 + metadata over the production `memories` table, owner-scoped per user), and
// writes the artifact JSONL that HaluMem's official `evaluation.py` scorer consumes.
//
// Pipeline per user (sessions processed in chronological order):
//   Task A — Extraction:  LLM (OpenRouter) extracts atomic standalone memory facts from
//                         each session's dialogue. Facts are stored as Clude memories via
//                         DIRECT insert into `memories` (owner_wallet='bench:halumem:<uuid>')
//                         + batched Voyage embedding, avoiding storeMemory()'s fire-and-forget
//                         side effects (on-chain commit / entity extraction) that cause 429s.
//   Task B — Update:      For each is_update memory_point with original_memories, recall
//                         top-10 via Clude's recallMemories(query=memory_content) and record
//                         them as `memories_from_system`.
//   QA:                   For each question, recall context via Clude, then have the LLM answer
//                         terse using ONLY that context. The `system_response` is the scored field.
//
// Recall sees memories from all sessions up to AND including the current one because we
// store the current session's facts BEFORE running its update-recall + QA.
//
// Output: misc/halumem-out/memzero-medium/memzero_eval_results.jsonl — one user-object per line.
//
// Usage (smoke test on user 0):
//   USERS=1 node --import tsx misc/scripts/halumem-adapter.mjs
//
// Env (all optional, sensible defaults):
//   USERS=20                         # limit number of users (default: all)
//   IN=/tmp/halumem-medium.jsonl     # input dataset
//   OUT_DIR=misc/halumem-out/memzero-medium
//   OPENROUTER_API_KEY=...           # falls back to the embedded benchmark key
//   OR_MODEL=openai/gpt-5-mini       # extraction + QA model
//   STORE_CONCURRENCY=24             # parallel embeddings/inserts within a batch
//   LLM_CONCURRENCY=6                # parallel OpenRouter calls
//   VERBOSE=1                        # print recall examples + per-session progress
//
// SECURITY: every store + recall is scoped to a `bench:halumem:*` wallet via
// withOwnerWallet(). Recall is owner-scoped, so it NEVER sees the ~211K real production
// rows under other wallets. Idempotent: deletes this wallet's rows before re-ingesting a user.

import dotenv from 'dotenv';
dotenv.config({ path: '/Users/sebastien/Projects/cluude-bot/.env', override: true });

import { readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Make the @clude workspace packages resolvable in this worktree ──────────────
// The worktree's node_modules is minimal (no pnpm-linked workspace packages). The
// brain dist is CommonJS and does require("@clude/shared/..."), so both @clude/brain
// and @clude/shared must resolve as bare specifiers. We symlink them to the local
// packages/ dirs (idempotent) — mirroring what a pnpm install would create.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..'); // misc/scripts -> repo root
function ensureCludeSymlink(pkg) {
  const linkPath = resolve(REPO_ROOT, 'node_modules', '@clude', pkg);
  const target = resolve(REPO_ROOT, 'packages', pkg);
  if (existsSync(linkPath)) return;
  mkdirSync(dirname(linkPath), { recursive: true });
  try { symlinkSync(target, linkPath, 'dir'); } catch (e) { if (e.code !== 'EEXIST') throw e; }
}
ensureCludeSymlink('shared');
ensureCludeSymlink('brain');

// ── Embedding wiring (mirror scale-bm25-benchmark.mjs) ──────────────────────────
// Must be set BEFORE importing the brain/shared modules so config.embedding picks
// them up at module-load. EXP_BM25_SEARCH=true turns on the BM25 full-text path so
// recall runs the full hybrid (vector + BM25 + metadata) — best for exact-fact QA.
process.env.EMBEDDING_PROVIDER = 'voyage';
process.env.EMBEDDING_API_KEY = process.env.VOYAGE_API_KEY;
process.env.EMBEDDING_MODEL = 'voyage-4-large';
process.env.EXP_BM25_SEARCH = 'true';

const { getDb } = await import('@clude/shared/core/database');
const { withOwnerWallet } = await import('@clude/shared/core/owner-context');
const { generateEmbeddings } = await import('@clude/shared/core/embeddings');
const { recallMemories, generateHashId } = await import('@clude/brain/memory');

const db = getDb();

// ── Config ──────────────────────────────────────────────────────────────────────
const IN = process.env.IN || '/tmp/halumem-medium.jsonl';
const OUT_DIR = process.env.OUT_DIR || resolve(REPO_ROOT, 'misc/halumem-out/memzero-medium');
const OUT_FILE = resolve(OUT_DIR, 'memzero_eval_results.jsonl');
const USERS = process.env.USERS ? Number(process.env.USERS) : Infinity;
const OR_KEY = process.env.OPENROUTER_API_KEY ||
  '';
const OR_MODEL = process.env.OR_MODEL || 'openai/gpt-5-mini';
const STORE_CONCURRENCY = Number(process.env.STORE_CONCURRENCY || 24);
const LLM_CONCURRENCY = Number(process.env.LLM_CONCURRENCY || 6);
const UPDATE_TOP_K = 10;   // HaluMem update task: top-10 recalled memories
const QA_RECALL_K = 12;    // memories fed to the answerer per question
const VERBOSE = process.env.VERBOSE === '1' || USERS === 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Generic retry with exponential backoff — network/DB/LLM flakiness is common at scale.
async function withRetry(fn, { attempts = 8, base = 600, label = 'op' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const wait = base * Math.pow(1.6, i) + (i * 137) % 400; // jittered backoff (no Math.random)
      if (VERBOSE && i >= 2) console.error(`  [retry ${i + 1}/${attempts}] ${label}: ${String(e?.message || e).slice(0, 120)}`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// Run an async mapper over items with a bounded concurrency pool.
async function pMap(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await mapper(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, worker));
  return results;
}

// ── Telemetry ────────────────────────────────────────────────────────────────────
const telemetry = {
  extractionCalls: 0, qaCalls: 0,
  llmPromptTokens: 0, llmCompletionTokens: 0, llmCostUsd: 0,
  embedCalls: 0, embedTokens: 0, embeddedFacts: 0,
  recallCalls: 0,
  factsStored: 0,
};

// ── OpenRouter chat (extraction + QA) ─────────────────────────────────────────────
async function orChat(messages, { maxTokens = 1200, kind = 'qa' } = {}) {
  const data = await withRetry(async () => {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OR_MODEL, messages, max_tokens: maxTokens }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 160)}`);
    }
    const d = await res.json();
    if (!d.choices?.[0]) throw new Error(`OpenRouter no choices: ${JSON.stringify(d).slice(0, 160)}`);
    return d;
  }, { label: `openrouter:${kind}` });

  if (kind === 'extract') telemetry.extractionCalls++; else telemetry.qaCalls++;
  const u = data.usage || {};
  telemetry.llmPromptTokens += u.prompt_tokens || 0;
  telemetry.llmCompletionTokens += u.completion_tokens || 0;
  telemetry.llmCostUsd += u.cost || 0;
  return (data.choices[0].message?.content || '').trim();
}

// Parse a JSON array of strings from an LLM response (tolerates code fences / prose).
function parseJsonStringArray(text) {
  if (!text) return [];
  let t = text.trim();
  // strip ```json ... ``` or ``` ... ``` fences
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // grab the first [...] block if there's surrounding prose
  const arr = t.match(/\[[\s\S]*\]/);
  if (arr) t = arr[0];
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) {
      return parsed.map((x) => (typeof x === 'string' ? x : String(x))).map((s) => s.trim()).filter(Boolean);
    }
  } catch { /* fall through */ }
  return [];
}

// ── Task A: extract atomic memory facts from a session's dialogue ─────────────────
function formatDialogue(dialogue) {
  return (dialogue || [])
    .map((t) => `${t.role}: ${t.content}`)
    .join('\n');
}

const EXTRACT_SYS = `You extract durable memory facts about the USER from a conversation, the way a memory system (like Mem0) does.

Rules:
- Output a JSON array of short, atomic, standalone declarative facts about the user.
- Resolve all pronouns to the user's name ("{NAME}"). Each fact must stand alone without context.
- Capture persona facts, events, preferences, relationships, plans, and updates the user states.
- Do NOT invent or infer facts that are not directly supported by what the user said. If the assistant introduced a claim the user never confirmed, omit it.
- One fact per array element. No commentary. Return ONLY the JSON array.`;

async function extractFacts(userName, dialogue) {
  const sys = EXTRACT_SYS.replaceAll('{NAME}', userName);
  const text = await orChat([
    { role: 'system', content: sys },
    { role: 'user', content: `Conversation:\n${formatDialogue(dialogue)}\n\nReturn the JSON array of atomic memory facts about ${userName}:` },
  ], { maxTokens: 2000, kind: 'extract' });
  return parseJsonStringArray(text);
}

// ── Storage: DIRECT insert + batched Voyage embedding (owner-scoped) ──────────────
// Embeds the summary text (recall's vector search matches against memories.embedding,
// which is the summary embedding — see embedMemory in memory.ts). content == summary == fact.
async function storeFacts(uuid, facts) {
  if (!facts.length) return [];
  const ownerWallet = `bench:halumem:${uuid}`;
  const nowIso = new Date().toISOString();

  // Batch-embed all facts in one Voyage call (cheap + fast). generateEmbeddings handles
  // the 8000-char truncation and returns null per item on failure.
  const embeddings = await withRetry(() => generateEmbeddings(facts), { label: 'voyage:embed' });
  telemetry.embedCalls++;
  telemetry.embeddedFacts += embeddings.filter(Boolean).length;
  telemetry.embedTokens += facts.reduce((a, f) => a + Math.ceil(f.length / 4), 0); // rough est

  const rows = facts.map((fact, i) => ({
    hash_id: generateHashId(),
    memory_type: 'semantic',
    content: fact,
    summary: fact.slice(0, 500),
    tags: ['halumem'],
    concepts: [],
    emotional_valence: 0,
    importance: 0.6,
    access_count: 0,
    source: 'halumem-benchmark',
    metadata: {},
    decay_factor: 1.0,
    embedding: embeddings[i] ? JSON.stringify(embeddings[i]) : null,
    owner_wallet: ownerWallet,
    created_at: nowIso,
    last_accessed: nowIso,
  }));

  // Insert in chunks (one chunk = one REST round-trip) with retry per chunk.
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await withRetry(async () => {
      const { error } = await db.from('memories').insert(chunk);
      if (error) throw new Error(`insert: ${error.message}`);
    }, { label: 'db:insert' });
  }
  telemetry.factsStored += rows.length;
  return facts;
}

// ── Clude recall (REAL pipeline), owner-scoped ────────────────────────────────────
// trackAccess:false is CRITICAL for a benchmark. With access tracking on, recall calls
// batch_boost_memory_access (migration 016), which does importance = LEAST(1.0, importance + boost)
// on every recalled memory. The first session's persona facts get recalled on nearly every
// query, so their importance ratchets 0.6 -> 1.0, and the recall pipeline's importance-ranked
// candidate query then floods every result with those same generic facts (a positive feedback
// loop that drowns the specific fact each question needs). Disabling access tracking keeps the
// corpus state immutable across the eval — the correct semantics for benchmarking retrieval.
async function recall(uuid, query, limit) {
  const ownerWallet = `bench:halumem:${uuid}`;
  telemetry.recallCalls++;
  return withRetry(() => withOwnerWallet(ownerWallet, () =>
    recallMemories({ query, limit, skipExpansion: true, trackAccess: false })
  ), { label: 'clude:recall' });
}

// memory.content is the primary text; fall back to summary.
const memText = (m) => (m?.content || m?.summary || '').trim();

// ── QA: answer terse using ONLY the retrieved memories ────────────────────────────
const QA_SYS = `You are a helpful assistant. Answer the question using ONLY the provided memories.
If the answer is not present in the memories, respond exactly: Unknown.
Answer in under 6 words. No explanation.`;

async function answerQuestion(question, contextMemories) {
  const context = contextMemories.map((m, i) => `${i + 1}. ${m}`).join('\n');
  const text = await orChat([
    { role: 'system', content: QA_SYS },
    { role: 'user', content: `Memories:\n${context || '(none)'}\n\nQuestion: ${question}\nAnswer:` },
  ], { maxTokens: 600, kind: 'qa' });
  return text.replace(/^answer:\s*/i, '').trim();
}

// ── Per-user processing ───────────────────────────────────────────────────────────
function parseUserName(personaInfo) {
  const m = (personaInfo || '').match(/Name:\s*(.*?); Gender:/);
  return (m && m[1].trim()) || 'the user';
}

async function processUser(user, idx) {
  const uuid = user.uuid;
  const ownerWallet = `bench:halumem:${uuid}`;
  const userName = parseUserName(user.persona_info);
  const t0 = Date.now();

  // Idempotency: wipe any prior rows for THIS bench wallet (paginated delete-by-filter).
  // Owner-scoped — only ever touches bench:halumem:<uuid>.
  await withRetry(async () => {
    const { error } = await db.from('memories').delete().eq('owner_wallet', ownerWallet);
    if (error) throw new Error(`cleanup: ${error.message}`);
  }, { label: 'db:cleanup' });

  const sessions = user.sessions || [];
  console.log(`\n[user ${idx}] ${userName} (${uuid}) — ${sessions.length} sessions`);

  const outSessions = [];
  let printedRecallExample = false;
  let firstStoredSample = null;

  for (let si = 0; si < sessions.length; si++) {
    const session = sessions[si];

    // ── Task A: extract + store this session's facts (BEFORE its update/QA) ──
    let extracted = [];
    try {
      extracted = await extractFacts(userName, session.dialogue);
    } catch (e) {
      console.error(`  [user ${idx}] session ${si} extraction failed: ${String(e?.message || e).slice(0, 120)}`);
      extracted = [];
    }
    try {
      if (extracted.length) await storeFacts(uuid, extracted);
      if (!firstStoredSample && extracted.length) firstStoredSample = extracted.slice(0, 3);
    } catch (e) {
      console.error(`  [user ${idx}] session ${si} store failed: ${String(e?.message || e).slice(0, 120)}`);
    }

    // Build the augmented session (gold passed through verbatim + added fields).
    const augSession = { ...session };
    augSession.extracted_memories = extracted;
    augSession.add_dialogue_duration_ms = 0.0;

    // ── Task B: update-recall for is_update memory_points ──
    const memoryPoints = (session.memory_points || []).map((mp) => {
      if (mp.is_update === 'True' && Array.isArray(mp.original_memories) && mp.original_memories.length > 0) {
        return { ...mp }; // clone; memories_from_system filled below
      }
      return mp;
    });
    augSession.memory_points = memoryPoints;

    for (const mp of memoryPoints) {
      if (mp.is_update === 'True' && Array.isArray(mp.original_memories) && mp.original_memories.length > 0) {
        try {
          const mems = await recall(uuid, mp.memory_content, UPDATE_TOP_K);
          mp.memories_from_system = mems.map(memText).filter(Boolean).slice(0, UPDATE_TOP_K);
          if (VERBOSE && !printedRecallExample && mp.memories_from_system.length) {
            printedRecallExample = true;
            console.log(`  [recall proof — update] query="${mp.memory_content.slice(0, 70)}"`);
            mp.memories_from_system.slice(0, 3).forEach((m, i) => console.log(`     #${i + 1} ${m.slice(0, 90)}`));
          }
        } catch (e) {
          console.error(`  [user ${idx}] session ${si} update-recall failed: ${String(e?.message || e).slice(0, 120)}`);
          mp.memories_from_system = [];
        }
      }
    }

    // ── QA: recall context + terse answer for each question ──
    if (Array.isArray(session.questions) && session.questions.length > 0) {
      const answered = await pMap(session.questions, LLM_CONCURRENCY, async (q) => {
        const out = { ...q };
        try {
          const mems = await recall(uuid, q.question, QA_RECALL_K);
          const ctxList = mems.map(memText).filter(Boolean);
          out.context = ctxList.join('\n');
          out.system_response = await answerQuestion(q.question, ctxList);
          if (VERBOSE && !printedRecallExample && ctxList.length) {
            printedRecallExample = true;
            console.log(`  [recall proof — QA] q="${q.question.slice(0, 70)}" -> "${out.system_response}"`);
            ctxList.slice(0, 3).forEach((m, i) => console.log(`     ctx#${i + 1} ${m.slice(0, 90)}`));
          }
        } catch (e) {
          console.error(`  [user ${idx}] session ${si} QA failed: ${String(e?.message || e).slice(0, 120)}`);
          out.context = out.context || '';
          out.system_response = 'Unknown';
        }
        out.search_duration_ms = 0.0;
        out.response_duration_ms = 0.0;
        return out;
      });
      augSession.questions = answered;
    }

    outSessions.push(augSession);
    if (VERBOSE && (si + 1) % 10 === 0) {
      console.log(`  ...session ${si + 1}/${sessions.length} | stored ${telemetry.factsStored} facts | recalls ${telemetry.recallCalls} | LLM ${telemetry.extractionCalls + telemetry.qaCalls}`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[user ${idx}] done in ${elapsed}s`);
  if (firstStoredSample) {
    console.log(`  sample stored facts: ${firstStoredSample.map((f) => `"${f.slice(0, 60)}"`).join(' | ')}`);
  }

  return { uuid, user_name: userName, sessions: outSessions };
}

// ── Main ──────────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.VOYAGE_API_KEY) { console.error('FATAL: VOYAGE_API_KEY not set in .env'); process.exit(1); }
  if (!existsSync(IN)) { console.error(`FATAL: input not found: ${IN}`); process.exit(1); }

  const lines = readFileSync(IN, 'utf8').trim().split('\n').filter(Boolean);
  const allUsers = lines.map((l) => JSON.parse(l));
  const USER_START = process.env.USER_START ? Number(process.env.USER_START) : 0;
  const USER_END = process.env.USER_END ? Number(process.env.USER_END)
    : (Number.isFinite(USERS) ? USER_START + USERS : allUsers.length);
  const users = allUsers.slice(USER_START, USER_END);
  const USER_CONCURRENCY = Number(process.env.USER_CONCURRENCY || 1);

  mkdirSync(OUT_DIR, { recursive: true });

  console.log('HaluMem adapter — Clude REAL recall pipeline');
  console.log(`  input:      ${IN} (${allUsers.length} users; processing ${users.length})`);
  console.log(`  output:     ${OUT_FILE}`);
  console.log(`  recall:     vector + BM25 + metadata (EXP_BM25_SEARCH=on), skipExpansion=true`);
  console.log(`  embed:      voyage-4-large (1024d) -> memories.embedding`);
  console.log(`  LLM:        ${OR_MODEL} via OpenRouter (extraction + QA)`);
  console.log(`  wallets:    bench:halumem:<uuid> (owner-scoped; prod rows untouched)`);

  const wallStart = Date.now();
  const outLines = [];
  console.log(`  concurrency: ${USER_CONCURRENCY} users in parallel (range ${USER_START}..${USER_END})`);
  for (let i = 0; i < users.length; i += USER_CONCURRENCY) {
    const batch = users.slice(i, i + USER_CONCURRENCY);
    const results = await Promise.all(batch.map((u, j) =>
      processUser(u, USER_START + i + j)
        .then((r) => ({ ok: r }))
        .catch((e) => { console.error(`[user ${USER_START + i + j}] FATAL (skipped): ${String(e?.message || e).slice(0, 200)}`); return { ok: null }; })
    ));
    for (const r of results) if (r.ok) outLines.push(JSON.stringify(r.ok));
    // Write incrementally so a crash mid-run still leaves a valid partial artifact.
    writeFileSync(OUT_FILE, outLines.join('\n') + '\n');
    console.log(`  [progress] ${outLines.length}/${users.length} users done`);
  }

  const wallSec = ((Date.now() - wallStart) / 1000).toFixed(1);
  console.log('\n=== DONE ===');
  console.log(`  wrote ${outLines.length} user-object(s) -> ${OUT_FILE}`);
  console.log(`  wall clock:        ${wallSec}s`);
  console.log(`  facts stored:      ${telemetry.factsStored} (embedded ${telemetry.embeddedFacts})`);
  console.log(`  extraction calls:  ${telemetry.extractionCalls}`);
  console.log(`  QA calls:          ${telemetry.qaCalls}`);
  console.log(`  recall calls:      ${telemetry.recallCalls}`);
  console.log(`  Voyage embed calls:${telemetry.embedCalls} (~${telemetry.embedTokens} est tokens)`);
  console.log(`  LLM tokens:        prompt ${telemetry.llmPromptTokens} + completion ${telemetry.llmCompletionTokens}`);
  console.log(`  LLM cost (OpenRouter reported): $${telemetry.llmCostUsd.toFixed(4)}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
