import { TweetV2 } from 'twitter-api-v2';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('safety-gate');

// Features that represent an actual reply going out — used when counting
// real replies for daily cap / pacing. Skip reasons like 'rate-limited',
// 'blocked', 'error' don't burn quota.
const REPLY_FEATURES = [
  'general',
  'question',
  'memory-recall',
  'vesting',
  'ca',
  'web-search',
];

// Static seed list of known auto-reply bots. Add to this as we identify
// new ones that keep getting cludebot tangled. Expandable via the
// KNOWN_BOT_HANDLES env var (comma-separated usernames, no @).
const BOT_HANDLE_SEED = [
  // Bot-vs-bot tangle regulars — populate from X's "explore" + past incidents.
  'askperplexity',
  'grok',
  'aixbt_agent',
  'gptsbot',
  'replyguyai',
  'zoroai',
  'shoaibux1',
];

function loadBotHandles(): Set<string> {
  const extra = (process.env.KNOWN_BOT_HANDLES ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set<string>([...BOT_HANDLE_SEED, ...extra].map(h => h.toLowerCase()));
}

const BOT_HANDLES = loadBotHandles();

// Tunables, all overridable via env.
const KILL_SWITCH = process.env.X_REPLIES_PAUSED === 'true';
const DAILY_CAP = Number(process.env.X_DAILY_REPLY_CAP ?? 50);
const MIN_INTER_REPLY_SEC = Number(process.env.X_MIN_INTER_REPLY_SEC ?? 90);
const MULTI_MENTION_THRESHOLD = Number(process.env.X_MULTI_MENTION_THRESHOLD ?? 3);

export type GateVerdict =
  | { allow: true }
  | { allow: false; reason: string; markAs: string };

/**
 * Hard safety gate that runs BEFORE any reply is crafted. Designed to
 * prevent the specific ban vectors that hit cludebot historically:
 *
 * 1. Kill switch — pause replies entirely via env var, no deploy needed
 * 2. Known auto-reply bot author — another bot mentioning us
 * 3. Multi-mention tangle — tweet tagging 3+ accounts is usually pile-on bait
 * 4. Daily hard cap — ceiling regardless of hourly limits
 * 5. Minimum inter-reply pacing — human-looking floor between any two replies
 *
 * Existing per-user and per-conversation limits in dispatcher.ts still
 * apply; this gate is additive and stricter.
 */
export async function safetyGate(
  tweet: TweetV2,
  authorHandle: string | undefined,
): Promise<GateVerdict> {
  if (KILL_SWITCH) {
    return { allow: false, reason: 'X_REPLIES_PAUSED=true', markAs: 'kill-switch' };
  }

  // Author is a known bot — never engage, regardless of content.
  if (authorHandle && BOT_HANDLES.has(authorHandle.toLowerCase())) {
    return {
      allow: false,
      reason: `author @${authorHandle} is on known-bot list`,
      markAs: 'author-is-bot',
    };
  }

  // Scan @-mentions in the tweet text.
  const mentions = (tweet.text ?? '').match(/@\w+/g) ?? [];
  const distinct = new Set(mentions.map(m => m.slice(1).toLowerCase()));

  // If another known bot is tagged alongside us, it's almost always a
  // tangle bait. Hard skip, regardless of count.
  const tangledBots = [...distinct].filter(h => BOT_HANDLES.has(h));
  if (tangledBots.length > 0) {
    return {
      allow: false,
      reason: `thread mentions other bots: ${tangledBots.map(b => '@' + b).join(', ')}`,
      markAs: 'bot-tangle-blocked',
    };
  }

  // Multi-mention tweets tagging 3+ accounts are usually spam/pile-on.
  if (distinct.size >= MULTI_MENTION_THRESHOLD) {
    return {
      allow: false,
      reason: `multi-mention tweet (${distinct.size} handles tagged)`,
      markAs: 'multi-mention-skip',
    };
  }

  // Persistent checks against processed_mentions.
  const db = getDb();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // Daily cap
  const { count: dailyCount, error: countErr } = await db
    .from('processed_mentions')
    .select('tweet_id', { count: 'exact', head: true })
    .in('feature', REPLY_FEATURES)
    .gte('processed_at', since24h);

  if (countErr) {
    log.warn({ err: countErr }, 'Daily cap query failed, allowing reply');
  } else if ((dailyCount ?? 0) >= DAILY_CAP) {
    return {
      allow: false,
      reason: `daily cap reached (${dailyCount}/${DAILY_CAP})`,
      markAs: 'daily-cap',
    };
  }

  // Minimum inter-reply pacing
  const { data: lastReply } = await db
    .from('processed_mentions')
    .select('processed_at')
    .in('feature', REPLY_FEATURES)
    .order('processed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastReply?.processed_at) {
    const secondsSince = (Date.now() - new Date(lastReply.processed_at).getTime()) / 1000;
    if (secondsSince < MIN_INTER_REPLY_SEC) {
      return {
        allow: false,
        reason: `pacing (${secondsSince.toFixed(0)}s since last reply < ${MIN_INTER_REPLY_SEC}s floor)`,
        markAs: 'paced',
      };
    }
  }

  return { allow: true };
}
