import { sendChannelMessage, escapeMarkdownV2 } from '@clude/shared/core/telegram-client';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('telegram-service');

export interface CommitInfo {
  hash: string;
  message: string;
}

export interface SentimentDigest {
  sentiment: 'bullish' | 'bearish' | 'neutral';
  tweetCount: number;
  commentary: string;
  notableTweets?: { author: string; excerpt: string; likes: number }[];
  period: string;
}

/**
 * Broadcast a generic message to the Telegram channel.
 */
export async function broadcastToChannel(
  text: string,
  feature: string,
  opts?: { format?: 'markdown' | 'html' }
): Promise<number> {
  const parseMode = opts?.format === 'html' ? 'HTML' : undefined;
  const result = await sendChannelMessage(text, { parseMode, disablePreview: true });
  log.info({ feature, messageId: result.messageId }, 'Broadcast sent');
  return result.messageId;
}

/**
 * Broadcast a formatted dev update (commits pushed).
 */
export async function broadcastDevUpdate(
  commits: CommitInfo[],
  branch: string,
  author?: string
): Promise<number> {
  const commitLines = commits
    .slice(0, 8)
    .map(c => `<code>${c.hash.slice(0, 7)}</code> ${escapeHtml(c.message)}`)
    .join('\n');

  const text = [
    `<b>CLUDE DEV LOG</b>`,
    ``,
    `<b>Branch:</b> ${escapeHtml(branch)}`,
    author ? `<b>By:</b> ${escapeHtml(author)}` : '',
    ``,
    `<b>Recent commits:</b>`,
    commitLines,
  ].filter(Boolean).join('\n');

  const result = await sendChannelMessage(text, { parseMode: 'HTML', disablePreview: true });
  log.info({ branch, commitCount: commits.length, messageId: result.messageId }, 'Dev update broadcast');
  return result.messageId;
}

/**
 * Broadcast a sentiment analysis digest.
 */
export async function broadcastSentimentDigest(digest: SentimentDigest): Promise<number> {
  // Remap sentiment to positive framing
  const sentimentLabel = digest.sentiment === 'bullish' ? 'momentum'
    : digest.sentiment === 'neutral' ? 'building' : 'steady';
  const sentimentEmoji = digest.sentiment === 'bullish' ? '🔥'
    : digest.sentiment === 'neutral' ? '🔧' : '➡️';

  const notableLines = (digest.notableTweets || [])
    .slice(0, 3)
    .map(t => `• @${escapeHtml(t.author)}: "${escapeHtml(t.excerpt)}" (${t.likes} ♥)`)
    .join('\n');

  const text = [
    `<b>X PULSE | $CLUDE</b> ${sentimentEmoji}`,
    ``,
    escapeHtml(digest.commentary),
    ``,
    `<b>Tweets:</b> ${digest.tweetCount} | <b>Vibe:</b> ${sentimentLabel}`,
    `<b>Period:</b> ${escapeHtml(digest.period)}`,
    notableLines ? `\n<b>Notable:</b>\n${notableLines}` : '',
  ].filter(Boolean).join('\n');

  const result = await sendChannelMessage(text, { parseMode: 'HTML', disablePreview: true });
  log.info({ sentiment: digest.sentiment, tweetCount: digest.tweetCount, messageId: result.messageId }, 'Sentiment digest broadcast');
  return result.messageId;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
