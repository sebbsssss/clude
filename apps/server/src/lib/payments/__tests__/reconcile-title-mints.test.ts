/**
 * reconcileTitleMintsOnce — the durable backstop that guarantees "a title pack exists on Base once
 * exported". MONEY/ASSET CODE. This suite pins the sweep contract:
 *
 *   1. SCAN: only SOURCE title exports are examined — license_type='title' AND pack_id NOT LIKE
 *      'tsnap-%' (snapshot artifacts are excluded), and copy exports are excluded.
 *   2. SKIP-MINTED: an exported title pack whose snapshot title is already 'minted' is a cheap no-op
 *      (no mint call) — so steady state costs only DB reads.
 *   3. RE-MINT: an exported title pack with no minted title triggers mintTitleOnExport(source, author).
 *   4. RESILIENT: a per-item failure is counted + swallowed; the rest of the sweep still runs.
 *   5. IDLE-CHEAP: zero title exports → EMPTY, no Base client touched, no mint.
 *
 * db/evm/resolver/mint are injected; the REAL snapshotPackId derives the expected title id (so the
 * skip-minted seed matches what the sweep computes). No live chain.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { reconcileTitleMintsOnce } from '../reconcile-title-mints.js';
import { snapshotPackId } from '../snapshot-pack-for-title.js';

// ── A tiny query mock supporting exactly the calls the sweep makes ──
//   pmp_artifacts: .select().eq('license_type',v).not('pack_id','like','tsnap-%').limit(n)  (awaited)
//   pack_titles:   .select('status').eq('pack_id', snapId).maybeSingle()
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
}
function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}
function likeToRe(pattern: string): RegExp {
  // SQL LIKE → regex: % → .*, _ → ., escape the rest.
  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${esc}$`);
}
function makeChain(table: string) {
  const filters: Array<(r: Row) => boolean> = [];
  let limit = Infinity;
  const matched = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, limit);
  const chain: Record<string, any> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return chain; },
    not: (c: string, op: string, v: any) => {
      if (op === 'like') { const re = likeToRe(v); filters.push((r) => !re.test(String(r[c] ?? ''))); }
      else { filters.push((r) => r[c] !== v); }
      return chain;
    },
    like: (c: string, v: any) => { const re = likeToRe(v); filters.push((r) => re.test(String(r[c] ?? ''))); return chain; },
    limit: (n: number) => { limit = n; return chain; },
    maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
    then: (resolve: (v: any) => any) => Promise.resolve({ data: matched(), error: null }).then(resolve),
  });
  return chain;
}
const db = { from: (t: string) => makeChain(t) } as any;

// addressFor: deterministic Base addr per app wallet. snapId = snapshotPackId(source, creatorBase).
const resolver = { custodial: true, addressFor: (app: string) => `0xBase-${app}`, keysFor: () => { throw new Error('unused'); } } as any;
const evm = {} as any; // passed through to the injected mint; never called directly here
// `any` so vi.fn() satisfies the precise mint?: typeof mintTitleOnExport seam without cast noise.
let mint: any;

beforeEach(() => {
  resetDb();
  mint = vi.fn(async () => ({ snapshotPackId: 'x', tokenId: '1', mintTx: '0xt', alreadyMinted: false, creatorBase: 'b' }));
});

/** Mark a source title pack's snapshot title as already minted (so the sweep skips it). */
function seedMinted(sourcePackId: string, author: string) {
  const snapId = snapshotPackId(sourcePackId, resolver.addressFor(author));
  seed('pack_titles', [{ pack_id: snapId, status: 'minted' }]);
}

describe('reconcileTitleMintsOnce', () => {
  it('re-mints an exported title pack with no minted title, skips an already-minted one', async () => {
    seed('pmp_artifacts', [
      { pack_id: 'pack-A', owner_wallet: 'authorA', license_type: 'title' }, // NOT minted → re-mint
      { pack_id: 'pack-B', owner_wallet: 'authorB', license_type: 'title' }, // minted → skip
      { pack_id: 'tsnap-deadbeef', owner_wallet: '0xBase-authorA', license_type: 'title' }, // snapshot → excluded
      { pack_id: 'pack-C', owner_wallet: 'authorC', license_type: 'copy' }, // copy → excluded
    ]);
    seedMinted('pack-B', 'authorB');

    const summary = await reconcileTitleMintsOnce({ db, evm, resolver, mint });

    // Only the two SOURCE title exports are examined (snapshot + copy excluded by the scan filters).
    expect(summary).toEqual({ examined: 2, minted: 1, skipped: 1, failed: 0 });
    // The mint ran exactly once, for the un-minted pack, with (source, author).
    expect(mint).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledWith(db, evm, resolver, { sourcePackId: 'pack-A', creatorAppWallet: 'authorA' });
  });

  it('is a cheap no-op when there are no title exports (no mint, no Base client needed)', async () => {
    seed('pmp_artifacts', [{ pack_id: 'pack-C', owner_wallet: 'authorC', license_type: 'copy' }]);
    // Inject NO evm/resolver — proving the idle path never touches a Base client.
    const summary = await reconcileTitleMintsOnce({ db, mint });
    expect(summary).toEqual({ examined: 0, minted: 0, skipped: 0, failed: 0 });
    expect(mint).not.toHaveBeenCalled();
  });

  it('counts + swallows a per-item failure and still processes the rest of the sweep', async () => {
    seed('pmp_artifacts', [
      { pack_id: 'pack-A', owner_wallet: 'authorA', license_type: 'title' }, // mint throws
      { pack_id: 'pack-D', owner_wallet: 'authorD', license_type: 'title' }, // mint succeeds
    ]);
    mint.mockImplementation(async (_db: any, _evm: any, _res: any, args: any) => {
      if (args.sourcePackId === 'pack-A') throw new Error('chain down');
      return { snapshotPackId: 'x', tokenId: '1', mintTx: '0xt', alreadyMinted: false, creatorBase: 'b' };
    });

    const summary = await reconcileTitleMintsOnce({ db, evm, resolver, mint });

    expect(summary).toEqual({ examined: 2, minted: 1, failed: 1, skipped: 0 });
    expect(mint).toHaveBeenCalledTimes(2); // the throw on A did NOT abort the sweep; D still ran
  });

  it('skips a source export with no owner_wallet (defensive) without minting', async () => {
    seed('pmp_artifacts', [{ pack_id: 'pack-A', owner_wallet: null, license_type: 'title' }]);
    const summary = await reconcileTitleMintsOnce({ db, evm, resolver, mint });
    expect(summary).toEqual({ examined: 1, minted: 0, skipped: 1, failed: 0 });
    expect(mint).not.toHaveBeenCalled();
  });
});
