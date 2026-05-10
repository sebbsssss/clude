/**
 * Seed Maya's account with ~1000 memories for the Colosseum demo.
 *
 * Phases (run independently or via `all`):
 *   generate  — call Claude per thread, cache to JSON
 *   insert    — bulk-insert into Supabase memories table
 *   embed     — Voyage batch-embed summaries → update rows
 *   verify    — sanity report
 *   all       — generate → insert → embed → verify
 *
 * Usage:
 *   pnpm dlx tsx scripts/demo/seed-maya.ts <phase>
 *   (or `node --experimental-strip-types --no-warnings scripts/demo/seed-maya.ts <phase>`)
 *
 * Env required:  ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, VOYAGE_API_KEY
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { autoCategorizeTags } from '../../packages/shared/src/wiki-packs.ts';
import { THREADS, PERSONA_BLURB, type Thread } from './seed-maya-threads.ts';

config();

// ─── CONFIG ─────────────────────────────────────────────────────────
const WALLET = process.env.MAYA_WALLET || 'FRokptxESMhuTWbWgL8JF3Ti1EKzsrRLrEPSqu9uhza7';
const DATA_DIR = 'scripts/demo/seed-maya-data';
const SOURCE = 'demo';            // skip-listed → won't auto-commit to chain
const HIGHLIGHT_SOURCE = 'demo-highlight'; // tagged for later manual chain commit
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001';
const BATCH_INSERT_SIZE = 100;
const EMBED_BATCH_SIZE = 64;
const VOYAGE_MODEL = 'voyage-3-large';
const INSTALLED_PACKS = ['workspace', 'compliance', 'sales']; // all three for the demo

const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });

// ─── TYPES ──────────────────────────────────────────────────────────
type MemoryType = 'episodic' | 'semantic' | 'procedural' | 'self_model' | 'introspective';
interface Draft {
  type: MemoryType;
  content: string;
  summary: string;
  event_date: string; // YYYY-MM-DD
  importance: number;
}

// ─── PHASE: GENERATE ────────────────────────────────────────────────
function buildPrompt(t: Thread): string {
  const mixLines = (Object.entries(t.mix) as [string, number][])
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `  - ${n} ${k}`)
    .join('\n');
  return `You are generating realistic typed memory entries for a memory system. The owner is:

${PERSONA_BLURB}

NARRATIVE THREAD
Title: ${t.title}
Date range: ${t.startDate} to ${t.endDate}
Premise: ${t.premise}

Generate exactly ${t.count} memories with this mix:
${mixLines}

REQUIREMENTS
- Each memory must feel real: specific names, numbers, dates, dollar amounts.
- Spread event_date evenly across the range (cluster on weekdays; rare weekend entries are fine).
- importance: 0.30–0.95. Semantic/decision/procedural memories tend higher (0.55–0.95). Casual episodic lower (0.30–0.65). Introspective/self_model in between.
- Where natural, work in these keywords (don't force every one — just at least a few): ${t.keywordHints.join(', ')}.
- content: 1–3 sentences, 40–220 chars. Concrete, dry, Maya's voice.
- summary: ≤ 80 chars. A tight one-liner.
- Avoid filler. No "they said hi" or "checked Slack". Decisions, exchanges, observations, lessons.

OUTPUT
Return ONLY a JSON array. No prose, no markdown fences. Each element:
{ "type": "...", "content": "...", "summary": "...", "event_date": "YYYY-MM-DD", "importance": 0.0 }`;
}

function parseDrafts(raw: string): Draft[] {
  let text = raw.trim();
  // Strip markdown fences if Claude wrapped the JSON
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  }
  // Find first '[' and last ']' to handle stray prose
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < 0) throw new Error(`No JSON array found in response: ${text.slice(0, 200)}`);
  const json = text.slice(start, end + 1);
  return JSON.parse(json);
}

async function generateThread(t: Thread): Promise<Draft[]> {
  const cachePath = join(DATA_DIR, `${t.id}.json`);
  if (existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
    console.log(`  cache hit: ${t.id} (${cached.length})`);
    return cached;
  }
  console.log(`  generating: ${t.id} (target ${t.count})`);
  const resp = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8192,
    messages: [{ role: 'user', content: buildPrompt(t) }],
  });
  const text = resp.content.filter(c => c.type === 'text').map(c => (c as any).text).join('');
  const drafts = parseDrafts(text);
  writeFileSync(cachePath, JSON.stringify(drafts, null, 2));
  console.log(`    → ${drafts.length} memories cached`);
  return drafts;
}

async function generate() {
  console.log(`Generating ${THREADS.length} threads → ${DATA_DIR}/`);
  let done = 0;
  for (const t of THREADS) {
    try {
      const drafts = await generateThread(t);
      done += drafts.length;
    } catch (err: any) {
      console.error(`  FAIL ${t.id}: ${err.message}`);
    }
  }
  console.log(`\nGenerated ${done} memories total across ${THREADS.length} threads.`);
}

// ─── PHASE: INSERT ──────────────────────────────────────────────────
function generateHashId(): string {
  return `clude-${randomBytes(4).toString('hex')}`;
}

const TYPE_DECAY: Record<MemoryType, number> = {
  episodic: 1.0,
  semantic: 1.0,
  procedural: 1.0,
  self_model: 1.0,
  introspective: 1.0,
};

function draftToRow(d: Draft, threadId: string, idx: number, isHighlight: boolean) {
  // Validate / clamp
  const validTypes: MemoryType[] = ['episodic', 'semantic', 'procedural', 'self_model', 'introspective'];
  if (!validTypes.includes(d.type)) d.type = 'episodic';
  d.importance = Math.max(0.1, Math.min(0.99, Number(d.importance) || 0.5));
  const eventISO = `${d.event_date}T${String(8 + Math.floor(Math.random() * 10)).padStart(2, '0')}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}:00.000Z`;
  // Auto-categorize tags by pack rules
  const tags = autoCategorizeTags({
    content: d.content,
    summary: d.summary,
    installedPackIds: INSTALLED_PACKS,
  });
  return {
    hash_id: generateHashId(),
    memory_type: d.type,
    content: d.content,
    summary: d.summary,
    tags,
    concepts: [],
    importance: d.importance,
    decay_factor: TYPE_DECAY[d.type],
    emotional_valence: 0,
    access_count: 0,
    source: isHighlight ? HIGHLIGHT_SOURCE : SOURCE,
    source_id: `seed-maya:${threadId}:${idx}:${randomBytes(2).toString('hex')}`,
    owner_wallet: WALLET,
    event_date: eventISO,
    event_date_precision: 'day',
    metadata: { seed: 'maya-demo', thread: threadId },
    created_at: eventISO, // align created_at with event_date for natural recency
    last_accessed: eventISO,
  };
}

async function insert() {
  // Pre-flight: count existing memories for this wallet
  const { count: existing } = await db
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('owner_wallet', WALLET);
  if ((existing || 0) > 0) {
    console.error(`ABORT: wallet ${WALLET} already has ${existing} memories. Either purge first or run on a clean wallet.`);
    process.exit(1);
  }

  const allRows: any[] = [];
  for (const t of THREADS) {
    const cachePath = join(DATA_DIR, `${t.id}.json`);
    if (!existsSync(cachePath)) {
      console.warn(`  missing cache for ${t.id} — skipping`);
      continue;
    }
    const drafts: Draft[] = JSON.parse(readFileSync(cachePath, 'utf8'));
    // Mark first `highlightCount` memories of each thread as highlights
    drafts.forEach((d, i) => allRows.push(draftToRow(d, t.id, i, i < t.highlightCount)));
  }
  console.log(`Total rows to insert: ${allRows.length}`);

  let inserted = 0;
  for (let i = 0; i < allRows.length; i += BATCH_INSERT_SIZE) {
    const batch = allRows.slice(i, i + BATCH_INSERT_SIZE);
    const { error } = await db.from('memories').insert(batch);
    if (error) {
      console.error(`  batch ${i / BATCH_INSERT_SIZE} failed:`, error.message);
      continue;
    }
    inserted += batch.length;
    process.stdout.write(`  inserted ${inserted}/${allRows.length}\r`);
  }
  console.log(`\nInserted ${inserted} memories.`);
}

// ─── PHASE: EMBED ───────────────────────────────────────────────────
async function voyageEmbed(texts: string[]): Promise<(number[] | null)[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) {
    console.error('VOYAGE_API_KEY not set — embeddings will be skipped');
    return texts.map(() => null);
  }
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      input: texts.map(t => t.slice(0, 8000)),
      model: VOYAGE_MODEL,
    }),
  });
  if (!res.ok) {
    console.error(`Voyage error ${res.status}: ${await res.text()}`);
    return texts.map(() => null);
  }
  const data = await res.json() as { data: Array<{ embedding: number[]; index: number }> };
  const out: (number[] | null)[] = texts.map(() => null);
  for (const item of data.data) out[item.index] = item.embedding;
  return out;
}

async function embed() {
  if (!process.env.VOYAGE_API_KEY) {
    console.error('VOYAGE_API_KEY not set — aborting embed phase');
    process.exit(1);
  }
  // Page through all of Maya's memories that don't yet have an embedding
  const PAGE = 500;
  let total = 0, done = 0;
  while (true) {
    const { data: rows, error } = await db
      .from('memories')
      .select('id, summary, content')
      .eq('owner_wallet', WALLET)
      .is('embedding', null)
      .limit(PAGE);
    if (error) { console.error('select err', error); return; }
    if (!rows || rows.length === 0) break;
    if (total === 0) console.log(`Embedding via Voyage (${VOYAGE_MODEL})...`);
    total += rows.length;

    for (let i = 0; i < rows.length; i += EMBED_BATCH_SIZE) {
      const batch = rows.slice(i, i + EMBED_BATCH_SIZE);
      const texts = batch.map(r => `${r.summary}\n${r.content}`);
      const embs = await voyageEmbed(texts);
      for (let j = 0; j < batch.length; j++) {
        if (!embs[j]) continue;
        const { error: e2 } = await db
          .from('memories')
          .update({ embedding: JSON.stringify(embs[j]) })
          .eq('id', batch[j].id);
        if (e2) { console.error('update err', e2.message); continue; }
        done++;
      }
      process.stdout.write(`  embedded ${done}/${total}\r`);
    }
    if (rows.length < PAGE) break;
  }
  console.log(`\nEmbedded ${done} memories.`);
}

// ─── PHASE: VERIFY ──────────────────────────────────────────────────
async function verify() {
  const { count: total } = await db
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('owner_wallet', WALLET);
  const { count: highlights } = await db
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('owner_wallet', WALLET)
    .eq('source', HIGHLIGHT_SOURCE);
  const { count: embedded } = await db
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('owner_wallet', WALLET)
    .not('embedding', 'is', null);
  // Type breakdown
  const types: Record<string, number> = {};
  let from = 0;
  while (true) {
    const { data } = await db
      .from('memories')
      .select('memory_type, tags')
      .eq('owner_wallet', WALLET)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const m of data) types[m.memory_type] = (types[m.memory_type] || 0) + 1;
    if (data.length < 1000) break;
    from += 1000;
  }
  // Tag distribution (top 12)
  const tagCounts: Record<string, number> = {};
  from = 0;
  while (true) {
    const { data } = await db
      .from('memories')
      .select('tags')
      .eq('owner_wallet', WALLET)
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    for (const m of data) for (const tg of (m.tags || [])) tagCounts[tg] = (tagCounts[tg] || 0) + 1;
    if (data.length < 1000) break;
    from += 1000;
  }
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 12);

  console.log('Wallet:', WALLET);
  console.log('Total memories:', total);
  console.log('Highlights (chain-commit candidates):', highlights);
  console.log('Embedded:', embedded);
  console.log('By type:', types);
  console.log('Top tags:', Object.fromEntries(topTags));
}

// ─── MAIN ───────────────────────────────────────────────────────────
const phase = process.argv[2];
const run = async () => {
  switch (phase) {
    case 'generate': await generate(); break;
    case 'insert':   await insert();   break;
    case 'embed':    await embed();    break;
    case 'verify':   await verify();   break;
    case 'all':
      await generate();
      await insert();
      await embed();
      await verify();
      break;
    default:
      console.error('Usage: seed-maya.ts <generate|insert|embed|verify|all>');
      process.exit(1);
  }
};
run().catch(e => { console.error(e); process.exit(1); });
