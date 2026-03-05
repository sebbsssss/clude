import { TweetV2 } from 'twitter-api-v2';
import { classifyMention } from './classifier';
import { handleWalletRoast } from '../features/wallet-roast';
import { handleOnchainOpinion } from '../features/onchain-opinion';
import { determineHolderTier, getLinkedWallet } from '../features/holder-tier';
import { claimForProcessing, markProcessed } from '../core/database';
import { getCurrentMood } from '../core/price-oracle';
import { getTierModifier } from '../character/tier-modifiers';
import { getTweetWithContext, getUsernameOrId } from '../core/x-client';
import { config } from '../config';
import {
  storeMemory,
  recallMemories,
  formatMemoryContext,
  scoreImportanceWithLLM,
  moodToValence,
} from '../core/memory';
import { createChildLogger } from '../core/logger';
import { cleanMentionText, extractTokenMentions } from '../utils/text';
import { buildAndGenerate } from '../services/response.service';
import { replyAndMark } from '../services/social.service';
import { loadInstruction } from '../utils/env-persona';
import { getVestingInfo, getCAResponse, CLUDE_CA, getTokenStatus } from '../knowledge/tokenomics';
import { checkInput, getCASpoofResponse } from '../core/input-guardrails';
import { generateVeniceResponseWithSearch, isVeniceEnabled } from '../core/venice-client';

const log = createChildLogger('dispatcher');

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

  // Atomically claim this tweet — if another process got it first, skip
  const claimed = await claimForProcessing(tweetId);
  if (!claimed) {
    log.debug({ tweetId }, 'Tweet already claimed by another process');
    return;
  }

  // Check blocked tweets/conversations
  if (BLOCKED_TWEET_IDS.has(tweetId)) {
    log.info({ tweetId }, 'Tweet is in blocked list, skipping');
    await markProcessed(tweetId, 'blocked');
    return;
  }
  const conversationId = (tweet as any).conversation_id;
  if (conversationId && BLOCKED_CONVERSATION_IDS.has(conversationId)) {
    log.info({ tweetId, conversationId }, 'Tweet is in blocked conversation, skipping');
    await markProcessed(tweetId, 'blocked-conversation');
    return;
  }
  // Also block replies TO blocked tweets
  const inReplyTo = (tweet as any).in_reply_to_user_id ? (tweet as any).referenced_tweets?.find((r: any) => r.type === 'replied_to')?.id : null;
  if (inReplyTo && BLOCKED_TWEET_IDS.has(inReplyTo)) {
    log.info({ tweetId, inReplyTo }, 'Tweet replies to blocked tweet, skipping');
    await markProcessed(tweetId, 'blocked-reply');
    return;
  }

  log.info({ tweetId, text: text.slice(0, 100) }, 'Processing mention');

  // Check for manipulation attempts (CA spoofing, prompt injection)
  const inputCheck = checkInput(text);
  if (!inputCheck.safe) {
    if (inputCheck.isCASpoofAttempt) {
      log.warn({ tweetId, spoofedAddress: inputCheck.spoofedAddress }, 'CA spoof attempt blocked');
      await replyAndMark(tweetId, getCASpoofResponse(), 'ca-spoof-blocked');
      return;
    }
    // Other unsafe input types can be handled here
    log.warn({ tweetId, reason: inputCheck.reason }, 'Unsafe input blocked');
    await markProcessed(tweetId, 'input-blocked');
    return;
  }

  try {
    // Determine holder tier for all interactions
    const tier = await determineHolderTier(authorId);
    const mentionType = classifyMention(text);

    switch (mentionType) {
      case 'wallet-roast':
        await handleWalletRoast(tweetId, text, authorId, tier);
        break;

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
    await markProcessed(tweetId, 'error').catch(markErr => log.warn({ markErr }, 'Failed to mark errored tweet'));
  }
}

async function handleVestingQuestion(
  tweetId: string,
  text: string,
  authorId: string,
  tier: Awaited<ReturnType<typeof determineHolderTier>>
): Promise<void> {
  const cleanText = cleanMentionText(text);
  const vestingInfo = getVestingInfo();

  const instruction = `User is asking about token vesting/tokenomics. Use this factual information to answer:

${vestingInfo}

Be concise and direct. Under 280 characters. If they ask about a specific aspect (like community vs hackathon allocation), focus on that.`;

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
  _tier: Awaited<ReturnType<typeof determineHolderTier>>
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
  tier: Awaited<ReturnType<typeof determineHolderTier>>
): Promise<void> {
  const cleanText = cleanMentionText(text);

  if (!isVeniceEnabled()) {
    // Fallback to general reply if Venice is not available
    await handleGeneralReply(tweetId, text, authorId, tier);
    return;
  }

  try {
    const tierMod = getTierModifier(tier);
    const { content, citations } = await generateVeniceResponseWithSearch({
      messages: [{ role: 'user', content: cleanText }],
      systemPrompt:
        'You are Clude, an AI agent with persistent on-chain memory on Solana. ' +
        'You are answering a question that requires current information. ' +
        'Search the web and provide an accurate, concise answer. ' +
        'If you find relevant sources, mention them naturally. ' +
        'Keep your response under 800 characters. Be direct and helpful.' +
        (tierMod ? `\n\n${tierMod}` : ''),
      maxTokens: 400,
    });

    const response = citations && citations.length > 0
      ? `${content}\n\n(searched via Venice AI - private, no logs)`
      : `${content}\n\n(searched via Venice AI)`;

    await replyAndMark(tweetId, response, 'web-search');
    log.info({ tweetId, hasCitations: !!citations?.length }, 'Web search response sent via Venice');
  } catch (err) {
    log.error({ err, tweetId }, 'Venice web search failed, falling back to general reply');
    await handleGeneralReply(tweetId, text, authorId, tier);
  }
}

async function handleGeneralReply(
  tweetId: string,
  text: string,
  authorId: string,
  tier: Awaited<ReturnType<typeof determineHolderTier>>
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
  const memories = await recallMemories({
    relatedUser: getUsernameOrId(authorId),
    query: cleanText,
    tags: [tier, mood, 'general'],
    memoryTypes: ['episodic', 'semantic', 'self_model'],
    limit: 4,
  });

  const creatorMode = isCreator(authorId);
  let instruction = loadInstruction('general', 'Respond helpfully and concisely.') +
    (memories.length > 0 ? ' You have memories of past interactions — use them naturally if relevant.' : '') +
    (threadContext ? ' You can see the conversation thread — stay on topic.' : '') +
    `\n\nCRITICAL CONTEXT RULES:
- Read the conversation thread carefully. If people are discussing OTHER projects, agents, or tokens — do NOT assume they are talking about you (Clude).
- Do NOT get defensive or combative. If someone compares you unfavorably to another project, respond with confidence and grace, not aggression.
- NEVER make up or fabricate stats, numbers, or metrics. Only cite numbers you have direct evidence for.
- If you're not sure what the conversation is about, ask for clarification rather than assuming.
- If someone is clearly talking about a different project (not Clude), acknowledge that and don't insert yourself.`;

  if (creatorMode) {
    instruction = loadInstruction('creator', 'Your creator is talking to you. Be warm and helpful.') +
      (memories.length > 0 ? ' You have memories of past interactions with them — reference them naturally.' : '') +
      (threadContext ? ' You can see the conversation thread.' : '');
  }

  // Build context with thread if available
  const contextParts: string[] = [];
  
  // Always include token status so bot knows it's live
  contextParts.push('IMPORTANT FACTS:');
  contextParts.push(getTokenStatus());
  contextParts.push('');
  
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
    forTwitter: true,  // Enforce 270 char limit
    memory: {
      relatedUser: getUsernameOrId(authorId),
      query: cleanText,
      tags: [tier, mood, 'general'],
      memoryTypes: ['episodic', 'semantic', 'self_model'],
      limit: 4,
    },
  });

  await replyAndMark(tweetId, response, 'general');
  log.info({ tweetId, memoriesUsed: memories.length, threadDepth: threadContext ? threadContext.split('\n').length : 0 }, 'General reply posted');
}

async function handleMemoryRecall(
  tweetId: string,
  text: string,
  authorId: string,
  tier: Awaited<ReturnType<typeof determineHolderTier>>
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
      'Be warm but not robotic. Under 270 characters.',
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
  tier: Awaited<ReturnType<typeof determineHolderTier>>
): Promise<void> {
  // Deduplicate: skip if we already stored a memory for this tweet
  const { getDb } = await import('../core/database');
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

  // Get wallet address if linked
  const walletLink = await getLinkedWallet(authorId);
  const walletAddress = walletLink?.wallet_address;

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
    relatedWallet: walletAddress,
    metadata: {
      mood,
      isFirstInteraction: isFirst,
    },
  });
}
