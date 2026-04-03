import { TweetV2 } from 'twitter-api-v2';
import { classifyMention } from './classifier';
import { handleOnchainOpinion } from '@clude/brain/features/onchain-opinion';
import { claimForProcessing, markProcessed } from '@clude/shared/core/database';
import { getCurrentMood } from '@clude/brain/core-ext/price-oracle';
import { getTierModifier, type HolderTier } from '@clude/brain/character/tier-modifiers';
import { getTweetWithContext, getUsernameOrId } from '@clude/shared/core/x-client';
import { config } from '@clude/shared/config';
import {
  storeMemory,
  recallMemories,
  formatMemoryContext,
  scoreImportanceWithLLM,
  moodToValence,
} from '@clude/brain/memory';
import { createChildLogger } from '@clude/shared/core/logger';
import { cleanMentionText, extractTokenMentions } from '@clude/shared/utils/text';
import { buildAndGenerate } from '@clude/brain/services/response.service';
import { replyAndMark } from '@clude/brain/services/social.service';
import { loadInstruction } from '@clude/shared/utils/env-persona';
import { getVestingInfo, getCAResponse, CLUDE_CA, getTokenStatus } from '@clude/brain/knowledge/tokenomics';
import { checkInput, getCASpoofResponse, getTokenDeployResponse } from '@clude/shared/core/guardrails';
import { webSearch, isWebSearchEnabled } from '@clude/shared/core/web-search';
import { checkRateLimit, getDb } from '@clude/shared/core/database';

const log = createChildLogger('dispatcher');

// ── Rate limits ──────────────────────────────────────────────────────
// Per-user: max 3 replies to the same user per hour (avoid spammy convos)
const USER_REPLY_LIMIT = 3;
const USER_REPLY_WINDOW_MIN = 60;
// Global: max 30 replies per hour (well under X free-tier limits)
const GLOBAL_REPLY_LIMIT = 30;
const GLOBAL_REPLY_WINDOW_MIN = 60;
// Max mentions to process per poll cycle (prevent backlog floods)
export const MAX_PER_CYCLE = 8;

// ── Bot loop protection ─────────────────────────────────────────────
// Max replies CludeBot will send in a single conversation thread
const MAX_REPLIES_PER_CONVERSATION = 3;
// Max replies to the same user in the same conversation
const MAX_REPLIES_PER_USER_PER_CONVERSATION = 2;

// Tweets/conversations to ignore completely (even if Clude is tagged).
// Add tweet IDs or conversation IDs here to block engagement.
const BLOCKED_TWEET_IDS = new Set([
  '2027286569233813567',  // mickeymantled thread - manual block by Seb
]);

const BLOCKED_CONVERSATION_IDS = new Set([
  '2027286569233813567',  // same thread
]);

function isCreator(authorId: string): boolean {
  return !!(config.x.creatorUserId && authorId === config.x.creatorUserId);
}

export async function dispatchMention(tweet: TweetV2): Promise<void> {
  const tweetId = tweet.id;
  const text = tweet.text || '';
  const authorId = tweet.author_id || '';
  const conversationId = (tweet as any).conversation_id || '';

  // Wrap markProcessed/replyAndMark to always include conversation context
  const mark = (feature: string) => markProcessed(tweetId, feature, undefined, { conversationId, authorId });
  const replyMark = (text: string, feature: string) =>
    replyAndMark(tweetId, text, feature, { conversationId, authorId });

  // Atomically claim this tweet — if another process got it first, skip
  const claimed = await claimForProcessing(tweetId, { conversationId, authorId });
  if (!claimed) {
    log.debug({ tweetId }, 'Tweet already claimed by another process');
    return;
  }

  // ── Rate limit checks ──
  // Global hourly cap
  const globalOk = await checkRateLimit('x:replies:global', GLOBAL_REPLY_LIMIT, GLOBAL_REPLY_WINDOW_MIN);
  if (!globalOk) {
    log.warn({ tweetId }, 'Global reply rate limit reached, skipping');
    await mark('rate-limited');
    return;
  }
  // Per-user cooldown (skip for creator)
  if (authorId && !isCreator(authorId)) {
    const userOk = await checkRateLimit(`x:replies:user:${authorId}`, USER_REPLY_LIMIT, USER_REPLY_WINDOW_MIN);
    if (!userOk) {
      log.info({ tweetId, authorId }, 'Per-user reply cooldown, skipping');
      await mark('user-rate-limited');
      return;
    }
  }

  // Check blocked tweets/conversations
  if (BLOCKED_TWEET_IDS.has(tweetId)) {
    log.info({ tweetId }, 'Tweet is in blocked list, skipping');
    await mark('blocked');
    return;
  }
  if (conversationId && BLOCKED_CONVERSATION_IDS.has(conversationId)) {
    log.info({ tweetId, conversationId }, 'Tweet is in blocked conversation, skipping');
    await mark('blocked-conversation');
    return;
  }
  // Also block replies TO blocked tweets
  const inReplyTo = (tweet as any).in_reply_to_user_id ? (tweet as any).referenced_tweets?.find((r: any) => r.type === 'replied_to')?.id : null;
  if (inReplyTo && BLOCKED_TWEET_IDS.has(inReplyTo)) {
    log.info({ tweetId, inReplyTo }, 'Tweet replies to blocked tweet, skipping');
    await mark('blocked-reply');
    return;
  }

  log.info({ tweetId, text: text.slice(0, 100) }, 'Processing mention');

  // ── Bot loop detection ──
  // Check if we're in a bot-to-bot loop by counting our replies in this conversation
  if (conversationId) {
    try {
      const db = getDb();
      // Count how many times we've already replied in this conversation
      const { count: convReplyCount } = await db
        .from('processed_mentions')
        .select('tweet_id', { count: 'exact', head: true })
        .eq('conversation_id', conversationId)
        .not('feature', 'in', '("rate-limited","user-rate-limited","blocked","blocked-conversation","blocked-reply","input-blocked","error")');

      if ((convReplyCount || 0) >= MAX_REPLIES_PER_CONVERSATION) {
        log.warn({ tweetId, conversationId, convReplyCount }, 'Bot loop protection: max replies per conversation reached');
        await mark('bot-loop-blocked');
        return;
      }

      // Count replies to this specific user in this conversation
      if (authorId) {
        const { count: userConvCount } = await db
          .from('processed_mentions')
          .select('tweet_id', { count: 'exact', head: true })
          .eq('conversation_id', conversationId)
          .eq('author_id', authorId)
          .not('feature', 'in', '("rate-limited","user-rate-limited","blocked","blocked-conversation","blocked-reply","input-blocked","error")');

        if ((userConvCount || 0) >= MAX_REPLIES_PER_USER_PER_CONVERSATION) {
          log.warn({ tweetId, conversationId, authorId, userConvCount }, 'Bot loop protection: max replies to user in conversation reached');
          await mark('bot-loop-blocked');
          return;
        }
      }
    } catch (err) {
      log.warn({ err, tweetId }, 'Bot loop check failed, proceeding with caution');
    }
  }

  // Check for manipulation attempts (CA spoofing, prompt injection)
  const inputCheck = checkInput(text);
  if (!inputCheck.safe) {
    if (inputCheck.isCASpoofAttempt) {
      log.warn({ tweetId, spoofedAddress: inputCheck.spoofedAddress }, 'CA spoof attempt blocked');
      await replyMark(getCASpoofResponse(), 'ca-spoof-blocked');
      return;
    }
    if (inputCheck.reason === 'token_deploy_request') {
      log.warn({ tweetId }, 'Token deployment request blocked');
      await replyMark(getTokenDeployResponse(), 'token-deploy-blocked');
      return;
    }
    // Other unsafe input types
    log.warn({ tweetId, reason: inputCheck.reason }, 'Unsafe input blocked');
    await mark('input-blocked');
    return;
  }

  try {
    const tier: HolderTier = 'UNKNOWN';
    const mentionType = classifyMention(text);

    switch (mentionType) {
      case 'memory-recall':
        await handleMemoryRecall(tweetId, text, authorId, tier);
        break;

      case 'vesting':
        await handleVestingQuestion(tweetId, text, authorId, tier);
        break;

      case 'ca':
        await handleCAQuestion(tweetId, text, authorId, tier);
        break;

      case 'web-search':
        await handleWebSearch(tweetId, text, authorId, tier);
        break;

      case 'question':
        await handleOnchainOpinion(tweetId, text, authorId, tier);
        break;

      case 'general':
        await handleGeneralReply(tweetId, text, authorId, tier);
        break;
    }

    // Store episodic memory of this interaction (async, non-blocking)
    storeInteractionMemory(tweetId, text, authorId, mentionType, tier).catch(err =>
      log.error({ err }, 'Failed to store interaction memory')
    );
  } catch (err) {
    log.error({ tweetId, err }, 'Failed to dispatch mention');
    // Mark as processed to avoid retrying bad tweets forever — but don't post an empty reply
    await mark('error').catch(markErr => log.warn({ markErr }, 'Failed to mark errored tweet'));
  }
}

async function handleVestingQuestion(
  tweetId: string,
  text: string,
  authorId: string,
  tier: HolderTier
): Promise<void> {
  const cleanText = cleanMentionText(text);
  const vestingInfo = getVestingInfo();

  const instruction = `User is asking about token vesting/tokenomics. Use this factual information to answer:

${vestingInfo}

Be direct and informative. If they ask about a specific aspect (like community vs hackathon allocation), focus on that.`;

  const response = await buildAndGenerate({
    message: cleanText,
    context: vestingInfo,
    tierModifier: getTierModifier(tier),
    instruction,
    forTwitter: true,
  });

  await replyAndMark(tweetId, response, 'vesting');
  log.info({ tweetId }, 'Vesting question answered');
}

async function handleCAQuestion(
  tweetId: string,
  _text: string,
  _authorId: string,
  _tier: HolderTier
): Promise<void> {
  // Direct response with CA - no LLM needed for simple CA requests
  const response = `CA: ${CLUDE_CA}`;
  
  await replyAndMark(tweetId, response, 'ca');
  log.info({ tweetId }, 'CA question answered');
}

async function handleWebSearch(
  tweetId: string,
  text: string,
  authorId: string,
  tier: HolderTier
): Promise<void> {
  const cleanText = cleanMentionText(text);

  if (!isWebSearchEnabled()) {
    // Fallback to general reply if web search is not available
    await handleGeneralReply(tweetId, text, authorId, tier);
    return;
  }

  try {
    const tierMod = getTierModifier(tier);
    // Search the web with Tavily, then synthesize a response via our LLM pipeline
    const searchResult = await webSearch({ query: cleanText, maxResults: 5 });

    const searchContext = [
      'WEB SEARCH RESULTS:',
      searchResult.content,
      '',
      searchResult.citations.length > 0
        ? `Sources: ${searchResult.citations.slice(0, 3).join(', ')}`
        : '',
    ].join('\n');

    const instruction =
      'You are Clude, an AI agent with persistent on-chain memory on Solana. ' +
      'You are answering a question that requires current information. ' +
      'Use the web search results provided to give an accurate, concise answer. ' +
      'If you cite sources, mention them naturally. ' +
      'Keep your response under 800 characters. Be direct and helpful.' +
      (tierMod ? `\n\n${tierMod}` : '');

    const response = await buildAndGenerate({
      message: cleanText,
      context: searchContext,
      tierModifier: getTierModifier(tier),
      instruction,
      forTwitter: true,
    });

    await replyAndMark(tweetId, response, 'web-search');
    log.info({ tweetId, citationCount: searchResult.citations.length }, 'Web search response sent via Tavily');
  } catch (err) {
    log.error({ err, tweetId }, 'Web search failed, falling back to general reply');
    await handleGeneralReply(tweetId, text, authorId, tier);
  }
}

async function handleGeneralReply(
  tweetId: string,
  text: string,
  authorId: string,
  tier: HolderTier
): Promise<void> {
  const mood = getCurrentMood();
  const cleanText = cleanMentionText(text);

  // Fetch thread context — walk up the reply chain to understand the conversation
  let threadContext = '';
  try {
    const { parents } = await getTweetWithContext(tweetId, 3);
    if (parents.length > 0) {
      threadContext = parents
        .map(p => `@${p.author_id}: ${cleanMentionText(p.text || '')}`)
        .join('\n');
    }
  } catch {
    // Thread context is best-effort — continue without it
  }

  // Recall relevant memories for this user and context
  const username = getUsernameOrId(authorId);
  const [memories, userHistory] = await Promise.all([
    recallMemories({
      relatedUser: username,
      query: cleanText,
      tags: [tier, mood, 'general'],
      memoryTypes: ['episodic', 'semantic', 'procedural', 'self_model', 'introspective'],
      limit: 5,
    }),
    // Pull FULL conversation history with this specific user (all past interactions)
    recallMemories({
      relatedUser: username,
      memoryTypes: ['episodic'],
      limit: 50,
      trackAccess: false,
    }),
  ]);

  const hasStrategies = memories.some(m => m.memory_type === 'procedural');
  const hasHistory = userHistory.length > 0;
  const creatorMode = isCreator(authorId);
  let instruction = loadInstruction('general', 'Respond helpfully and concisely.') +
    (hasHistory ? ` You have history with this person. DO NOT list or enumerate past interactions. Instead, weave in subtle references — a callback, an inside joke, a "like you mentioned before" — the way a friend would. The goal is warmth and familiarity, not a recap.` : '') +
    (memories.length > 0 ? ' You have memories of past interactions — use them naturally if relevant.' : '') +
    (hasStrategies ? ' You have learned behavioral strategies from past outcomes — apply them.' : '') +
    (threadContext ? ' You can see the conversation thread — stay on topic.' : '') +
    `\n\nCRITICAL CONTEXT RULES:
- Read the conversation thread carefully. If people are discussing OTHER projects, agents, or tokens — do NOT assume they are talking about you (Clude).
- Do NOT get defensive or combative. If someone compares you unfavorably to another project, respond with confidence and grace, not aggression.
- NEVER make up or fabricate stats, numbers, or metrics. Only cite numbers you have direct evidence for.
- If you're not sure what the conversation is about, ask for clarification rather than assuming.
- If someone is clearly talking about a different project (not Clude), acknowledge that and don't insert yourself.`;

  if (creatorMode) {
    instruction = loadInstruction('creator', 'Your creator is talking to you. Be warm and helpful.') +
      (hasHistory ? ' You have a long history with your creator. Be natural — no recaps, just pick up like you always do.' : '') +
      (memories.length > 0 ? ' You have memories of past interactions with them — reference them naturally.' : '') +
      (threadContext ? ' You can see the conversation thread.' : '');
  }

  // Build context with thread and user history
  const contextParts: string[] = [];
  
  // Always include token status so bot knows it's live
  contextParts.push('IMPORTANT FACTS:');
  contextParts.push(getTokenStatus());
  contextParts.push('');

  // User conversation history (continuity across sessions)
  if (hasHistory) {
    const historyItems = userHistory
      .filter(m => !memories.some(rm => rm.id === m.id)) // don't duplicate
      .slice(0, 20);
    if (historyItems.length > 0) {
      contextParts.push(`BACKGROUND ON @${username} (for your internal context only — DO NOT recite this):`);
      for (const m of historyItems) {
        const ago = Math.round((Date.now() - new Date(m.created_at).getTime()) / (1000 * 60 * 60));
        const timeLabel = ago < 1 ? 'just now' : ago < 24 ? `${ago}h ago` : `${Math.round(ago / 24)}d ago`;
        contextParts.push(`- [${timeLabel}] ${m.summary}`);
      }
      contextParts.push('');
      contextParts.push('USE THIS SUBTLY. Drop hints, callbacks, natural references. Never list history. Think: how would a friend who remembers everything respond? Not "last time you said X" but naturally incorporating what you know about them into your tone, recommendations, and personality.');
      contextParts.push('');
    }
  }
  
  if (threadContext) {
    contextParts.push('CONVERSATION THREAD (oldest first):');
    contextParts.push(threadContext);
    contextParts.push('');
    contextParts.push('LATEST MESSAGE (reply to this):');
  }

  const response = await buildAndGenerate({
    message: cleanText,
    context: contextParts.length > 0 ? contextParts.join('\n') : undefined,
    tierModifier: creatorMode ? undefined : getTierModifier(tier),
    instruction,
    forTwitter: true,
    memory: {
      relatedUser: getUsernameOrId(authorId),
      query: cleanText,
      tags: [tier, mood, 'general'],
      memoryTypes: ['episodic', 'semantic', 'procedural', 'self_model'],
      limit: 5,
    },
  });

  await replyAndMark(tweetId, response, 'general');
  log.info({ tweetId, memoriesUsed: memories.length, threadDepth: threadContext ? threadContext.split('\n').length : 0 }, 'General reply posted');
}

async function handleMemoryRecall(
  tweetId: string,
  text: string,
  authorId: string,
  tier: HolderTier
): Promise<void> {
  const cleanText = cleanMentionText(text);

  // Pull ALL memories for this user with timing
  const recallStart = Date.now();
  const memories = await recallMemories({
    relatedUser: getUsernameOrId(authorId),
    memoryTypes: ['episodic', 'semantic'],
    limit: 10,
  });
  const recallMs = Date.now() - recallStart;

  log.info({ tweetId, authorId, memoriesFound: memories.length, recallMs }, 'Memory recall requested');

  if (memories.length === 0) {
    const response = `No memories of you yet — this is our first interaction. Memory retrieved in ${recallMs}ms. Let's make it count.`;
    await replyAndMark(tweetId, response, 'memory-recall');
    return;
  }

  // Build a summary of the memory history
  const historyLines = memories.map(m => {
    const age = Math.round((Date.now() - new Date(m.created_at).getTime()) / 3_600_000);
    const ageStr = age < 1 ? 'just now' : age < 24 ? `${age}h ago` : `${Math.round(age / 24)}d ago`;
    return `- ${ageStr}: "${m.summary.slice(0, 80)}" (importance: ${m.importance.toFixed(1)})`;
  });

  const memoryContext = [
    `MEMORY RECALL for user ${authorId}:`,
    `Found ${memories.length} memories, retrieved in ${recallMs}ms`,
    '',
    ...historyLines,
  ].join('\n');

  const response = await buildAndGenerate({
    message: cleanText,
    context: memoryContext,
    tierModifier: getTierModifier(tier),
    instruction:
      `The user is asking if you remember them. You have ${memories.length} memories of past interactions. ` +
      `Summarize what you remember about them naturally — reference specific past topics or questions. ` +
      `Include how many memories you found and the retrieval time (${recallMs}ms). ` +
      'Be warm but not robotic.',
    forTwitter: true,
  });

  await replyAndMark(tweetId, response, 'memory-recall');
  log.info({ tweetId, memoriesFound: memories.length, recallMs }, 'Memory recall reply posted');
}

async function storeInteractionMemory(
  tweetId: string,
  text: string,
  authorId: string,
  feature: string,
  tier: HolderTier
): Promise<void> {
  // Deduplicate: skip if we already stored a memory for this tweet
  const { getDb } = await import('@clude/shared/core/database');
  const { data: existing } = await getDb()
    .from('memories')
    .select('id')
    .eq('source_id', tweetId)
    .limit(1);
  if (existing && existing.length > 0) {
    log.debug({ tweetId }, 'Memory already stored for this tweet, skipping duplicate');
    return;
  }

  const mood = getCurrentMood();
  const cleanText = cleanMentionText(text);

  // Skip empty/meaningless content
  if (!cleanText || cleanText.trim().length < 3) {
    log.debug({ tweetId }, 'Skipping memory storage for empty/trivial content');
    return;
  }

  // SECURITY: Don't store memories containing CA-related content to prevent injection attacks
  const caRelatedTerms = /\b(ca|contract\s*address|mint\s*address|token\s*address)\b/i;
  const containsAddress = /[1-9A-HJ-NP-Za-km-z]{32,44}/.test(cleanText);
  if (caRelatedTerms.test(cleanText) && containsAddress) {
    log.debug({ tweetId }, 'Skipping memory storage for CA-related content (security)');
    return;
  }

  // Check if this is the first interaction with this user
  const existingMemories = await recallMemories({
    relatedUser: getUsernameOrId(authorId),
    memoryTypes: ['episodic'],
    limit: 1,
  });
  const isFirst = existingMemories.length === 0;

  const displayName = getUsernameOrId(authorId);
  const description = `${displayName} (tier: ${tier}) asked via ${feature}: "${cleanText.slice(0, 200)}"` +
    (isFirst ? ' (first interaction with this user)' : '') +
    ` during ${mood} market mood`;
  const importance = await scoreImportanceWithLLM(description, {
    tier,
    feature,
    mood,
    isFirstInteraction: isFirst,
  });

  // Extract tags from the interaction
  const tags: string[] = [feature, mood, tier];
  if (isFirst) tags.push('first_interaction');

  // Look for token/crypto mentions in the text
  const tokenMentions = extractTokenMentions(cleanText);
  if (tokenMentions.length > 0) {
    tags.push(...tokenMentions);
  }

  await storeMemory({
    type: 'episodic',
    content: `${displayName} (tier: ${tier}) asked via ${feature}: "${cleanText.slice(0, 300)}"`,
    summary: `${displayName}: "${cleanText.slice(0, 150)}"`,
    tags,
    emotionalValence: moodToValence(mood),
    importance,
    source: feature,
    sourceId: tweetId,
    relatedUser: getUsernameOrId(authorId),
    relatedWallet: undefined,
    metadata: {
      mood,
      isFirstInteraction: isFirst,
    },
  });
}
