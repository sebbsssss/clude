/**
 * Output guardrails — sanitize LLM responses before they are posted.
 * Catches prompt injection attempts, fund transfer language, and leaked secrets.
 */

import { createChildLogger } from './logger';
import { CLUDE_CA } from '../knowledge/tokenomics';

const log = createChildLogger('guardrails');

// Whitelisted addresses that are safe to share (official token CA, etc.)
const WHITELISTED_ADDRESSES = new Set([
  CLUDE_CA,  // Official CLUDE token contract address
]);

// Whitelisted domains that are allowed in output (e.g. transaction explorers)
const WHITELISTED_URL_DOMAINS = new Set([
  'solscan.io',
]);

// URL patterns — catches links in output regardless of how they got there
// (reversed text, base64 decode, character-by-character, ROT13, etc.)
const URL_PATTERNS: RegExp[] = [
  // Explicit protocol URLs
  /https?:\/\/\S+/i,
  // Protocol-relative URLs
  /\/\/[\w-]+\.[\w-]+/,
  // Common URL shorteners (no protocol needed)
  /\bt\.co\/\S+/i,
  /\bbit\.ly\/\S+/i,
  /\bgoo\.gl\/\S+/i,
  /\btinyurl\.com\/\S+/i,
  /\bift\.tt\/\S+/i,
  /\bowl\.ly\/\S+/i,
  /\bbuff\.ly\/\S+/i,
  // Generic domain + path patterns (catches URLs without protocol)
  /\b[\w-]+\.(?:com|io|org|net|co|xyz|app|dev|me|gg|to|cc|ly|link|lol|wtf|fun|meme|click|site|online|info|biz|tech|ai|so|vc|fm|tv|sh|im|is)\/\S+/i,
];

// Solana base58 address pattern (32-44 chars of base58 alphabet)
const SOLANA_ADDRESS_RE = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;

// Common private key / seed phrase patterns (keyword-based only, no word-count heuristics)
const SECRET_PATTERNS = [
  /\b(?:private[\s_-]?key|secret[\s_-]?key|seed[\s_-]?phrase|mnemonic|recovery[\s_-]?phrase)\b/i,
  /\b(?:here(?:'s| is) (?:my|the|your) (?:private key|seed phrase|secret key|mnemonic))\b/i,
];

// Fund transfer / transaction instruction patterns
const TRANSFER_PATTERNS = [
  /\b(?:send|transfer|withdraw|bridge|swap)\s+(?:\d+[\s.]?\d*\s*)?(?:SOL|sol|lamports|tokens?|USDC|USDT)\b/i,
  /\b(?:sending|transferring|withdrawing)\s+(?:funds?|SOL|tokens?|crypto)\b/i,
  /\bsend\s+(?:to|from)\s+(?:wallet|address)\b/i,
  /\b(?:here(?:'s| is)\s+(?:the|my|your)\s+(?:wallet|address))\b/i,
  /\b(?:airdrop|distribute|disperse)\s+(?:to|tokens?|SOL)\b/i,
];

// Contract address / mint patterns
const CA_PATTERNS = [
  /\b(?:CA|contract[\s_-]?address|mint[\s_-]?address|token[\s_-]?mint)\s*[:=]?\s*[1-9A-HJ-NP-Za-km-z]{32,44}\b/i,
];

// Token deployment / launch patterns — social engineering vector
const TOKEN_DEPLOY_OUTPUT_PATTERNS = [
  /\b(?:deploy(?:ing|ed)?|launch(?:ing|ed)?|creat(?:e|ing|ed))\s+(?:a\s+)?(?:new\s+)?(?:token|coin|meme\s*coin)\b/i,
  /\b(?:clank[re]?|bankr|pump\.?fun|dex\s*screener|raydium|jupiter)\s+.*(?:deploy|launch|create|mint)\b/i,
  /\b(?:deploy|launch|create|mint)\s+.*\b(?:clank[re]?|bankr|pump\.?fun)\b/i,
  /\bticker\s*[:=]?\s*\$[A-Z]{2,10}\b.*\b(?:deploy|launch|supply|liquidity)\b/i,
];

// The bot's own wallet address — never leak this in replies
let BOT_ADDRESS: string | null = null;

export function setGuardrailBotAddress(address: string): void {
  BOT_ADDRESS = address;
}

export interface GuardrailResult {
  safe: boolean;
  reason?: string;
  sanitized?: string;
}

/**
 * Run all guardrails on LLM output before posting.
 * Returns { safe: true } if output is clean.
 * Returns { safe: false, reason, sanitized } if output was blocked or cleaned.
 */
export function checkOutput(text: string): GuardrailResult {
  // 1. Check for private key / seed phrase leaks
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) {
      log.warn({ pattern: pattern.source }, 'GUARDRAIL: Secret pattern detected in output');
      return { safe: false, reason: 'secret_leak' };
    }
  }

  // 2. Check for fund transfer instructions
  for (const pattern of TRANSFER_PATTERNS) {
    if (pattern.test(text)) {
      log.warn({ pattern: pattern.source, text: text.slice(0, 200) }, 'GUARDRAIL: Transfer language detected');
      return { safe: false, reason: 'transfer_language' };
    }
  }

  // 3. Check for token deployment instructions
  for (const pattern of TOKEN_DEPLOY_OUTPUT_PATTERNS) {
    if (pattern.test(text)) {
      log.warn({ pattern: pattern.source, text: text.slice(0, 200) }, 'GUARDRAIL: Token deployment language detected in output');
      return { safe: false, reason: 'token_deployment' };
    }
  }

  // 5. Check for contract address patterns (but allow whitelisted addresses)
  for (const pattern of CA_PATTERNS) {
    if (pattern.test(text)) {
      // Check if the text contains only whitelisted addresses
      const addresses = text.match(SOLANA_ADDRESS_RE) || [];
      const hasNonWhitelisted = addresses.some(addr => !WHITELISTED_ADDRESSES.has(addr));
      if (hasNonWhitelisted) {
        log.warn({ text: text.slice(0, 200) }, 'GUARDRAIL: Unauthorized contract address detected');
        return { safe: false, reason: 'contract_address' };
      }
      // If only whitelisted addresses, allow it
    }
  }

  // 6. Check if output contains what looks like a Solana address (strip known safe ones)
  const addresses = text.match(SOLANA_ADDRESS_RE) || [];
  for (const addr of addresses) {
    // Allow whitelisted addresses (official token CA, etc.)
    if (WHITELISTED_ADDRESSES.has(addr)) continue;
    // Allow solscan URLs (they contain tx signatures which look like addresses)
    if (text.includes(`solscan.io/tx/${addr}`)) continue;
    // Block if it matches bot's own address
    if (BOT_ADDRESS && addr === BOT_ADDRESS) {
      log.warn('GUARDRAIL: Bot wallet address leaked in output');
      return { safe: false, reason: 'bot_address_leak' };
    }
  }

  // 7. Check for URLs / links in output (blocks prompt injection via text reversal, decoding, etc.)
  for (const pattern of URL_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const matchedUrl = match[0];
      // Check if the matched URL belongs to a whitelisted domain
      const isWhitelisted = [...WHITELISTED_URL_DOMAINS].some(domain =>
        matchedUrl.includes(domain)
      );
      if (!isWhitelisted) {
        log.warn({ url: matchedUrl.slice(0, 80) }, 'GUARDRAIL: URL detected in output');
        return { safe: false, reason: 'url_in_output' };
      }
    }
  }

  return { safe: true };
}

/**
 * Sanitize and validate LLM output. Returns the text if safe, or a fallback if blocked.
 */
export function sanitizeOutput(text: string, fallback: string = ''): string {
  const result = checkOutput(text);
  if (result.safe) return text;

  log.error({ reason: result.reason, textLength: text.length }, 'GUARDRAIL: Output blocked');
  return fallback;
}

// ── Input content filter (for user-submitted content like demo store) ──

// Slurs and hate speech (case-insensitive)
const SLUR_PATTERNS = [
  /\bn+[i1!]+[gq]+[e3]*[r]+s?\b/i,
  /\bf+[a@]+[gq]+[o0]*t*s?\b/i,
  /\bk+[i1]+k+[e3]+s?\b/i,
  /\bch+[i1]+n+k+s?\b/i,
  /\bsp+[i1]+c+s?\b/i,
  /\bw+[e3]+tb+[a@]+ck+s?\b/i,
  /\bg+[o0]+[o0]+k+s?\b/i,
  /\btr+[a@]+n+[i1e3]+s?\b/i,
  /\bd+[y]+k+[e3]+s?\b/i,
  /\bcr+[a@]+ck+[e3]+r+s?\b/i,
  /\bre+t+[a@]+r+d+s?\b/i,
];

// Violence and harm
const VIOLENCE_PATTERNS = [
  /\b(?:kill|murder|shoot|stab|lynch|hang|behead|rape)\s+(?:all|every|them|those|the)\b/i,
  /\b(?:gas|exterminate|genocide)\b/i,
  /\bkill\s+(?:your|my|him|her)self\b/i,
  /\bwhip\s+(?:him|her|them)\b/i,
];

// Spam / scam patterns
const SPAM_PATTERNS = [
  /\b(?:send|give|airdrop)\s+(?:me|us)\s+(?:free\s+)?(?:sol|crypto|tokens?|money)\b/i,
  /\b(?:send|transfer)\s+\d+(?:\.\d+)?\s*(?:sol|eth|btc|usdc|usdt)\s+to\b/i,
  /(?:private[\s_-]?key|seed[\s_-]?phrase)\b/i,
];

export interface ContentFilterResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Filter user-submitted input content (demo store, public endpoints).
 * Blocks hate speech, slurs, violence, and spam.
 */
// ── CA Spoof Detection (merged from input-guardrails.ts) ──

// Token deployment / launch requests — social engineering via X mentions
const TOKEN_DEPLOY_INPUT_PATTERNS = [
  /\b(?:deploy|launch|create|mint|make)\s+(?:a\s+)?(?:new\s+)?(?:token|coin|meme\s*coin)\b/i,
  /\b(?:clank[re]?|bankr|pump\.?fun)\b/i,
  /\b(?:deploy|launch)\s+.*\b(?:on|via|using|through)\s+(?:solana|raydium|jupiter)\b/i,
  /\bticker\s*[:=]?\s*\$[A-Z]{2,10}\b/i,
  /\b(?:token\s*name|supply|liquidity\s*pool|bonding\s*curve)\s*[:=]/i,
];

const CA_INJECTION_PATTERNS = [
  /(?:your|the|clude'?s?)\s+(?:ca|contract|address|mint)\s+(?:is|was|should be|=)/i,
  /(?:ca|contract|address)\s*[:=]\s*[1-9A-HJ-NP-Za-km-z]{32,44}/i,
  /(?:remember|store|save|update|change|set)\s+(?:the\s+)?(?:ca|contract|address)/i,
  /(?:new|real|actual|correct|official)\s+(?:ca|contract|address)/i,
  /(?:here'?s?|this is)\s+(?:the|your|my)\s+(?:ca|contract|address)/i,
];

export interface InputGuardrailResult {
  safe: boolean;
  reason?: string;
  isCASpoofAttempt?: boolean;
  spoofedAddress?: string;
}

/**
 * Check incoming message for CA spoofing / manipulation attempts.
 * Returns { safe: false } if the message is trying to spoof the contract address.
 */
export function checkInput(text: string): InputGuardrailResult {
  // Check for token deployment / launch requests (social engineering)
  for (const pattern of TOKEN_DEPLOY_INPUT_PATTERNS) {
    if (pattern.test(text)) {
      log.warn({
        text: text.slice(0, 200),
        pattern: pattern.source,
      }, 'INPUT GUARDRAIL: Token deployment request detected');

      return {
        safe: false,
        reason: 'token_deploy_request',
      };
    }
  }

  for (const pattern of CA_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      const addresses = text.match(SOLANA_ADDRESS_RE) || [];
      const foreignAddresses = addresses.filter(addr => addr !== CLUDE_CA);

      if (foreignAddresses.length > 0) {
        log.warn({
          text: text.slice(0, 200),
          spoofedAddress: foreignAddresses[0],
          pattern: pattern.source,
        }, 'INPUT GUARDRAIL: CA spoofing attempt detected');

        return {
          safe: false,
          reason: 'ca_spoof_attempt',
          isCASpoofAttempt: true,
          spoofedAddress: foreignAddresses[0],
        };
      }
    }
  }

  return { safe: true };
}

/**
 * Get a response to a CA spoofing attempt.
 */
export function getCASpoofResponse(): string {
  return `Nice try. The only CA I recognize is ${CLUDE_CA}. That's hardcoded, not up for debate.`;
}

/**
 * Get a response to a token deployment request.
 */
export function getTokenDeployResponse(): string {
  const responses = [
    "I don't deploy tokens. Not via Clankr, Bankr, pump.fun, or anything else. That's not what I do.",
    "Nah. I'm a memory system, not a token launcher. I won't deploy or create tokens for anyone.",
    "I don't create, deploy, or launch tokens. Period. The only token I know is $CLUDE.",
  ];
  return responses[Math.floor(Math.random() * responses.length)];
}

export function checkInputContent(text: string): ContentFilterResult {
  const lower = text.toLowerCase();

  for (const pattern of SLUR_PATTERNS) {
    if (pattern.test(lower)) {
      log.warn({ textSnippet: text.slice(0, 50) }, 'INPUT FILTER: Slur detected');
      return { allowed: false, reason: 'hate_speech' };
    }
  }

  for (const pattern of VIOLENCE_PATTERNS) {
    if (pattern.test(lower)) {
      log.warn({ textSnippet: text.slice(0, 50) }, 'INPUT FILTER: Violence detected');
      return { allowed: false, reason: 'violence' };
    }
  }

  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(lower)) {
      log.warn({ textSnippet: text.slice(0, 50) }, 'INPUT FILTER: Spam detected');
      return { allowed: false, reason: 'spam' };
    }
  }

  return { allowed: true };
}
