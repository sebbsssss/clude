import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Memory 3.0 C0 / P0.5: BENCH_MODE — read-only recall under measurement.
 *
 * Guarantee under test: shouldTrackAccess() is the single gate for read-path
 * state mutation (access boost + Hebbian reinforcement), and BENCH_MODE=true
 * forces it off regardless of caller options. Reads must not mutate retrieval
 * state under measurement (+2.6pp drift measured from data freshness alone).
 */
vi.hoisted(() => {
  process.env.SITE_ONLY = 'true';
});

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@clude/shared/core/database', () => ({ getDb: () => ({ from: vi.fn(), rpc: vi.fn() }) }));

vi.mock('@clude/shared/wiki-packs', () => ({
  autoCategorizeTags: (o: { existingTags?: string[] }) => o.existingTags ?? [],
  DEFAULT_PACK_ID: 'workspace',
  topicEmbedSources: () => [],
  semanticTagMatches: () => [],
}));

vi.mock('../graph', () => ({
  extractAndLinkEntities: vi.fn(async () => undefined),
  findSimilarEntities: vi.fn(async () => []),
  getMemoriesByEntity: vi.fn(async () => []),
  getEntityCooccurrences: vi.fn(async () => []),
}));

import { isBenchMode, shouldTrackAccess } from '../memory';

beforeEach(() => {
  delete process.env.BENCH_MODE;
});

afterEach(() => {
  delete process.env.BENCH_MODE;
});

describe('isBenchMode', () => {
  it('is off by default', () => {
    expect(isBenchMode()).toBe(false);
  });

  it('is on only for the exact value "true"', () => {
    process.env.BENCH_MODE = 'true';
    expect(isBenchMode()).toBe(true);
    process.env.BENCH_MODE = '1';
    expect(isBenchMode()).toBe(false);
  });
});

describe('shouldTrackAccess', () => {
  it('tracks by default (prod behavior unchanged)', () => {
    expect(shouldTrackAccess({})).toBe(true);
    expect(shouldTrackAccess({ trackAccess: true })).toBe(true);
  });

  it('respects an explicit caller opt-out', () => {
    expect(shouldTrackAccess({ trackAccess: false })).toBe(false);
  });

  it('BENCH_MODE forces tracking off regardless of caller options', () => {
    process.env.BENCH_MODE = 'true';
    expect(shouldTrackAccess({})).toBe(false);
    expect(shouldTrackAccess({ trackAccess: true })).toBe(false);
    expect(shouldTrackAccess({ trackAccess: false })).toBe(false);
  });
});
