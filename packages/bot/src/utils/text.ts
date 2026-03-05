/**
 * Text processing utilities for mention handling, wallet extraction, and content analysis.
 */

export const SOLANA_ADDRESS_REGEX = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

export function cleanMentionText(text: string): string {
  return text.replace(/@\w+/g, '').trim();
}

export function extractWalletAddress(text: string): string | null {
  const matches = text.match(SOLANA_ADDRESS_REGEX);
  if (!matches) return null;
  return matches[0] || null;
}

export function isQuestion(text: string): boolean {
  const cleaned = text.replace(/@\w+/g, '').trim();
  return cleaned.includes('?') || /^(ask|what|why|how|when|where|will|should|can|is|do|does)\b/i.test(cleaned);
}

export function extractTokenMentions(text: string): string[] {
  const matches = text.match(/\$[A-Z]{2,10}/gi);
  return matches ? matches.map(t => t.toUpperCase()) : [];
}

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
