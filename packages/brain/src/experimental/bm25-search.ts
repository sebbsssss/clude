/**
 * Experiment 8: PostgreSQL Full-Text Search (tsvector/tsquery)
 *
 * Problem: Current keyword search uses `ilike` which:
 * - Matches substrings ("sol" matches "solution")
 * - Has no TF-IDF weighting (all keyword matches treated equally)
 * - No stemming ("token" doesn't match "tokens")
 *
 * Fix: Use PostgreSQL native full-text search with tsvector/tsquery.
 * Requires a schema migration to add ts_summary column + GIN index.
 * Falls back to ilike if the column doesn't exist.
 *
 * Expected improvement: LoCoMo +4-9pp (24.2% → 28-33%)
 * Effort: Low — schema migration + query change.
 */

import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import type { Memory } from '../memory';

const log = createChildLogger('exp-bm25');

/** Track whether the ts_summary column exists (checked once) */
let _tsvectorAvailable: boolean | null = null;

/**
 * Check if the ts_summary tsvector column exists in the memories table.
 * Caches the result for the process lifetime.
 */
async function isTsvectorAvailable(): Promise<boolean> {
  if (_tsvectorAvailable !== null) return _tsvectorAvailable;

  try {
    const db = getDb();
    const { data, error } = await db.rpc('bm25_search_memories', {
      search_query: 'test',
      match_count: 1,
      min_decay: 0.1,
      filter_owner: null,
    });
    _tsvectorAvailable = !error;
  } catch {
    _tsvectorAvailable = false;
  }

  log.info({ available: _tsvectorAvailable }, 'BM25 tsvector availability check');
  return _tsvectorAvailable;
}

/**
 * Search memories using PostgreSQL full-text search (BM25-like ranking).
 *
 * Uses ts_rank() for TF-IDF-weighted ranking and tsquery for stemming.
 * Falls back to empty results if tsvector column is not available.
 *
 * @param query - Natural language query
 * @param opts - Filtering options
 * @returns Memories with BM25 rank scores
 */
export async function bm25SearchMemories(
  query: string,
  opts: {
    limit?: number;
    minDecay?: number;
    filterOwner?: string | null;
    filterTypes?: string[] | null;
    filterTags?: string[] | null;
  } = {},
): Promise<Array<{ id: number; rank: number }>> {
  const available = await isTsvectorAvailable();
  if (!available) {
    log.debug('BM25 search not available (migration not applied)');
    return [];
  }

  const limit = opts.limit ?? 20;
  const db = getDb();

  try {
    const { data, error } = await db.rpc('bm25_search_memories', {
      search_query: query,
      match_count: limit,
      min_decay: opts.minDecay ?? 0.1,
      filter_owner: opts.filterOwner || null,
      filter_types: opts.filterTypes || null,
      filter_tags: opts.filterTags || null,
    });

    if (error) {
      log.warn({ error: error.message }, 'BM25 search RPC failed');
      return [];
    }

    log.debug({ results: data?.length || 0, query: query.slice(0, 40) }, 'BM25 search completed');
    return data || [];
  } catch (err) {
    log.warn({ err }, 'BM25 search failed');
    return [];
  }
}

/**
 * Reset the tsvector availability cache (for testing).
 */
export function resetBm25Cache(): void {
  _tsvectorAvailable = null;
}
