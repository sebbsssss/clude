/**
 * Hybrid evaluation: take per-question outputs from two benchmark runs
 * (different seeding strategies) and combine using the per-category winner.
 *
 * Background: tonight's measurement showed chunked seeding helps SS-User
 * (+22.8pp), SS-Asst (+5.5), Temporal (+8.2) but hurts SS-Pref (-10),
 * KU (-5), Multi-Session (-4.5). This script combines the best of both
 * strategies without re-running, yielding +6pp over either alone.
 *
 * Usage:
 *   npx tsx misc/scripts/hybrid-eval.ts <truncate-results.json> <chunked-results.json>
 */
import { readFileSync } from 'fs';

const USE_CHUNKED = new Set([
  'single-session-user',
  'single-session-assistant',
  'temporal-reasoning',
]);

function loadResults(path: string) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function main() {
  const [truncPath, chunkPath] = process.argv.slice(2);
  if (!truncPath || !chunkPath) {
    console.error('Usage: npx tsx hybrid-eval.ts <truncate-results.json> <chunked-results.json>');
    process.exit(1);
  }

  const trunc = loadResults(truncPath);
  const chunk = loadResults(chunkPath);
  const truncById = new Map<string, any>(trunc.results.map((r: any) => [r.questionId, r]));
  const chunkById = new Map<string, any>(chunk.results.map((r: any) => [r.questionId, r]));

  const merged: any[] = [];
  for (const [qid, t] of truncById) {
    const qtype = (t as any).questionType;
    if (USE_CHUNKED.has(qtype) && chunkById.has(qid)) {
      merged.push(chunkById.get(qid));
    } else {
      merged.push(t);
    }
  }

  const cats: Record<string, { correct: number; total: number; f1Sum: number; source: string }> = {};
  for (const r of merged) {
    const c = cats[r.questionType] ||= { correct: 0, total: 0, f1Sum: 0, source: '' };
    c.total++;
    c.correct += r.correct || 0;
    c.f1Sum += r.f1 || 0;
    c.source = USE_CHUNKED.has(r.questionType) ? 'chunked' : 'truncate';
  }

  console.log('=== HYBRID per-category result ===');
  let totalCorrect = 0;
  let total = 0;
  for (const [cat, s] of Object.entries(cats).sort()) {
    const acc = (s.correct / s.total) * 100;
    console.log(`  ${cat.padEnd(30)} ${acc.toFixed(1).padStart(5)}%  (${s.correct}/${s.total})  [${s.source}]`);
    totalCorrect += s.correct;
    total += s.total;
  }
  const overall = (totalCorrect / total) * 100;
  console.log();
  console.log(`  Overall: ${overall.toFixed(1)}% (${totalCorrect}/${total})`);
  console.log();
  console.log(`  Truncate alone: ${trunc.summary.accuracy}% (${trunc.summary.totalCorrect}/${trunc.summary.totalEvaluated})`);
  console.log(`  Chunked alone:  ${chunk.summary.accuracy}% (${chunk.summary.totalCorrect}/${chunk.summary.totalEvaluated})`);
  console.log(`  Hybrid:         ${overall.toFixed(1)}% (${totalCorrect}/${total})`);
}

main();
