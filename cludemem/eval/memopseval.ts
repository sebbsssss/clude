import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { TASK_SCHEMAS, type TaskName } from '../data-engine/taxonomy';

// ============================================================
// MemOpsEval — per-task gate for CludeMem.
//
//   npx tsx cludemem/eval/memopseval.ts --model cludemem-e4b --data cludemem/data/heldout.jsonl
//
// Calls a local Ollama model per example, scores per-task accuracy +
// schema-adherence + abstention calibration against the planted gold.
// Needs Ollama + the model (the GPU/Ollama stage). See design Section 8.1.
// ============================================================

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';

interface ChatRow {
  messages: { role: string; content: string }[];
  task: TaskName;
  meta?: { answerable?: boolean };
}

function arg(name: string, def?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : (def ?? '');
}

async function callModel(model: string, system: string, user: string, schema: unknown): Promise<unknown> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: false,
      format: schema,
      options: { temperature: 0 },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}`);
  const data = (await res.json()) as { message?: { content?: string } };
  return JSON.parse(data.message?.content ?? '{}');
}

// Per-task correctness: compare the load-bearing fields to gold.
function score(task: TaskName, gold: any, pred: any): boolean {
  switch (task) {
    case 'CLASSIFY':
      return gold.type === pred.type;
    case 'TEMPORAL':
      return gold.event_date === pred.event_date && gold.precision === pred.precision;
    case 'RECONCILE':
      return gold.verdict === pred.verdict && gold.weaker_id === pred.weaker_id;
    case 'ENTITIES': {
      const g = new Set((gold.entities ?? []).map((e: any) => e.name.toLowerCase()));
      const p = new Set((pred.entities ?? []).map((e: any) => e.name.toLowerCase()));
      return [...g].every((n) => p.has(n));
    }
    case 'EXTRACT': {
      const g = (gold.memories ?? []).map((m: any) => m.type).sort();
      const p = (pred.memories ?? []).map((m: any) => m.type).sort();
      return JSON.stringify(g) === JSON.stringify(p);
    }
    case 'CONSOLIDATE': {
      const g = new Set((gold.insights ?? []).flatMap((i: any) => i.evidence));
      const p = new Set((pred.insights ?? []).flatMap((i: any) => i.evidence));
      return [...g].some((e) => p.has(e));
    }
    case 'QUERY':
      return gold.intent === pred.intent;
    case 'ANSWER':
      if (gold.abstain !== pred.abstain) return false;
      if (gold.abstain) return true; // correct refusal
      return typeof pred.answer === 'string' && pred.answer.toLowerCase().includes(String(gold.answer).toLowerCase());
    default:
      return false;
  }
}

async function main() {
  const model = arg('model', 'cludemem-e4b');
  const dataPath = arg('data', 'cludemem/data/heldout.jsonl');
  const rows = readFileSync(dataPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as ChatRow);

  const stat: Record<string, { n: number; correct: number; schemaOk: number }> = {};
  let abstainTotal = 0, abstainCorrect = 0;

  for (const r of rows) {
    const [sys, usr, asst] = r.messages;
    const gold = JSON.parse(asst.content);
    const schema = TASK_SCHEMAS[r.task];
    const s = (stat[r.task] ??= { n: 0, correct: 0, schemaOk: 0 });
    s.n++;
    try {
      const pred = await callModel(model, sys.content, usr.content, z.toJSONSchema(schema));
      if (schema.safeParse(pred).success) s.schemaOk++;
      if (score(r.task, gold, pred)) s.correct++;
      if (r.task === 'ANSWER' && r.meta && r.meta.answerable === false) {
        abstainTotal++;
        if ((pred as any).abstain === true) abstainCorrect++;
      }
    } catch (e) {
      // schema/parse failure counts as incorrect (schemaOk not incremented)
    }
  }

  console.log(`MemOpsEval — model=${model}  n=${rows.length}`);
  let totN = 0, totC = 0;
  for (const [task, s] of Object.entries(stat)) {
    totN += s.n; totC += s.correct;
    console.log(`  ${task.padEnd(12)} acc=${pct(s.correct, s.n)}  schema=${pct(s.schemaOk, s.n)}  (n=${s.n})`);
  }
  console.log(`  ${'OVERALL'.padEnd(12)} acc=${pct(totC, totN)}`);
  if (abstainTotal) console.log(`  abstention   ${pct(abstainCorrect, abstainTotal)} of ${abstainTotal} unanswerable correctly refused`);
}

function pct(a: number, b: number): string {
  return b ? `${((100 * a) / b).toFixed(1)}%` : 'n/a';
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
