import { TwitterApi, TweetV2, UserV2 } from 'twitter-api-v2';
import { config } from '../config';
import { createChildLogger } from './logger';

const log = createChildLogger('x-client');

const client = new TwitterApi({
  appKey: config.x.apiKey,
  appSecret: config.x.apiSecret,
  accessToken: config.x.accessToken,
  accessSecret: config.x.accessSecret,
});

const rwClient = client.readWrite;

// X Premium allows up to 4000 characters (was 280 for standard accounts)
const MAX_TWEET_LENGTH = 4000;

/**
 * Strip em-dashes and replace with comma or period.
 */
function stripEmDashes(text: string): string {
  return text
    .replace(/ — /g, ', ')   // " — " → ", "
    .replace(/—/g, ', ');     // "—" (no spaces) → ", "
}

/**
 * Smart truncate text to fit within limit, respecting word boundaries.
 * Adds ellipsis if truncated.
 */
function smartTruncate(text: string, maxLength: number = MAX_TWEET_LENGTH): string {
  if (text.length <= maxLength) return text;
  
  // Reserve space for ellipsis
  const truncateAt = maxLength - 3;
  
  // Find last space before truncation point
  let lastSpace = text.lastIndexOf(' ', truncateAt);
  
  // If no space found or it's too early, just cut (for very long words)
  if (lastSpace < truncateAt * 0.5) {
    lastSpace = truncateAt;
  }
  
  return text.slice(0, lastSpace).trimEnd() + '...';
}

export async function postReply(tweetId: string, text: string): Promise<string> {
  const truncated = smartTruncate(stripEmDashes(text));
  log.info({ tweetId, originalLength: text.length, length: truncated.length }, 'Posting reply');
  const result = await rwClient.v2.reply(truncated, tweetId);
  return result.data.id;
}

export async function postTweet(text: string): Promise<string> {
  const truncated = smartTruncate(stripEmDashes(text));
  log.info({ originalLength: text.length, length: truncated.length }, 'Posting tweet');
  const result = await rwClient.v2.tweet(truncated);
  return result.data.id;
}

export async function postThread(texts: string[]): Promise<string[]> {
  log.info({ count: texts.length }, 'Posting thread');
  const tweetIds: string[] = [];

  let previousId: string | undefined;
  for (const text of texts) {
    const truncated = smartTruncate(stripEmDashes(text));
    if (!previousId) {
      const result = await rwClient.v2.tweet(truncated);
      previousId = result.data.id;
    } else {
      const result = await rwClient.v2.reply(truncated, previousId);
      previousId = result.data.id;
    }
    tweetIds.push(previousId);
  }

  return tweetIds;
}

/**
 * Split a long text into multiple tweets for threading.
 * Useful for responses that exceed 280 chars.
 */
export function splitForThread(text: string, maxLength: number = MAX_TWEET_LENGTH): string[] {
  if (text.length <= maxLength) return [text];
  
  const tweets: string[] = [];
  let remaining = text;
  
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      tweets.push(remaining);
      break;
    }
    
    // Reserve space for thread indicator (e.g., "1/3")
    const effectiveMax = maxLength - 5;
    
    // Find a good break point (sentence end, then word boundary)
    let breakPoint = -1;
    
    // Try to break at sentence end
    const sentenceEnders = ['. ', '! ', '? ', '.\n', '!\n', '?\n'];
    for (const ender of sentenceEnders) {
      const idx = remaining.lastIndexOf(ender, effectiveMax);
      if (idx > effectiveMax * 0.4 && idx > breakPoint) {
        breakPoint = idx + ender.length - 1;
      }
    }
    
    // Fall back to word boundary
    if (breakPoint === -1) {
      breakPoint = remaining.lastIndexOf(' ', effectiveMax);
      if (breakPoint < effectiveMax * 0.4) {
        breakPoint = effectiveMax;
      }
    }
    
    tweets.push(remaining.slice(0, breakPoint).trimEnd());
    remaining = remaining.slice(breakPoint).trimStart();
  }
  
  return tweets;
}

// Username cache: maps X user IDs to @usernames
const _usernameCache = new Map<string, string>();

export function getCachedUsername(userId: string): string | undefined {
  return _usernameCache.get(userId);
}

export function getUsernameOrId(userId: string): string {
  return _usernameCache.get(userId) || userId;
}

export async function getMentions(sinceId?: string): Promise<TweetV2[]> {
  log.debug({ sinceId }, 'Fetching mentions');
  const params: Record<string, string> = {
    'tweet.fields': 'created_at,author_id,conversation_id,text',
    'expansions': 'author_id',
    'user.fields': 'username',
    max_results: '20',
  };
  if (sinceId) params.since_id = sinceId;

  const result = await rwClient.v2.userMentionTimeline(config.x.botUserId, params);

  // Cache author usernames
  if (result.includes?.users) {
    for (const user of result.includes.users) {
      _usernameCache.set(user.id, user.username);
    }
  }

  return result.data?.data || [];
}

/**
 * Fetch a single tweet by ID, optionally with conversation context.
 * Returns the tweet and up to `depth` parent tweets in the thread.
 */
export async function getTweetWithContext(
  tweetId: string,
  depth: number = 3
): Promise<{ tweet: TweetV2; parents: TweetV2[] }> {
  const parents: TweetV2[] = [];

  try {
    const result = await rwClient.v2.singleTweet(tweetId, {
      'tweet.fields': 'created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets,text',
    });

    const tweet = result.data;
    let currentTweet = tweet;

    // Walk up the reply chain to get parent context
    for (let i = 0; i < depth; i++) {
      const replyTo = currentTweet.referenced_tweets?.find(r => r.type === 'replied_to');
      if (!replyTo) break;

      try {
        const parentResult = await rwClient.v2.singleTweet(replyTo.id, {
          'tweet.fields': 'created_at,author_id,conversation_id,referenced_tweets,text',
        });
        parents.unshift(parentResult.data); // oldest first
        currentTweet = parentResult.data;
      } catch {
        break; // Parent might be deleted or protected
      }
    }

    return { tweet, parents };
  } catch (err) {
    log.warn({ tweetId, err }, 'Failed to fetch tweet context');
    return { tweet: { id: tweetId, text: '' } as TweetV2, parents: [] };
  }
}

// ---- CAMPAIGN: Hashtag Search ---- //

export interface CampaignTweet {
  id: string;
  text: string;
  authorId: string;
  authorUsername?: string;
  createdAt?: string;
  publicMetrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
    quote_count: number;
  };
}

/**
 * Search tweets mentioning @cludebot with #CludeHackathon.
 * Requires X API Basic tier ($100/mo) for v2.search().
 */
export async function searchHashtagTweets(
  sinceId?: string,
  maxResults: number = 100
): Promise<CampaignTweet[]> {
  log.info({ sinceId, maxResults }, 'Searching campaign tweets');

  try {
    // Broad match: direct mentions, hashtag, or $CLUDE with campaign keywords
    const query = '(@cludebot OR #CludeHackathon OR ($CLUDE (hackathon OR "10 days" OR "growing a brain" OR "blockchain brain"))) -is:retweet';
    const params: Record<string, string> = {
      'tweet.fields': 'created_at,author_id,public_metrics',
      'expansions': 'author_id',
      'user.fields': 'username',
      max_results: String(Math.min(maxResults, 100)),
    };
    if (sinceId) params.since_id = sinceId;

    const result = await rwClient.v2.search(query, params);

    // Build author lookup from includes
    const authorMap = new Map<string, string>();
    if (result.includes?.users) {
      for (const user of result.includes.users) {
        authorMap.set(user.id, user.username);
      }
    }

    const tweets: CampaignTweet[] = [];
    for (const tweet of result.data?.data || []) {
      tweets.push({
        id: tweet.id,
        text: tweet.text,
        authorId: tweet.author_id || '',
        authorUsername: authorMap.get(tweet.author_id || '') || undefined,
        createdAt: tweet.created_at,
        publicMetrics: tweet.public_metrics ? {
          like_count: tweet.public_metrics.like_count || 0,
          retweet_count: tweet.public_metrics.retweet_count || 0,
          reply_count: tweet.public_metrics.reply_count || 0,
          quote_count: tweet.public_metrics.quote_count || 0,
        } : undefined,
      });
    }

    log.info({ found: tweets.length }, 'Campaign tweet search complete');
    return tweets;
  } catch (err) {
    log.error({ err }, 'Failed to search campaign tweets');
    return [];
  }
}

/**
 * Refresh engagement metrics for a batch of tweet IDs.
 * Returns a map of tweetId → { likes, retweets, replies, quotes }.
 */
export async function refreshTweetMetrics(
  tweetIds: string[]
): Promise<Map<string, { likes: number; retweets: number; replies: number; quotes: number }>> {
  const metricsMap = new Map<string, { likes: number; retweets: number; replies: number; quotes: number }>();
  if (tweetIds.length === 0) return metricsMap;

  // API allows up to 100 tweet lookups at once
  const batches: string[][] = [];
  for (let i = 0; i < tweetIds.length; i += 100) {
    batches.push(tweetIds.slice(i, i + 100));
  }

  for (const batch of batches) {
    try {
      const result = await rwClient.v2.tweets(batch, {
        'tweet.fields': 'public_metrics',
      });
      for (const tweet of result.data || []) {
        if (tweet.public_metrics) {
          metricsMap.set(tweet.id, {
            likes: tweet.public_metrics.like_count || 0,
            retweets: tweet.public_metrics.retweet_count || 0,
            replies: tweet.public_metrics.reply_count || 0,
            quotes: tweet.public_metrics.quote_count || 0,
          });
        }
      }
    } catch (err) {
      log.warn({ err, batchSize: batch.length }, 'Failed to refresh tweet metrics batch');
    }
  }

  return metricsMap;
}

/**
 * Get engagement metrics for a single tweet.
 */
export async function getTweetMetrics(tweetId: string): Promise<{ likes: number; retweets: number; replies: number; quotes: number } | null> {
  const result = await refreshTweetMetrics([tweetId]);
  return result.get(tweetId) || null;
}

export async function getUserById(userId: string): Promise<UserV2 | null> {
  try {
    const result = await rwClient.v2.user(userId, {
      'user.fields': 'description,username,name,public_metrics',
    });
    return result.data;
  } catch (err) {
    log.warn({ userId, err }, 'Failed to fetch user');
    return null;
  }
}
