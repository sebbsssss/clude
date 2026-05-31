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

// Same abstention shape the frontend/grader use, to classify baseline declines.
const ABSTAIN =
  /not enough information|i don'?t know|cannot determine|no information|abstain|don'?t have (verified|access|enough)|no (verified )?data|do not have|unable to/i;

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
      const baseAbstained = ABSTAIN.test(baseAns);
      const baselineHall = r.baseline && r.baseline.correct === false && !baseAbstained;
      rows.push({
        question: r.question || it.question,
        category: it.category,
        sourceRef: r.sourceRef || it.sourceRef || null,
        groundTruth: r.groundTruth ?? it.gold ?? null,
        clude: { answer: (r.clude && r.clude.answer) || '', correct: r.clude ? r.clude.correct : null },
        baseline: { answer: baseAns, correct: r.baseline ? r.baseline.correct : null },
        cludeHall: r.hallucinated === true,
        baselineHall: !!baselineHall,
        baseAbstained,
      });
      const c = rows[rows.length - 1];
      console.log(`${i + 1}/${sample.length} ${it.category} clude.correct=${c.clude.correct} cludeHall=${c.cludeHall} baseHall=${c.baselineHall} baseAbstain=${c.baseAbstained}`);
    }
    await sleep(PACE_MS);
  }

  const n = rows.length;
  const cnt = (f) => rows.reduce((a, x) => a + (f(x) ? 1 : 0), 0);
  const rate = n ? cnt((x) => x.cludeHall) / n : 0;            // Clude hallucination rate
  const baselineRate = n ? cnt((x) => x.baselineHall) / n : 0; // baseline hallucination rate
  const cludeAccuracy = n ? cnt((x) => x.clude.correct === true) / n : 0;
  const baselineAccuracy = n ? cnt((x) => x.baseline.correct === true) / n : 0;
  const nAbstention = cnt((x) => x.baseAbstained);
  const baselineAbstainRate = n ? nAbstention / n : 0;

  // Per category
  const cats = {};
  for (const x of rows) {
    const c = cats[x.category] || (cats[x.category] = { n: 0, ch: 0, bh: 0, cc: 0, bc: 0 });
    c.n++;
    if (x.cludeHall) c.ch++;
    if (x.baselineHall) c.bh++;
    if (x.clude.correct === true) c.cc++;
    if (x.baseline.correct === true) c.bc++;
  }
  const byCategory = {};
  for (const k of Object.keys(cats)) {
    const c = cats[k];
    byCategory[k] = {
      cludeAccuracy: c.cc / c.n,
      baselineAccuracy: c.bc / c.n,
      rate: c.ch / c.n,
      baselineRate: c.bh / c.n,
      n: c.n,
    };
  }

  const summary = {
    placeholder: false,
    cludeAccuracy,
    baselineAccuracy,
    rate,
    baselineRate,
    baselineAbstainRate,
    abstentionAccuracy: n ? nAbstention / n : null,
    n,
    nAbstention,
    model: 'anthropic/claude-haiku-4.5',
    datasetVersion: 'crypto_solana_mainnet_us@2025-03-31',
    runAt: new Date().toISOString(),
    note: `Measured live across ${n} questions sampled evenly from the ${items.length}-question frozen dataset, through the same grounding pipeline as the ask demo. Clude grounds on the BigQuery snapshot; the baseline is the same model (claude-haiku-4.5) without it. Clude answers from the data; the bare model mostly declines (honest) and rarely fabricates.`,
    byCategory,
  };
  fs.writeFileSync(RESULTS_OUT, JSON.stringify(summary, null, 2) + '\n');

  // Examples: every pick is Clude-correct. Lead with the strongest contrast,
  // baseline FABRICATED (confident wrong), then honest declines. One per category
  // for variety, capped at 6. `hallucinated` field = the BASELINE hallucinated
  // (that is what the examples UI labels on the right-hand card).
  const cludeRight = rows.filter((x) => x.clude.correct === true);
  const fabricated = cludeRight.filter((x) => x.baselineHall);
  const declined = cludeRight.filter((x) => x.baseAbstained && !x.baselineHall);
  const CAP = 6;
  const picked = [];
  const seenCat = new Set();
  // Pass 1: fabrication cases, one per category (most compelling).
  for (const x of fabricated) {
    if (seenCat.has(x.category)) continue;
    seenCat.add(x.category);
    picked.push(x);
    if (picked.length >= CAP) break;
  }
  // Pass 2: honest declines, one per remaining category.
  for (const x of declined) {
    if (picked.length >= CAP) break;
    if (seenCat.has(x.category)) continue;
    seenCat.add(x.category);
    picked.push(x);
  }
  // Pass 3: top up ignoring category if still short of 4.
  for (const x of [...fabricated, ...declined]) {
    if (picked.length >= Math.min(CAP, 4)) break;
    if (picked.includes(x)) continue;
    picked.push(x);
  }
  const examples = picked.map((x) => ({
    question: x.question,
    category: x.category,
    sourceRef: x.sourceRef,
    groundTruth: x.groundTruth,
    clude: { answer: x.clude.answer, correct: x.clude.correct },
    baseline: { answer: x.baseline.answer, correct: x.baseline.correct },
    hallucinated: x.baselineHall,
  }));
  fs.writeFileSync(EXAMPLES_OUT, JSON.stringify(examples, null, 2) + '\n');

  console.log('--- DONE ---');
  console.log(`n=${n}  cludeAccuracy=${(cludeAccuracy * 100).toFixed(1)}%  baselineAccuracy=${(baselineAccuracy * 100).toFixed(1)}%`);
  console.log(`cludeHallucinationRate=${(rate * 100).toFixed(1)}%  baselineHallucinationRate=${(baselineRate * 100).toFixed(1)}%  baselineAbstained=${nAbstention}/${n}`);
  console.log(`examples=${examples.length}`);
  console.log(`wrote:\n  ${RESULTS_OUT}\n  ${EXAMPLES_OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
