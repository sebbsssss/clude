/**
 * Shared presentation constants + helpers for the revamped dashboard.
 *
 * Colors are taken verbatim from the Clude Design handoff (dark scheme). Every
 * revamped screen imports from here so the five memory types and bond/edge types
 * read identically across Overview, Explore, Wiki, and Export.
 */

export type UIMemoryType =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'self_model'
  | 'introspective';

export interface TypeStyle {
  key: UIMemoryType;
  /** Full label, e.g. "Self-model". */
  label: string;
  /** Compact label for tight cells, e.g. "Introspect.". */
  short: string;
  /** Dot / accent color. */
  color: string;
  /** Pill background tint. */
  tint: string;
}

/** The five typed memory tiers, in canonical display order. */
export const MEMORY_TYPES: TypeStyle[] = [
  { key: 'episodic',      label: 'Episodic',      short: 'Episodic',    color: '#4466ff', tint: 'rgba(68,102,255,0.16)' },
  { key: 'semantic',      label: 'Semantic',      short: 'Semantic',    color: '#10b981', tint: 'rgba(16,185,129,0.16)' },
  { key: 'procedural',    label: 'Procedural',    short: 'Procedural',  color: '#f59e0b', tint: 'rgba(245,158,11,0.16)' },
  { key: 'self_model',    label: 'Self-model',    short: 'Self-model',  color: '#8b5cf6', tint: 'rgba(139,92,246,0.16)' },
  { key: 'introspective', label: 'Introspective', short: 'Introspect.', color: '#ec4899', tint: 'rgba(236,72,153,0.16)' },
];

const TYPE_BY_KEY: Record<string, TypeStyle> = Object.fromEntries(
  MEMORY_TYPES.map((t) => [t.key, t]),
);

/** Resolve a memory_type string (any casing / unknown) to a style, falling back to episodic. */
export function typeStyle(type: string | null | undefined): TypeStyle {
  if (!type) return MEMORY_TYPES[0];
  return TYPE_BY_KEY[type.toLowerCase()] ?? MEMORY_TYPES[0];
}

/** Bond / graph-edge color by link type (matches BOND_TYPE_WEIGHTS in the brain). */
export const BOND_COLORS: Record<string, string> = {
  causes: '#ef4444',
  supports: '#4466ff',
  elaborates: '#10b981',
  resolves: '#10b981',
  contradicts: '#f59e0b',
  relates: '#6b7280',
  follows: '#a3a3a3',
  happens_before: '#6b7280',
  happens_after: '#6b7280',
  concurrent_with: '#6b7280',
};

export function bondColor(kind: string | null | undefined): string {
  if (!kind) return '#6b7280';
  return BOND_COLORS[kind.toLowerCase()] ?? '#6b7280';
}

/** Compact relative time from an ISO timestamp: "2m", "3h", "4d", "1y". */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const secs = Math.max(0, (Date.now() - t) / 1000);
  if (secs < 60) return `${Math.floor(secs)}s`;
  const mins = secs / 60;
  if (mins < 60) return `${Math.floor(mins)}m`;
  const hrs = mins / 60;
  if (hrs < 24) return `${Math.floor(hrs)}h`;
  const days = hrs / 24;
  if (days < 365) return `${Math.floor(days)}d`;
  return `${Math.floor(days / 365)}y`;
}

/** Retention factor (0–1) → bar color: green healthy, amber mid, pink fading. */
export function decayColor(retained: number): string {
  if (retained >= 0.8) return '#10b981';
  if (retained >= 0.6) return '#f59e0b';
  return '#ec4899';
}

/** Format a 0–1 factor as a compact percentage string, e.g. 0.94 → "94%". */
export function pct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${Math.round(value * 100)}%`;
}
