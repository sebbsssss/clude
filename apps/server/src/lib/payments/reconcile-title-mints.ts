/**
 * reconcile-title-mints — the durable backstop that makes "a title pack exists on Base once exported"
 * a strong guarantee. Runs on its OWN bounded-cadence timer (never inside the copy-delivery sweep).
 *
 * The export-time mint is best-effort + detached, so a transient miss (RPC down, Base env not yet set,
 * restart mid-mint) can leave an exported title pack without its Base title. Each sweep walks the
 * exported SOURCE title packs and idempotently re-runs the mint for any whose snapshot title is not yet
 * recorded. This is the §00 M6 "read-off-persisted-state, retry-until-done" discipline, redesigned after
 * a 4-agent backtest. How each backtest finding is addressed:
 *   ① STARVATION → a WALKING CURSOR over created_at: ALL of a page's misses are minted before the cursor
 *      advances PAST that page (no per-sweep cap stranding misses behind the cursor), and the cursor
 *      advances only at the END of a fully-processed page (a scan/batch error returns WITHOUT advancing,
 *      so the same page retries next sweep — never a silently-skipped page). The minted check is ONE
 *      batch `.in()` per page, not N point reads. The page size bounds per-sweep work.
 *   ② COUPLING → its OWN timer + OWN re-entrancy guard. A hung Base RPC here cannot block copy delivery.
 *   ③/④ DOUBLE-MINT + CLONE RACE → a GRACE PERIOD: only reconcile exports older than GRACE_MS. The
 *      export's own detached mint settles in seconds, so the sweep is never concurrent with it (nor,
 *      via the single-sweeper guard, with another sweep). Residual: a tx stuck past GRACE_MS → a 2nd
 *      broadcast the contract's _safeMint reverts (asset-safe, gas-only, rare).
 *   ⑤ Per-item chain calls AND the two DB reads are wrapped in hard timeouts so nothing can wedge the
 *      poller (the whole point of decoupling).
 *
 * KNOWN RESIDUALS (asset-safe; durability edges, tracked):
 *   - DUPLICATE created_at at a page boundary: if > SCAN_PAGE exports share the exact same millisecond
 *     timestamp, the strict `.gt(cursor)` skips the tail of that cluster (re-examined only after a wrap).
 *     Unreachable at gated launch volume; the durability-COMPLETE fix is a MARKER COLUMN
 *     (`pmp_artifacts.title_minted_at`, partial index, scan `WHERE … IS NULL`) which removes the cursor
 *     entirely and naturally handles failed-retry without stranding — the recommended upgrade before
 *     title volume scales.
 *   - A failed miss is retried after the cursor wraps the table (delayed, never permanently stranded).
 *   - No SIGTERM drain of an in-flight mint (recoverable — the next process's sweep re-attempts; the
 *     copy-delivery poller shares this gap).
 *
 * MONEY / IRREVERSIBLE-ASSET CODE; mintTitleOnExport stays idempotent.
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

const DEFAULT_INTERVAL_MS = 300_000; // 5 min — a backstop, not a latency path
const GRACE_MS = 300_000; // only reconcile exports older than this, so the export's own mint has settled
const SCAN_PAGE = 20; // rows examined per sweep; bounds per-sweep mints (ALL a page's misses are minted)
const PER_ITEM_TIMEOUT_MS = 20_000; // hard cap per chain mint
const DB_TIMEOUT_MS = 15_000; // hard cap per DB read (so a hung Supabase call can't wedge the poller)
const EPOCH = '1970-01-01T00:00:00.000Z'; // cursor sentinel: strictly before any real created_at

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

// ── Walking-cursor state (module-scoped; ONE sweeper — see the re-entrancy guard in tick()). Reset on
//    process restart, which just re-walks (safe). NOTE: reconcileTitleMintsOnce assumes a single caller;
//    do not invoke it concurrently (the poller's guard enforces this in prod). ──
let scanCursor = EPOCH;

/** Reject if `p` doesn't settle within `ms` (the underlying promise keeps running; the caller moves on). */
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
 * Run exactly one reconciliation sweep. Idempotent + crash-safe. Never throws. Returns a summary
 * (examined / minted / skipped / failed). The cursor advances ONLY after a page is fully processed.
 */
export async function reconcileTitleMintsOnce(deps: ReconcileDeps = {}): Promise<ReconcileSummary> {
  const db = deps.db ?? getDb();
  const mint = deps.mint ?? mintTitleOnExport;
  const nowMs = deps.now ?? Date.now();
  const graceCutoff = new Date(nowMs - GRACE_MS).toISOString();

  // 1) Scan one page of SETTLED source title exports past the cursor (DB read bounded). The cursor is
  //    NOT advanced here — only after the page is fully processed (step 6), so any early return below
  //    leaves it pointing at this page → the SAME page retries next sweep (no silently-skipped page).
  let page: Array<{ pack_id: string; owner_wallet: string | null; created_at: string }>;
  try {
    const { data, error } = await withTimeout(
      (async () =>
        db
          .from('pmp_artifacts')
          .select('pack_id, owner_wallet, created_at')
          .eq('license_type', 'title')
          .lt('created_at', graceCutoff)
          .gt('created_at', scanCursor)
          .order('created_at', { ascending: true })
          .limit(SCAN_PAGE))(),
      DB_TIMEOUT_MS,
      'reconcile scan',
    );
    if (error) {
      log.error({ err: error }, 'reconcile: failed to scan title exports');
      return EMPTY; // cursor unchanged → retry this page next sweep
    }
    page = (data ?? []) as typeof page;
  } catch (err) {
    log.error({ err: (err as Error).message }, 'reconcile: title export scan threw/timed out');
    return EMPTY;
  }

  // End of the walk (no settled rows past the cursor) → wrap to the start for the next sweep.
  if (page.length === 0) {
    scanCursor = EPOCH;
    return EMPTY;
  }

  // AUTHORITATIVE exclusion of snapshot artifacts (pack_id 'tsnap-…') — never trust the DB wildcard; a
  // leaked snapshot row would be mis-read as a source pack and trigger a snapshot-of-a-snapshot mint.
  const exports = page.filter((r) => !String(r.pack_id ?? '').startsWith('tsnap-'));

  // 2) Resolve the MINTER client + custodial resolver (absent Base env → return WITHOUT advancing the
  //    cursor; bootstrap gates the poller on the full Base env, so this is unreachable when configured).
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
  if (!evm || !resolver) return { ...EMPTY, examined: exports.length };

  // 3) Derive each export's expected snapshot title id (pure, no I/O). Skip rows whose owner_wallet is
  //    NOT an app (Solana) wallet — a 0x Base address would mis-key snapshotPackId and never match.
  const withSnap: Array<{ pack_id: string; author: string; snapId: string }> = [];
  for (const e of exports) {
    const author = e.owner_wallet;
    if (!author || author.startsWith('0x')) continue; // app wallet only; defensive
    withSnap.push({ pack_id: e.pack_id, author, snapId: snapshotPackId(e.pack_id, resolver.addressFor(author)) });
  }

  // 4) BATCH minted-check (bounded). A title row exists iff the mint already completed (minted or later
  //    sold) — those are skipped; the misses are the rows with no title record. On error, return WITHOUT
  //    advancing the cursor (retry the page).
  let mintedSet = new Set<string>();
  if (withSnap.length > 0) {
    try {
      const { data: titleRows, error: tErr } = await withTimeout(
        (async () => db.from('pack_titles').select('pack_id').in('pack_id', withSnap.map((e) => e.snapId)))(),
        DB_TIMEOUT_MS,
        'reconcile batch-check',
      );
      if (tErr) {
        log.error({ err: tErr }, 'reconcile: failed to batch-check pack_titles');
        return { ...EMPTY, examined: exports.length };
      }
      mintedSet = new Set(((titleRows ?? []) as Array<{ pack_id: string }>).map((t) => t.pack_id));
    } catch (err) {
      log.error({ err: (err as Error).message }, 'reconcile: pack_titles batch-check threw/timed out');
      return { ...EMPTY, examined: exports.length };
    }
  }

  // 5) Mint ALL of the page's misses (the page size bounds the work — no separate cap that could strand
  //    misses behind the advancing cursor). Each under a hard timeout; a per-item failure is swallowed.
  const misses = withSnap.filter((e) => !mintedSet.has(e.snapId));
  let minted = 0;
  let failed = 0;
  for (const m of misses) {
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

  // 6) Page fully processed → NOW advance the cursor past it. (A failed miss is retried after the cursor
  //    wraps the table; the page is never re-stuck, and progress is always made.)
  scanCursor = page[page.length - 1]!.created_at;

  const summary: ReconcileSummary = {
    examined: exports.length,
    minted,
    failed,
    skipped: exports.length - minted - failed, // derived from outcomes so the buckets always reconcile
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
