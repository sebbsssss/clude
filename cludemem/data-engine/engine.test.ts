import { SEED_SCRIPTS } from './life-script';
import { generateScripts } from './script-generator';
import { TemplateRenderer } from './render';
import { deriveExamples } from './derive';
import { runGauntlet } from './gauntlet';
import * as gauntlet from './gauntlet';
import type { Example, TaskName } from './taxonomy';

// ============================================================
// CludeMem data-engine "v1" invariants (design Sections 5-6).
//
//   npx tsx cludemem/data-engine/engine.test.ts
//
// No vitest in this standalone dir; this self-runs via tsx and exits non-zero
// on any failure, same idiom as generate.ts. Deterministic (seeded), so a green
// run is a real regression guard, not a flake.
// ============================================================

let passes = 0;
let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passes++;
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`FAIL   ${name}${detail ? `  — ${detail}` : ''}`);
  }
}

async function buildCorpus(count: number, seed: number) {
  const scripts = [...SEED_SCRIPTS, ...generateScripts(count, seed)];
  const renderer = new TemplateRenderer();
  const all: Example[] = [];
  for (const s of scripts) all.push(...(await deriveExamples(s, renderer)));
  return { scripts, all };
}

async function main() {
  const { scripts, all } = await buildCorpus(150, 7);
  const { kept, rejected } = runGauntlet(all);
  const byTask = (t: TaskName | string) => kept.filter((e) => e.task === t);
  const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(0)}%` : 'n/a');

  // Template-rendered data must be perfectly clean (labels are planted).
  check('template path: 0 gauntlet rejections', rejected.length === 0, rejected.slice(0, 3).map((r) => r.reason).join(' | '));

  // --- 1. COMPACT task exists (design Section 5, task #6) ---
  check('COMPACT examples generated', byTask('COMPACT').length > 0, `got ${byTask('COMPACT').length}`);

  // --- 2. TEMPORAL links are populated (not always []) ---
  const temporal = byTask('TEMPORAL');
  const withLinks = temporal.filter((e) => ((e.output as { links: unknown[] }).links?.length ?? 0) > 0);
  check('TEMPORAL: some examples carry temporal links', withLinks.length > 0, `${withLinks.length}/${temporal.length} have links`);
  // links must reference ids present in the prompt + use a valid bond type (gauntlet enforces; double-check here)
  const linkIdsGrounded = withLinks.every((e) =>
    (e.output as { links: { target: string }[] }).links.every((l) => e.input.includes(`[${l.target}]`)),
  );
  check('TEMPORAL: link targets are grounded in the prompt', withLinks.length > 0 && linkIdsGrounded);

  // --- 3. QUERY temporal_constraints populated for temporal questions ---
  const queries = byTask('QUERY');
  const withConstraint = queries.filter((e) => {
    const c = (e.output as { temporal_constraints: { after: string | null; before: string | null } }).temporal_constraints;
    return !!(c && (c.after || c.before));
  });
  check('QUERY: temporal questions get non-null temporal_constraints', withConstraint.length > 0, `${withConstraint.length}/${queries.length}`);

  // --- 4. Hard-negative variety + ratio (design 6.1) ---
  const negs = scripts.flatMap((s) => s.qa).filter((qa) => !qa.answerable);
  const kinds = new Set(negs.map((qa) => qa.negativeKind));
  check('hard negatives include temporal_near_miss', kinds.has('temporal_near_miss'));
  check('hard negatives include wrong_session', kinds.has('wrong_session'));
  const hard = negs.filter((qa) => qa.negativeKind && qa.negativeKind !== 'absent');
  check('>=50% of unanswerables are hard negatives', negs.length > 0 && hard.length / negs.length >= 0.5, `${hard.length}/${negs.length} = ${pct(hard.length, negs.length)}`);

  // --- 5. Register noise on 20-30% of dialogues (design 6.1), labels still clean ---
  const extracts = byTask('EXTRACT');
  const noiseMarker = /```|\| ---|\bDEBUG\b|\bWARN\b|\{"|\t/;
  const noisy = extracts.filter((e) => noiseMarker.test(e.input));
  check('register noise present on a meaningful fraction of EXTRACT blocks', noisy.length / extracts.length >= 0.15, `${noisy.length}/${extracts.length} = ${pct(noisy.length, extracts.length)}`);
  check('register noise stays within ~40% of dialogues', noisy.length / extracts.length <= 0.4, pct(noisy.length, extracts.length));

  // --- 6. Length stratification: long inputs for the long-context tasks (design 6.1) ---
  const longTasks = kept.filter((e) => e.task === 'CONSOLIDATE' || e.task === 'COMPACT' || e.task === 'ANSWER');
  const longOnes = longTasks.filter((e) => e.input.length >= 4000);
  check('>=20% of long-context-task examples are >=4000 chars', longTasks.length > 0 && longOnes.length / longTasks.length >= 0.2, `${longOnes.length}/${longTasks.length} = ${pct(longOnes.length, longTasks.length)}`);

  // --- 7. Difficulty quota: >=40% of facts rendered non-explicitly (design 6.1) ---
  const facts = scripts.flatMap((s) => s.facts);
  const nonExplicit = facts.filter((f) => f.renderStyle !== 'explicit');
  check('>=40% of facts use a non-explicit render style', nonExplicit.length / facts.length >= 0.4, pct(nonExplicit.length, facts.length));

  // --- 8. Decontamination layer exists + works (design 6.3) ---
  const decon = (gauntlet as { decontaminate?: (text: string) => { ok: boolean; reason?: string } }).decontaminate;
  check('decontaminate() is exported', typeof decon === 'function');
  if (typeof decon === 'function') {
    check('decontaminate flags a blocklisted eval persona name', decon('Caroline went to the concert in 2023.').ok === false);
    check('decontaminate passes clean synthetic text', decon('Maya moved to Lisbon on 2026-02-10.').ok === true);
  }

  // --- 9. RECONCILE verdict variety (design Section 5, task #7) ---
  const verdicts = new Set(byTask('RECONCILE').map((e) => (e.output as { verdict: string }).verdict));
  check('RECONCILE emits a duplicate verdict somewhere', verdicts.has('duplicate'), [...verdicts].join(','));
  check('RECONCILE emits a consistent verdict somewhere', verdicts.has('consistent'), [...verdicts].join(','));

  // --- 10. CLASSIFY carries emotional_valence (design Section 5, task #1) ---
  const classify = byTask('CLASSIFY');
  const haveValence = classify.filter((e) => typeof (e.output as { emotional_valence?: unknown }).emotional_valence === 'number');
  check('every CLASSIFY example has a numeric emotional_valence', classify.length > 0 && haveValence.length === classify.length, `${haveValence.length}/${classify.length}`);

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
