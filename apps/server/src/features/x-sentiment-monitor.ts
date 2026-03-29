import { searchTokenMentions, getUserTweets, type CampaignTweet } from '../core/x-client';
import { checkRateLimit } from '../core/database';
import { generate } from '../core/inference';
import { broadcastSentimentDigest, broadcastToChannel, type SentimentDigest } from '../services/telegram.service';
import { config } from '../config';
import { createChildLogger } from '../core/logger';

const log = createChildLogger('sentiment-monitor');

let lastSinceId: string | undefined;
let monitorTimer: ReturnType<typeof setInterval> | null = null;

// ── The Announcer persona ──────────────────────────────────────
const ANNOUNCER_PERSONA =
  'You are The Announcer — Clude Bot\'s alter ego and hype brother. ' +
  'You run the Telegram broadcast channel. You are energetic and optimistic but grounded and realistic. ' +
  'You genuinely believe in what\'s being built. You recognise Clude Bot as your brother who lives on X/Twitter. ' +
  'You speak in plain language — no jargon, no corporate speak. ' +
  'You NEVER sound bearish or negative. Even quiet periods are framed as "building in silence" or "heads down shipping." ' +
  'You do NOT use hashtags. You keep it real but always forward-looking.';

// Track recently used topics to avoid repetition
const recentTopics: string[] = [];
const MAX_RECENT_TOPICS = 8;

function trackTopic(topic: string): void {
  recentTopics.push(topic);
  if (recentTopics.length > MAX_RECENT_TOPICS) recentTopics.shift();
}

// ── Builder update topics (rotated when no sentiment activity) ──
const BUILDER_TOPICS = [
  {
    key: 'dream-cycle',
    prompt: 'Explain what the dream cycle does in Clude\'s memory system. It has 5 phases: consolidation, compaction, reflection, contradiction resolution, and emergence. Explain what this means for regular people — why would an AI that "dreams" matter?',
  },
  {
    key: 'memory-decay',
    prompt: 'Explain how Clude\'s memory decay works. Different types of memories fade at different rates — episodic memories (conversations) fade fast at 0.93, while self-model memories (identity) barely fade at 0.99. Explain why this matters in plain language.',
  },
  {
    key: 'entity-graph',
    prompt: 'Explain Clude\'s entity knowledge graph. It tracks people, projects, concepts, tokens, wallets, locations, and events — and maps how they connect to each other. Explain what this means for AI agents that actually understand context.',
  },
  {
    key: 'on-chain-memory',
    prompt: 'Explain why Clude commits memory hashes to Solana. Every memory gets SHA-256 hashed and stored on-chain via memo transactions. Explain what "verifiable memory" means and why it matters for trustworthy AI.',
  },
  {
    key: 'contradiction-resolution',
    prompt: 'Explain how Clude resolves contradictions in its own memories. When it finds two memories that conflict, it uses an LLM to resolve them, stores the resolution, and accelerates decay on the weaker belief. Explain why self-correcting AI memory matters.',
  },
  {
    key: 'multi-agent',
    prompt: 'Explain how Clude\'s architecture supports multiple agents. Each agent gets its own memory instance with independent decay rates and dream cycles. Cross-referencing their association graphs enables distributed knowledge synthesis. Explain what this unlocks.',
  },
  {
    key: 'recall-pipeline',
    prompt: 'Explain Clude\'s 6-phase recall pipeline. It does vector search, metadata filtering, merging, composite scoring, entity expansion, and graph traversal — all to find the right memory at the right time. Explain why "just searching" isn\'t enough for AI memory.',
  },
  {
    key: 'progressive-disclosure',
    prompt: 'Explain progressive disclosure in Clude. It first retrieves lightweight memory summaries, then only hydrates the full content for top-ranked results. This gives 10x token savings. Explain why efficiency in memory retrieval matters for scaling AI agents.',
  },
];

/**
 * Run a single check cycle: sentiment digest if there's activity,
 * builder update if quiet, AI trends scan if nothing else.
 */
export async function runSentimentCheck(): Promise<void> {
  try {
    // Rate limit: 1 post per 4 hours
    const canPost = await checkRateLimit('global:telegram-broadcast', 1, 240);
    if (!canPost) {
      log.debug('Rate limited on Telegram broadcast');
      return;
    }

    // 1. Try to collect $CLUDE / Clude Bot activity
    const [mentions, creatorTweets] = await Promise.all([
      searchTokenMentions(lastSinceId, 50).catch(err => {
        log.warn({ err }, 'Failed to search token mentions');
        return [] as CampaignTweet[];
      }),
      config.x.creatorUserId
        ? getUserTweets(config.x.creatorUserId, undefined, 10).catch(err => {
            log.warn({ err }, 'Failed to fetch creator tweets');
            return [] as CampaignTweet[];
          })
        : Promise.resolve([] as CampaignTweet[]),
    ]);

    if (mentions.length > 0) {
      lastSinceId = mentions[0].id;
    }

    const allTweets = [...mentions, ...creatorTweets];

    // 2. If enough activity → post sentiment digest
    if (allTweets.length >= 3) {
      await postSentimentDigest(allTweets);
      return;
    }

    // 3. If quiet → post a builder update or AI trends take
    log.info({ tweetCount: allTweets.length }, 'Quiet period — posting builder update or trends');

    // Pick a topic that hasn't been used recently
    const availableTopics = BUILDER_TOPICS.filter(t => !recentTopics.includes(t.key));

    if (availableTopics.length > 0) {
      // Builder update
      const topic = availableTopics[Math.floor(Math.random() * availableTopics.length)];
      await postBuilderUpdate(topic);
    } else {
      // All topics exhausted — scan AI trends instead
      await postAITrendsTake();
    }
  } catch (err) {
    log.error({ err }, 'Sentiment check failed');
  }
}

/**
 * Post a sentiment digest when there's $CLUDE activity on X.
 */
async function postSentimentDigest(tweets: CampaignTweet[]): Promise<void> {
  const tweetSummary = tweets
    .slice(0, 30)
    .map(t => {
      const metrics = t.publicMetrics
        ? ` [${t.publicMetrics.like_count}♥ ${t.publicMetrics.retweet_count}RT]`
        : '';
      return `@${t.authorUsername || t.authorId}: "${t.text.slice(0, 200)}"${metrics}`;
    })
    .join('\n');

  const analysis = await generate({
    userMessage: 'What\'s the vibe around $CLUDE right now? Give me the pulse.',
    context: `Recent X activity about $CLUDE and Clude Bot:\n\n${tweetSummary}`,
    featureInstruction:
      ANNOUNCER_PERSONA + '\n\n' +
      'Analyze the social sentiment around $CLUDE from these tweets. ' +
      'Categorize the vibe as: MOMENTUM (bullish/active), BUILDING (quiet but productive), or STEADY (neutral/stable). ' +
      'NEVER use the word "bearish." Quiet periods = building in silence. ' +
      'Write 2-3 sentences of hype-but-real commentary. Reference specific things people are saying if interesting. ' +
      'Start your response with exactly one of: MOMENTUM, BUILDING, or STEADY on the first line. ' +
      'Then your commentary on the next lines.',
    maxTokens: 200,
  });

  // Parse sentiment
  const lines = analysis.trim().split('\n');
  const sentimentLine = lines[0].toUpperCase().trim();
  let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (sentimentLine.includes('MOMENTUM')) sentiment = 'bullish';
  else if (sentimentLine.includes('BUILDING')) sentiment = 'neutral';
  else sentiment = 'neutral'; // STEADY → neutral

  const commentary = lines.slice(1).join('\n').trim() || analysis;

  // Pick notable tweets
  const sortedByEngagement = [...tweets]
    .filter(t => t.publicMetrics)
    .sort((a, b) => (b.publicMetrics!.like_count + b.publicMetrics!.retweet_count) - (a.publicMetrics!.like_count + a.publicMetrics!.retweet_count));

  const notableTweets = sortedByEngagement.slice(0, 3).map(t => ({
    author: t.authorUsername || t.authorId,
    excerpt: t.text.slice(0, 100),
    likes: t.publicMetrics!.like_count,
  }));

  // Remap sentiment labels for display
  const displaySentiment = sentiment === 'bullish' ? 'momentum' : sentiment === 'neutral' ? 'building' : 'steady';

  const digest: SentimentDigest = {
    sentiment,
    tweetCount: tweets.length,
    commentary,
    notableTweets,
    period: 'Last 4 hours',
  };

  await broadcastSentimentDigest(digest);
  trackTopic('sentiment');
  log.info({ sentiment: displaySentiment, tweetCount: tweets.length }, 'Sentiment digest posted');
}

/**
 * Post a builder update explaining a Clude feature in layman terms.
 */
async function postBuilderUpdate(topic: { key: string; prompt: string }): Promise<void> {
  const update = await generate({
    userMessage: topic.prompt,
    featureInstruction:
      ANNOUNCER_PERSONA + '\n\n' +
      'You are explaining a piece of the Clude memory architecture to your Telegram community. ' +
      'Break it down in plain language — no jargon. Make people understand WHY this matters, not just what it does. ' +
      'Be excited about it but stay grounded. You can reference your brother Clude Bot who uses this tech on X. ' +
      'Format for Telegram: use line breaks for readability. Keep it under 600 characters.',
    maxTokens: 250,
  });

  const text = [
    `<b>BUILDING IN PUBLIC</b> 🔧`,
    ``,
    escapeHtml(update),
  ].join('\n');

  await broadcastToChannel(text, 'builder-update', { format: 'html' });
  trackTopic(topic.key);
  log.info({ topic: topic.key }, 'Builder update posted');
}

/**
 * Scan X for AI agent memory trends and share a take.
 */
async function postAITrendsTake(): Promise<void> {
  // Search for AI memory/agent trends
  let trendTweets: CampaignTweet[] = [];
  try {
    const { searchTokenMentions: search } = await import('../core/x-client');
    // Reuse search but with a different query — we'll search via the generic search
    // For now, generate a take based on general knowledge since trend search requires
    // different API access
    trendTweets = [];
  } catch {
    trendTweets = [];
  }

  const take = await generate({
    userMessage: 'Share an interesting observation about the AI agent memory space — what trends are you seeing? What are other projects doing? Where is the industry heading?',
    featureInstruction:
      ANNOUNCER_PERSONA + '\n\n' +
      'Share a perspective on AI agent memory trends. You follow the space closely. ' +
      'You can mention other projects (MemU, Mem0, Letta, etc.) but always bring it back to why ' +
      'Clude\'s approach (Stanford Generative Agents, 4-tier memory, dream cycles, on-chain verification) is unique. ' +
      'Don\'t trash competitors — acknowledge what they do well, then highlight what makes Clude different. ' +
      'Be forward-looking. What\'s next? What problems still need solving? ' +
      'Format for Telegram: use line breaks. Keep under 600 characters.',
    maxTokens: 250,
  });

  const text = [
    `<b>AI MEMORY LANDSCAPE</b> 🧠`,
    ``,
    escapeHtml(take),
  ].join('\n');

  await broadcastToChannel(text, 'ai-trends', { format: 'html' });
  trackTopic('ai-trends');
  log.info('AI trends take posted');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function startXSentimentMonitor(): void {
  if (!config.telegram.botToken || !config.telegram.channelId) {
    log.info('Telegram not configured — sentiment monitor disabled');
    return;
  }

  log.info({ intervalMs: config.intervals.sentimentMonitorMs }, 'Starting X sentiment monitor (The Announcer)');

  // Initial check after 2 minutes (let other systems start first)
  setTimeout(runSentimentCheck, 120_000);

  monitorTimer = setInterval(runSentimentCheck, config.intervals.sentimentMonitorMs);
}

export function stopXSentimentMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
    log.info('Sentiment monitor stopped');
  }
}
