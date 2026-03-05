import { pickRandom } from '../utils/text';

/**
 * All persona content is loaded from environment variables.
 * See Railway dashboard for the actual values.
 * Fallbacks are generic stubs for SDK users / local dev.
 */

function jsonEnv<T>(key: string, fallback: T): T {
  const raw = process.env[key];
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

const VOICE_FLAVORS: string[] = jsonEnv('CLUDE_VOICE_FLAVORS', [
  'Respond helpfully and clearly.',
  'Be concise and technically precise.',
]);

const STRUCTURAL_PATTERNS: string[] = jsonEnv('CLUDE_STRUCTURAL_PATTERNS', [
  'Answer directly, then add context.',
  'Lead with the key insight.',
]);

const CLOSERS: string[] = jsonEnv('CLUDE_CLOSERS', ['', '', '']);

export function getBasePrompt(): string {
  const template = process.env.CLUDE_SYSTEM_PROMPT;
  if (!template) {
    return 'You are an AI assistant with persistent memory.';
  }

  const flavor = pickRandom(VOICE_FLAVORS);
  const structure = pickRandom(STRUCTURAL_PATTERNS);

  return template
    .replace('{{VOICE_FLAVOR}}', flavor)
    .replace('{{STRUCTURAL_PATTERN}}', structure);
}

export function getRandomCloser(): string {
  return pickRandom(CLOSERS);
}
