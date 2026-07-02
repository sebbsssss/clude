import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Memory 3.0 C0 / P0.3: fragment parity, code side.
 *
 * Guarantee under test: buildFragmentRpcArgs sends the legacy 4-arg shape by
 * default (deploy-safe against the pre-043 match_memory_fragments), and the
 * extended min_decay + filter_types args ONLY under MEMORY_FRAGMENT_FILTERS=true
 * (PostgREST matches RPCs by named args; unknown args = no match = dead lane).
 * The owner filter rides getOwnerScope(), so it is sentinel-aware.
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

import { withOwnerWallet } from '@clude/shared/core/owner-context';
import { buildFragmentRpcArgs, SCOPE_BOT_OWN } from '../memory';

const BASE = { embeddingJson: '[0.1,0.2]', matchThreshold: 0.3, matchCount: 20, minDecay: 0.1 };

beforeEach(() => {
  delete process.env.MEMORY_FRAGMENT_FILTERS;
  delete process.env.OWNER_SCOPE_FAILCLOSED;
});

afterEach(() => {
  delete process.env.MEMORY_FRAGMENT_FILTERS;
  delete process.env.OWNER_SCOPE_FAILCLOSED;
});

describe('buildFragmentRpcArgs', () => {
  it('sends the legacy 4-arg shape by default (pre-043 RPC compatible)', () => {
    const args = buildFragmentRpcArgs({ ...BASE, memoryTypes: ['semantic'] });
    expect(Object.keys(args).sort()).toEqual(['filter_owner', 'match_count', 'match_threshold', 'query_embedding']);
    expect(args.match_count).toBe(20);
    expect(args.match_threshold).toBe(0.3);
  });

  it('adds min_decay + filter_types under MEMORY_FRAGMENT_FILTERS=true', () => {
    process.env.MEMORY_FRAGMENT_FILTERS = 'true';
    const args = buildFragmentRpcArgs({ ...BASE, memoryTypes: ['semantic', 'episodic'] });
    expect(args.min_decay).toBe(0.1);
    expect(args.filter_types).toEqual(['semantic', 'episodic']);
  });

  it('sends filter_types null when no types are requested (flag on)', () => {
    process.env.MEMORY_FRAGMENT_FILTERS = 'true';
    const args = buildFragmentRpcArgs({ ...BASE, memoryTypes: [] });
    expect(args.filter_types).toBeNull();
  });

  it('owner filter is the ambient scope (tenant wallet)', async () => {
    await withOwnerWallet('wallet-abc', async () => {
      const args = buildFragmentRpcArgs(BASE);
      expect(args.filter_owner).toBe('wallet-abc');
    });
  });

  it('owner filter resolves to the bot sentinel when unscoped under OWNER_SCOPE_FAILCLOSED', () => {
    process.env.OWNER_SCOPE_FAILCLOSED = 'true';
    const args = buildFragmentRpcArgs(BASE);
    expect(args.filter_owner).toBe(SCOPE_BOT_OWN);
  });
});
