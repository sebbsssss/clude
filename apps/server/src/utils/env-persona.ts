/**
 * Shared utilities for loading persona content from environment variables.
 * All personality-revealing content lives in CLUDE_* env vars, not in source.
 */

let _instructions: Record<string, string> | null = null;
let _replyPools: Record<string, string[]> | null = null;

function getInstructions(): Record<string, string> {
  if (!_instructions) {
    const raw = process.env.CLUDE_INSTRUCTIONS;
    if (raw) {
      try { _instructions = JSON.parse(raw); } catch { _instructions = {}; }
    } else {
      _instructions = {};
    }
  }
  return _instructions!;
}

function getReplyPools(): Record<string, string[]> {
  if (!_replyPools) {
    const raw = process.env.CLUDE_REPLY_POOLS;
    if (raw) {
      try { _replyPools = JSON.parse(raw); } catch { _replyPools = {}; }
    } else {
      _replyPools = {};
    }
  }
  return _replyPools!;
}

/** Load an instruction string by key, with a generic fallback. */
export function loadInstruction(key: string, fallback: string): string {
  return getInstructions()[key] || fallback;
}

/** Load a reply pool (array of strings) by key, with a generic fallback. */
export function loadReplyPool(key: string, fallback: string[]): string[] {
  return getReplyPools()[key] || fallback;
}
