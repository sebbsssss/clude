import type { Example, TaskName } from './taxonomy';
import type { LifeScript, PlantedFact } from './life-script';
import type { Renderer } from './render';
import { applyRegisterNoise, seededRng } from './noise';

// ============================================================
// Mechanical label derivation.
//
// Given a planted script + a renderer, emit supervised examples whose labels
// are EXACT by construction (read straight off the script, never guessed).
// Each task gets a fixed system prompt; the model is trained to emit the
// task's strict JSON. See taxonomy.ts for the per-task output schemas.
// ============================================================

const SYS: Record<TaskName, string> = {
  CLASSIFY: 'Classify the memory. Output JSON: {type, importance (0-1), tags[], concepts[], emotional_valence (-1..1)}.',
  EXTRACT: 'Extract atomic memories from the text. Output JSON: {memories:[{content, summary, type}]}.',
  ENTITIES: 'Extract entities and relations. Output JSON: {entities:[{name,type,aliases}], relations:[{head,type,tail}]}.',
  TEMPORAL: 'Extract the event date and its temporal links to the known events. Output JSON: {event_date, precision, links:[{type,target}]}.',
  CONSOLIDATE: 'Consolidate the memories into evidence-linked insights. Output JSON: {insights:[{content, evidence[]}]}.',
  COMPACT: 'Compact the old memories into one summary, preserving entities and the date range. Output JSON: {summary, preserved_entities[], date_range:{start,end}}.',
  RECONCILE: 'Decide how the two memories relate. Output JSON: {verdict, resolution, weaker_id, confidence}.',
  QUERY: 'Understand the query. Output JSON: {expanded_queries[], temporal_constraints, type_filters[], entities[], intent}.',
  ANSWER: 'Answer ONLY from the provided memories; abstain if unsupported. Output JSON: {rationale, answer, citations[], confidence, abstain}.',
};

function tagsFor(fact: PlantedFact): string[] {
  const names = fact.entities.map((e) => e.name.toLowerCase());
  return Array.from(new Set([...fact.concepts, ...names])).slice(0, 6);
}

// Light default sentiment when a fact doesn't pin one: contradictions read
// mildly negative, preferences/events mildly positive, else neutral.
function defaultValence(fact: PlantedFact): number {
  if (fact.contradicts) return -0.3;
  if (fact.concepts.includes('preference')) return 0.3;
  if (fact.memoryType === 'episodic' && fact.concepts.includes('event')) return 0.2;
  return 0;
}

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export async function deriveExamples(script: LifeScript, renderer: Renderer): Promise<Example[]> {
  const out: Example[] = [];
  const push = (task: TaskName, input: string, output: unknown, meta: Partial<Example['meta']> = {}) =>
    out.push({ task, system: SYS[task], input, output, meta: { scriptId: script.id, ...meta } });

  // Long scripts (many planted facts) drive the length-stratified, long-context
  // examples the benchmarks actually score (design 6.1).
  const isLong = script.facts.length > 20;

  // Render each fact once; build session blocks from the utterances.
  const utter = new Map<string, string>();
  for (const f of script.facts) utter.set(f.id, await Promise.resolve(renderer.render(f)));
  const sessions = new Map<number, PlantedFact[]>();
  for (const f of script.facts) (sessions.get(f.session) ?? sessions.set(f.session, []).get(f.session)!).push(f);

  // CLASSIFY, ENTITIES — per fact.
  for (const f of script.facts) {
    const text = utter.get(f.id)!;
    push('CLASSIFY', text, {
      type: f.memoryType,
      importance: f.importance,
      tags: tagsFor(f),
      concepts: f.concepts,
      emotional_valence: f.emotionalValence ?? defaultValence(f),
    }, { renderStyle: f.renderStyle });

    if (f.entities.length) {
      push('ENTITIES', text, {
        entities: f.entities.map((e) => ({ name: e.name, type: e.type, aliases: e.aliases ?? [] })),
        relations: (f.relations ?? []).map((r) => ({ head: r.head, type: r.type, tail: r.tail })),
      });
    }
  }

  // TEMPORAL — event date + ordered links to the nearest known dated events.
  // Links target ids that are LISTED in the prompt (grounded), and order is read
  // off the planted dates, so happens_before/after labels are exact.
  const dated = script.facts
    .filter((f) => f.eventDate)
    .sort((a, b) => (a.eventDate! < b.eventDate! ? -1 : a.eventDate! > b.eventDate! ? 1 : 0));
  for (let i = 0; i < dated.length; i++) {
    const f = dated[i];
    const earlier = dated.slice(Math.max(0, i - 3), i);
    const later = dated.slice(i + 1, i + 4);
    const links = [
      ...earlier.map((o) => ({ type: 'happens_after' as const, target: o.id })),
      ...later.map((o) => ({ type: 'happens_before' as const, target: o.id })),
    ];
    const known = [...earlier, ...later].map((o) => `[${o.id}] ${o.text} (${o.eventDate})`).join('\n');
    const input =
      `Today is ${script.referenceDate}.\nNew event [${f.id}]: ${utter.get(f.id)}` +
      (known ? `\nKnown events:\n${known}` : '');
    push('TEMPORAL', input, { event_date: f.eventDate, precision: f.datePrecision ?? 'day', links });
  }

  // EXTRACT — per session (dialogue block -> facts revealed in it), with the
  // optional register-noise pass (labels untouched, see noise.ts).
  const noiseOn = !!script.registerNoise;
  for (const [s, facts] of sessions) {
    let block = facts.map((f) => `${script.persona.name}: ${utter.get(f.id)}`).join('\n');
    if (noiseOn) block = applyRegisterNoise(block, seededRng(`${script.id}:${s}`));
    push('EXTRACT', block, {
      memories: facts.map((f) => ({ content: f.text, summary: f.text.slice(0, 60), type: f.memoryType })),
    });
  }

  // CONSOLIDATE — durable (semantic/self_model/procedural) facts as evidence-linked insights.
  const durable = script.facts.filter((f) => f.memoryType !== 'episodic');
  if (durable.length) {
    const corpus = script.facts.map((f) => `[${f.id}] ${f.text}`).join('\n');
    push('CONSOLIDATE', corpus, {
      insights: durable.map((f) => ({ content: f.text, evidence: [f.id] })),
    });
  }

  // COMPACT — squash the episodic event log into one summary, keeping entities + date span.
  const episodic = script.facts.filter((f) => f.memoryType === 'episodic');
  if (episodic.length >= 2) {
    const corpus = episodic.map((f) => `[${f.id}] ${f.text}`).join('\n');
    const eDates = episodic.map((f) => f.eventDate).filter((d): d is string => !!d).sort();
    const entities = Array.from(new Set(episodic.flatMap((f) => f.entities.map((e) => e.name))));
    push('COMPACT', corpus, {
      summary: `${script.persona.name}: ${episodic.length} events covering ${entities.slice(0, 5).join(', ')}.`,
      preserved_entities: entities,
      date_range: { start: eDates[0] ?? null, end: eDates[eDates.length - 1] ?? null },
    });
  }

  // RECONCILE — supersession / contradiction / duplicate / consistent pairs.
  for (const f of script.facts) {
    const rel = f.supersedes
      ? { older: f.supersedes, verdict: 'supersedes' as const }
      : f.contradicts
        ? { older: f.contradicts, verdict: 'contradicts' as const }
        : f.duplicates
          ? { older: f.duplicates, verdict: 'duplicate' as const }
          : f.consistentWith
            ? { older: f.consistentWith, verdict: 'consistent' as const }
            : null;
    if (!rel) continue;
    const older = script.facts.find((x) => x.id === rel.older);
    if (!older) continue;
    const input = `Memory A [${older.id}]: ${older.text}\nMemory B [${f.id}]: ${f.text}`;
    const resolution =
      rel.verdict === 'supersedes'
        ? 'Memory B is the current truth; Memory A is outdated.'
        : rel.verdict === 'contradicts'
          ? 'Memory B conflicts with Memory A; treat B as current.'
          : rel.verdict === 'duplicate'
            ? 'Memory B restates Memory A; keep one.'
            : 'Memory A and Memory B agree; both are kept.';
    push('RECONCILE', input, {
      verdict: rel.verdict,
      resolution,
      weaker_id: rel.verdict === 'consistent' ? null : older.id,
      confidence: rel.verdict === 'contradicts' ? 0.8 : 0.9,
    });
  }

  // QUERY + ANSWER — per planted QA.
  for (const qa of script.qa) {
    const ents = Array.from(
      new Set(script.facts.flatMap((f) => f.entities).map((e) => e.name).filter((n) => qa.question.includes(n))),
    );
    const isTemporal = /\b(19|20)\d{2}\b|when|date|before|after|during|since/i.test(qa.question);
    const evFact = qa.evidence
      .map((id) => script.facts.find((f) => f.id === id))
      .find((f): f is PlantedFact => !!(f && f.eventDate));
    const temporal_constraints: { after: string | null; before: string | null } =
      isTemporal && evFact?.eventDate
        ? { after: shiftDays(evFact.eventDate, -31), before: shiftDays(evFact.eventDate, 31) }
        : { after: null, before: null };
    push('QUERY', `Today is ${script.referenceDate}.\n${qa.question}`, {
      expanded_queries: [qa.question, qa.question.replace(/\?$/, '').trim()],
      temporal_constraints,
      type_filters: [],
      entities: ents,
      intent: isTemporal ? 'temporal_lookup' : 'lookup',
    }, { answerable: qa.answerable });

    // Retrieved context: evidence + distractors. Long scripts pull the whole
    // fact set as distractors so ANSWER inputs reach the 4-16K-token band.
    const pool = script.facts.filter((f) => !qa.evidence.includes(f.id));
    const distractors = isLong ? pool : pool.slice(0, 2);
    const retrieved = [...qa.evidence.map((id) => script.facts.find((f) => f.id === id)!), ...distractors]
      .filter(Boolean)
      .map((f) => `[${f.id}] ${f.text}`)
      .join('\n');
    const input = `Question: ${qa.question}\n\nMemories:\n${retrieved}`;
    push(
      'ANSWER',
      input,
      qa.answerable
        ? { rationale: `Supported by ${qa.evidence.join(', ')}.`, answer: qa.expectedAnswer ?? '', citations: qa.evidence, confidence: 0.9, abstain: false }
        : { rationale: 'No provided memory answers this.', answer: 'I do not have enough information to answer that.', citations: [], confidence: 0.8, abstain: true },
      { answerable: qa.answerable },
    );
  }

  return out;
}
