// ============================================================
// ENTITY EXTRACTION — Rule-based NER for memory content
// ============================================================

import type { EntityType } from './types/memory.js';

export interface ExtractedEntity {
  name: string;
  type: EntityType;
}

/**
 * Extract entities from text using heuristics.
 * For production, swap with NER model or LLM extraction.
 */
export function extractEntitiesFromText(text: string): ExtractedEntity[] {
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();

  // Twitter handles -> person
  const handles = text.match(/@(\w+)/g);
  if (handles) {
    for (const handle of handles) {
      const name = handle.slice(1);
      if (!seen.has(name.toLowerCase())) {
        entities.push({ name, type: 'person' });
        seen.add(name.toLowerCase());
      }
    }
  }

  // Wallet addresses (Solana base58)
  const wallets = text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
  if (wallets) {
    for (const wallet of wallets) {
      if (wallet.length >= 32 && !seen.has(wallet)) {
        entities.push({ name: wallet, type: 'wallet' });
        seen.add(wallet);
      }
    }
  }

  // Token tickers ($XXX)
  const tickers = text.match(/\$([A-Z]{2,10})/g);
  if (tickers) {
    for (const ticker of tickers) {
      const name = ticker.slice(1);
      if (!seen.has(name.toLowerCase())) {
        entities.push({ name, type: 'token' });
        seen.add(name.toLowerCase());
      }
    }
  }

  // Capitalized multi-word names
  const properNouns = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g);
  if (properNouns) {
    for (const noun of properNouns) {
      if (!seen.has(noun.toLowerCase()) && noun.length > 3) {
        entities.push({ name: noun, type: 'concept' });
        seen.add(noun.toLowerCase());
      }
    }
  }

  return entities;
}

/**
 * Classify the link type between a new memory and an existing candidate.
 */
export function classifyLinkType(
  newType: string,
  candidateType: string,
  sameUser: boolean,
  recentCandidate: boolean,
  conceptOverlap: number,
  valenceFlip: boolean,
): string {
  if (sameUser && recentCandidate) return 'follows';
  if (valenceFlip && conceptOverlap > 0) return 'contradicts';
  if (newType === 'semantic' && candidateType === 'episodic') return 'elaborates';
  if (conceptOverlap >= 2) return 'relates';
  return 'relates';
}
