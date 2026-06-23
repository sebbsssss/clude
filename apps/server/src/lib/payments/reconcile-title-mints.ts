/**
 * reconcile-title-mints — the durable backstop that makes "a title pack exists on Base once exported"
 * a GUARANTEE, not a hope. Runs on its OWN bounded-cadence timer (never inside the copy-delivery sweep).
 *
 * The export-time mint is best-effort + detached, so a transient miss (RPC down, Base env not yet set,
 * restart mid-mint) can leave an exported title pack without its Base title. Each sweep walks the
 * exported SOURCE title packs and idempotently re-runs the mint for any whose snapshot title is not yet
 * recorded. This is the §00 M6 "read-off-persisted-state, retry-until-done" discipline, redesigned after
 * a 4-agent backtest NO_GO'd the first version. The four fixes the backtest demanded, and how they land:
 *
 *   ① STARVATION (was CRITICAL: unordered LIMIT 100 + skip-minted stranded misses past the cap) →
 *      a WALKING CURSOR over created_at: each sweep advances past the page it examined and wraps at the
 *      end, so every export is visited over successive sweeps regardless of how many are already minted.
 *      The minted check is ONE batch `.in()` per page, not N point reads.
 *   ② COUPLING (was HIGH: awaited inside the M6 copy-delivery critical section) → its OWN timer + its
 *      OWN re-entrancy guard. A hung Base RPC here can never block copy delivery.
 *   ③ DOUBLE-MINT WINDOW + ④ CLONE RACE (was HIGH/MEDIUM: export's detached mint and a sweep racing the
 *      same pack) → a GRACE PERIOD: the sweep only considers packs exported MORE than GRACE_MS ago. The
 *      export's own detached mint settles in seconds, so by the time the sweep looks, that pack's mint
 *      is mined (a pack_titles row exists → skipped) or genuinely failed (no row → safe to re-mint with
 *      no concurrent actor). Combined with the single-sweeper guard, reconcile is never concurrent with
 *      an export mint or another sweep — so no duplicate clones and no concurrent broadcast. (A tx still
 *      stuck past GRACE_MS is the only residual: a 2nd broadcast that the contract's _safeMint reverts —
 *      asset-safe, gas-only, rare.)
 *   ⑤ Per-item chain calls are wrapped in a hard timeout so one slow mint can't consume the whole sweep.
 *
 * Idempotent + crash-safe throughout (mintTitleOnExport reuses the snapshot + no-ops a live mint). Cheap
 * when idle (a settled-export page scan; no Base client unless there's work). MONEY / IRREVERSIBLE-ASSET
 * CODE. NOT YET fixed: a SIGTERM drain for an in-flight mint (recoverable — the next process's sweep
 * re-attempts via the cursor; the copy poller shares this gap).
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

/** Default sweep cadence — a backstop, not a latency path. */
const DEFAULT_INTERVAL_MS = 300_000; // 5 min
/** Only reconcile exports OLDER than this, so the export's own detached mint has long settled (③/④). */
const GRACE_MS = 300_000; // 5 min
/** Rows examined per sweep (the cursor walks the whole set over successive sweeps). */
const SCAN_PAGE = 100;
/** Max on-chain mints attempted per sweep (bounds the irreversible work + the sweep's wall-clock). */
const MINT_PER_SWEEP = 10;
/** Hard per-item timeout so one slow chain call can't consume the sweep (⑤). */
const PER_ITEM_TIMEOUT_MS = 20_000;
/** Cursor sentinel: a timestamp strictly before any real created_at (the walk starts/wraps here). */
const EPOCH = '1970-01-01T00:00:00.000Z';

export interface ReconcileSummary {
  examined: number;
  minted: number;
  skipped: number;
  failed: number;
}
const EMPTY: ReconcileSummary = { examined: 0, minted: 0, skipped: 0, failed: 0 };

/** Injectable seams (defaults are the real singletons; tests pass mocks — no live chain, fixed clock). */
export interface ReconcileDeps {
  db?: ReturnType<typeof getDb>;
  evm?: EvmTitleClient;
  resolver?: BaseIdentityResolver;
  mint?: typeof mintTitleOnExport;
  /** Wall clock (ms) — injectable so tests control the GRACE window. Defaults to Date.now(). */
  now?: number;
}

// ── Walking-cursor state (module-scoped; one sweeper). Reset on process restart — a re-walk is safe. ──
let scanCursor = EPOCH;

/** Reject if `p` doesn't settle within `ms` (the underlying promise keeps running; the loop moves on). */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms`)), ms);
    if (typeof t.unref === 'function') t.unref();
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Run exactly one reconciliation sweep. Idempotent + crash-safe. Never throws — a transient failure is
 * logged and retried next tick. Returns a summary (examined / minted / skipped / failed).
 */
export async function reconcileTitleMintsOnce(deps: ReconcileDeps = {}): Promise<ReconcileSummary> {
  const db = deps.db ?? getDb();
  const mint = deps.mint ?? mintTitleOnExport;
  const nowMs = deps.now ?? Date.now();
  const graceCutoff = new Date(nowMs - GRACE_MS).toISOString();

  // 1) Walk one page of SETTLED source title exports (created before graceCutoff, after the cursor).
  let page: Array<{ pack_id: string; owner_wallet: string | null; created_at: string }>;
  try {
    const { data, error } = await db
      .from('pmp_artifacts')
      .select('pack_id, owner_wallet, created_at')
      .eq('license_type', 'title')
      .lt('created_at', graceCutoff)
      .gt('created_at', scanCursor)
      .order('created_at', { ascending: true })
      .limit(SCAN_PAGE);
    if (error) {
      log.error({ err: error }, 'reconcile: failed to scan title exports');
      return EMPTY; // leave the cursor — retry this page next sweep
    }
    page = (data ?? []) as typeof page;
  } catch (err) {
    log.error({ err }, 'reconcile: title export scan threw');
    return EMPTY;
  }

  // End of the walk (no settled rows past the cursor) → wrap to the start for the next sweep.
  if (page.length === 0) {
    scanCursor = EPOCH;
    return EMPTY;
  }
  // Advance the cursor past this page (even rows we filter out below, so the walk always progresses).
  scanCursor = page[page.length - 1]!.created_at;

  // AUTHORITATIVE exclusion of snapshot artifacts (pack_id 'tsnap-…') — never trust the DB wildcard; a
  // leaked snapshot row would be mis-read as a source pack and trigger a snapshot-of-a-snapshot mint.
  const exports = page.filter((r) => !String(r.pack_id ?? '').startsWith('tsnap-'));
  if (exports.length === 0) return EMPTY; // page was all snapshot rows; cursor already advanced

  // 2) Resolve the MINTER client + custodial resolver (absent Base env → no-op; cursor stays advanced).
  let evm = deps.evm;
  let resolver = deps.resolver;
  if (!evm || !resolver) {
    try {
      evm = evm ?? getMinterEvmTitleClient();
      resolver = resolver ?? getBaseIdentityResolver();
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'reconcile: Base title env not configured — skipping');
      return { ...EMPTY, examined: exports.length };
    }
  }
  if (!evm || !resolver) return { ...EMPTY, examined: exports.length }; // unreachable; narrows for TS

  // 3) BATCH minted-check: derive each export's expected snapshot title id (pure, no I/O), then ONE
  //    `.in()` over pack_titles. A title row exists iff the mint already completed (minted or later
  //    sold) — those are skipped; the misses are the rows with no title record.
  const withSnap: Array<{ pack_id: string; author: string; snapId: string }> = [];
  for (const e of exports) {
    if (!e.owner_wallet) continue; // a source export always carries its author; defensive
    withSnap.push({
      pack_id: e.pack_id,
      author: e.owner_wallet,
      snapId: snapshotPackId(e.pack_id, resolver.addressFor(e.owner_wallet)),
    });
  }

  let mintedSet = new Set<string>();
  if (withSnap.length > 0) {
    const { data: titleRows, error: tErr } = await db
      .from('pack_titles')
      .select('pack_id')
      .in('pack_id', withSnap.map((e) => e.snapId));
    if (tErr) {
      log.error({ err: tErr }, 'reconcile: failed to batch-check pack_titles');
      return { ...EMPTY, examined: exports.length };
    }
    mintedSet = new Set(((titleRows ?? []) as Array<{ pack_id: string }>).map((t) => t.pack_id));
  }

  const misses = withSnap.filter((e) => !mintedSet.has(e.snapId));

  // 4) Re-mint the misses (bounded per sweep), each under a hard timeout. Idempotent per item.
  let minted = 0;
  let failed = 0;
  const toMint = misses.slice(0, MINT_PER_SWEEP);
  for (const m of toMint) {
    try {
      await withTimeout(
        mint(db, evm, resolver, { sourcePackId: m.pack_id, creatorAppWallet: m.author }),
        PER_ITEM_TIMEOUT_MS,
        `reconcile mint ${m.pack_id}`,
      );
      minted += 1;
    } catch (err) {
      failed += 1;
      log.warn({ err: (err as Error).message, packId: m.pack_id }, 'reconcile: title mint retry failed (will retry)');
    }
  }

  // examined = skipped + minted + failed. skipped = everything examined we did NOT attempt to mint
  // (already-minted, no-owner, and any misses beyond the per-sweep cap — picked up by the cursor walk).
  const summary: ReconcileSummary = {
    examined: exports.length,
    minted,
    failed,
    skipped: exports.length - toMint.length,
  };
  if (minted > 0 || failed > 0) log.info(summary, 'title-mint reconciliation sweep complete');
  return summary;
}

// ── Own recurring poller (decoupled from the copy-delivery sweep — ② coupling fix) ──

let timer: NodeJS.Timeout | null = null;
let reconciling = false;

/** Run one sweep, guarded against overlap, swallowing errors (never let a transient failure kill it). */
async function tick(): Promise<void> {
  if (reconciling) return; // single sweeper — also part of the ③/④ no-concurrency guarantee
  reconciling = true;
  try {
    await reconcileTitleMintsOnce();
  } catch (err) {
    log.error({ err }, 'title-mint reconciliation tick failed (will retry next interval)');
  } finally {
    reconciling = false;
  }
}

/**
 * Start the recurring title-mint reconciliation poller on its OWN timer. Idempotent (one instance).
 * Returns a stop() handle. unref()'d so it never keeps the process alive on its own.
 */
export function startTitleReconciliationPoller(intervalMs: number = DEFAULT_INTERVAL_MS): { stop: () => void } {
  if (timer) return { stop: stopTitleReconciliationPoller };
  log.info({ intervalMs }, 'starting title-mint reconciliation poller (own timer, decoupled from delivery)');
  timer = setInterval(() => void tick(), intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return { stop: stopTitleReconciliationPoller };
}

/** Stop the poller (clears the interval). Safe to call when not running. */
export function stopTitleReconciliationPoller(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Test-only: reset the walking cursor (module state) between cases. */
export function __resetCursorForTests(): void {
  scanCursor = EPOCH;
}
