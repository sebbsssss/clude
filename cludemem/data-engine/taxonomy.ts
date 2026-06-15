import { z } from 'zod';

// ============================================================
// CludeMem taxonomy + task I/O schemas
//
// Memory types and bond types are aligned with Clude's production schema
// (packages/shared/src/utils/constants.ts) so a trained CludeMem drops in.
// Concepts use a GENERAL agent-memory vocabulary (not the bot's crypto
// ontology) because CludeMem is a general agent-memory model.
// ============================================================

export const MEMORY_TYPES = [
  'episodic',
  'semantic',
  'procedural',
  'self_model',
  'introspective',
] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number];

export const BOND_TYPES = [
  'supports',
  'contradicts',
  'elaborates',
  'causes',
  'follows',
  'relates',
  'resolves',
  'happens_before',
  'happens_after',
  'concurrent_with',
] as const;
export type BondType = (typeof BOND_TYPES)[number];

// General agent-memory concept vocabulary (12 controlled labels).
export const CONCEPTS = [
  'personal_fact',
  'preference',
  'goal_or_plan',
  'task',
  'event',
  'relationship',
  'knowledge',
  'skill_or_procedure',
  'self_reflection',
  'location',
  'possession',
  'temporal_marker',
] as const;
export type Concept = (typeof CONCEPTS)[number];

export const ENTITY_TYPES = [
  'person',
  'organization',
  'project',
  'concept',
  'location',
  'event',
  'object',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const DATE_PRECISION = ['day', 'month', 'year', 'none'] as const;
export type DatePrecision = (typeof DATE_PRECISION)[number];

// ── Task output schemas (the strict, flat JSON CludeMem emits) ──

export const ClassifyOut = z.object({
  type: z.enum(MEMORY_TYPES),
  importance: z.number().min(0).max(1),
  tags: z.array(z.string()),
  concepts: z.array(z.enum(CONCEPTS)),
  // -1 (very negative) .. 0 (neutral) .. 1 (very positive)
  emotional_valence: z.number().min(-1).max(1),
});

export const ExtractOut = z.object({
  memories: z.array(
    z.object({
      content: z.string(),
      summary: z.string(),
      type: z.enum(MEMORY_TYPES),
    }),
  ),
});

export const EntitiesOut = z.object({
  entities: z.array(
    z.object({
      name: z.string(),
      type: z.enum(ENTITY_TYPES),
      aliases: z.array(z.string()),
    }),
  ),
  relations: z.array(
    z.object({ head: z.string(), type: z.string(), tail: z.string() }),
  ),
});

export const TemporalOut = z.object({
  event_date: z.string().nullable(),
  precision: z.enum(DATE_PRECISION),
  links: z.array(
    z.object({ type: z.enum(BOND_TYPES), target: z.string() }),
  ),
});

export const ConsolidateOut = z.object({
  insights: z.array(z.object({ content: z.string(), evidence: z.array(z.string()) })),
});

// COMPACT (task #6): squash an old memory group into one summary, keeping the
// entities and the spanned date range so nothing load-bearing is lost.
export const CompactOut = z.object({
  summary: z.string(),
  preserved_entities: z.array(z.string()),
  date_range: z.object({ start: z.string().nullable(), end: z.string().nullable() }),
});

export const ReconcileOut = z.object({
  verdict: z.enum(['contradicts', 'consistent', 'supersedes', 'duplicate']),
  resolution: z.string(),
  weaker_id: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export const QueryOut = z.object({
  expanded_queries: z.array(z.string()),
  temporal_constraints: z.object({ after: z.string().nullable(), before: z.string().nullable() }),
  type_filters: z.array(z.enum(MEMORY_TYPES)),
  entities: z.array(z.string()),
  intent: z.string(),
});

export const AnswerOut = z.object({
  rationale: z.string(),
  answer: z.string(),
  citations: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  abstain: z.boolean(),
});

// Map task -> output schema, for the verification gauntlet.
export const TASK_SCHEMAS = {
  CLASSIFY: ClassifyOut,
  EXTRACT: ExtractOut,
  ENTITIES: EntitiesOut,
  TEMPORAL: TemporalOut,
  CONSOLIDATE: ConsolidateOut,
  COMPACT: CompactOut,
  RECONCILE: ReconcileOut,
  QUERY: QueryOut,
  ANSWER: AnswerOut,
} as const;

export type TaskName = keyof typeof TASK_SCHEMAS;

// A single supervised training example (one CludeMem call).
export interface Example {
  task: TaskName;
  system: string;
  input: string;
  output: unknown; // validated against TASK_SCHEMAS[task]
  meta: { scriptId: string; renderStyle?: string; answerable?: boolean };
}
