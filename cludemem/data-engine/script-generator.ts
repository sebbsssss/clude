import type { LifeScript, PlantedFact, PlantedQA, RenderStyle } from './life-script';
import type { Concept } from './taxonomy';

// ============================================================
// Combinatorial life-script generator (the volume lever).
//
// Assembles diverse personas + timelines from pools, GUARANTEEING the hard
// structures every batch needs (a supersession, a contradiction, a temporal
// chain, hard-negative unanswerables). Structure is deterministic per seed, so
// labels stay exact by construction — only natural-language phrasing should
// come from a teacher (TeacherRenderer). Each script yields ~20-25 examples.
//
//   import { generateScripts } from './script-generator';
//   const scripts = generateScripts(4000, 42); // ~90K examples
// ============================================================

// Small seeded PRNG (mulberry32) — reproducible, no Math.random.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NAMES = ['Maya', 'Devon', 'Priya', 'Theo', 'Aisha', 'Marco', 'Lena', 'Kai', 'Sofia', 'Omar', 'Nina', 'Hugo', 'Ravi', 'Elena', 'Jonas', 'Yuki', 'Tomas', 'Iris', 'Caleb', 'Zara'];
const ROLES = ['product designer', 'backend engineer', 'data scientist', 'teacher', 'nurse', 'founder', 'analyst', 'writer', 'architect', 'chef'];
const CITIES = ['Berlin', 'Lisbon', 'Madrid', 'Tokyo', 'Austin', 'Nairobi', 'Toronto', 'Oslo', 'Lyon', 'Porto', 'Seoul', 'Denver'];
const ORGS = ['Nuvio', 'Aperture', 'Lumen Labs', 'Kestrel', 'Vantage', 'Orbital', 'Brightwell', 'Cadence', 'Halcyon', 'Northstar'];
const PROJECTS = ['Atlas', 'Beacon', 'Polaris', 'Mercury', 'Sable', 'Quartz', 'Ridge', 'Echo'];
const ALLERGENS = ['peanuts', 'shellfish', 'gluten', 'pollen', 'lactose'];
const DRINKS = ['tea', 'coffee', 'matcha', 'cola'];
const RELATIONS = ['sister', 'mentor', 'manager', 'roommate', 'co-founder'];

function pick<T>(arr: T[], r: () => number): T {
  return arr[Math.floor(r() * arr.length)];
}
function intIn(r: () => number, min: number, max: number): number {
  return min + Math.floor(r() * (max - min + 1));
}
function isoDate(r: () => number): string {
  const m = intIn(r, 1, 12).toString().padStart(2, '0');
  const d = intIn(r, 1, 28).toString().padStart(2, '0');
  return `2026-${m}-${d}`;
}
const STYLES: RenderStyle[] = ['explicit', 'implicit', 'hedged', 'corrected'];

function generateScript(index: number): LifeScript {
  const r = rng(index * 2654435761 + 1);
  const name = pick(NAMES, r);
  const role = pick(ROLES, r);
  const facts: PlantedFact[] = [];
  const qa: PlantedQA[] = [];
  let n = 0;
  const fid = () => `f${++n}`;

  // ── Guaranteed: relocation (supersession + dated temporal chain) ──
  const cityA = pick(CITIES, r);
  let cityB = pick(CITIES, r);
  while (cityB === cityA) cityB = pick(CITIES, r);
  const live = fid();
  facts.push({
    id: live, text: `${name} lives in ${cityA}.`, memoryType: 'semantic', importance: 0.6,
    concepts: ['personal_fact', 'location'], entities: [{ name, type: 'person' }, { name: cityA, type: 'location' }],
    relations: [{ head: name, type: 'lives_in', tail: cityA }], session: 0, renderStyle: 'explicit',
  });
  const moveDate = isoDate(r);
  const moved = fid();
  facts.push({
    id: moved, text: `${name} moved to ${cityB} on ${moveDate}.`, memoryType: 'episodic', importance: 0.8,
    concepts: ['event', 'location', 'temporal_marker'], entities: [{ name, type: 'person' }, { name: cityB, type: 'location' }],
    relations: [{ head: name, type: 'lives_in', tail: cityB }], eventDate: moveDate, datePrecision: 'day',
    supersedes: live, session: 2, renderStyle: pick(STYLES, r),
  });
  qa.push({ id: 'qa1', question: `Where does ${name} live now?`, evidence: [moved], answerable: true, expectedAnswer: cityB });
  qa.push({ id: 'qa2', question: `When did ${name} move to ${cityB}?`, evidence: [moved], answerable: true, expectedAnswer: moveDate });

  // ── Guaranteed: preference flip (contradiction) ──
  const dA = pick(DRINKS, r);
  let dB = pick(DRINKS, r);
  while (dB === dA) dB = pick(DRINKS, r);
  const pref = fid();
  facts.push({
    id: pref, text: `${name} prefers ${dA} over ${dB}.`, memoryType: 'semantic', importance: 0.4,
    concepts: ['preference'], entities: [{ name, type: 'person' }], session: 0, renderStyle: 'hedged',
  });
  const pref2 = fid();
  facts.push({
    id: pref2, text: `${name} now prefers ${dB}, having switched from ${dA}.`, memoryType: 'semantic', importance: 0.4,
    concepts: ['preference'], entities: [{ name, type: 'person' }], contradicts: pref, session: 3, renderStyle: 'corrected',
  });
  qa.push({ id: 'qa3', question: `Does ${name} prefer ${dA} or ${dB} now?`, evidence: [pref2], answerable: true, expectedAnswer: dB });

  // ── Optional archetypes (sampled) ──
  if (r() < 0.7) {
    const org = pick(ORGS, r);
    const jobDate = isoDate(r);
    const job = fid();
    facts.push({
      id: job, text: `${name} started a new job at ${org} on ${jobDate}.`, memoryType: 'episodic', importance: 0.85,
      concepts: ['event', 'task'], entities: [{ name, type: 'person' }, { name: org, type: 'organization' }],
      relations: [{ head: name, type: 'works_at', tail: org }], eventDate: jobDate, datePrecision: 'day',
      session: 3, renderStyle: pick(STYLES, r),
    });
    qa.push({ id: 'qa4', question: `Where does ${name} work?`, evidence: [job], answerable: true, expectedAnswer: org });
  }
  if (r() < 0.6) {
    const allergen = pick(ALLERGENS, r);
    const al = fid();
    facts.push({
      id: al, text: `${name} is allergic to ${allergen}.`, memoryType: 'semantic', importance: 0.9,
      concepts: ['personal_fact'], entities: [{ name, type: 'person' }], session: 1, renderStyle: 'explicit',
    });
    qa.push({ id: 'qa5', question: `What is ${name} allergic to?`, evidence: [al], answerable: true, expectedAnswer: allergen });
  }
  if (r() < 0.6) {
    const proj = pick(PROJECTS, r);
    const shipDate = isoDate(r);
    const ship = fid();
    facts.push({
      id: ship, text: `The ${proj} project shipped on ${shipDate}.`, memoryType: 'episodic', importance: 0.8,
      concepts: ['event', 'temporal_marker'], entities: [{ name: proj, type: 'project' }],
      eventDate: shipDate, datePrecision: 'day', session: 2, renderStyle: pick(STYLES, r),
    });
    qa.push({ id: 'qa6', question: `When did the ${proj} project ship?`, evidence: [ship], answerable: true, expectedAnswer: shipDate });
  }

  // ── Guaranteed: 2 hard-negative unanswerables ──
  qa.push({ id: 'qn1', question: `What is the name of ${name}'s ${pick(RELATIONS, r)}?`, evidence: [], answerable: false, negativeKind: 'absent' });
  const otherCity = pick(CITIES.filter((c) => c !== cityA && c !== cityB), r);
  qa.push({ id: 'qn2', question: `Did ${name} move to ${otherCity}?`, evidence: [], answerable: false, negativeKind: 'attribute_miss' });

  return { id: `gen-${index}-${name.toLowerCase()}`, persona: { name, role }, referenceDate: '2026-06-01', facts, qa };
}

/** Generate `count` diverse, deterministic life scripts (seed shifts the batch). */
export function generateScripts(count: number, seed = 0): LifeScript[] {
  return Array.from({ length: count }, (_, i) => generateScript(seed * 100000 + i));
}
