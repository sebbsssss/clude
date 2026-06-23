/**
 * reconcile-title-mints — the durable backstop that GUARANTEES "a title pack exists on Base once
 * exported."
 *
 * The export route mints the Base title BEST-EFFORT + DETACHED (so a slow/hung chain never holds the
 * request). That means a transient miss is possible: the export succeeded, the `.pmp` shipped, but the
 * mint threw (RPC down, env not yet set, process restart mid-mint). THIS sweep closes that gap. Every
 * tick it scans the exported title packs and idempotently re-runs the mint for any that have no minted
 * Base title yet — exactly the §00 M6 "read-off-persisted-state, retry-until-done" discipline the copy
 * delivery poller uses.
 *
 * SIGNAL (no new table / no marker to maintain): a SOURCE pack export writes a `pmp_artifacts` row
 * (owner_wallet = the author's app wallet, license_type = the pack's sale_mode). A snapshot's own
 * artifact has pack_id `tsnap-…`, so source exports are `license_type='title' AND pack_id NOT LIKE
 * 'tsnap-%'`. For each, the expected title id is the deterministic `snapshotPackId(source, creatorBase)`;
 * if `pack_titles` shows it 'minted', skip — otherwise re-run mintTitleOnExport (which is itself fully
 * idempotent: snapshot reused, mint a no-op once on-chain). Stateless + self-correcting: it can never
 * drift, and re-running a minted pack is a cheap DB read with no chain call.
 *
 * CHEAP WHEN IDLE: the scan runs FIRST; with zero title exports it returns before constructing any Base
 * client. With exports present it resolves the MINTER client + custodial resolver, and if the Base env
 * is absent (non-Base deploys) it no-ops. Per-item errors are swallowed (logged) so one bad pack never
 * stalls the sweep — the next tick retries. MONEY / IRREVERSIBLE-ASSET CODE; the mint stays idempotent.
 *
 * ⚠️ STATUS: NOT WIRED — pending rework. A 4-agent adversarial backtest (2026-06-23) returned NO_GO on
 * this as first written + wired into the copy-delivery poller. The core single-threaded logic is sound
 * + unit-tested (skip-minted, skip-sold, re-mint-miss, resilient-per-item, snapshot-leak guard), but
 * the OPERATIONAL shape was wrong, so it was REMOVED from runDeliverySweepOnce until fixed:
 *   1. CRITICAL (starvation): the unordered `.limit(SCAN_LIMIT)` + skip-if-minted can permanently
 *      strand a genuine miss once the title backlog exceeds the cap — the backstop stops backstopping.
 *      FIX: scan only UN-minted candidates (a marker column / partial index on pmp_artifacts, or an
 *      anti-join against pack_titles), ordered (created_at), or a walking cursor; batch the minted
 *      check (one `.in()` over derived snapIds, not N point reads).
 *   2. HIGH (coupling): must run on its OWN bounded-cadence timer (~5 min), never inside the M6
 *      copy-delivery critical section — a hung Base RPC here must not block copy delivery.
 *   3. HIGH (double-mint window): mintTitle() returns at broadcast (no receipt await) while
 *      titleOwner() reads null pre-mining, so export + a sweep can both broadcast (asset-safe via
 *      _safeMint, but gas burn + racing mirror writes). FIX: an atomic claim (conditional INSERT of a
 *      pending_mint pack_titles row, unique on pack_id) before broadcast, or await the receipt.
 *   4. MEDIUM (clone TOCTOU): concurrent export-vs-sweep mintTitleOnExport for one pack can duplicate
 *      member clones (no DB uniqueness on the clone). FIX: partial unique index on
 *      memories(owner_wallet, metadata->>'title_snapshot_pack', metadata->>'title_snapshot_of_member').
 *   5. Bound per-item chain calls (viem timeout/retryCount) + a SIGTERM drain for the in-flight mint.
 */

import { createChildLogger } from '@clude/shared/core/logger';
import { getDb } from '@clude/shared/core/database';
import type { EvmTitleClient } from '../evm-title-client.js';
import type { BaseIdentityResolver } from './base-identity.js';
import { getMinterEvmTitleClient } from './evm-title-config.js';
import { getBaseIdentityResolver } from './base-identity.js';
import { mintTitleOnExport } from './mint-title-on-export.js';
import { snapshotPackId } from './snapshot-pack-for-title.js';

const log = createChildLogger('reconcile-title-mints');

/** Max exported title packs examined per sweep (bounds the backstop; more are picked up next tick). */
const SCAN_LIMIT = 100;

export interface ReconcileSummary {
  examined: number;
  minted: number;
  skipped: number;
  failed: number;
}

const EMPTY: ReconcileSummary = { examined: 0, minted: 0, skipped: 0, failed: 0 };

/** Injectable seams (defaults are the real singletons; tests pass mocks — no live chain). */
export interface ReconcileDeps {
  db?: ReturnType<typeof getDb>;
  evm?: EvmTitleClient;
  resolver?: BaseIdentityResolver;
  /** The mint orchestrator (mintTitleOnExport). Injectable so tests assert dispatch without a chain. */
  mint?: typeof mintTitleOnExport;
}

/**
 * Run exactly one title-mint reconciliation sweep. Idempotent + crash-safe. Returns a summary
 * (examined / minted / skipped / failed). Never throws — a transient failure is logged and retried
 * next tick.
 */
export async function reconcileTitleMintsOnce(deps: ReconcileDeps = {}): Promise<ReconcileSummary> {
  const db = deps.db ?? getDb();
  const mint = deps.mint ?? mintTitleOnExport;

  // 1) CHEAP SCAN FIRST — exported SOURCE title packs (snapshot artifacts are pack_id LIKE 'tsnap-%').
  //    With none, return before constructing any Base client (the common, non-title case).
  let exports: Array<{ pack_id: string; owner_wallet: string | null }>;
  try {
    const { data, error } = await db
      .from('pmp_artifacts')
      .select('pack_id, owner_wallet')
      .eq('license_type', 'title')
      .not('pack_id', 'like', 'tsnap-%') // DB-side optimisation (PostgREST like); see the JS guard below
      .limit(SCAN_LIMIT);
    if (error) {
      log.error({ err: error }, 'reconcile: failed to scan title exports');
      return EMPTY;
    }
    // AUTHORITATIVE exclusion of snapshot artifacts (pack_id 'tsnap-…'): do NOT trust the PostgREST
    // `like` wildcard semantics (* vs %) — a leaked snapshot row would be mis-read as a source pack
    // and trigger a spurious snapshot-of-a-snapshot mint. The startsWith filter is the real guard.
    exports = ((data ?? []) as Array<{ pack_id: string; owner_wallet: string | null }>).filter(
      (r) => !String(r.pack_id ?? '').startsWith('tsnap-'),
    );
  } catch (err) {
    log.error({ err }, 'reconcile: title export scan threw');
    return EMPTY;
  }
  if (exports.length === 0) return EMPTY;

  // 2) There IS work → resolve the MINTER client + custodial resolver. Absent Base env → no-op.
  let evm = deps.evm;
  let resolver = deps.resolver;
  if (!evm || !resolver) {
    try {
      evm = evm ?? getMinterEvmTitleClient();
      resolver = resolver ?? getBaseIdentityResolver();
    } catch (err) {
      log.warn(
        { err: (err as Error).message },
        'reconcile: Base title env not configured — skipping title-mint reconciliation',
      );
      return { ...EMPTY, examined: exports.length };
    }
  }

  // 3) Re-mint any exported title pack whose snapshot title is not yet 'minted'. Idempotent per item.
  let minted = 0;
  let skipped = 0;
  let failed = 0;
  for (const exp of exports) {
    const author = exp.owner_wallet;
    if (!author) {
      skipped += 1; // a source export always carries its author owner_wallet; defensive
      continue;
    }
    try {
      const creatorBase = resolver.addressFor(author);
      const snapId = snapshotPackId(exp.pack_id, creatorBase);
      const { data: titleRow } = await db
        .from('pack_titles')
        .select('pack_id')
        .eq('pack_id', snapId)
        .maybeSingle();
      // SKIP if a title record EXISTS at all — a pack_titles row is written iff the mint already
      // completed (status 'minted', or later 'transferring'/'transferred' once SOLD). Re-running the
      // mint for a minted OR sold title is harmful: mintTitleForPack's mirror upsert would revert a
      // sold title's status back to 'minted' AND grantCreatorTitleOwner would re-grant the seller
      // access they no longer hold. Only mint a GENUINE miss (no record). A crash-after-broadcast (no
      // row but token live on-chain) still self-heals via mintTitleForPack's own ownerOf pre-check.
      if (titleRow) {
        skipped += 1; // already minted (or sold) — cheap no-op, no chain call
        continue;
      }
      await mint(db, evm, resolver, { sourcePackId: exp.pack_id, creatorAppWallet: author });
      minted += 1;
    } catch (err) {
      failed += 1;
      log.warn(
        { err: (err as Error).message, packId: exp.pack_id },
        'reconcile: title mint retry failed (will retry next sweep)',
      );
    }
  }

  const summary: ReconcileSummary = { examined: exports.length, minted, skipped, failed };
  if (minted > 0 || failed > 0) {
    log.info(summary, 'title-mint reconciliation sweep complete');
  }
  return summary;
}
