import fs from 'fs';
import path from 'path';
import type { SolanaQA } from '@clude/shared/core/solana-grading';

export type { SolanaQA };

export interface HallucinationData {
  results: Record<string, unknown> | null;
  examples: unknown[];
  qa: SolanaQA[];
}

/**
 * Load the three Solana grounding fixture files from a directory.
 * Each file is guarded individually — a missing or malformed file yields a
 * safe default without throwing. Callers can check `results === null` to
 * detect an unpopulated benchmark dir.
 */
export function loadHallucinationData(dir: string): HallucinationData {
  let results: Record<string, unknown> | null = null;
  let examples: unknown[] = [];
  let qa: SolanaQA[] = [];

  try {
    const raw = fs.readFileSync(path.join(dir, 'solana-grounding-results.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      results = parsed as Record<string, unknown>;
    }
  } catch {
    // Missing or invalid — keep null
  }

  try {
    const raw = fs.readFileSync(path.join(dir, 'solana-grounding-examples.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      examples = parsed;
    }
  } catch {
    // Missing or invalid — keep []
  }

  try {
    const raw = fs.readFileSync(path.join(dir, 'solana-qa.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
      qa = parsed.items as SolanaQA[];
    }
  } catch {
    // Missing or invalid — keep []
  }

  return { results, examples, qa };
}
