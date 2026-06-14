import type { Concept, DatePrecision, EntityType, MemoryType } from './taxonomy';

// ============================================================
// Life scripts: the planted ground truth.
//
// A life script is a persona + a timeline of planted facts (with preference
// changes, contradictions, supersessions, temporal chains). Because the
// script IS the source of truth, every task label derives MECHANICALLY from
// it — labels are exact by construction, not a teacher's guess. Teachers
// (DeepSeek/Qwen) only RENDER natural dialogue around this structure.
// ============================================================

export interface PlantedEntity {
  name: string;
  type: EntityType;
  aliases?: string[];
}

export interface PlantedRelation {
  head: string;
  type: string; // works_at | lives_in | founded | owns | knows | ...
  tail: string;
}

export type RenderStyle = 'explicit' | 'implicit' | 'hedged' | 'corrected';

export interface PlantedFact {
  id: string;
  /** Canonical statement of the fact (ground truth content). */
  text: string;
  memoryType: MemoryType;
  importance: number; // 0-1
  concepts: Concept[];
  entities: PlantedEntity[];
  relations?: PlantedRelation[];
  eventDate?: string; // ISO (YYYY-MM-DD); omit if not datable
  datePrecision?: DatePrecision;
  /** id of an earlier fact this fact replaces (newer truth). */
  supersedes?: string;
  /** id of a fact this directly conflicts with. */
  contradicts?: string;
  /** Which session reveals this fact. */
  session: number;
  /** How the renderer should surface it (difficulty control). */
  renderStyle: RenderStyle;
}

export interface PlantedQA {
  id: string;
  question: string;
  /** Fact ids that answer it. Empty => unanswerable (abstain). */
  evidence: string[];
  answerable: boolean;
  /** Expected short answer (for answerable Qs). */
  expectedAnswer?: string;
  /** Distractor type for hard negatives (unanswerable Qs). */
  negativeKind?: 'absent' | 'attribute_miss' | 'temporal_near_miss' | 'wrong_session';
}

export interface LifeScript {
  id: string;
  persona: { name: string; role: string };
  /** "Today" for temporal-relative reasoning. */
  referenceDate: string;
  facts: PlantedFact[];
  qa: PlantedQA[];
}

// ── Seed scripts (hand-authored; the generator multiplies these for scale) ──

export const SEED_SCRIPTS: LifeScript[] = [
  {
    id: 'maya-relocation',
    persona: { name: 'Maya', role: 'product designer' },
    referenceDate: '2026-03-01',
    facts: [
      {
        id: 'f1',
        text: 'Maya lives in Berlin.',
        memoryType: 'semantic',
        importance: 0.6,
        concepts: ['personal_fact', 'location'],
        entities: [
          { name: 'Maya', type: 'person' },
          { name: 'Berlin', type: 'location' },
        ],
        relations: [{ head: 'Maya', type: 'lives_in', tail: 'Berlin' }],
        session: 0,
        renderStyle: 'explicit',
      },
      {
        id: 'f2',
        text: 'Maya prefers tea over coffee.',
        memoryType: 'semantic',
        importance: 0.4,
        concepts: ['preference'],
        entities: [{ name: 'Maya', type: 'person' }],
        session: 0,
        renderStyle: 'hedged',
      },
      {
        id: 'f3',
        text: 'Maya moved to Lisbon on 2026-02-10.',
        memoryType: 'episodic',
        importance: 0.8,
        concepts: ['event', 'location', 'temporal_marker'],
        entities: [
          { name: 'Maya', type: 'person' },
          { name: 'Lisbon', type: 'location' },
        ],
        relations: [{ head: 'Maya', type: 'lives_in', tail: 'Lisbon' }],
        eventDate: '2026-02-10',
        datePrecision: 'day',
        supersedes: 'f1', // now lives in Lisbon, not Berlin
        session: 2,
        renderStyle: 'explicit',
      },
      {
        id: 'f4',
        text: 'Maya now prefers coffee, having switched from tea.',
        memoryType: 'semantic',
        importance: 0.4,
        concepts: ['preference'],
        entities: [{ name: 'Maya', type: 'person' }],
        contradicts: 'f2',
        session: 3,
        renderStyle: 'corrected',
      },
      {
        id: 'f5',
        text: 'Maya started a new job at Nuvio as lead designer on 2026-02-24.',
        memoryType: 'episodic',
        importance: 0.85,
        concepts: ['event', 'task', 'relationship'],
        entities: [
          { name: 'Maya', type: 'person' },
          { name: 'Nuvio', type: 'organization' },
        ],
        relations: [{ head: 'Maya', type: 'works_at', tail: 'Nuvio' }],
        eventDate: '2026-02-24',
        datePrecision: 'day',
        session: 3,
        renderStyle: 'implicit',
      },
    ],
    qa: [
      { id: 'q1', question: 'Where does Maya live now?', evidence: ['f3'], answerable: true, expectedAnswer: 'Lisbon' },
      { id: 'q2', question: 'Does Maya prefer tea or coffee now?', evidence: ['f4'], answerable: true, expectedAnswer: 'coffee' },
      { id: 'q3', question: 'When did Maya move to Lisbon?', evidence: ['f3'], answerable: true, expectedAnswer: '2026-02-10' },
      { id: 'q4', question: 'What is the name of Maya\'s sister?', evidence: [], answerable: false, negativeKind: 'absent' },
      { id: 'q5', question: 'Did Maya move to Madrid?', evidence: [], answerable: false, negativeKind: 'attribute_miss' },
    ],
  },
  {
    id: 'devon-project',
    persona: { name: 'Devon', role: 'backend engineer' },
    referenceDate: '2026-05-15',
    facts: [
      {
        id: 'g1',
        text: 'Devon is allergic to peanuts.',
        memoryType: 'semantic',
        importance: 0.9,
        concepts: ['personal_fact'],
        entities: [{ name: 'Devon', type: 'person' }],
        session: 0,
        renderStyle: 'explicit',
      },
      {
        id: 'g2',
        text: 'Devon is leading the Atlas migration project.',
        memoryType: 'episodic',
        importance: 0.75,
        concepts: ['task', 'goal_or_plan'],
        entities: [
          { name: 'Devon', type: 'person' },
          { name: 'Atlas', type: 'project' },
        ],
        relations: [{ head: 'Devon', type: 'leads', tail: 'Atlas' }],
        eventDate: '2026-04-01',
        datePrecision: 'month',
        session: 1,
        renderStyle: 'explicit',
      },
      {
        id: 'g3',
        text: 'The Atlas migration shipped on 2026-05-09.',
        memoryType: 'episodic',
        importance: 0.8,
        concepts: ['event', 'temporal_marker'],
        entities: [{ name: 'Atlas', type: 'project' }],
        eventDate: '2026-05-09',
        datePrecision: 'day',
        session: 2,
        renderStyle: 'explicit',
      },
    ],
    qa: [
      { id: 'p1', question: 'What is Devon allergic to?', evidence: ['g1'], answerable: true, expectedAnswer: 'peanuts' },
      { id: 'p2', question: 'When did the Atlas migration ship?', evidence: ['g3'], answerable: true, expectedAnswer: '2026-05-09' },
      { id: 'p3', question: 'What database did Devon pick for Atlas?', evidence: [], answerable: false, negativeKind: 'absent' },
    ],
  },
];
