import type { Example, TaskName } from './taxonomy';
import type { LifeScript, PlantedFact } from './life-script';
import type { Renderer } from './render';

// ============================================================
// Mechanical label derivation.
//
// Given a planted script + a renderer, emit supervised examples whose labels
// are EXACT by construction (read straight off the script, never guessed).
// Each task gets a fixed system prompt; the model is trained to emit the
// task's strict JSON. See taxonomy.ts for the per-task output schemas.
// ============================================================

const SYS: Record<TaskName, string> = {
  CLASSIFY: 'Classify the memory. Output JSON: {type, importance (0-1), tags[], concepts[]}.',
  EXTRACT: 'Extract atomic memories from the text. Output JSON: {memories:[{content, summary, type}]}.',
  ENTITIES: 'Extract entities and relations. Output JSON: {entities:[{name,type,aliases}], relations:[{head,type,tail}]}.',
  TEMPORAL: 'Extract the event date and temporal links. Output JSON: {event_date, precision, links[]}.',
  CONSOLIDATE: 'Consolidate the memories into evidence-linked insights. Output JSON: {insights:[{content, evidence[]}]}.',
  RECONCILE: 'Decide how the two memories relate. Output JSON: {verdict, resolution, weaker_id, confidence}.',
  QUERY: 'Understand the query. Output JSON: {expanded_queries[], temporal_constraints, type_filters[], entities[], intent}.',
  ANSWER: 'Answer ONLY from the provided memories; abstain if unsupported. Output JSON: {rationale, answer, citations[], confidence, abstain}.',
};

function tagsFor(fact: PlantedFact): string[] {
  const names = fact.entities.map((e) => e.name.toLowerCase());
  return Array.from(new Set([...fact.concepts, ...names])).slice(0, 6);
}

export async function deriveExamples(script: LifeScript, renderer: Renderer): Promise<Example[]> {
  const out: Example[] = [];
  const push = (task: TaskName, input: string, output: unknown, meta: Partial<Example['meta']> = {}) =>
    out.push({ task, system: SYS[task], input, output, meta: { scriptId: script.id, ...meta } });

  // Render each fact once; build session blocks from the utterances.
  const utter = new Map<string, string>();
  for (const f of script.facts) utter.set(f.id, await Promise.resolve(renderer.render(f)));
  const sessions = new Map<number, PlantedFact[]>();
  for (const f of script.facts) (sessions.get(f.session) ?? sessions.set(f.session, []).get(f.session)!).push(f);

  // CLASSIFY, ENTITIES, TEMPORAL — per fact.
  for (const f of script.facts) {
    const text = utter.get(f.id)!;
    push('CLASSIFY', text, { type: f.memoryType, importance: f.importance, tags: tagsFor(f), concepts: f.concepts }, { renderStyle: f.renderStyle });

    if (f.entities.length) {
      push('ENTITIES', text, {
        entities: f.entities.map((e) => ({ name: e.name, type: e.type, aliases: e.aliases ?? [] })),
        relations: (f.relations ?? []).map((r) => ({ head: r.head, type: r.type, tail: r.tail })),
      });
    }

    if (f.eventDate) {
      push('TEMPORAL', `Today is ${script.referenceDate}.\n${text}`, {
        event_date: f.eventDate,
        precision: f.datePrecision ?? 'day',
        links: [],
      });
    }
  }

  // EXTRACT — per session (the dialogue block -> the facts revealed in it).
  for (const [s, facts] of sessions) {
    const block = facts.map((f) => `${script.persona.name}: ${utter.get(f.id)}`).join('\n');
    push('EXTRACT', block, {
      memories: facts.map((f) => ({ content: f.text, summary: f.text.slice(0, 60), type: f.memoryType })),
    }, { });
    void s;
  }

  // CONSOLIDATE — durable (semantic/self_model/procedural) facts as evidence-linked insights.
  const durable = script.facts.filter((f) => f.memoryType !== 'episodic');
  if (durable.length) {
    const corpus = script.facts.map((f) => `[${f.id}] ${f.text}`).join('\n');
    push('CONSOLIDATE', corpus, {
      insights: durable.map((f) => ({ content: f.text, evidence: [f.id] })),
    });
  }

  // RECONCILE — supersession + contradiction pairs.
  for (const f of script.facts) {
    const olderId = f.supersedes ?? f.contradicts;
    if (!olderId) continue;
    const older = script.facts.find((x) => x.id === olderId);
    if (!older) continue;
    const input = `Memory A [${older.id}]: ${older.text}\nMemory B [${f.id}]: ${f.text}`;
    push('RECONCILE', input, {
      verdict: f.supersedes ? 'supersedes' : 'contradicts',
      resolution: `Memory B is the current truth; Memory A is outdated.`,
      weaker_id: older.id,
      confidence: 0.9,
    });
  }

  // QUERY + ANSWER — per planted QA.
  for (const qa of script.qa) {
    const ents = Array.from(
      new Set(script.facts.flatMap((f) => f.entities).map((e) => e.name).filter((n) => qa.question.includes(n))),
    );
    const hasDate = /\b(19|20)\d{2}\b|when|date/i.test(qa.question);
    push('QUERY', `Today is ${script.referenceDate}.\n${qa.question}`, {
      expanded_queries: [qa.question, qa.question.replace(/\?$/, '').trim()],
      temporal_constraints: { after: null, before: null },
      type_filters: [],
      entities: ents,
      intent: hasDate ? 'temporal_lookup' : 'lookup',
    });

    // Build a small retrieved-memory context: evidence facts + a couple of distractors.
    const distractors = script.facts.filter((f) => !qa.evidence.includes(f.id)).slice(0, 2);
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
