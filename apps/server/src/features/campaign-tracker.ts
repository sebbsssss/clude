import { searchHashtagTweets, refreshTweetMetrics } from '../core/x-client';
import { getDb } from '../core/database';
import { config } from '../config';
import { createChildLogger } from '../core/logger';

const log = createChildLogger('campaign-tracker');

let tweetPollInterval: ReturnType<typeof setInterval> | null = null;
let metricsRefreshInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start background polling for campaign tweets.
 * Polls hashtag search every 5 minutes, refreshes metrics every 15 minutes.
 * Auto-manages campaign_state (is_active, current_day) from dates.
 */
export function startCampaignTracker(): void {
  log.info('Campaign tracker starting');

  // Sync state + initial poll
  syncCampaignState()
    .then(() => pollCampaignTweets())
    .catch(err => log.warn({ err }, 'Initial campaign sync/poll failed'));

  // Poll for new tweets every 5 minutes
  tweetPollInterval = setInterval(() => {
    syncCampaignState()
      .then(() => pollCampaignTweets())
      .catch(err => log.warn({ err }, 'Campaign tweet poll failed'));
  }, 5 * 60 * 1000);

  // Refresh engagement metrics every 15 minutes
  metricsRefreshInterval = setInterval(() => {
    refreshAllMetrics().catch(err => log.warn({ err }, 'Campaign metrics refresh failed'));
  }, 15 * 60 * 1000);

  log.info('Campaign tracker started — polling every 5 min, metrics every 15 min');
}

export function stopCampaignTracker(): void {
  if (tweetPollInterval) clearInterval(tweetPollInterval);
  if (metricsRefreshInterval) clearInterval(metricsRefreshInterval);
  tweetPollInterval = null;
  metricsRefreshInterval = null;
  log.info('Campaign tracker stopped');
}

/**
 * Auto-manage campaign_state: calculate current_day from dates,
 * set is_active based on whether we're within the campaign window.
 */
async function syncCampaignState(): Promise<void> {
  const db = getDb();
  const { data: state } = await db
    .from('campaign_state')
    .select('*')
    .eq('id', 1)
    .single();

  if (!state) {
    log.warn('No campaign_state row found');
    return;
  }

  // If CAMPAIGN_START env var is set, sync dates to DB
  const envStart = config.campaign.startDate;
  if (envStart) {
    const envStartDate = new Date(envStart);
    const envEndDate = new Date(envStartDate.getTime() + 10 * 24 * 60 * 60 * 1000); // 10 days
    const dbStart = new Date(state.campaign_start);
    if (Math.abs(envStartDate.getTime() - dbStart.getTime()) > 60000) {
      await db
        .from('campaign_state')
        .update({
          campaign_start: envStartDate.toISOString(),
          campaign_end: envEndDate.toISOString(),
        })
        .eq('id', 1);
      state.campaign_start = envStartDate.toISOString();
      state.campaign_end = envEndDate.toISOString();
      log.info({ start: envStartDate.toISOString(), end: envEndDate.toISOString() }, 'Campaign dates synced from env');
    }
  }

  const now = new Date();
  const start = new Date(state.campaign_start);
  const end = new Date(state.campaign_end);

  const isActive = now >= start && now <= end;
  const currentDay = isActive ? calculateCampaignDay(now, start) : 0;
  const clampedDay = Math.min(currentDay, 10);

  // Only update if something changed
  if (state.is_active !== isActive || state.current_day !== clampedDay) {
    await db
      .from('campaign_state')
      .update({ is_active: isActive, current_day: clampedDay })
      .eq('id', 1);
    log.info({ isActive, currentDay: clampedDay, prev: state.current_day }, 'Campaign state synced');
  }
}

/**
 * Calculate which campaign day based on time elapsed since start.
 */
function calculateCampaignDay(date: Date, campaignStart: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffMs = date.getTime() - campaignStart.getTime();
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / msPerDay) + 1;
}

/**
 * Poll for new tweets with @cludebot #CludeHackathon.
 */
async function pollCampaignTweets(): Promise<void> {
  const db = getDb();

  // Get campaign state
  const { data: state } = await db
    .from('campaign_state')
    .select('*')
    .eq('id', 1)
    .single();

  if (!state || !state.is_active) {
    log.debug('Campaign not active, skipping tweet poll');
    return;
  }

  // Get the latest tweet ID we've seen (for since_id pagination)
  const { data: latest } = await db
    .from('campaign_tweets')
    .select('tweet_id')
    .order('created_at', { ascending: false })
    .limit(1);

  const sinceId = latest?.[0]?.tweet_id;

  // Search for new tweets
  const tweets = await searchHashtagTweets(sinceId);
  if (tweets.length === 0) {
    log.debug('No new campaign tweets found');
    return;
  }

  const campaignStart = new Date(state.campaign_start);
  let inserted = 0;

  for (const tweet of tweets) {
    const tweetDate = new Date(tweet.createdAt || Date.now());
    const dayNumber = calculateCampaignDay(tweetDate, campaignStart);
    if (dayNumber < 1 || dayNumber > 10) continue;

    // Calculate engagement score: likes + 2*retweets + 3*quotes + replies
    const metrics = tweet.publicMetrics || { like_count: 0, retweet_count: 0, reply_count: 0, quote_count: 0 };
    const engagementScore =
      metrics.like_count +
      metrics.retweet_count * 2 +
      metrics.quote_count * 3 +
      metrics.reply_count;

    const { error } = await db
      .from('campaign_tweets')
      .upsert({
        tweet_id: tweet.id,
        author_id: tweet.authorId,
        author_username: tweet.authorUsername || null,
        text: tweet.text,
        campaign_day: dayNumber,
        likes: metrics.like_count,
        retweets: metrics.retweet_count,
        replies: metrics.reply_count,
        quotes: metrics.quote_count,
        engagement_score: engagementScore,
        metrics_updated_at: new Date().toISOString(),
      }, { onConflict: 'tweet_id' });

    if (!error) inserted++;
  }

  log.info({ found: tweets.length, inserted }, 'Campaign tweet poll complete');
}

/**
 * Refresh engagement metrics for all tracked tweets (not just current day).
 */
async function refreshAllMetrics(): Promise<void> {
  const db = getDb();

  const { data: state } = await db
    .from('campaign_state')
    .select('current_day, is_active')
    .eq('id', 1)
    .single();

  if (!state?.is_active || !state.current_day) return;

  // Refresh metrics for ALL tweets, not just current day
  const { data: tweets } = await db
    .from('campaign_tweets')
    .select('tweet_id');

  if (!tweets || tweets.length === 0) return;

  const tweetIds = tweets.map(t => t.tweet_id);
  const metricsMap = await refreshTweetMetrics(tweetIds);

  let updated = 0;
  for (const [tweetId, metrics] of metricsMap) {
    const engagementScore =
      metrics.likes +
      metrics.retweets * 2 +
      metrics.quotes * 3 +
      metrics.replies;

    const { error } = await db
      .from('campaign_tweets')
      .update({
        likes: metrics.likes,
        retweets: metrics.retweets,
        replies: metrics.replies,
        quotes: metrics.quotes,
        engagement_score: engagementScore,
        metrics_updated_at: new Date().toISOString(),
      })
      .eq('tweet_id', tweetId);

    if (!error) updated++;
  }

  log.info({ total: tweetIds.length, updated }, 'Campaign metrics refresh complete');
}
