import { postReply, postTweet, postThread } from '../core/x-client';
import { markProcessed } from '../core/database';
import { logAction } from '../memory/action-learning';
import { createChildLogger } from '../core/logger';
import { randomBytes } from 'crypto';

const log = createChildLogger('social');

/**
 * Social service — wraps X client with consistent logging and processed-marking.
 *
 * Centralizes the repeated pattern of: post → mark processed → log.
 * Note: Truncation now happens in x-client.ts with smart word-boundary truncation.
 */

export async function replyAndMark(
  tweetId: string,
  text: string,
  feature: string,
  context?: { trigger?: string; reasoning?: string; relatedUser?: string; conversationId?: string; authorId?: string }
): Promise<string> {
  // x-client handles smart truncation
  const replyId = await postReply(tweetId, text);
  await markProcessed(tweetId, feature, replyId, {
    conversationId: context?.conversationId,
    authorId: context?.authorId,
  });
  log.info({ tweetId, replyId, feature }, 'Reply posted and marked');

  // Log action for self-learning (fire-and-forget)
  const actionId = `reply:${replyId || tweetId}:${randomBytes(4).toString('hex')}`;
  logAction({
    actionId,
    action: `Replied to tweet: "${text.slice(0, 200)}"`,
    reasoning: context?.reasoning || `Responded via ${feature}`,
    feature,
    relatedUser: context?.relatedUser,
    trigger: context?.trigger,
    metadata: { tweetId, replyId },
  }).catch(err => log.error({ err }, 'Action logging failed (non-fatal)'));

  return replyId;
}

export async function tweet(text: string): Promise<string> {
  // x-client handles smart truncation
  return postTweet(text);
}

export async function tweetThread(texts: string[]): Promise<string[]> {
  // x-client handles smart truncation
  return postThread(texts);
}
