/**
 * reconcileTitleMintsOnce — the durable backstop that guarantees "a title pack exists on Base once
 * exported", redesigned after the backtest NO_GO. MONEY/ASSET CODE. This suite pins the new contract:
 *
 *   1. GRACE: a pack exported < GRACE_MS ago is NOT examined (so the sweep never races the export's own
 *      detached mint — the double-mint + clone-race fix).
 *   2. SKIP-MINTED / SKIP-SOLD: a settled export whose snapshot title already has a pack_titles row
 *      (minted OR transferred) is skipped via a single batch `.in()` — no chain call.
 *   3. RE-MINT: a settled export with no title record triggers mintTitleOnExport(source, author).
 *   4. tsnap GUARD: snapshot artifacts (pack_id 'tsnap-…') are excluded in JS, not trusted to the DB.
 *   5. CURSOR WALK + WRAP: the cursor advances past each page and wraps at the end (no starvation).
 *   6. CAP + RESILIENCE: at most MINT_PER_SWEEP mints/sweep; a per-item failure is counted + swallowed.
 *   7. POLLER: start/stop is idempotent and decoupled from the delivery poller.
 *
 * db/evm/resolver/mint/now are injected; the REAL snapshotPackId derives the expected title id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  reconcileTitleMintsOnce,
  startTitleReconciliationPoller,
  stopTitleReconciliationPoller,
  __resetCursorForTests,
} from '../reconcile-title-mints.js';
import { snapshotPackId } from '../snapshot-pack-for-title.js';

const NOW = Date.parse('2026-06-23T12:00:00.000Z'); // fixed clock; GRACE_MS = 5min → cutoff 11:55:00Z
const iso = (ms: number) => new Date(ms).toISOString();
const minsAgo = (m: number) => iso(NOW - m * 60_000);

// ── Query mock: .select().eq().lt().gt().order().limit() (scan) + .select().in() (batch check) ──
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
function resetDb() { for (const k of Object.keys(tables)) delete tables[k]; }
function seed(table: string, rows: Row[]) { tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r }))); }
function makeChain(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let orderCol: string | null = null;
  let limit = Infinity;
  const matched = () => {
    let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
    if (orderCol) rows = [...rows].sort((a, b) => String(a[orderCol!]).localeCompare(String(b[orderCol!])));
    return rows.slice(0, limit);
  };
  const chain: Record<string, any> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return chain; },
    lt: (c: string, v: any) => { filters.push((r) => String(r[c]) < String(v)); return chain; },
    gt: (c: string, v: any) => { filters.push((r) => String(r[c]) > String(v)); return chain; },
    in: (c: string, vals: any[]) => { filters.push((r) => vals.includes(r[c])); return chain; },
    order: (c: string) => { orderCol = c; return chain; },
    limit: (n: number) => { limit = n; return chain; },
    then: (resolve: (v: any) => any) => Promise.resolve({ data: matched(), error: null }).then(resolve),
  });
  return chain;
}
const db = { from: (t: string) => makeChain(t) } as any;
const resolver = { custodial: true, addressFor: (app: string) => `0xBase-${app}`, keysFor: () => { throw new Error('unused'); } } as any;
const evm = {} as any;
let mint: any;

function seedExport(packId: string, author: string, ageMin: number) {
  seed('pmp_artifacts', [{ pack_id: packId, owner_wallet: author, license_type: 'title', created_at: minsAgo(ageMin) }]);
}
function seedTitle(sourcePackId: string, author: string, status: string) {
  seed('pack_titles', [{ pack_id: snapshotPackId(sourcePackId, resolver.addressFor(author)), status }]);
}

beforeEach(() => {
  resetDb();
  __resetCursorForTests();
  mint = vi.fn(async () => ({ snapshotPackId: 'x', tokenId: '1', mintTx: '0xt', alreadyMinted: false, creatorBase: 'b' }));
});

describe('reconcileTitleMintsOnce — grace, skip, re-mint', () => {
  it('re-mints a SETTLED miss, skips a settled minted one, and IGNORES a too-recent export (grace)', async () => {
    seedExport('pack-A', 'authorA', 60); // settled (60m ago), no title → re-mint
    seedExport('pack-B', 'authorB', 60); // settled, minted → skip
    seedTitle('pack-B', 'authorB', 'minted');
    seedExport('pack-R', 'authorR', 1); // exported 1m ago < 5m grace → NOT examined (no race)

    const summary = await reconcileTitleMintsOnce({ db, evm, resolver, mint, now: NOW });

    expect(summary).toEqual({ examined: 2, minted: 1, skipped: 1, failed: 0 }); // pack-R excluded by grace
    expect(mint).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledWith(db, evm, resolver, { sourcePackId: 'pack-A', creatorAppWallet: 'authorA' });
  });

  it('skips a SOLD (transferred) title — a row exists, so it is never re-minted', async () => {
    seedExport('pack-S', 'authorS', 60);
    seedTitle('pack-S', 'authorS', 'transferred');
    const summary = await reconcileTitleMintsOnce({ db, evm, resolver, mint, now: NOW });
    expect(summary).toEqual({ examined: 1, minted: 0, skipped: 1, failed: 0 });
    expect(mint).not.toHaveBeenCalled();
  });

  it('excludes snapshot artifacts (pack_id tsnap-…) via the authoritative JS guard', async () => {
    seedExport('pack-A', 'authorA', 60);
    seedExport('tsnap-deadbeef', '0xBase-authorA', 60); // a snapshot artifact — must be ignored
    const summary = await reconcileTitleMintsOnce({ db, evm, resolver, mint, now: NOW });
    expect(summary.examined).toBe(1); // only pack-A
    expect(mint).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledWith(db, evm, resolver, { sourcePackId: 'pack-A', creatorAppWallet: 'authorA' });
  });

  it('mints ALL of a page\'s misses (no per-sweep cap below page size) — closes cap-stranding', async () => {
    for (let i = 0; i < 12; i++) seedExport(`pack-${i}`, `author-${i}`, 60); // 12 settled misses < SCAN_PAGE
    const summary = await reconcileTitleMintsOnce({ db, evm, resolver, mint, now: NOW });
    expect(summary).toEqual({ examined: 12, minted: 12, skipped: 0, failed: 0 });
    expect(mint).toHaveBeenCalledTimes(12);
  });

  it('bounds a sweep to SCAN_PAGE rows (the walking cursor reaches the rest on later sweeps)', async () => {
    for (let i = 0; i < 25; i++) seedExport(`pack-${i}`, `author-${i}`, 60); // 25 > SCAN_PAGE (20)
    const summary = await reconcileTitleMintsOnce({ db, evm, resolver, mint, now: NOW });
    expect(summary.examined).toBe(20); // page-bounded; the rest follow on subsequent sweeps
    expect(summary.minted).toBe(20);
  });

  it('skips an export whose owner_wallet is a Base (0x) address, not an app wallet', async () => {
    seedExport('pack-A', 'authorA', 60);
    seedExport('pack-X', '0xBaseAddrNotAnAppWallet', 60); // mis-keyed owner → must be skipped, not mis-minted
    const summary = await reconcileTitleMintsOnce({ db, evm, resolver, mint, now: NOW });
    expect(summary).toEqual({ examined: 2, minted: 1, skipped: 1, failed: 0 });
    expect(mint).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledWith(db, evm, resolver, { sourcePackId: 'pack-A', creatorAppWallet: 'authorA' });
  });

  it('counts + swallows a per-item failure and still processes the rest', async () => {
    seedExport('pack-A', 'authorA', 60);
    seedExport('pack-D', 'authorD', 60);
    mint.mockImplementation(async (_d: any, _e: any, _r: any, args: any) => {
      if (args.sourcePackId === 'pack-A') throw new Error('chain down');
      return { snapshotPackId: 'x', tokenId: '1', mintTx: '0xt', alreadyMinted: false, creatorBase: 'b' };
    });
    const summary = await reconcileTitleMintsOnce({ db, evm, resolver, mint, now: NOW });
    expect(summary).toEqual({ examined: 2, minted: 1, failed: 1, skipped: 0 });
    expect(mint).toHaveBeenCalledTimes(2);
  });
});

describe('reconcileTitleMintsOnce — walking cursor (no starvation)', () => {
  it('advances past the examined page and WRAPS at the end of the walk', async () => {
    seedExport('pack-A', 'authorA', 60);
    seedTitle('pack-A', 'authorA', 'minted'); // already minted so no mint() call muddies the walk

    // Sweep 1: examines pack-A (cursor advances past it).
    const s1 = await reconcileTitleMintsOnce({ db, evm, resolver, mint, now: NOW });
    expect(s1.examined).toBe(1);
    // Sweep 2: cursor is now past pack-A → nothing settled remains → examined 0 and the cursor WRAPS.
    const s2 = await reconcileTitleMintsOnce({ db, evm, resolver, mint, now: NOW });
    expect(s2.examined).toBe(0);
    // Sweep 3: after the wrap, the walk restarts and re-examines pack-A (proving no permanent skip).
    const s3 = await reconcileTitleMintsOnce({ db, evm, resolver, mint, now: NOW });
    expect(s3.examined).toBe(1);
  });
});

describe('title reconciliation poller — own timer', () => {
  it('start is idempotent and stop is safe', () => {
    const a = startTitleReconciliationPoller(60_000);
    const b = startTitleReconciliationPoller(60_000); // second call is a no-op (one instance)
    expect(typeof a.stop).toBe('function');
    expect(typeof b.stop).toBe('function');
    stopTitleReconciliationPoller();
    stopTitleReconciliationPoller(); // safe when already stopped
  });
});
