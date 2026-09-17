// ============================================================
// Register noise (design Section 6.1).
//
// Real agent-memory inputs are not clean prose — they carry tool output, logs,
// markdown tables, code fences, JSON. We inject that texture into ~20-30% of
// dialogue blocks so the model learns to extract facts from messy context.
//
// Noise is added AROUND the planted utterances, never inside them, so labels
// stay exact by construction (the gauntlet's groundedness checks still hold).
// ============================================================

// Deterministic string-seeded PRNG so a given (scriptId, session) always noises
// the same way — reproducible corpora, no Math.random.
export function seededRng(seedStr: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ARTIFACTS: ((r: () => number) => string)[] = [
  // code fence (tool transcript)
  () => '```\n$ deploy --env prod\nbuild ok\nexit 0\n```',
  // markdown table
  () => '| metric | value |\n| --- | --- |\n| latency_ms | 42 |\n| status | ok |',
  // log lines
  (r) => `[2026-0${1 + Math.floor(r() * 8)}-15T09:00:00Z] ${r() < 0.5 ? 'DEBUG' : 'WARN'} worker: queue drained`,
  // tool-output JSON
  (r) => `{"tool":"search","status":"${r() < 0.5 ? 'ok' : 'WARN'}","hits":${Math.floor(r() * 5)}}`,
];

/**
 * Wrap a rendered dialogue block in one register-noise artifact (before or
 * after). The planted utterances are untouched, so extraction labels stay exact.
 */
export function applyRegisterNoise(block: string, r: () => number): string {
  const artifact = ARTIFACTS[Math.floor(r() * ARTIFACTS.length)](r);
  return r() < 0.5 ? `${artifact}\n${block}` : `${block}\n${artifact}`;
}
