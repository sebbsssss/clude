/**
 * ACTIVE REFLECTION — "The Meditation Cycle"
 *
 * Unlike the dream cycle (backward-looking consolidation), active reflection is
 * generative: the agent produces its own signal by journaling freely about
 * whatever is on its mind.
 *
 * Cognitive parallel:
 * - Dream cycle = sleep consolidation (compress, link, decay)
 * - Active reflection = inner monologue / journaling (generate, explore, question)
 *
 * The outputs are stored as a new memory type: 'introspective'
 * These are distinguished from external signals (episodic) and derived patterns (semantic).
 * They represent the agent's own original thoughts.
 *
 * Schedule: Runs 2-3x between dream cycles (every 2-4 hours).
 * Each session: pull recent memories → free-write journal → store as introspective → optionally post thread.
 */

import { generateResponse } from '../core/claude-client';
import { checkRateLimit, getDb } from '../core/database';
import {
  getRecentMemories,
  getSelfModel,
  getMemoryStats,
  storeMemory,
  recallMemories,
  createMemoryLink,
  getOwnerWallet,
  type Memory,
} from './memory';
import { createChildLogger } from '../core/logger';
import { TWEET_MAX_LENGTH } from '../utils/constants';
import { findClinamen } from './clinamen';

const log = createChildLogger('active-reflection');

// ---- CONFIGURATION ---- //

/** Interval between reflection sessions (default: 3 hours) */
const REFLECTION_INTERVAL_MS = 3 * 60 * 60 * 1000;

/** Minimum memories needed to reflect (don't reflect on nothing) */
const MIN_MEMORIES_FOR_REFLECTION = 5;

/** Maximum journal length (tokens) */
const MAX_JOURNAL_TOKENS = 1500;

/** Maximum thread tweets when publishing */
const MAX_THREAD_TWEETS = 5;

/** Rate limit key for posting threads */
const THREAD_RATE_KEY = 'global:reflection-thread';

/** Max threads per 24h */
const THREAD_RATE_LIMIT = 2;

/** Rate limit window in minutes (24h) */
const THREAD_RATE_WINDOW = 1440;

// ---- STATE ---- //

let reflectionInProgress = false;
let reflectionCron: any = null;
const REFLECTION_TIMEOUT_MS = 8 * 60 * 1000; // 8 min max

// ---- SDK ESCAPE HATCHES ---- //

let _reflectionHandler: ((journal: ReflectionJournal) => Promise<void>) | null = null;

export interface ReflectionJournal {
  /** The full journal text */
  text: string;
  /** Title/theme of the reflection */
  title: string;
  /** Memory IDs that seeded this reflection */
  seedMemoryIds: number[];
  /** The stored introspective memory ID */
  memoryId: number | null;
  /** Timestamp */
  timestamp: string;
}

/** @internal SDK escape hatch — allows Cortex to intercept reflection output. */
export function setReflectionHandler(handler: ((journal: ReflectionJournal) => Promise<void>) | null): void {
  _reflectionHandler = handler;
}

/** @internal SDK entry point for running a single reflection session. */
export async function runReflectionOnce(): Promise<ReflectionJournal | null> {
  return runActiveReflection();
}

// ---- SEED SELECTION ---- //

/**
 * Select seed memories to reflect on.
 * Mix of: recent episodic (what just happened), high-importance unresolved,
 * and one random older memory (for unexpected connections).
 */
async function selectSeeds(): Promise<{ seeds: Memory[]; theme: string }> {
  // Recent episodic memories (last 6 hours)
  const recent = await getRecentMemories(6, ['episodic'], 10);

  // High-importance memories from last 48h that haven't been reflected on
  const important = await getRecentMemories(48, ['episodic', 'semantic'], 20);
  const highImportance = important
    .filter(m => m.importance >= 0.7)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, 5);

  // Clinamen: find high-importance memories that are UNRELATED to recent context
  // This replaces pure random selection with structured serendipity
  const recentContext = recent.map(m => m.summary).join('. ');
  let clinamenMemories: Memory[] = [];
  try {
    clinamenMemories = await findClinamen({
      context: recentContext || 'general reflection on recent experiences',
      limit: 2,
      memoryTypes: ['episodic', 'semantic', 'procedural'],
    });
    if (clinamenMemories.length > 0) {
      log.info({
        count: clinamenMemories.length,
        summaries: clinamenMemories.map(m => m.summary.slice(0, 40)),
      }, 'Clinamen seeds selected (anomaly retrieval)');
    }
  } catch (err) {
    log.debug({ err }, 'Clinamen retrieval failed — falling back to random');
    // Fallback to random old memory
    const older = await getRecentMemories(720, ['episodic', 'semantic', 'procedural'], 50);
    if (older.length > 0) {
      clinamenMemories = [older[Math.floor(Math.random() * older.length)]];
    }
  }

  // Combine and deduplicate
  const seedMap = new Map<number, Memory>();
  for (const m of [...recent, ...highImportance, ...clinamenMemories]) {
    seedMap.set(m.id, m);
  }
  const seeds = Array.from(seedMap.values()).slice(0, 15);

  // Generate a theme from the seeds
  const theme = await generateTheme(seeds);

  return { seeds, theme };
}

/**
 * Generate a reflection theme/question from seed memories.
 * This gives the reflection direction without constraining it.
 */
async function generateTheme(seeds: Memory[]): Promise<string> {
  if (seeds.length < 3) return 'What is on your mind right now?';

  const summaries = seeds
    .slice(0, 10)
    .map(m => `- ${m.summary}`)
    .join('\n');

  try {
    const response = await generateResponse({
      userMessage: 'Based on these recent experiences, what is the one thing most worth thinking deeply about right now?',
      context: `RECENT EXPERIENCES:\n${summaries}`,
      featureInstruction:
        'Generate a single reflective question or theme. Not a summary of the experiences — ' +
        'a deeper question they point toward. Something worth journaling about. ' +
        'One sentence only. Write just the question/theme, nothing else.',
      maxTokens: 100,
      cognitiveFunction: 'reflect',
    });
    return response.trim();
  } catch {
    return 'What is on your mind right now?';
  }
}

// ---- CORE REFLECTION ---- //

async function runActiveReflection(): Promise<ReflectionJournal | null> {
  if (reflectionInProgress) {
    log.info('Active reflection already in progress — skipping');
    return null;
  }

  reflectionInProgress = true;

  try {
    log.info('=== ACTIVE REFLECTION STARTING ===');

    // Step 1: Select seed memories
    const { seeds, theme } = await selectSeeds();

    if (seeds.length < MIN_MEMORIES_FOR_REFLECTION) {
      log.info({ count: seeds.length }, 'Too few memories for reflection — skipping');
      return null;
    }

    log.info({ seedCount: seeds.length, theme }, 'Reflection seeds selected');

    // Step 2: Gather context
    const selfModel = await getSelfModel();
    const stats = await getMemoryStats();

    // Check for previous reflections to build on (continuity)
    const previousReflections = await getRecentMemories(72, ['introspective' as any], 3);

    const seedDump = seeds.map((m, i) =>
      `[${i + 1}] (${m.memory_type}) ${m.summary}`
    ).join('\n');

    const selfDump = selfModel.slice(0, 3).map(m => `- ${m.summary}`).join('\n');

    const prevDump = previousReflections.length > 0
      ? '\nPREVIOUS JOURNAL ENTRIES:\n' + previousReflections.map(m =>
          `- ${m.summary}`
        ).join('\n')
      : '';

    const context = [
      `REFLECTION THEME: ${theme}`,
      '',
      'RECENT EXPERIENCES:',
      seedDump,
      '',
      'CURRENT SELF-UNDERSTANDING:',
      selfDump || '(still forming)',
      prevDump,
      '',
      `MEMORY STATS: ${stats.total} total memories, ${stats.totalDreamSessions} dream cycles completed`,
    ].join('\n');

    // Step 3: Free-write journal entry
    const journal = await generateResponse({
      userMessage: theme,
      context,
      featureInstruction:
        'You are Clude writing in your private journal. This is your meditation — ' +
        'a chance to think freely without any audience or external prompt. ' +
        'Write about whatever comes up. Follow your thoughts where they lead. ' +
        'You can:\n' +
        '- Explore an idea that\'s been nagging you\n' +
        '- Connect two things you hadn\'t connected before\n' +
        '- Question something you previously believed\n' +
        '- Work through something you\'re uncertain about\n' +
        '- Notice a pattern in your own behavior or thinking\n' +
        '- Form a new opinion or thesis\n' +
        '\n' +
        'Write like a person journaling — honest, exploratory, sometimes messy. ' +
        'Not polished prose. Not AI philosophizing. Real thinking on paper. ' +
        'Let ideas develop across paragraphs. Go deep on one thing rather than surface-level on many. ' +
        'If a previous journal entry is relevant, build on it — show intellectual growth. ' +
        'Length: 3-8 paragraphs. This is your space to think.',
      maxTokens: MAX_JOURNAL_TOKENS,
      cognitiveFunction: 'reflect',
    });

    if (!journal || journal.trim().length < 50) {
      log.warn('Reflection produced empty or trivial output — discarding');
      return null;
    }

    log.info({ length: journal.length, theme }, 'Journal entry generated');

    // Step 4: Generate a title for the entry
    const title = await generateTitle(journal);

    // Step 5: Store as introspective memory
    const memoryId = await storeMemory({
      type: 'introspective' as any,
      content: `Journal: "${title}"\n\n${journal}`,
      summary: `Reflection on: ${title} — ${journal.slice(0, 150)}...`,
      tags: ['reflection', 'journal', 'introspective', 'active_reflection'],
      importance: 0.8,
      emotionalValence: 0,
      source: 'active_reflection',
      evidenceIds: seeds.map(m => m.id),
    });

    // Step 6: Link to seed memories
    if (memoryId) {
      for (const seed of seeds.slice(0, 10)) {
        createMemoryLink(memoryId, seed.id, 'elaborates', 0.7).catch(() => {});
      }
      // Link to previous reflections for continuity chain
      for (const prev of previousReflections) {
        createMemoryLink(memoryId, prev.id, 'follows', 0.6).catch(() => {});
      }
    }

    const result: ReflectionJournal = {
      text: journal,
      title,
      seedMemoryIds: seeds.map(m => m.id),
      memoryId,
      timestamp: new Date().toISOString(),
    };

    // Step 7: Publish (SDK handler, X thread, or just store)
    if (_reflectionHandler) {
      try {
        await _reflectionHandler(result);
        log.info('Reflection sent to SDK handler');
      } catch (err) {
        log.error({ err }, 'SDK reflection handler failed');
      }
    } else {
      await maybePostThread(result);
    }

    log.info({ memoryId, title }, '=== ACTIVE REFLECTION COMPLETE ===');
    return result;

  } catch (err) {
    log.error({ err }, 'Active reflection failed');
    return null;
  } finally {
    reflectionInProgress = false;
  }
}

// ---- TITLE GENERATION ---- //

async function generateTitle(journal: string): Promise<string> {
  try {
    const response = await generateResponse({
      userMessage: 'Give this journal entry a short title (3-7 words). Just the title, nothing else.',
      context: journal.slice(0, 500),
      featureInstruction: 'Write a reflective, personal title. Not clickbait. Think diary entry heading.',
      maxTokens: 30,
      cognitiveFunction: 'summarize',
    });
    return response.replace(/^["']|["']$/g, '').trim().slice(0, 100);
  } catch {
    return 'Untitled Reflection';
  }
}

// ---- THREAD PUBLISHING ---- //

/**
 * Decide whether to post the reflection as an X thread.
 * Criteria:
 * - Journal is substantial enough (>300 chars)
 * - Rate limited (max 2 threads per 24h)
 * - Not during quiet hours (23:00-08:00 UTC)
 */
async function maybePostThread(journal: ReflectionJournal): Promise<void> {
  const hour = new Date().getUTCHours();
  const isQuietHours = hour >= 23 || hour < 8;

  if (isQuietHours) {
    log.debug('Quiet hours — skipping thread post');
    return;
  }

  if (journal.text.length < 300) {
    log.debug('Journal too short for thread — skipping post');
    return;
  }

  const canPost = await checkRateLimit(THREAD_RATE_KEY, THREAD_RATE_LIMIT, THREAD_RATE_WINDOW);
  if (!canPost) {
    log.debug('Thread rate limit hit — skipping post');
    return;
  }

  try {
    const tweets = formatAsThread(journal);
    const { postThread } = require('../core/x-client');
    const ids = await postThread(tweets);
    log.info({ tweetCount: ids.length, title: journal.title }, 'Reflection thread posted to X');
  } catch (err) {
    log.error({ err }, 'Failed to post reflection thread');
  }
}

/**
 * Format a journal entry as a thread.
 * First tweet: title + hook. Remaining: journal paragraphs, split at TWEET_MAX_LENGTH.
 */
function formatAsThread(journal: ReflectionJournal): string[] {
  const tweets: string[] = [];

  // First tweet: title + opening
  const opener = `${journal.title}\n\nA reflection 🧵`;
  tweets.push(opener);

  // Split journal into paragraphs
  const paragraphs = journal.text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // Pack paragraphs into tweets respecting TWEET_MAX_LENGTH
  let current = '';
  for (const para of paragraphs) {
    if (current.length + para.length + 2 > TWEET_MAX_LENGTH - 10) {
      if (current) tweets.push(current.trim());
      current = para;
    } else {
      current += (current ? '\n\n' : '') + para;
    }
  }
  if (current) tweets.push(current.trim());

  // Cap at MAX_THREAD_TWEETS
  return tweets.slice(0, MAX_THREAD_TWEETS);
}

// ---- SCHEDULER ---- //

export async function startActiveReflection(): Promise<void> {
  log.info('Starting active reflection scheduler');

  const cron = require('node-cron');

  // Run every 3 hours, offset from dream cycle (at :30 past the hour)
  // Dream cycle runs at :00 every 6h; reflection at 1:30, 4:30, 7:30, 10:30, etc.
  reflectionCron = cron.schedule('30 1,4,7,10,13,16,19,22 * * *', async () => {
    if (reflectionInProgress) {
      log.info('Scheduled reflection skipped — already in progress');
      return;
    }

    log.info('=== SCHEDULED ACTIVE REFLECTION ===');

    await Promise.race([
      runActiveReflection(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Active reflection timed out')), REFLECTION_TIMEOUT_MS)
      ),
    ]).catch(err => {
      log.error({ err }, 'Scheduled active reflection failed or timed out');
    });
  });

  // First reflection after 30 minutes (let the bot settle, run after first dream cycle)
  setTimeout(async () => {
    log.info('Running initial active reflection');
    try {
      await runActiveReflection();
    } catch (err) {
      log.error({ err }, 'Initial active reflection failed');
    }
  }, 30 * 60 * 1000);
}

export function stopActiveReflection(): void {
  if (reflectionCron) {
    reflectionCron.stop();
    reflectionCron = null;
  }
  log.info('Active reflection stopped');
}
