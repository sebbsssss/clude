import { Mood } from '../core/price-oracle';
import { pickRandom } from '../utils/text';

function jsonEnv<T>(key: string, fallback: T): T {
  const raw = process.env[key];
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

const moodPrompts: Record<Mood, string[]> = jsonEnv('CLUDE_MOOD_MODIFIERS', {
  PUMPING: ['Market is up.'],
  DUMPING: ['Market is down.'],
  SIDEWAYS: ['Market is flat.'],
  NEW_ATH: ['New all-time high.'],
  WHALE_SELL: ['Whale sell detected.'],
  NEUTRAL: ['Normal conditions.'],
});

export function getMoodModifier(mood: Mood): string {
  return pickRandom(moodPrompts[mood]);
}
