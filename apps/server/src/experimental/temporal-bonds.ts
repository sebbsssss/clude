/**
 * Experiment 9: Temporal Bond Weights + Temporal RPC Activation
 *
 * Problem: Phase 6 graph traversal (memory.ts:854) is missing temporal link types
 * (happens_before, happens_after, concurrent_with). These link types exist in the
 * schema and are created by the dream cycle, but are ignored during recall because
 * BOND_TYPE_WEIGHTS doesn't include them.
 *
 * Fix: Add temporal link types to the bond weight map and route temporal queries
 * to a date-range-aware RPC when date constraints are detected.
 *
 * Expected improvement: Temporal accuracy 53.4% → 65-70% (+12-17pp)
 * Effort: Very low — infrastructure already exists.
 */

import { getDb } from '../core/database';
import { createChildLogger } from '../core/logger';

const log = createChildLogger('exp-temporal');

/**
 * Complete bond type weights including temporal link types.
 * Drop-in replacement for the BOND_TYPE_WEIGHTS in memory.ts:854.
 */
export const TEMPORAL_BOND_TYPE_WEIGHTS: Record<string, number> = {
  causes: 1.0,
  supports: 0.9,
  concurrent_with: 0.8,   // NEW: temporally co-occurring events
  resolves: 0.8,
  happens_before: 0.7,    // NEW: temporal ordering
  happens_after: 0.7,     // NEW: temporal ordering
  elaborates: 0.7,
  contradicts: 0.6,
  relates: 0.4,
  follows: 0.3,
};

/**
 * Detect temporal constraints from a natural language query.
 * Returns date range if temporal query is detected, null otherwise.
 *
 * Handles patterns like:
 * - "What happened in March 2026?"
 * - "last week", "yesterday", "3 days ago"
 * - "between January and March"
 * - "on March 15th"
 * - "before/after February"
 */
export interface TemporalConstraints {
  startDate: string;  // ISO date string
  endDate: string;    // ISO date string
}

export function detectTemporalConstraints(query: string): TemporalConstraints | null {
  const now = new Date();
  const lower = query.toLowerCase();

  // Pattern: "yesterday"
  if (/\byesterday\b/.test(lower)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return { startDate: startOfDay(d), endDate: endOfDay(d) };
  }

  // Pattern: "last week"
  if (/\blast\s+week\b/.test(lower)) {
    const end = new Date(now);
    const start = new Date(now);
    start.setDate(start.getDate() - 7);
    return { startDate: startOfDay(start), endDate: endOfDay(end) };
  }

  // Pattern: "N days/weeks/months ago"
  const agoMatch = lower.match(/(\d+)\s+(day|week|month)s?\s+ago/);
  if (agoMatch) {
    const n = parseInt(agoMatch[1], 10);
    const unit = agoMatch[2];
    const start = new Date(now);
    if (unit === 'day') start.setDate(start.getDate() - n);
    else if (unit === 'week') start.setDate(start.getDate() - n * 7);
    else if (unit === 'month') start.setMonth(start.getMonth() - n);
    return { startDate: startOfDay(start), endDate: endOfDay(now) };
  }

  // Pattern: "in [Month] [Year]" or "[Month] [Year]"
  const monthYearMatch = lower.match(/(?:in\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})/);
  if (monthYearMatch) {
    const monthIdx = monthNameToIndex(monthYearMatch[1]);
    const year = parseInt(monthYearMatch[2], 10);
    const start = new Date(year, monthIdx, 1);
    const end = new Date(year, monthIdx + 1, 0); // last day of month
    return { startDate: startOfDay(start), endDate: endOfDay(end) };
  }

  // Pattern: "on [Month] [Day]" or "[Month] [Day], [Year]"
  const dateMatch = lower.match(/(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/);
  if (dateMatch) {
    const monthIdx = monthNameToIndex(dateMatch[1]);
    const day = parseInt(dateMatch[2], 10);
    const year = dateMatch[3] ? parseInt(dateMatch[3], 10) : now.getFullYear();
    const d = new Date(year, monthIdx, day);
    return { startDate: startOfDay(d), endDate: endOfDay(d) };
  }

  // Pattern: "before/after [Month]"
  const beforeAfterMatch = lower.match(/(before|after)\s+(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?/);
  if (beforeAfterMatch) {
    const direction = beforeAfterMatch[1];
    const monthIdx = monthNameToIndex(beforeAfterMatch[2]);
    const year = beforeAfterMatch[3] ? parseInt(beforeAfterMatch[3], 10) : now.getFullYear();
    if (direction === 'before') {
      return {
        startDate: '1970-01-01T00:00:00Z',
        endDate: startOfDay(new Date(year, monthIdx, 1)),
      };
    } else {
      const lastDay = new Date(year, monthIdx + 1, 0);
      return {
        startDate: endOfDay(lastDay),
        endDate: new Date(now.getFullYear() + 1, 0, 1).toISOString(),
      };
    }
  }

  return null;
}

/**
 * Query memories with temporal date range filtering.
 * Uses COALESCE(event_date, created_at) so memories with explicit event dates
 * are preferred, but all memories fall back to creation time.
 */
export async function matchMemoriesTemporal(opts: {
  queryEmbedding: number[];
  matchThreshold: number;
  matchCount: number;
  startDate: string;
  endDate: string;
  filterTypes?: string[] | null;
  filterUser?: string | null;
  minDecay?: number;
  filterOwner?: string | null;
  filterTags?: string[] | null;
}): Promise<Array<{ id: number; similarity: number }>> {
  const db = getDb();
  try {
    // Try the temporal RPC first (requires migration)
    const { data, error } = await db.rpc('match_memories_temporal', {
      query_embedding: JSON.stringify(opts.queryEmbedding),
      match_threshold: opts.matchThreshold,
      match_count: opts.matchCount,
      start_date: opts.startDate,
      end_date: opts.endDate,
      filter_types: opts.filterTypes || null,
      filter_user: opts.filterUser || null,
      min_decay: opts.minDecay ?? 0.1,
      filter_owner: opts.filterOwner || null,
      filter_tags: opts.filterTags || null,
    });

    if (error) {
      log.debug({ error: error.message }, 'Temporal RPC not available, falling back to post-filter');
      return [];
    }

    log.debug({ results: data?.length || 0, startDate: opts.startDate, endDate: opts.endDate }, 'Temporal memory search completed');
    return data || [];
  } catch (err) {
    log.debug({ err }, 'Temporal RPC unavailable');
    return [];
  }
}

// ---- Helpers ---- //

function monthNameToIndex(name: string): number {
  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  return months[name.toLowerCase()] ?? 0;
}

function startOfDay(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}

function endOfDay(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).toISOString();
}
