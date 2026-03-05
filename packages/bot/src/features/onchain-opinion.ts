import { createHash } from 'crypto';
import { postReply } from '../core/x-client';
import { writeMemo, solscanTxUrl } from '../core/solana-client';
import { checkRateLimit, markProcessed, getDb } from '../core/database';
import { config } from '../config';
import { getTierModifier } from '../character/tier-modifiers';
import { HolderTier } from '../character/tier-modifiers';
import { createChildLogger } from '../core/logger';
import { isQuestion, cleanMentionText } from '../utils/text';
import { pickRandom } from '../utils/text';
import { buildAndGenerate } from '../services/response.service';
import { replyAndMark } from '../services/social.service';
import { loadReplyPool, loadInstruction } from '../utils/env-persona';

const log = createChildLogger('onchain-opinion');

const GLOBAL_COOLDOWN_REPLIES = loadReplyPool('opinion_global', [
  'On-chain commit limit reached for this hour. Try again shortly.',
]);

const USER_COOLDOWN_REPLIES = loadReplyPool('opinion_user', [
  'Already committed an opinion for you this hour. Try again later.',
]);

// Re-export isQuestion for backward compat (classifier.ts imports it)
export { isQuestion };

export async function handleOnchainOpinion(
  tweetId: string,
  tweetText: string,
  authorId: string,
  tier: HolderTier
): Promise<void> {
  // Rate limits removed — Solana memo signing is unrestricted

  const question = cleanMentionText(tweetText);
  log.info({ question, tweetId }, 'Processing on-chain opinion');

  const answer = await buildAndGenerate({
    message: question,
    tierModifier: getTierModifier(tier),
    forTwitter: true,  // Enforce char limit
    instruction: loadInstruction('opinion', 'Answer the question thoughtfully. Keep it under 200 characters (a tx link will be appended).'),
    maxTokens: 150,
    memory: {
      relatedUser: authorId,
      query: question,
      tags: [tier, 'question'],
      memoryTypes: ['episodic', 'semantic'],
      limit: 3,
    },
  });

  const answerHash = createHash('sha256').update(answer).digest('hex');
  const memoContent = `clude-opinion | q: ${question.slice(0, 100)} | hash: ${answerHash.slice(0, 16)}`;
  const signature = await writeMemo(memoContent);

  let replyText: string;
  if (signature) {
    if (config.features.showTxLinksInTweets) {
      const txUrl = solscanTxUrl(signature);
      replyText = `${answer}\n\nOn-chain forever: ${txUrl}`;
    } else {
      replyText = answer;
    }

    const db = getDb();
    await db
      .from('opinion_commits')
      .insert({
        tweet_id: tweetId,
        question,
        answer,
        answer_hash: answerHash,
        solana_signature: signature,
      });
  } else {
    replyText = `${answer}\n\n(On-chain commit failed this time — Solana RPC hiccup. The answer still stands.)`;
  }

  await replyAndMark(tweetId, replyText, 'onchain-opinion');
  log.info({ tweetId, signature }, 'On-chain opinion posted');
}
