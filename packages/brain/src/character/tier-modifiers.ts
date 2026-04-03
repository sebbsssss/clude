export type HolderTier = 'ZERO' | 'SMALL' | 'WHALE' | 'SELLER' | 'UNKNOWN';

function jsonEnv<T>(key: string, fallback: T): T {
  const raw = process.env[key];
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

const tierPrompts: Record<HolderTier, string> = jsonEnv('CLUDE_TIER_MODIFIERS', {
  ZERO: 'Unknown holdings.',
  SMALL: 'Standard holder.',
  WHALE: 'Major holder.',
  SELLER: 'Former holder.',
  UNKNOWN: 'Unknown.',
});

export function getTierModifier(tier: HolderTier): string {
  return tierPrompts[tier];
}
