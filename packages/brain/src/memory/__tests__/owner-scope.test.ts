import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Memory 3.0 C0: fail-closed owner scoping (P0.2 SQL half, code side).
 *
 * Guarantees under test:
 *  - getOwnerScope(): wallet passes through; unscoped context resolves to
 *    SCOPE_BOT_OWN when OWNER_SCOPE_FAILCLOSED=true, null (legacy fail-open)
 *    when off.
 *  - scopeToOwner(): sentinel -> .is('owner_wallet', null); wallet -> .eq;
 *    unscoped+flag -> .is null; unscoped legacy -> passthrough.
 *  - applyOwnerPostGuard(): the recall post-guard is sentinel-aware and pure.
 *
 * SITE_ONLY short-circuits config env validation at import; vi.hoisted runs
 * before static imports (novelty-decay / memory-integrity test pattern).
 */
vi.hoisted(() => {
  process.env.SITE_ONLY = 'true';
});

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock('@clude/shared/core/database', () => ({ getDb: () => ({ from: vi.fn(), rpc: vi.fn() }) }));

// Keep the semantic-tagging layer inert (imported transitively by memory.ts).
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
import {
  getOwnerScope,
  scopeToOwner,
  applyOwnerPostGuard,
  SCOPE_BOT_OWN,
} from '../memory';

// Minimal chainable query double that records the scoping call applied to it.
function queryDouble() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const q = {
    calls,
    is: (...args: unknown[]) => {
      calls.push({ method: 'is', args });
      return q;
    },
    eq: (...args: unknown[]) => {
      calls.push({ method: 'eq', args });
      return q;
    },
  };
  return q;
}

beforeEach(() => {
  delete process.env.OWNER_SCOPE_FAILCLOSED;
});

afterEach(() => {
  delete process.env.OWNER_SCOPE_FAILCLOSED;
});

describe('getOwnerScope', () => {
  it('returns the context wallet when one is in scope', async () => {
    await withOwnerWallet('wallet-abc', async () => {
      expect(getOwnerScope()).toBe('wallet-abc');
    });
  });

  it('returns null when unscoped and the flag is OFF (legacy fail-open)', () => {
    expect(getOwnerScope()).toBeNull();
  });

  it('returns SCOPE_BOT_OWN when unscoped and OWNER_SCOPE_FAILCLOSED=true', () => {
    process.env.OWNER_SCOPE_FAILCLOSED = 'true';
    expect(getOwnerScope()).toBe(SCOPE_BOT_OWN);
  });

  it('an explicit SCOPE_BOT_OWN context passes through regardless of the flag', async () => {
    await withOwnerWallet(SCOPE_BOT_OWN, async () => {
      expect(getOwnerScope()).toBe(SCOPE_BOT_OWN);
    });
  });

  it('a context wallet wins over the flag', async () => {
    process.env.OWNER_SCOPE_FAILCLOSED = 'true';
    await withOwnerWallet('wallet-abc', async () => {
      expect(getOwnerScope()).toBe('wallet-abc');
    });
  });
});

describe('scopeToOwner', () => {
  it('applies .eq for a tenant wallet', async () => {
    await withOwnerWallet('wallet-abc', async () => {
      const q = queryDouble();
      scopeToOwner(q);
      expect(q.calls).toEqual([{ method: 'eq', args: ['owner_wallet', 'wallet-abc'] }]);
    });
  });

  it('applies .is null for the bot-own sentinel', async () => {
    await withOwnerWallet(SCOPE_BOT_OWN, async () => {
      const q = queryDouble();
      scopeToOwner(q);
      expect(q.calls).toEqual([{ method: 'is', args: ['owner_wallet', null] }]);
    });
  });

  it('is a passthrough when unscoped with the flag OFF (legacy)', () => {
    const q = queryDouble();
    scopeToOwner(q);
    expect(q.calls).toEqual([]);
  });

  it('applies .is null when unscoped with the flag ON (fail closed)', () => {
    process.env.OWNER_SCOPE_FAILCLOSED = 'true';
    const q = queryDouble();
    scopeToOwner(q);
    expect(q.calls).toEqual([{ method: 'is', args: ['owner_wallet', null] }]);
  });
});

describe('applyOwnerPostGuard', () => {
  const rows = [
    { id: 1, owner_wallet: 'wallet-abc' },
    { id: 2, owner_wallet: 'wallet-other' },
    { id: 3, owner_wallet: null },
    { id: 4 }, // undefined owner_wallet == null-owner (bot) row
  ];

  it('passes everything through when scope is null (legacy fail-open)', () => {
    const { kept, stripped } = applyOwnerPostGuard(rows, null);
    expect(kept).toHaveLength(4);
    expect(stripped).toBe(0);
  });

  it('keeps only the exact tenant rows for a wallet scope', () => {
    const { kept, stripped } = applyOwnerPostGuard(rows, 'wallet-abc');
    expect(kept.map((r) => r.id)).toEqual([1]);
    expect(stripped).toBe(3);
  });

  it('keeps only null-owner rows under SCOPE_BOT_OWN (never strips the bot\'s own)', () => {
    const { kept, stripped } = applyOwnerPostGuard(rows, SCOPE_BOT_OWN);
    expect(kept.map((r) => r.id)).toEqual([3, 4]);
    expect(stripped).toBe(2);
  });

  it('never leaks a tenant row into the bot scope (the DISCOVER-default leak class)', () => {
    const { kept } = applyOwnerPostGuard(rows, SCOPE_BOT_OWN);
    expect(kept.every((r) => r.owner_wallet == null)).toBe(true);
  });
});
