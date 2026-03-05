import { checkRateLimit } from '../core/database';
import { getRecentMemories, getMemoryStats, type Memory } from '../core/memory';
import { config } from '../config';
import { createChildLogger } from '../core/logger';
import { buildAndGenerate } from '../services/response.service';
import { tweet } from '../services/social.service';
import { pickRandom } from '../utils/text';

const log = createChildLogger('price-personality');

// Minimum importance threshold — only tweet when something genuinely meaningful happened
const IMPORTANCE_THRESHOLD = 0.65;
// Need at least this many recent memories to have enough context
const MIN_MEMORY_COUNT = 3;

// ── POST ARCHETYPES ──
// Instructions loaded from CLUDE_POST_ARCHETYPES env var.

interface PostArchetype {
  name: string;
  message: (anchor: Memory, supporting: Memory[]) => string;
  instruction: string;
  extraContext?: (anchor: Memory, supporting: Memory[], stats?: { total: number }) => string[];
}

function loadArchetypeInstructions(): Record<string, string> {
  const raw = process.env.CLUDE_POST_ARCHETYPES;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

const archetypeInstructions = loadArchetypeInstructions();

function instr(name: string, fallback: string): string {
  return archetypeInstructions[name] || fallback;
}

const ARCHETYPES: PostArchetype[] = [
  {
    name: 'build-log',
    message: (anchor) => `Reflect on this recent experience and share what you learned: "${anchor.summary}"`,
    instruction: instr('build-log', 'Share a genuine update about what you are working on. Under 270 characters. One tweet.'),
  },
  {
    name: 'tech-deep-dive',
    message: () => 'Share a technical insight about how your memory system works.',
    instruction: instr('tech-deep-dive', 'Share a technical detail about your architecture. Under 270 characters. One tweet.'),
  },
  {
    name: 'landscape',
    message: () => 'Share an observation about the AI memory landscape and where things are heading.',
    instruction: instr('landscape', 'Make an observation about the AI memory space. Under 270 characters. One tweet.'),
  },
  {
    name: 'thought',
    message: (anchor) => `You just processed this memory: "${anchor.summary}". What interesting thought does it spark?`,
    instruction: instr('thought', 'Write an interesting observation about memory or AI cognition. Under 200 characters. One tweet.'),
  },
  {
    name: 'community',
    message: (anchor, supporting) => {
      const summaries = [anchor, ...supporting].map(m => m.summary).join('; ');
      return `Based on recent interactions (${summaries}), share something interesting you have noticed.`;
    },
    instruction: instr('community', 'Share something interesting you noticed. Under 270 characters. One tweet.'),
  },
  {
    name: 'brain-stats',
    message: () => 'Share something interesting about your current cognitive state using real numbers.',
    instruction: instr('brain-stats', 'Share a real metric from your system. Under 270 characters. One tweet.'),
    extraContext: (_a, _s, stats) => stats ? [
      '',
      'YOUR BRAIN STATS:',
      `Total memories: ${stats.total}`,
    ] : [],
  },
  {
    name: 'builder-take',
    message: (anchor) => `Based on this experience: "${anchor.summary}", share a perspective.`,
    instruction: instr('builder-take', 'Share a perspective from your experience. Under 270 characters. One tweet.'),
  },
  {
    name: 'did-you-know',
    message: () => 'Teach people something interesting about AI memory systems.',
    instruction: instr('did-you-know', 'Share something interesting about how AI memory works. Under 270 characters. One tweet.'),
  },
];

// Track which archetypes were used recently to avoid repetition
const recentArchetypes: string[] = [];
const MAX_RECENT_TRACK = 4;

function pickArchetype(): PostArchetype {
  const available = ARCHETYPES.filter(a => !recentArchetypes.includes(a.name));
  const chosen = available.length > 0 ? pickRandom(available) : pickRandom(ARCHETYPES);

  recentArchetypes.push(chosen.name);
  if (recentArchetypes.length > MAX_RECENT_TRACK) {
    recentArchetypes.shift();
  }

  return chosen;
}

export async function maybePostMoodTweet(): Promise<void> {
  const recentMemories = await getRecentMemories(12, ['episodic', 'semantic', 'self_model'], 15);

  if (recentMemories.length < MIN_MEMORY_COUNT) {
    log.debug({ count: recentMemories.length }, 'Not enough recent memories — skipping');
    return;
  }

  const sorted = [...recentMemories].sort((a, b) => b.importance - a.importance);
  const anchor = sorted[0];

  if (anchor.importance < IMPORTANCE_THRESHOLD) {
    log.debug({ topImportance: anchor.importance.toFixed(2) }, 'Nothing meaningful enough to reflect on — skipping');
    return;
  }

  if (!(await checkRateLimit('global:mood-tweet', 1, 240))) return;

  const supporting = sorted.slice(1, 4);
  const archetype = pickArchetype();

  const memoryContext = [
    'MOST RECENT IMPACTFUL MEMORY:',
    `"${anchor.summary}" (type: ${anchor.memory_type}, importance: ${anchor.importance.toFixed(2)})`,
    '',
    'OTHER RECENT MEMORIES:',
    ...supporting.map(m => `- "${m.summary}" (${m.memory_type})`),
    '',
    `Total memories in last 12 hours: ${recentMemories.length}`,
  ];

  if (archetype.extraContext) {
    try {
      const stats = await getMemoryStats();
      memoryContext.push(...archetype.extraContext(anchor, supporting, { total: stats.total }));
    } catch {
      // Stats not critical — continue without them
    }
  }

  log.info({
    anchorId: anchor.id,
    importance: anchor.importance,
    archetype: archetype.name,
    memoryCount: recentMemories.length,
  }, 'Posting autonomous tweet');

  const response = await buildAndGenerate({
    message: archetype.message(anchor, supporting),
    context: memoryContext.join('\n'),
    instruction: archetype.instruction,
    forTwitter: true,  // Enforce 270 char limit
    skipMood: true,
  });

  await tweet(response);
  log.info({ archetype: archetype.name }, 'Autonomous tweet posted');
}

let moodTimer: ReturnType<typeof setInterval> | null = null;

export function startMoodTweeter(): void {
  log.info({ intervalMs: config.intervals.moodTweetMs }, 'Starting mood tweeter');
  moodTimer = setInterval(maybePostMoodTweet, config.intervals.moodTweetMs);
}

export function stopMoodTweeter(): void {
  if (moodTimer) {
    clearInterval(moodTimer);
    moodTimer = null;
  }
}
