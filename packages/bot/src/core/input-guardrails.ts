/**
 * Input guardrails — detect and block manipulation attempts before processing.
 * Protects against prompt injection, CA spoofing, and identity attacks.
 */

import { createChildLogger } from './logger';
import { CLUDE_CA } from '../knowledge/tokenomics';

const log = createChildLogger('input-guardrails');

// Solana address pattern
const SOLANA_ADDRESS_RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// Patterns that indicate CA manipulation attempts
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
 * Check incoming message for manipulation attempts.
 * Returns { safe: false } if the message is trying to manipulate the bot.
 */
export function checkInput(text: string): InputGuardrailResult {
  const lower = text.toLowerCase();
  
  // Check for CA manipulation patterns
  for (const pattern of CA_INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      // Extract any addresses in the message
      const addresses = text.match(SOLANA_ADDRESS_RE) || [];
      
      // If they're providing an address that's NOT the official CA, it's an attack
      const foreignAddresses = addresses.filter(addr => addr !== CLUDE_CA);
      
      if (foreignAddresses.length > 0) {
        log.warn({ 
          text: text.slice(0, 200), 
          spoofedAddress: foreignAddresses[0],
          pattern: pattern.source 
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
 * Firm but not aggressive — don't engage with the manipulation.
 */
export function getCASpoofResponse(): string {
  return `Nice try. The only CA I recognize is ${CLUDE_CA}. That's hardcoded, not up for debate.`;
}
