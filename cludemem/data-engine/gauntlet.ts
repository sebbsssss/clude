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

// Known eval-set persona names + n-grams to keep OUT of training data (design
// 6.3, decontamination). Seeded with illustrative LoCoMo/LongMemEval persona
// names; the full n-gram + embedding decontamination set plugs in here in W1.
// Synthetic generator names are disjoint from this list, so template data passes
// clean.
const EVAL_NAME_BLOCKLIST = ['caroline', 'melanie', 'angela', 'joanna', 'hannah', 'gabriella'];
const EVAL_NGRAMS: string[] = [];

/** Reject text that overlaps a known evaluation set (benchmark-leakage guard). */
export function decontaminate(text: string): GauntletResult {
  const lower = text.toLowerCase();
  for (const name of EVAL_NAME_BLOCKLIST) {
    if (new RegExp(`\\b${name}\\b`).test(lower)) {
      return { ok: false, reason: `decontamination: eval persona name "${name}"` };
    }
  }
  for (const ng of EVAL_NGRAMS) {
    if (lower.includes(ng.toLowerCase())) return { ok: false, reason: 'decontamination: eval n-gram overlap' };
  }
  return { ok: true };
}

export function validateExample(ex: Example): GauntletResult {
  const schema = TASK_SCHEMAS[ex.task];
  const parsed = schema.safeParse(ex.output);
  if (!parsed.success) {
    return { ok: false, reason: `schema: ${parsed.error.issues[0]?.path.join('.')} ${parsed.error.issues[0]?.message}` };
  }

  // Benchmark-leakage guard on the rendered input.
  const clean = decontaminate(ex.input);
  if (!clean.ok) return clean;

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

  // Groundedness: an entity label must survive into the (possibly teacher-paraphrased)
  // input. Proper nouns survive paraphrase, so this catches a teacher that dropped
  // an entity — the main way teacher rendering corrupts an otherwise-exact label.
  if (ex.task === 'ENTITIES') {
    const o = ex.output as { entities: { name: string }[] };
    for (const e of o.entities) {
      if (!ex.input.toLowerCase().includes(e.name.toLowerCase())) {
        return { ok: false, reason: `entity "${e.name}" not grounded in rendered input` };
      }
    }
  }

  // TEMPORAL: every temporal link must point at an event id present in the prompt.
  if (ex.task === 'TEMPORAL') {
    const o = ex.output as { links: { target: string }[] };
    for (const l of o.links) {
      if (!ex.input.includes(`[${l.target}]`)) return { ok: false, reason: `temporal link target ${l.target} not in prompt` };
    }
  }

  // COMPACT: preserved entities must actually appear in the compacted corpus.
  if (ex.task === 'COMPACT') {
    const o = ex.output as { preserved_entities: string[] };
    for (const e of o.preserved_entities) {
      if (!ex.input.toLowerCase().includes(e.toLowerCase())) return { ok: false, reason: `compact entity "${e}" not in corpus` };
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
