import { describe, it, expect } from 'vitest';
import { withOwnerWallet, getContextOwnerWallet } from '@clude/shared/core/owner-context';

/**
 * Regression test for the BM25 owner-scope bug (2026-06-02).
 *
 * recallMemories' BM25 branch originally scoped its full-text search with the bare
 * module-level `_ownerWallet` variable. But `withOwnerWallet()` sets the request-scoped
 * AsyncLocalStorage context, NOT that module variable. So under any wrapped call
 * (hosted API, benchmark, anything using withOwnerWallet) the bare var was null and
 * BM25 searched the ENTIRE memories table unscoped — a correctness AND tenant-isolation
 * bug. The fix routes BM25 through getOwnerWallet(), whose FIRST check is
 * getContextOwnerWallet() (the AsyncLocalStorage value set by withOwnerWallet).
 *
 * This pins the invariant the fix depends on: the async context that withOwnerWallet
 * establishes is exactly what owner-scoped retrieval must read. We test the shared
 * owner-context primitives directly (no heavy ../memory import, which pulls config and
 * validates env at load); getOwnerWallet() returns getContextOwnerWallet() when set.
 */
describe('owner-scope: withOwnerWallet async context (BM25 scope regression)', () => {
  it('exposes the wrapped wallet via getContextOwnerWallet() synchronously', () => {
    const seen = withOwnerWallet('bench:owner-scope:test', () => getContextOwnerWallet());
    expect(seen).toBe('bench:owner-scope:test');
  });

  it('propagates the wallet across an await boundary', async () => {
    const seen = await withOwnerWallet('wallet:async:abc', async () => {
      await Promise.resolve();
      return getContextOwnerWallet();
    });
    expect(seen).toBe('wallet:async:abc');
  });

  it('isolates concurrent scopes (no cross-tenant leakage)', async () => {
    const [a, b] = await Promise.all([
      withOwnerWallet('tenant:A', async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getContextOwnerWallet();
      }),
      withOwnerWallet('tenant:B', async () => {
        await new Promise((r) => setTimeout(r, 1));
        return getContextOwnerWallet();
      }),
    ]);
    expect(a).toBe('tenant:A');
    expect(b).toBe('tenant:B');
  });

  it('returns undefined outside any scope (so getOwnerWallet falls back, never leaks a stale tenant)', () => {
    expect(getContextOwnerWallet()).toBeUndefined();
  });
});
