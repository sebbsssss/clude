// HaluMem QA-only rerun — two-arm prompt A/B over the EXISTING seeded corpus.
//
// Purpose: validate the read-side hallucination defense (PR #264) against the 11.77%
// baseline measured by the v1 adapter run. No re-seeding: recalls run against the
// bench:halumem:<uuid> wallets already in prod (verified present, ~1.1-1.5K rows/user).
//
// Design — one recall per question, TWO answers per question:
//   ARM baseline — the v1 adapter's QA prompt + plain numbered context (verbatim copy).
//   ARM grounded — the #264 memory_rules ported to QA form: ground-only, timestamped
//                  lines, most-recent-wins on conflict, "Unknown" over guessing. Same
//                  answer-format contract (≤6 words / "Unknown") so judge comparability holds.
// Both arms share the IDENTICAL retrieved context per question → the delta isolates the
// prompt. (The recall stack itself is also newer than the 11.77% run: entity RPCs deployed,
// ts_summary GIN index, recency clamp — so baseline-arm vs 11.77% measures the stack delta.)
//
// Output (memzero artifact shape, one per arm — QA fields filled; extraction/update tasks
// intentionally empty/no-op, so ONLY the QA table of evaluation.py is meaningful):
//   misc/halumem-out-rerun/baseline/memzero_eval_results.jsonl
//   misc/halumem-out-rerun/grounded/memzero_eval_results.jsonl
//
// Usage:
//   USERS=1 node --import tsx misc/scripts/halumem-qa-rerun.mjs     # smoke (user 0)
//   node --import tsx misc/scripts/halumem-qa-rerun.mjs             # all 20 users
//
// Env: USERS / USER_START / USER_END, IN=/tmp/halumem-medium.jsonl,
//      OUT_BASE=misc/halumem-out-rerun, OR_MODEL=openai/gpt-5-mini, LLM_CONCURRENCY=6
//
// SECURITY: recall is owner-scoped to bench:halumem:<uuid> via withOwnerWallet; this
// script performs NO writes to the memories table at all (read-only against prod).

import dotenv from 'dotenv';
dotenv.config({ path: '/Users/sebastien/Projects/cluude-bot/.env', override: true });

import { readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── @clude workspace resolution (verbatim from halumem-adapter.mjs) ─────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
function ensureCludeSymlink(pkg) {
  const linkPath = resolve(REPO_ROOT, 'node_modules', '@clude', pkg);
  const target = resolve(REPO_ROOT, 'packages', pkg);
  if (existsSync(linkPath)) return;
  mkdirSync(dirname(linkPath), { recursive: true });
  try { symlinkSync(target, linkPath, 'dir'); } catch (e) { if (e.code !== 'EEXIST') throw e; }
}
ensureCludeSymlink('shared');
ensureCludeSymlink('brain');

// Embedding + BM25 wiring — must precede brain/shared imports (config reads at load).
process.env.EMBEDDING_PROVIDER = 'voyage';
process.env.EMBEDDING_API_KEY = process.env.VOYAGE_API_KEY;
process.env.EMBEDDING_MODEL = 'voyage-4-large';
process.env.EXP_BM25_SEARCH = 'true';

const { withOwnerWallet } = await import('@clude/shared/core/owner-context');
const { recallMemories } = await import('@clude/brain/memory');

// ── Config ──────────────────────────────────────────────────────────────────────
const IN = process.env.IN || '/tmp/halumem-medium.jsonl';
const OUT_BASE = process.env.OUT_BASE || resolve(REPO_ROOT, 'misc/halumem-out-rerun');
const USERS = process.env.USERS ? Number(process.env.USERS) : Infinity;
// LLM endpoint: OpenRouter when OPENROUTER_API_KEY is set, else the OpenAI API directly
// (same underlying model — the v1 run used openai/gpt-5-mini through OpenRouter).
const OR_KEY = process.env.OPENROUTER_API_KEY || '';
const USE_OPENROUTER = !!OR_KEY;
const API_KEY = USE_OPENROUTER ? OR_KEY : (process.env.OPENAI_API_KEY || '');
const API_BASE = USE_OPENROUTER ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';
const OR_MODEL_RAW = process.env.OR_MODEL || 'openai/gpt-5-mini';
const OR_MODEL = USE_OPENROUTER ? OR_MODEL_RAW : OR_MODEL_RAW.replace(/^openai\//, '');
const LLM_CONCURRENCY = Number(process.env.LLM_CONCURRENCY || 6);
const QA_RECALL_K = 12; // same as the v1 run
const VERBOSE = process.env.VERBOSE === '1' || USERS === 1;

const telemetry = { qaCalls: 0, recallCalls: 0, llmCostUsd: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(fn, { attempts = 8, base = 600, label = 'op' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const wait = base * Math.pow(1.6, i) + (i * 137) % 400;
      if (VERBOSE && i >= 2) console.error(`  [retry ${i + 1}/${attempts}] ${label}: ${String(e?.message || e).slice(0, 120)}`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

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

async function orChat(messages, { maxTokens = 600 } = {}) {
  const data = await withRetry(async () => {
    // Direct OpenAI rejects max_tokens for the gpt-5 family (wants max_completion_tokens);
    // OpenRouter normalizes either. Send the right one per endpoint.
    const tokenParam = USE_OPENROUTER ? { max_tokens: maxTokens } : { max_completion_tokens: maxTokens };
    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OR_MODEL, messages, ...tokenParam }),
    });
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const d = await res.json();
    if (!d.choices?.[0]) throw new Error(`OpenRouter no choices: ${JSON.stringify(d).slice(0, 160)}`);
    return d;
  }, { label: 'or:qa' });
  telemetry.qaCalls++;
  if (data.usage?.cost) telemetry.llmCostUsd += data.usage.cost;
  return (data.choices[0].message.content || '').trim();
}

// ── Recall (verbatim semantics from the v1 adapter) ─────────────────────────────
async function recall(uuid, query, limit) {
  const ownerWallet = `bench:halumem:${uuid}`;
  telemetry.recallCalls++;
  return withRetry(() => withOwnerWallet(ownerWallet, () =>
    recallMemories({ query, limit, skipExpansion: true, trackAccess: false })
  ), { label: 'clude:recall' });
}

const memText = (m) => (m?.content || m?.summary || '').trim();
const memStamp = (m) => {
  const d = m?.created_at ? new Date(m.created_at) : null;
  return d && !isNaN(d) ? d.toISOString().slice(0, 16).replace('T', ' ') : '';
};

// ── ARM A: baseline — the v1 adapter's QA prompt, verbatim ──────────────────────
const QA_SYS_BASELINE = `You are a helpful assistant. Answer the question using ONLY the provided memories.
If the answer is not present in the memories, respond exactly: Unknown.
Answer in under 6 words. No explanation.`;

function contextBaseline(mems) {
  return mems.map(memText).filter(Boolean).map((m, i) => `${i + 1}. ${m}`).join('\n');
}

// ── ARM B: grounded — PR #264's memory_rules ported to QA form ──────────────────
// Same answer-format contract as baseline (≤6 words / "Unknown"); the delta is the
// grounding discipline: timestamped lines, most-recent-wins, never-guess.
const QA_SYS_GROUNDED = `You are a careful assistant answering questions about a user from their memories.
Ground every claim in the memories below. If the answer is not supported by them, respond exactly: Unknown.
Memories are timestamped. If two memories conflict, the one with the most recent timestamp is the current truth — answer from it and treat older ones as superseded.
Never guess, infer beyond, or invent details that are not in the memories. "Unknown" is always better than a wrong guess.
Answer in under 6 words, or exactly "Unknown". No explanation.`;

function contextGrounded(mems) {
  return mems
    .filter((m) => memText(m))
    .map((m, i) => {
      const stamp = memStamp(m);
      return `${i + 1}. ${stamp ? `[${stamp}] ` : ''}${memText(m)}`;
    })
    .join('\n');
}

async function answerArm(sys, question, context) {
  const text = await orChat([
    { role: 'system', content: sys },
    { role: 'user', content: `Memories:\n${context || '(none)'}\n\nQuestion: ${question}\nAnswer:` },
  ]);
  return text.replace(/^answer:\s*/i, '').trim() || 'Unknown';
}

function parseUserName(personaInfo) {
  const m = (personaInfo || '').match(/Name:\s*(.*?); Gender:/);
  return (m && m[1].trim()) || 'the user';
}

// ── Per-user: QA only (no cleanup, no seeding, no update-recall) ────────────────
async function processUser(user, idx) {
  const uuid = user.uuid;
  const userName = parseUserName(user.persona_info);
  const t0 = Date.now();
  console.log(`\n[user ${idx}] ${userName} (${uuid}) — QA-only rerun over existing corpus`);

  const outA = []; // baseline sessions
  const outB = []; // grounded sessions

  for (let si = 0; si < (user.sessions || []).length; si++) {
    const session = user.sessions[si];
    const baseSession = { ...session, extracted_memories: [], add_dialogue_duration_ms: 0.0 };
    const sessA = { ...baseSession };
    const sessB = { ...baseSession };

    if (Array.isArray(session.questions) && session.questions.length > 0) {
      const answered = await pMap(session.questions, LLM_CONCURRENCY, async (q) => {
        const a = { ...q };
        const b = { ...q };
        try {
          const mems = await recall(uuid, q.question, QA_RECALL_K);
          const ctxA = contextBaseline(mems);
          const ctxB = contextGrounded(mems);
          a.context = ctxA;
          b.context = ctxB;
          [a.system_response, b.system_response] = await Promise.all([
            answerArm(QA_SYS_BASELINE, q.question, ctxA),
            answerArm(QA_SYS_GROUNDED, q.question, ctxB),
          ]);
        } catch (e) {
          console.error(`  [user ${idx}] s${si} QA failed: ${String(e?.message || e).slice(0, 120)}`);
          a.context = a.context || ''; a.system_response = 'Unknown';
          b.context = b.context || ''; b.system_response = 'Unknown';
        }
        a.search_duration_ms = 0.0; a.response_duration_ms = 0.0;
        b.search_duration_ms = 0.0; b.response_duration_ms = 0.0;
        return [a, b];
      });
      sessA.questions = answered.map(([a]) => a);
      sessB.questions = answered.map(([, b]) => b);
      if (VERBOSE && si === 0 && sessA.questions[0]) {
        console.log(`  [proof] q="${sessA.questions[0].question.slice(0, 60)}"`);
        console.log(`     baseline -> "${sessA.questions[0].system_response}"`);
        console.log(`     grounded -> "${sessB.questions[0].system_response}"`);
      }
    }
    outA.push(sessA);
    outB.push(sessB);
  }

  console.log(`[user ${idx}] done in ${((Date.now() - t0) / 1000).toFixed(1)}s (recalls ${telemetry.recallCalls}, QA calls ${telemetry.qaCalls})`);
  return {
    baseline: { uuid, user_name: userName, sessions: outA },
    grounded: { uuid, user_name: userName, sessions: outB },
  };
}

// ── Main ────────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.VOYAGE_API_KEY) { console.error('FATAL: VOYAGE_API_KEY not set'); process.exit(1); }
  if (!API_KEY) { console.error('FATAL: neither OPENROUTER_API_KEY nor OPENAI_API_KEY set'); process.exit(1); }
  console.log(`  endpoint: ${USE_OPENROUTER ? 'OpenRouter' : 'OpenAI direct'} (${OR_MODEL})`);
  if (!existsSync(IN)) { console.error(`FATAL: input not found: ${IN}`); process.exit(1); }

  const allUsers = readFileSync(IN, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const USER_START = process.env.USER_START ? Number(process.env.USER_START) : 0;
  const USER_END = process.env.USER_END ? Number(process.env.USER_END)
    : (Number.isFinite(USERS) ? USER_START + USERS : allUsers.length);
  const users = allUsers.slice(USER_START, USER_END);

  const dirA = resolve(OUT_BASE, 'baseline');
  const dirB = resolve(OUT_BASE, 'grounded');
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });
  const fileA = resolve(dirA, 'memzero_eval_results.jsonl');
  const fileB = resolve(dirB, 'memzero_eval_results.jsonl');

  console.log('HaluMem QA-only rerun — prompt A/B on shared live recall');
  console.log(`  input:   ${IN} (${allUsers.length} users; processing ${users.length}, range ${USER_START}..${USER_END})`);
  console.log(`  corpus:  EXISTING bench:halumem:<uuid> rows (no seeding, read-only)`);
  console.log(`  arms:    baseline (v1 QA prompt) vs grounded (#264 rules, timestamped, recency-wins)`);
  console.log(`  model:   ${OR_MODEL}; recall K=${QA_RECALL_K}; conc=${LLM_CONCURRENCY}`);

  const wallStart = Date.now();
  const linesA = [];
  const linesB = [];
  for (let i = 0; i < users.length; i++) {
    try {
      const r = await processUser(users[i], USER_START + i);
      linesA.push(JSON.stringify(r.baseline));
      linesB.push(JSON.stringify(r.grounded));
    } catch (e) {
      console.error(`[user ${USER_START + i}] FATAL (skipped): ${String(e?.message || e).slice(0, 200)}`);
    }
    writeFileSync(fileA, linesA.join('\n') + '\n');
    writeFileSync(fileB, linesB.join('\n') + '\n');
    console.log(`  [progress] ${linesA.length}/${users.length} users done`);
  }

  console.log('\n=== DONE ===');
  console.log(`  baseline -> ${fileA}`);
  console.log(`  grounded -> ${fileB}`);
  console.log(`  wall: ${((Date.now() - wallStart) / 1000).toFixed(1)}s | recalls ${telemetry.recallCalls} | QA calls ${telemetry.qaCalls} | OR cost $${telemetry.llmCostUsd.toFixed(4)}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
