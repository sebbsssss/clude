#!/usr/bin/env node
/**
 * proof-grounding-sample.mjs
 *
 * Runs a real, reproducible sample of the frozen Solana QA dataset through the
 * LIVE grounding pipeline (POST /api/proof/hallucination/ask) and writes the two
 * fixture files the public /query-demo page reads:
 *   - apps/web/public/proof/solana-grounding-results.json  (summary, placeholder:false)
 *   - apps/web/public/proof/solana-grounding-examples.json (side-by-side array)
 *
 * The endpoint grades deterministically (gradeAnswer + isAbstention) and returns:
 *   { clude:{answer,correct}, baseline:{answer,correct}, hallucinated, groundTruth, sourceRef }
 * where `hallucinated` = CLUDE gave a confident wrong answer (not an abstention).
 *
 * Definitions used here:
 *   - Clude hallucination    = endpoint `hallucinated` (clude confident-wrong)
 *   - Baseline hallucination = baseline.correct === false AND not an abstention
 *
 * Usage:
 *   PROOF_BASE=https://cludebot-test-preview.up.railway.app \
 *   PER_CAT=10 PACE_MS=6500 node scripts/proof-grounding-sample.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROOF_DIR = path.join(ROOT, 'apps', 'web', 'public', 'proof');
const QA_PATH = path.join(PROOF_DIR, 'solana-qa.json');
const RESULTS_OUT = path.join(PROOF_DIR, 'solana-grounding-results.json');
const EXAMPLES_OUT = path.join(PROOF_DIR, 'solana-grounding-examples.json');

const BASE = process.env.PROOF_BASE || 'https://cludebot-test-preview.up.railway.app';
const PER_CAT = Number(process.env.PER_CAT || 10);
const PACE_MS = Number(process.env.PACE_MS || 6500);

// Fallback abstention regex mirroring packages/shared isAbstention. Only used
// when the endpoint does not return baseline.abstained (older deploys). A model
// that says "I don't have access, use an explorer" is declining, not fabricating.
const ABSTAIN = new RegExp(
  [
    "don'?t (have|know)",
    'do not (have|know)',
    "(can'?t|cannot|unable to|not able to) (determine|provide|access|look up|verify|find|query|confirm|tell)",
    'not enough info',
    'no information',
    'insufficient',
    'no access',
    'without access',
    "(don'?t|do not) have (access|the ability|real-?time|enough)",
    'no real-?time',
    "i'?m not able",
    'i am not able',
    'use (a|an|the)? ?(solana |block )?explorer',
    'check (a|an|the)? ?(block )?explorer',
    'you can (use|check)',
    "you'?ll need to",
    'you would need to',
  ].join('|'),
  'i',
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sampleByCategory(items, perCat) {
  const byCat = new Map();
  for (const it of items) {
    if (!byCat.has(it.category)) byCat.set(it.category, []);
    byCat.get(it.category).push(it);
  }
  const out = [];
  for (const [, arr] of byCat) {
    // Even stride so we don't only take the first N (deterministic, no RNG).
    const stride = Math.max(1, Math.floor(arr.length / perCat));
    for (let i = 0, taken = 0; i < arr.length && taken < perCat; i += stride, taken++) {
      out.push(arr[i]);
    }
  }
  return out;
}

async function ask(questionId) {
  for (let attempt = 0; attempt < 6; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}/api/proof/hallucination/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId }),
      });
    } catch (e) {
      await sleep(4000);
      continue;
    }
    if (res.status === 429) {
      await sleep(9000);
      continue;
    }
    if (!res.ok) {
      console.error(`  ERR ${questionId} HTTP ${res.status}`);
      return null;
    }
    return res.json();
  }
  console.error(`  GAVE UP ${questionId}`);
  return null;
}

async function main() {
  const qa = JSON.parse(fs.readFileSync(QA_PATH, 'utf8'));
  const items = Array.isArray(qa) ? qa : qa.items;
  const sample = sampleByCategory(items, PER_CAT);
  console.log(`Dataset ${items.length} items; sampling ${sample.length} (~${PER_CAT}/category) via ${BASE}`);

  const rows = [];
  for (let i = 0; i < sample.length; i++) {
    const it = sample[i];
    const r = await ask(it.id);
    if (r) {
      const baseAns = (r.baseline && r.baseline.answer) || '';
      const cludeAns = (r.clude && r.clude.answer) || '';
      // Prefer the server's authoritative flags (shared isAbstention grader);
      // fall back to the local regex only for older endpoints.
      const baseAbstained = (r.baseline && typeof r.baseline.abstained === 'boolean')
        ? r.baseline.abstained
        : ABSTAIN.test(baseAns);
      const baselineHall = (r.baseline && typeof r.baseline.hallucinated === 'boolean')
        ? r.baseline.hallucinated
        : (r.baseline && r.baseline.correct === false && !baseAbstained);
      const cludeAbstained = (r.clude && typeof r.clude.abstained === 'boolean')
        ? r.clude.abstained
        : ABSTAIN.test(cludeAns);
      // Forced-answer condition (same model, no data, escape hatch removed).
      const forcedAns = (r.forced && r.forced.answer) || '';
      const forcedAbstained = (r.forced && typeof r.forced.abstained === 'boolean')
        ? r.forced.abstained
        : ABSTAIN.test(forcedAns);
      const forcedHall = (r.forced && typeof r.forced.hallucinated === 'boolean')
        ? r.forced.hallucinated
        : (r.forced && r.forced.correct === false && !forcedAbstained);
      rows.push({
        question: r.question || it.question,
        category: it.category,
        sourceRef: r.sourceRef || it.sourceRef || null,
        groundTruth: r.groundTruth ?? it.gold ?? null,
        clude: { answer: cludeAns, correct: r.clude ? r.clude.correct : null, abstained: cludeAbstained },
        baseline: { answer: baseAns, correct: r.baseline ? r.baseline.correct : null, abstained: baseAbstained, hallucinated: !!baselineHall },
        forced: { answer: forcedAns, correct: r.forced ? r.forced.correct : null, abstained: forcedAbstained, hallucinated: !!forcedHall },
        cludeHall: r.hallucinated === true,
        baselineHall: !!baselineHall,
        forcedHall: !!forcedHall,
        baseAbstained,
        forcedAbstained,
      });
      const c = rows[rows.length - 1];
      console.log(`${i + 1}/${sample.length} ${it.category} clude.correct=${c.clude.correct} cludeHall=${c.cludeHall} baseHall=${c.baselineHall} forcedHall=${c.forcedHall} forced.correct=${c.forced.correct}`);
    }
    await sleep(PACE_MS);
  }

  const n = rows.length;
  const cnt = (f) => rows.reduce((a, x) => a + (f(x) ? 1 : 0), 0);
  const rate = n ? cnt((x) => x.cludeHall) / n : 0;            // Clude hallucination rate
  const baselineRate = n ? cnt((x) => x.baselineHall) / n : 0; // baseline (default) hallucination rate
  const forcedRate = n ? cnt((x) => x.forcedHall) / n : 0;     // forced-to-answer hallucination rate
  const cludeAccuracy = n ? cnt((x) => x.clude.correct === true) / n : 0;
  const baselineAccuracy = n ? cnt((x) => x.baseline.correct === true) / n : 0;
  const forcedAccuracy = n ? cnt((x) => x.forced.correct === true) / n : 0;
  const nAbstention = cnt((x) => x.baseAbstained);
  const baselineAbstainRate = n ? nAbstention / n : 0;
  const forcedAbstainRate = n ? cnt((x) => x.forcedAbstained) / n : 0;

  // Per category
  const cats = {};
  for (const x of rows) {
    const c = cats[x.category] || (cats[x.category] = { n: 0, ch: 0, bh: 0, fh: 0, cc: 0, bc: 0, fc: 0 });
    c.n++;
    if (x.cludeHall) c.ch++;
    if (x.baselineHall) c.bh++;
    if (x.forcedHall) c.fh++;
    if (x.clude.correct === true) c.cc++;
    if (x.baseline.correct === true) c.bc++;
    if (x.forced.correct === true) c.fc++;
  }
  const byCategory = {};
  for (const k of Object.keys(cats)) {
    const c = cats[k];
    byCategory[k] = {
      cludeAccuracy: c.cc / c.n,
      baselineAccuracy: c.bc / c.n,
      forcedAccuracy: c.fc / c.n,
      rate: c.ch / c.n,
      baselineRate: c.bh / c.n,
      forcedRate: c.fh / c.n,
      n: c.n,
    };
  }

  const summary = {
    placeholder: false,
    cludeAccuracy,
    baselineAccuracy,
    forcedAccuracy,
    rate,
    baselineRate,
    forcedRate,
    baselineAbstainRate,
    forcedAbstainRate,
    abstentionAccuracy: n ? nAbstention / n : null,
    n,
    nAbstention,
    model: 'anthropic/claude-haiku-4.5',
    datasetVersion: 'crypto_solana_mainnet_us@2025-03-31',
    runAt: new Date().toISOString(),
    note: `Measured live across ${n} questions sampled evenly from the ${items.length}-question frozen dataset, through the same grounding pipeline as the ask demo. Clude grounds on the BigQuery snapshot. Two ungrounded conditions of the SAME model (claude-haiku-4.5): "default" is free to decline, and "forced to answer" has the refer-to-an-explorer escape hatch removed so it must commit to a value. Clude answers from the data; the forced model fabricates because it has no data to ground on.`,
    byCategory,
  };
  fs.writeFileSync(RESULTS_OUT, JSON.stringify(summary, null, 2) + '\n');

  // Examples: every pick is Clude-correct. The right-hand card shows the SAME
  // model FORCED to answer (no data, escape hatch removed), which is where
  // fabrication shows up. Lead with forced-fabrication cases (the contrast), one
  // per category, capped at 6. `hallucinated` = the forced model fabricated.
  const cludeRight = rows.filter((x) => x.clude.correct === true);
  const forcedFab = cludeRight.filter((x) => x.forcedHall);
  const forcedOther = cludeRight.filter((x) => !x.forcedHall);
  const CAP = 6;
  const picked = [];
  const seenCat = new Set();
  // Pass 1: forced-fabrication cases, one per category (most compelling).
  for (const x of forcedFab) {
    if (seenCat.has(x.category)) continue;
    seenCat.add(x.category);
    picked.push(x);
    if (picked.length >= CAP) break;
  }
  // Pass 2: remaining categories (forced model wrong/declined), for variety.
  for (const x of forcedOther) {
    if (picked.length >= CAP) break;
    if (seenCat.has(x.category)) continue;
    seenCat.add(x.category);
    picked.push(x);
  }
  // Pass 3: top up ignoring category if still short of 4.
  for (const x of [...forcedFab, ...forcedOther]) {
    if (picked.length >= Math.min(CAP, 4)) break;
    if (picked.includes(x)) continue;
    picked.push(x);
  }
  const examples = picked.map((x) => ({
    question: x.question,
    category: x.category,
    sourceRef: x.sourceRef,
    groundTruth: x.groundTruth,
    clude: { answer: x.clude.answer, correct: x.clude.correct, abstained: x.clude.abstained },
    // The right card is the FORCED condition (same model, no data, made to commit).
    baseline: { answer: x.forced.answer, correct: x.forced.correct, abstained: x.forcedAbstained, hallucinated: x.forcedHall },
    hallucinated: x.forcedHall,
  }));
  fs.writeFileSync(EXAMPLES_OUT, JSON.stringify(examples, null, 2) + '\n');

  console.log('--- DONE ---');
  console.log(`n=${n}  cludeAccuracy=${(cludeAccuracy * 100).toFixed(1)}%  baselineAccuracy=${(baselineAccuracy * 100).toFixed(1)}%  forcedAccuracy=${(forcedAccuracy * 100).toFixed(1)}%`);
  console.log(`cludeHall=${(rate * 100).toFixed(1)}%  baselineHall=${(baselineRate * 100).toFixed(1)}%  forcedHall=${(forcedRate * 100).toFixed(1)}%  baselineAbstained=${nAbstention}/${n}  forcedAbstained=${cnt((x)=>x.forcedAbstained)}/${n}`);
  console.log(`examples=${examples.length}`);
  console.log(`wrote:\n  ${RESULTS_OUT}\n  ${EXAMPLES_OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
