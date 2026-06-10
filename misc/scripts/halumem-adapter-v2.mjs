// HaluMem benchmark adapter for Clude — v2 (Mem0-style extraction + reconciliation).
//
// v1 (misc/scripts/halumem-adapter.mjs) extracted only ~28% of gold facts with a thin
// "extract atomic facts" prompt and APPENDED everything, so updated facts coexisted with
// their stale predecessors (→ 36% hallucination on Dynamic-Update questions, 11.77% overall).
//
// v2 borrows Mem0's two mechanisms:
//   CHANGE 1 — Completeness extraction: a completeness-maximizing extractor (adapted from
//     Mem0's ADDITIVE_EXTRACTION_PROMPT) over BOTH user+assistant turns, self-contained +
//     temporally grounded, that explicitly fights "first-topic dominance" (the main miss).
//   CHANGE 2 — ADD/UPDATE/DELETE reconciliation: instead of blind insert, each session's new
//     facts are reconciled against the user's existing store (vector-retrieve neighbors via
//     match_memories, then ONE 'decide' LLM call adapted from Mem0's DEFAULT_UPDATE_MEMORY_PROMPT).
//     UPDATE overwrites the existing row IN PLACE (re-embed), DELETE removes the stale row,
//     ADD inserts new. This is the core fix: updated facts SUPERSEDE stale ones, not coexist.
//   CHANGE 3 — QA: recall top-20, render timestamped context, answer preferring the MOST RECENT
//     memory on contradiction.
//
// Everything else (Clude integration, owner-scoped recall over the prod `memories` table,
// direct insert + batched Voyage embedding, per-user reset, artifact format, dataset parsing)
// is reused verbatim from v1.
//
// Sessions are processed in CHRONOLOGICAL order (by start_time) so reconciliation sees the
// correct "existing memory" state at each point in time.
//
// Output: misc/halumem-out-v2/memzero-medium/memzero_eval_results.jsonl — one user-object per line.
//
// Usage (smoke test on user 0):
//   USERS=1 node --import tsx misc/scripts/halumem-adapter-v2.mjs
//
// Env (all optional, sensible defaults):
//   USERS=20  USER_START=0  USER_END  USER_CONCURRENCY=1
//   IN=/tmp/halumem-medium.jsonl
//   OUT_DIR=misc/halumem-out-v2/memzero-medium
//   OPENROUTER_API_KEY=...           # falls back to the embedded benchmark key
//   OR_MODEL=openai/gpt-5-mini       # extraction + decide + QA model
//   STORE_CONCURRENCY=24  LLM_CONCURRENCY=6  VERBOSE=1
//
// SECURITY: every store + recall + reconcile is scoped to a `bench:halumem:*` wallet via
// withOwnerWallet() / filter_owner. The ~211K real production rows under other wallets are
// NEVER read, updated, or deleted. Idempotent: deletes this wallet's rows before re-ingesting.

import dotenv from 'dotenv';
dotenv.config({ path: '/Users/sebastien/Projects/cluude-bot/.env', override: true });

import { readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Make the @clude workspace packages resolvable in this worktree ──────────────
// (verbatim from v1) symlink @clude/brain + @clude/shared to packages/ so the CJS dist
// can require("@clude/shared/...") as bare specifiers.
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

// ── Embedding wiring (verbatim from v1) ─────────────────────────────────────────
// Must be set BEFORE importing the brain/shared modules so config.embedding picks them up.
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
const OUT_DIR = process.env.OUT_DIR || resolve(REPO_ROOT, 'misc/halumem-out-v2/memzero-medium');
const OUT_FILE = resolve(OUT_DIR, 'memzero_eval_results.jsonl');
const USERS = process.env.USERS ? Number(process.env.USERS) : Infinity;
const OR_KEY = process.env.OPENROUTER_API_KEY ||
  '';
const OR_MODEL = process.env.OR_MODEL || 'openai/gpt-5-mini';
const STORE_CONCURRENCY = Number(process.env.STORE_CONCURRENCY || 24);
const LLM_CONCURRENCY = Number(process.env.LLM_CONCURRENCY || 6);
const UPDATE_TOP_K = 10;   // HaluMem update task: top-10 recalled memories (CHANGE 3)
const QA_RECALL_K = 20;    // memories fed to the answerer per question (CHANGE 3: was 12)
// RECONCILE off by default: the single-entity corpus (all facts about one user) makes the
// decide-LLM over-merge distinct facts (collapsed 700 -> 19). Default to ADD-all (exact-dedup);
// updates handled at QA time via the "prioritize most recent" rule. Set RECONCILE=on to re-enable.
const RECONCILE = process.env.RECONCILE === 'on';
const RECONCILE_THRESHOLD = Number(process.env.RECONCILE_THRESHOLD || 0.82); // only near-DUP memories are update candidates
const RECONCILE_NEIGHBORS = 5;    // top-N existing memories per new fact
const VERBOSE = process.env.VERBOSE === '1' || USERS === 1;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Generic retry with exponential backoff (verbatim from v1).
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

// Bounded-concurrency async map (verbatim from v1).
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
  extractionCalls: 0, decideCalls: 0, qaCalls: 0,
  llmPromptTokens: 0, llmCompletionTokens: 0, llmCostUsd: 0,
  embedCalls: 0, embedTokens: 0, embeddedFacts: 0,
  recallCalls: 0, matchCalls: 0,
  factsExtracted: 0,
  evAdd: 0, evUpdate: 0, evDelete: 0, evNone: 0,
  rowsInserted: 0, rowsUpdated: 0, rowsDeleted: 0,
};

// ── OpenRouter chat (extraction + decide + QA) ─────────────────────────────────────
// `json` flips on response_format json_object (used by extraction + decide).
async function orChat(messages, { maxTokens = 1200, kind = 'qa', json = false } = {}) {
  const data = await withRetry(async () => {
    const body = { model: OR_MODEL, messages, max_tokens: maxTokens };
    if (json) body.response_format = { type: 'json_object' };
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OR_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const b = await res.text();
      throw new Error(`OpenRouter ${res.status}: ${b.slice(0, 160)}`);
    }
    const d = await res.json();
    if (!d.choices?.[0]) throw new Error(`OpenRouter no choices: ${JSON.stringify(d).slice(0, 160)}`);
    return d;
  }, { label: `openrouter:${kind}` });

  if (kind === 'extract') telemetry.extractionCalls++;
  else if (kind === 'decide') telemetry.decideCalls++;
  else telemetry.qaCalls++;
  const u = data.usage || {};
  telemetry.llmPromptTokens += u.prompt_tokens || 0;
  telemetry.llmCompletionTokens += u.completion_tokens || 0;
  telemetry.llmCostUsd += u.cost || 0;
  return (data.choices[0].message?.content || '').trim();
}

// Extract the first JSON object from an LLM response (tolerates fences / prose).
function parseJsonObject(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const obj = t.match(/\{[\s\S]*\}/);
  if (obj) t = obj[0];
  try { return JSON.parse(t); } catch { return null; }
}

// ── Dialogue formatting (BOTH user + assistant turns) ──────────────────────────────
function formatDialogue(dialogue) {
  return (dialogue || []).map((t) => `${t.role}: ${t.content}`).join('\n');
}

// Parse the observation/recording date from the user's persona_info, e.g.
// "[Recorded on Oct 04, 2025] Name: ...". Falls back to the session start_time.
function parseObservationDate(personaInfo, fallback) {
  const m = (personaInfo || '').match(/\[Recorded on ([^\]]+)\]/i);
  return (m && m[1].trim()) || fallback || 'unknown';
}

// ── CHANGE 1: completeness extraction (Mem0 ADDITIVE_EXTRACTION_PROMPT, adapted) ───
const EXTRACT_SYS = `You are a Memory Extractor. Extract EVERY piece of memorable information from the conversation as self-contained, contextually rich factual statements. Extract from BOTH user and assistant messages.

Rules:
- Self-contained: replace all pronouns with the specific person's name (the user's name is: {USER_NAME}). Each memory must stand alone.
- Temporally grounded: convert relative dates to absolute using the Observation Date {OBS_DATE}. Keep absolute dates/durations exact.
- Numerically precise: keep exact numbers, titles, names ("assistant manager" not "manager").
- Meaning-preserving: capture the actual claim (e.g. "used to love hiking" = no longer loves it).
- Decompose: one memory per distinct fact/topic.
- COMPLETENESS IS CRITICAL. Scan EVERY message — beginning, middle, AND end. Do not let a dominant topic cause you to miss secondary info ("first-topic dominance" is the main failure mode). For a session with 10+ turns you should usually extract 5-15 memories; if you have fewer than 3, re-read — you are almost certainly missing information.
- No fabrication: every memory must trace to something explicitly said.

Output ONLY JSON: {"memory": [{"text": "<fact>", "attributed_to": "user|assistant"}]}`;

async function extractFacts(userName, obsDate, dialogue) {
  const sys = EXTRACT_SYS.replaceAll('{USER_NAME}', userName).replaceAll('{OBS_DATE}', obsDate);
  const text = await orChat([
    { role: 'system', content: sys },
    { role: 'user', content: `${formatDialogue(dialogue)}\n\nObservation Date: ${obsDate}` },
  ], { maxTokens: 3000, kind: 'extract', json: true });
  const parsed = parseJsonObject(text);
  const arr = parsed && Array.isArray(parsed.memory) ? parsed.memory : [];
  const facts = arr
    .map((m) => (m && typeof m.text === 'string' ? m.text.trim() : (typeof m === 'string' ? m.trim() : '')))
    .filter(Boolean);
  // de-dupe exact repeats within the session
  return [...new Set(facts)];
}

// ── CHANGE 2: ADD/UPDATE/DELETE reconciliation (Mem0 DEFAULT_UPDATE_MEMORY_PROMPT) ─
const DECIDE_SYS = `You are a smart memory manager. Compare the newly retrieved facts against the existing memory and decide, for EACH item in the final memory, one event: ADD (new info), UPDATE (an existing memory should be revised — keep its id, put the merged/updated text), DELETE (an existing memory is now contradicted/outdated — keep its id), or NONE (already present/irrelevant).
Rules:
- If a new fact updates or supersedes an existing memory (e.g. a changed plan, status, preference, or value), UPDATE that existing memory's id with the new text — do NOT add a duplicate.
- If a new fact directly contradicts an existing memory, DELETE the stale one (and ADD the new value).
- Keep ids stable for UPDATE/DELETE. Use new ids (the next integers) for ADD.
Return ONLY JSON: {"memory":[{"id":"<int>","text":"<content>","event":"ADD|UPDATE|DELETE|NONE"}]}`;

// Retrieve the union of existing stored memories that are near ANY new fact (vector search,
// owner-scoped via filter_owner). Returns a Map realId(int) -> text.
async function retrieveReconcileCandidates(ownerWallet, factEmbeddings) {
  const candidates = new Map(); // realId -> text (deduped by id)
  const seenIds = new Set();
  const idBatches = [];
  for (const emb of factEmbeddings) {
    if (!emb) continue;
    const rows = await withRetry(async () => {
      const { data, error } = await db.rpc('match_memories', {
        query_embedding: JSON.stringify(emb),
        match_threshold: RECONCILE_THRESHOLD,
        match_count: RECONCILE_NEIGHBORS,
        filter_owner: ownerWallet,
      });
      if (error) throw new Error(`match_memories: ${error.message}`);
      return data || [];
    }, { label: 'db:match_memories' });
    telemetry.matchCalls++;
    for (const r of rows) {
      if (r && r.id != null && !seenIds.has(r.id)) { seenIds.add(r.id); idBatches.push(r.id); }
    }
  }
  if (!idBatches.length) return candidates;
  // Fetch content for the union of neighbor ids (owner-scoped guard).
  const CHUNK = 200;
  for (let i = 0; i < idBatches.length; i += CHUNK) {
    const ids = idBatches.slice(i, i + CHUNK);
    const rows = await withRetry(async () => {
      const { data, error } = await db.from('memories')
        .select('id,content').in('id', ids).eq('owner_wallet', ownerWallet);
      if (error) throw new Error(`fetch candidates: ${error.message}`);
      return data || [];
    }, { label: 'db:fetch_candidates' });
    for (const row of rows) candidates.set(row.id, (row.content || '').trim());
  }
  return candidates;
}

// Build a memory row for direct insert (same shape as v1's storeFacts row).
function buildRow(ownerWallet, text, embedding, createdIso) {
  return {
    hash_id: generateHashId(),
    memory_type: 'semantic',
    content: text,
    summary: text.slice(0, 500),
    tags: ['halumem'],
    concepts: [],
    emotional_valence: 0,
    importance: 0.6,
    access_count: 0,
    source: 'halumem-benchmark',
    metadata: {},
    decay_factor: 1.0,
    embedding: embedding ? JSON.stringify(embedding) : null,
    owner_wallet: ownerWallet,
    created_at: createdIso,
    last_accessed: createdIso,
  };
}

// Reconcile one session's extracted facts against the user's existing store, then apply
// ADD/UPDATE/DELETE/NONE events in place. Returns the list of memory texts that were
// ADDed or UPDATEd this session (for the artifact's extracted_memories).
async function reconcileAndApply(ownerWallet, facts, sessionIso) {
  if (!facts.length) return [];
  telemetry.factsExtracted += facts.length;

  // 1) embed all new facts (Voyage, batch).
  const factEmbeddings = await withRetry(() => generateEmbeddings(facts), { label: 'voyage:embed-facts' });
  telemetry.embedCalls++;
  telemetry.embeddedFacts += factEmbeddings.filter(Boolean).length;
  telemetry.embedTokens += facts.reduce((a, f) => a + Math.ceil(f.length / 4), 0);

  // 2) retrieve the union of existing memories near any new fact.
  const candidates = await retrieveReconcileCandidates(ownerWallet, factEmbeddings);

  // RECONCILE off (default): ADD all new facts, exact-dedup vs existing near-duplicates. Avoids the
  // single-entity over-merge; superseding is handled at QA time ("prioritize most recent memory").
  if (!RECONCILE) {
    return await addFactsWithDedup(ownerWallet, facts, factEmbeddings, sessionIso, candidates);
  }

  // Edge case: no existing candidates (e.g. first session) → ADD all facts directly.
  if (candidates.size === 0) {
    const rows = facts.map((f, i) => buildRow(ownerWallet, f, factEmbeddings[i], sessionIso));
    await insertRows(rows);
    telemetry.evAdd += rows.length;
    return facts.slice();
  }

  // 3) integer-index map so the LLM never sees/invents real UUIDs/PKs.
  //    existing memories get indices 0..N-1 (in insertion order of the candidates Map).
  const realIds = [...candidates.keys()];
  const idxToReal = new Map();   // "0" -> realId
  const existingForPrompt = [];  // [{id:"0", text}]
  realIds.forEach((rid, i) => {
    idxToReal.set(String(i), rid);
    existingForPrompt.push({ id: String(i), text: candidates.get(rid) });
  });

  // 4) ONE 'decide' LLM call (Mem0 DEFAULT_UPDATE_MEMORY_PROMPT, adapted).
  const userMsg =
    'Existing memory: ```' + JSON.stringify(existingForPrompt) + '```\n' +
    'Newly retrieved facts: ```' + JSON.stringify(facts) + '```';
  let decision;
  try {
    const text = await orChat([
      { role: 'system', content: DECIDE_SYS },
      { role: 'user', content: userMsg },
    ], { maxTokens: 3000, kind: 'decide', json: true });
    const parsed = parseJsonObject(text);
    decision = parsed && Array.isArray(parsed.memory) ? parsed.memory : null;
  } catch (e) {
    decision = null;
  }

  // Safety fallback: if the decide call fails/returns garbage, ADD all facts (degrade to v1
  // append for this session rather than lose information). Exact-text dedupe guard applies.
  if (!decision) {
    return await addFactsWithDedup(ownerWallet, facts, factEmbeddings, sessionIso, candidates);
  }

  // Pre-embed any ADD/UPDATE target texts in one batch (re-embed the new content).
  const applyTexts = decision
    .filter((d) => d && (d.event === 'ADD' || d.event === 'UPDATE') && typeof d.text === 'string' && d.text.trim())
    .map((d) => d.text.trim());
  const applyEmbMap = new Map();
  if (applyTexts.length) {
    const uniqTexts = [...new Set(applyTexts)];
    const embs = await withRetry(() => generateEmbeddings(uniqTexts), { label: 'voyage:embed-apply' });
    telemetry.embedCalls++;
    telemetry.embeddedFacts += embs.filter(Boolean).length;
    uniqTexts.forEach((t, i) => applyEmbMap.set(t, embs[i]));
  }

  // 5) apply each event.
  const activeTexts = [];   // ADDed or UPDATEd this session → artifact extracted_memories
  const existingTextSet = new Set([...candidates.values()].map((t) => t.trim()));
  const addRows = [];

  for (const d of decision) {
    if (!d || typeof d.event !== 'string') { telemetry.evNone++; continue; }
    const ev = d.event.toUpperCase();
    const text = typeof d.text === 'string' ? d.text.trim() : '';

    if (ev === 'ADD') {
      if (!text) { telemetry.evNone++; continue; }
      // exact-text dedupe guard: skip if identical text already exists in the store.
      if (existingTextSet.has(text)) { telemetry.evNone++; continue; }
      existingTextSet.add(text);
      addRows.push(buildRow(ownerWallet, text, applyEmbMap.get(text), sessionIso));
      activeTexts.push(text);
      telemetry.evAdd++;
    } else if (ev === 'UPDATE') {
      const realId = idxToReal.get(String(d.id));
      if (realId == null || !text) { telemetry.evNone++; continue; }
      await withRetry(async () => {
        const { error } = await db.from('memories').update({
          content: text,
          summary: text.slice(0, 500),
          embedding: applyEmbMap.get(text) ? JSON.stringify(applyEmbMap.get(text)) : null,
          last_accessed: sessionIso,  // table has no updated_at; last_accessed is the in-place "touched" marker
        }).eq('id', realId).eq('owner_wallet', ownerWallet);
        if (error) throw new Error(`update: ${error.message}`);
      }, { label: 'db:update' });
      telemetry.rowsUpdated++;
      telemetry.evUpdate++;
      activeTexts.push(text);
      existingTextSet.add(text);
    } else if (ev === 'DELETE') {
      const realId = idxToReal.get(String(d.id));
      if (realId == null) { telemetry.evNone++; continue; }
      await withRetry(async () => {
        const { error } = await db.from('memories').delete()
          .eq('id', realId).eq('owner_wallet', ownerWallet);
        if (error) throw new Error(`delete: ${error.message}`);
      }, { label: 'db:delete' });
      telemetry.rowsDeleted++;
      telemetry.evDelete++;
    } else {
      telemetry.evNone++;
    }
  }

  if (addRows.length) await insertRows(addRows);
  return activeTexts;
}

// Insert rows in chunks (one chunk = one REST round-trip) with retry per chunk.
async function insertRows(rows) {
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await withRetry(async () => {
      const { error } = await db.from('memories').insert(chunk);
      if (error) throw new Error(`insert: ${error.message}`);
    }, { label: 'db:insert' });
  }
  telemetry.rowsInserted += rows.length;
}

// Fallback ADD-all path (used when the decide call fails) with exact-text dedupe vs existing.
async function addFactsWithDedup(ownerWallet, facts, factEmbeddings, sessionIso, candidates) {
  const existingTextSet = new Set([...candidates.values()].map((t) => t.trim()));
  const rows = [];
  const active = [];
  facts.forEach((f, i) => {
    const t = f.trim();
    if (existingTextSet.has(t)) return;
    existingTextSet.add(t);
    rows.push(buildRow(ownerWallet, t, factEmbeddings[i], sessionIso));
    active.push(t);
  });
  if (rows.length) await insertRows(rows);
  telemetry.evAdd += rows.length;
  return active;
}

// ── Clude recall (REAL pipeline), owner-scoped (verbatim from v1) ──────────────────
async function recall(uuid, query, limit) {
  const ownerWallet = `bench:halumem:${uuid}`;
  telemetry.recallCalls++;
  return withRetry(() => withOwnerWallet(ownerWallet, () =>
    recallMemories({ query, limit, skipExpansion: true, trackAccess: false })
  ), { label: 'clude:recall' });
}

const memText = (m) => (m?.content || m?.summary || '').trim();
// Pull a sortable timestamp off a recalled memory (last_accessed reflects in-place UPDATEs).
const memTs = (m) => m?.last_accessed || m?.created_at || null;

// ── CHANGE 3: QA — recall top-20, timestamped context, prefer MOST RECENT ─────────
const QA_SYS = `You are a helpful assistant. Answer the question using ONLY the provided memories. If the memories contain contradictory information, prioritize the MOST RECENT memory (later timestamp). If the answer is not present, respond exactly: Unknown. Answer in under 6 words. No explanation.`;

function renderContext(memories) {
  return memories.map((m) => {
    const ts = memTs(m);
    const body = memText(m);
    if (!body) return null;
    return ts ? `${ts}: ${body}` : body;
  }).filter(Boolean);
}

async function answerQuestion(question, contextLines) {
  const context = contextLines.join('\n');
  const text = await orChat([
    { role: 'system', content: QA_SYS },
    { role: 'user', content: `Memories:\n${context || '(none)'}\n\nQuestion: ${question}\nAnswer:` },
  ], { maxTokens: 1500, kind: 'qa' }); // gpt-5-mini is a reasoning model: needs headroom over reasoning_tokens
  return text.replace(/^answer:\s*/i, '').trim();
}

// ── Per-user processing ───────────────────────────────────────────────────────────
function parseUserName(personaInfo) {
  const m = (personaInfo || '').match(/Name:\s*(.*?); Gender:/);
  return (m && m[1].trim()) || 'the user';
}

// HaluMem timestamps are "Sep 04, 2025, 18:42:18" → ISO. Falls back to now on parse failure.
function toIso(humanTs) {
  if (!humanTs) return new Date().toISOString();
  const d = new Date(humanTs);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

async function processUser(user, idx) {
  const uuid = user.uuid;
  const ownerWallet = `bench:halumem:${uuid}`;
  const userName = parseUserName(user.persona_info);
  const obsDate = parseObservationDate(user.persona_info);
  const t0 = Date.now();

  // Idempotency: wipe any prior rows for THIS bench wallet. Owner-scoped — only ever
  // touches bench:halumem:<uuid>.
  await withRetry(async () => {
    const { error } = await db.from('memories').delete().eq('owner_wallet', ownerWallet);
    if (error) throw new Error(`cleanup: ${error.message}`);
  }, { label: 'db:cleanup' });

  // Process sessions in CHRONOLOGICAL order by start_time.
  const sessions = [...(user.sessions || [])]
    .map((s, origIdx) => ({ s, origIdx, ts: new Date(s.start_time).getTime() }))
    .sort((a, b) => (a.ts || 0) - (b.ts || 0))
    .map((x) => x.s);

  console.log(`\n[user ${idx}] ${userName} (${uuid}) — ${sessions.length} sessions | obsDate=${obsDate}`);

  const outSessions = [];
  let printedRecallExample = false;
  let firstStoredSample = null;

  for (let si = 0; si < sessions.length; si++) {
    const session = sessions[si];
    const sessionIso = toIso(session.start_time);

    // ── CHANGE 1 + 2: extract (completeness) then reconcile (ADD/UPDATE/DELETE) ──
    let extracted = [];
    let activeTexts = [];
    try {
      extracted = await extractFacts(userName, obsDate, session.dialogue);
    } catch (e) {
      console.error(`  [user ${idx}] session ${si} extraction failed: ${String(e?.message || e).slice(0, 120)}`);
      extracted = [];
    }
    try {
      if (extracted.length) activeTexts = await reconcileAndApply(ownerWallet, extracted, sessionIso);
      if (!firstStoredSample && extracted.length) firstStoredSample = extracted.slice(0, 3);
    } catch (e) {
      console.error(`  [user ${idx}] session ${si} reconcile failed: ${String(e?.message || e).slice(0, 120)}`);
    }

    // Build the augmented session (gold passed through verbatim + added fields).
    // extracted_memories = the texts ADDed or UPDATEd this session (the "active" memories).
    const augSession = { ...session };
    augSession.extracted_memories = activeTexts;
    augSession.add_dialogue_duration_ms = 0.0;

    // ── Update task: top-10 recall for is_update memory_points ──
    const memoryPoints = (session.memory_points || []).map((mp) => ({ ...mp }));
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

    // ── QA: recall top-20 context + terse answer for each question ──
    if (Array.isArray(session.questions) && session.questions.length > 0) {
      const answered = await pMap(session.questions, LLM_CONCURRENCY, async (q) => {
        const out = { ...q };
        try {
          const mems = await recall(uuid, q.question, QA_RECALL_K);
          const ctxLines = renderContext(mems);
          out.context = ctxLines.join('\n');
          out.system_response = await answerQuestion(q.question, ctxLines);
          if (VERBOSE && !printedRecallExample && ctxLines.length) {
            printedRecallExample = true;
            console.log(`  [recall proof — QA] q="${q.question.slice(0, 70)}" -> "${out.system_response}"`);
            ctxLines.slice(0, 3).forEach((m, i) => console.log(`     ctx#${i + 1} ${m.slice(0, 90)}`));
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
      console.log(`  ...session ${si + 1}/${sessions.length} | ADD ${telemetry.evAdd} UPD ${telemetry.evUpdate} DEL ${telemetry.evDelete} | recalls ${telemetry.recallCalls} | LLM ${telemetry.extractionCalls + telemetry.decideCalls + telemetry.qaCalls}`);
    }
  }

  // Final stored count for this user (owner-scoped head count).
  let storedCount = null;
  try {
    const { count } = await db.from('memories').select('id', { count: 'exact', head: true }).eq('owner_wallet', ownerWallet);
    storedCount = count;
  } catch { /* best-effort */ }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[user ${idx}] done in ${elapsed}s | stored rows=${storedCount} | events ADD ${telemetry.evAdd} UPDATE ${telemetry.evUpdate} DELETE ${telemetry.evDelete} NONE ${telemetry.evNone}`);
  if (firstStoredSample) {
    console.log(`  sample extracted facts: ${firstStoredSample.map((f) => `"${f.slice(0, 60)}"`).join(' | ')}`);
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

  console.log('HaluMem adapter v2 — Mem0-style extraction + ADD/UPDATE/DELETE reconciliation');
  console.log(`  input:      ${IN} (${allUsers.length} users; processing ${users.length})`);
  console.log(`  output:     ${OUT_FILE}`);
  console.log(`  extract:    completeness prompt over user+assistant turns (CHANGE 1)`);
  console.log(`  reconcile:  match_memories (thr ${RECONCILE_THRESHOLD}, top ${RECONCILE_NEIGHBORS}) + 1 decide call → ADD/UPDATE/DELETE (CHANGE 2)`);
  console.log(`  recall:     vector + BM25 + metadata (EXP_BM25_SEARCH=on), top-${QA_RECALL_K}, skipExpansion (CHANGE 3)`);
  console.log(`  embed:      voyage-4-large (1024d) -> memories.embedding`);
  console.log(`  LLM:        ${OR_MODEL} via OpenRouter (extract + decide + QA)`);
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
    writeFileSync(OUT_FILE, outLines.join('\n') + '\n');
    console.log(`  [progress] ${outLines.length}/${users.length} users done`);
  }

  const wallSec = ((Date.now() - wallStart) / 1000).toFixed(1);
  console.log('\n=== DONE ===');
  console.log(`  wrote ${outLines.length} user-object(s) -> ${OUT_FILE}`);
  console.log(`  wall clock:        ${wallSec}s`);
  console.log(`  facts extracted:   ${telemetry.factsExtracted}`);
  console.log(`  events:            ADD ${telemetry.evAdd} | UPDATE ${telemetry.evUpdate} | DELETE ${telemetry.evDelete} | NONE ${telemetry.evNone}`);
  console.log(`  rows inserted:     ${telemetry.rowsInserted} | updated ${telemetry.rowsUpdated} | deleted ${telemetry.rowsDeleted}`);
  console.log(`  extraction calls:  ${telemetry.extractionCalls}`);
  console.log(`  decide calls:      ${telemetry.decideCalls}`);
  console.log(`  QA calls:          ${telemetry.qaCalls}`);
  console.log(`  recall calls:      ${telemetry.recallCalls}`);
  console.log(`  match_memories:    ${telemetry.matchCalls}`);
  console.log(`  Voyage embed calls:${telemetry.embedCalls} (~${telemetry.embedTokens} est tokens, ${telemetry.embeddedFacts} embedded)`);
  console.log(`  LLM tokens:        prompt ${telemetry.llmPromptTokens} + completion ${telemetry.llmCompletionTokens}`);
  console.log(`  LLM cost (OpenRouter reported): $${telemetry.llmCostUsd.toFixed(4)}`);
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
