import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SEED_SCRIPTS } from './life-script';
import { TemplateRenderer } from './render';
import { deriveExamples } from './derive';
import { runGauntlet } from './gauntlet';
import type { Example, TaskName } from './taxonomy';

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

async function main() {
  const renderer = new TemplateRenderer();
  const all: Example[] = [];
  for (const script of SEED_SCRIPTS) {
    all.push(...(await deriveExamples(script, renderer)));
  }

  const { kept, rejected } = runGauntlet(all);

  // Self-checks: the whole pipeline is correct iff these hold.
  const tasksSeen = new Set(kept.map((e) => e.task));
  const expectTasks: TaskName[] = ['CLASSIFY', 'EXTRACT', 'ENTITIES', 'TEMPORAL', 'CONSOLIDATE', 'RECONCILE', 'QUERY', 'ANSWER'];
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error(`SELF-CHECK FAILED: ${msg}`);
      process.exit(1);
    }
  };
  assert(kept.length > 0, 'no examples produced');
  assert(rejected.length === 0, `template data should fully pass the gauntlet, but ${rejected.length} rejected: ${rejected.slice(0, 3).map((r) => r.reason).join(' | ')}`);
  for (const t of expectTasks) assert(tasksSeen.has(t), `task ${t} not represented`);
  // Abstention coverage: at least one trained refusal.
  assert(kept.some((e) => e.task === 'ANSWER' && (e.output as { abstain: boolean }).abstain), 'no abstention examples');

  // Write the shard.
  const outDir = fileURLToPath(new URL('../data/', import.meta.url));
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}sample.jsonl`;
  writeFileSync(outPath, kept.map((e) => JSON.stringify(toChat(e))).join('\n') + '\n');

  // Summary.
  const perTask = expectTasks
    .map((t) => `${t}=${kept.filter((e) => e.task === t).length}`)
    .join('  ');
  console.log(`CludeMem data engine — wrote ${kept.length} examples (0 rejected) to ${outPath}`);
  console.log(`  scripts: ${SEED_SCRIPTS.length}   tasks: ${perTask}`);
  console.log(`  (offline TemplateRenderer; swap in TeacherRenderer + more scripts for scale)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
