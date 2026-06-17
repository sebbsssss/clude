/**
 * Canonical memory→prompt grounding primitives, shared by every reader surface so they
 * cannot drift: the chat reader (apps/server memory-prompt.ts) and the bot + public SDK
 * formatter (packages/brain memory.ts / Cortex.formatContext).
 *
 * The rule TEXT stays per-surface (chat carries persona framing; the SDK formatter is
 * neutral), but the mechanics live here once: date-stamping every line, bounded content
 * snippets so the model has groundable facts, and chronological ordering so conflicting
 * facts about the same thing read as a dated timeline rather than a flat bag.
 */

/** Minimal shape needed to render a groundable, dated memory line. */
export interface GroundableMemory {
  memory_type?: string;
  summary?: string;
  content?: string;
  created_at?: string;
}

/** Max characters of memory content rendered into one grounded prompt line. */
export const GROUNDED_CONTENT_MAX = 600;

/**
 * Oldest→newest so conflicting facts about the same thing read as a dated timeline.
 * Undated memories sink to the end (stable sort preserves their relative order).
 * filter() returns fresh arrays, so callers can sort the result without mutating input.
 */
export function byMemoryDateAsc(a: GroundableMemory, b: GroundableMemory): number {
  const ta = a.created_at ? Date.parse(a.created_at) : NaN;
  const tb = b.created_at ? Date.parse(b.created_at) : NaN;
  if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
  if (Number.isNaN(ta)) return 1;
  if (Number.isNaN(tb)) return -1;
  return ta - tb;
}

/**
 * One dated, groundable line: "- [YYYY-MM-DD] summary — content snippet" + optional suffix.
 * Falls back gracefully when date, content, or summary is missing.
 */
export function renderGroundedLine(m: GroundableMemory, suffix = ''): string {
  const date = m.created_at ? new Date(m.created_at).toISOString().slice(0, 10) : '';
  const stamp = date ? `[${date}] ` : '';
  const summary = (m.summary || '').trim();
  const content = (m.content || '').trim();
  let body: string;
  if (!content || content === summary) {
    body = summary || content;
  } else if (content.length <= GROUNDED_CONTENT_MAX) {
    body = summary ? `${summary} — ${content}` : content;
  } else {
    const slice = content.slice(0, GROUNDED_CONTENT_MAX);
    body = summary ? `${summary} — ${slice}…` : `${slice}…`;
  }
  return `- ${stamp}${body}${suffix}`;
}
