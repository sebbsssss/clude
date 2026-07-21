import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { SEED_SCRIPTS, type PlantedFact } from './life-script';
import { generateScripts } from './script-generator';
import { TemplateRenderer, TeacherRenderer, PrerenderedRenderer, type Renderer } from './render';
import { makeTeacher } from './teacher';
import { deriveExamples } from './derive';
import { runGauntlet } from './gauntlet';
import type { Example, TaskName } from './taxonomy';
import { seededRng } from './noise';

// Load worktree-root .env so --teacher can read TEACHER_* creds (never committed).
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

// --count N  add N combinatorially-generated scripts (the volume lever).
// --seed S   batch seed (use different seeds for disjoint shards / dev vs test).
function argNum(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
}

// Bounded-concurrency map: run `fn` over `items` with at most `limit` in flight.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i], i);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

// ============================================================
// Build a CludeMem training shard from the planted scripts.
//
//   npx tsx cludemem/data-engine/generate.ts
//
// Offline + deterministic (TemplateRenderer). Emits chat-format JSONL and
// runs the verification gauntlet + self-check assertions, so running it IS
// the test. For scale, swap TemplateRenderer -> TeacherRenderer (DeepSeek/Qwen)
// and multiply scripts; the gauntlet stays identical.
// ============================================================

function toChat(ex: Example) {
  return {
    messages: [
      { role: 'system', content: ex.system },
      { role: 'user', content: ex.input },
      { role: 'assistant', content: JSON.stringify(ex.output) },
    ],
    task: ex.task,
    meta: ex.meta,
  };
}

// Per-task quota balancer (--balance): seeded-shuffle each task's pool and keep up
// to its target. CLASSIFY/ENTITIES are 1 per fact (abundant); COMPACT/CONSOLIDATE
// are ~1 per script (rare), so raising the rare ones needs MORE SCRIPTS (--count),
// and this trims the abundant ones down. Without it the abundant tasks swamp the
// corpus (~21x) and the model overtrains on them. Runs AFTER the gauntlet +
// self-checks, so those still validate the full generated set; balancing only
// shapes what gets written.
const BALANCE_TARGETS: Record<TaskName, number> = {
  CLASSIFY: 8000, ENTITIES: 8000, TEMPORAL: 8000,
  QUERY: 6000, ANSWER: 6000, EXTRACT: 5000,
  RECONCILE: 3000, CONSOLIDATE: 2500, COMPACT: 2500,
};
function balanceExamplesByTask(examples: Example[], seed: number): Example[] {
  const rng = seededRng(`balance:${seed}`);
  const byTask = new Map<TaskName, Example[]>();
  for (const e of examples) (byTask.get(e.task) ?? byTask.set(e.task, []).get(e.task)!).push(e);
  const out: Example[] = [];
  for (const [task, pool] of byTask) {
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    out.push(...pool.slice(0, BALANCE_TARGETS[task] ?? pool.length));
  }
  return out;
}

async function main() {
  const count = argNum('count', 0);
  const seed = argNum('seed', 0);
  const useTeacher = process.argv.includes('--teacher');
  // --no-seeds excludes the 2 hand-authored SEED_SCRIPTS so a held-out shard
  // (a different --seed) stays fully disjoint from the training shard.
  const noSeeds = process.argv.includes('--no-seeds');
  const scripts = [...(noSeeds ? [] : SEED_SCRIPTS), ...generateScripts(count, seed)];

  let renderer: Renderer;
  if (useTeacher) {
    const apiKey = process.env.TEACHER_API_KEY;
    if (!apiKey) {
      console.error('--teacher needs TEACHER_API_KEY in .env');
      process.exit(1);
    }
    const t = makeTeacher({ apiKey, baseUrl: process.env.TEACHER_BASE_URL, model: process.env.TEACHER_MODEL });
    const teacher = new TeacherRenderer(t.complete, t.model);
    const fallback = new TemplateRenderer();
    const conc = argNum('concurrency', 8);
    const allFacts: PlantedFact[] = scripts.flatMap((s) => s.facts);
    console.log(`rendering ${allFacts.length} facts with teacher ${t.model} (concurrency ${conc})`);
    let done = 0;
    let failed = 0;
    const rendered = await mapPool(allFacts, conc, async (f) => {
      let out: string;
      try {
        out = await teacher.render(f);
      } catch {
        failed++;
        out = fallback.render(f); // graceful: a failed teacher call degrades to template
      }
      if (++done % 1000 === 0) console.log(`  rendered ${done}/${allFacts.length}${failed ? ` (${failed} fell back)` : ''}`);
      return out;
    });
    const map = new Map<PlantedFact, string>();
    allFacts.forEach((f, i) => map.set(f, rendered[i]));
    if (failed) console.log(`  note: ${failed}/${allFacts.length} renders fell back to template (teacher errors)`);
    renderer = new PrerenderedRenderer(map);
  } else {
    renderer = new TemplateRenderer();
  }

  const all: Example[] = [];
  for (const script of scripts) {
    all.push(...(await deriveExamples(script, renderer)));
  }

  const { kept, rejected } = runGauntlet(all);

  // Self-checks: the whole pipeline is correct iff these hold.
  const tasksSeen = new Set(kept.map((e) => e.task));
  const expectTasks: TaskName[] = ['CLASSIFY', 'EXTRACT', 'ENTITIES', 'TEMPORAL', 'CONSOLIDATE', 'COMPACT', 'RECONCILE', 'QUERY', 'ANSWER'];
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`SELF-CHECK FAILED: ${msg}`);
      process.exit(1);
    }
  };
  assert(kept.length > 0, 'no examples produced');
  // Template data must be perfectly clean; teacher-rendered data is EXPECTED to
  // have some gauntlet rejections (drift) — that's the gauntlet doing its job.
  if (!useTeacher) {
    assert(rejected.length === 0, `template data should fully pass the gauntlet, but ${rejected.length} rejected: ${rejected.slice(0, 3).map((r) => r.reason).join(' | ')}`);
  }
  for (const t of expectTasks) assert(tasksSeen.has(t), `task ${t} not represented`);
  // Abstention coverage: at least one trained refusal.
  assert(kept.some((e) => e.task === 'ANSWER' && (e.output as { abstain: boolean }).abstain), 'no abstention examples');

  // v1 difficulty quotas (design 6.1) — enforced at scale, where ratios are meaningful.
  if (count > 0) {
    const allFacts = scripts.flatMap((s) => s.facts);
    const nonExplicit = allFacts.filter((f) => f.renderStyle !== 'explicit').length;
    assert(nonExplicit / allFacts.length >= 0.4, `difficulty quota: only ${((100 * nonExplicit) / allFacts.length).toFixed(0)}% of facts non-explicit (<40%)`);

    const negs = scripts.flatMap((s) => s.qa).filter((q) => !q.answerable);
    const hardNeg = negs.filter((q) => q.negativeKind && q.negativeKind !== 'absent').length;
    assert(negs.length > 0 && hardNeg / negs.length >= 0.5, `hard-negative quota: only ${((100 * hardNeg) / Math.max(1, negs.length)).toFixed(0)}% of unanswerables are hard negatives (<50%)`);

    const longTasks = kept.filter((e) => e.task === 'CONSOLIDATE' || e.task === 'COMPACT' || e.task === 'ANSWER');
    const longOnes = longTasks.filter((e) => e.input.length >= 4000).length;
    assert(longTasks.length > 0 && longOnes / longTasks.length >= 0.2, `length stratification: only ${((100 * longOnes) / Math.max(1, longTasks.length)).toFixed(0)}% of long-context examples >=4000 chars (<20%)`);
  }

  // Optional per-task balancing (--balance): shape the written shard's task mix.
  const doBalance = process.argv.includes('--balance');
  const emitted = doBalance ? balanceExamplesByTask(kept, seed) : kept;

  // Write the shard. Default smoke -> sample.jsonl (committed, small);
  // any scaled run -> train.jsonl (gitignored). Override with --out <file>.
  const outArgIdx = process.argv.indexOf('--out');
  const outName =
    outArgIdx >= 0 ? process.argv[outArgIdx + 1] : useTeacher ? 'teacher-sample.jsonl' : count > 0 ? 'train.jsonl' : 'sample.jsonl';
  const outDir = fileURLToPath(new URL('../data/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}${outName}`;
  writeFileSync(outPath, emitted.map((e) => JSON.stringify(toChat(e))).join('\n') + '\n');

  // Summary.
  const perTask = expectTasks
    .map((t) => `${t}=${emitted.filter((e) => e.task === t).length}`)
    .join('  ');
  const rate = all.length ? ((100 * rejected.length) / all.length).toFixed(1) : '0';
  console.log(`CludeMem data engine — wrote ${emitted.length} examples (${rejected.length} rejected, ${rate}%) to ${outPath}`);
  console.log(`  scripts: ${scripts.length}   renderer: ${useTeacher ? 'teacher' : 'template'}   tasks: ${perTask}`);
  if (rejected.length) console.log(`  sample rejections: ${rejected.slice(0, 3).map((r) => r.reason).join(' | ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
