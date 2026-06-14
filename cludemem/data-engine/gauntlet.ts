import { TASK_SCHEMAS, type Example } from './taxonomy';

// ============================================================
// Verification gauntlet.
//
// Every example must pass before it enters the corpus. For template-rendered
// data these checks should all pass (labels are planted). For teacher-rendered
// data they catch schema drift, hallucinated citations, and abstention bugs —
// expect to discard 50-80% there (NuExtract-style rejection sampling).
// ============================================================

export interface GauntletResult {
  ok: boolean;
  reason?: string;
}

export function validateExample(ex: Example): GauntletResult {
  const schema = TASK_SCHEMAS[ex.task];
  const parsed = schema.safeParse(ex.output);
  if (!parsed.success) {
    return { ok: false, reason: `schema: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` };
  }

  if (ex.task === 'ANSWER') {
    const o = ex.output as { citations: string[]; abstain: boolean };
    for (const c of o.citations) {
      if (!ex.input.includes(`[${c}]`)) return { ok: false, reason: `citation ${c} not grounded in context` };
    }
    if (o.abstain && o.citations.length) return { ok: false, reason: 'abstain=true but has citations' };
    if (!o.abstain && o.citations.length === 0) return { ok: false, reason: 'answer without citations' };
  }

  if (ex.task === 'CONSOLIDATE') {
    const o = ex.output as { insights: { evidence: string[] }[] };
    for (const ins of o.insights) {
      for (const e of ins.evidence) {
        if (!ex.input.includes(`[${e}]`)) return { ok: false, reason: `evidence ${e} not in corpus` };
      }
    }
  }

  return { ok: true };
}

export function runGauntlet(examples: Example[]): {
  kept: Example[];
  rejected: { ex: Example; reason: string }[];
} {
  const kept: Example[] = [];
  const rejected: { ex: Example; reason: string }[] = [];
  for (const ex of examples) {
    const r = validateExample(ex);
    if (r.ok) kept.push(ex);
    else rejected.push({ ex, reason: r.reason! });
  }
  return { kept, rejected };
}
