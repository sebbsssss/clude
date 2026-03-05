import { extractWalletAddress, isQuestion, cleanMentionText } from '../utils/text';
import { isVestingQuestion, isCAQuestion } from '../knowledge/tokenomics';

export type MentionType = 'wallet-roast' | 'question' | 'memory-recall' | 'vesting' | 'ca' | 'web-search' | 'general';

const WEB_SEARCH_PATTERNS = [
  /what(?:'s| is| are) (?:the )?(?:latest|recent|current|new)/i,
  /search (?:for|about|the web)/i,
  /look up/i,
  /find (?:out|me|info)/i,
  /what(?:'s| is) happening (?:with|in|on)/i,
  /news (?:about|on|for)/i,
  /price of/i,
  /how much is/i,
];

const MEMORY_RECALL_PATTERNS = [
  /do you remember/i,
  /what do you (?:remember|recall|know) about (?:me|us|our)/i,
  /remember (?:me|our|what we)/i,
  /our (?:conversation|chat|history|past)/i,
  /have we (?:talked|spoken|chatted|met)/i,
  /what(?:'s| is| was) our history/i,
  /pull up (?:my|our) (?:memory|memories|history)/i,
  /what have we (?:discussed|talked about)/i,
];

export function classifyMention(text: string): MentionType {
  // Strip @ mentions for classification
  const cleaned = cleanMentionText(text);

  // Check for memory recall requests first
  if (MEMORY_RECALL_PATTERNS.some(p => p.test(cleaned))) {
    return 'memory-recall';
  }

  // Check for vesting/tokenomics questions
  if (isVestingQuestion(cleaned)) {
    return 'vesting';
  }

  // Check for contract address questions
  if (isCAQuestion(cleaned)) {
    return 'ca';
  }

  // Wallet roast disabled for now — treat wallet mentions as general replies
  // if (extractWalletAddress(cleaned)) {
  //   return 'wallet-roast';
  // }

  // Check for web search requests (needs current/live info)
  if (WEB_SEARCH_PATTERNS.some(p => p.test(cleaned))) {
    return 'web-search';
  }

  // Check for question
  if (isQuestion(cleaned)) {
    return 'question';
  }

  return 'general';
}
