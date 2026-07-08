import { getDb } from '@clude/shared/core/database';
import { config } from '@clude/shared/config';
import { createChildLogger } from '@clude/shared/core/logger';
import { isRouterConfigured, routerBudgetAvailable, noteRouterCall, routeReconcile } from './reconcile-router';

const log = createChildLogger('reconcile-shadow');

/**
 * Memory 3.0 C1 — write-time reconciliation, SHADOW slice (LLM-free).
 *
 * For a just-written memory, RECORD a proposed reconciliation op into memory_reconciliation_log
 * WITHOUT applying it, so the enforce path can be greenlit from a labeled sample (target: <2%
 * false-positive supersession) before it ever mutates a memory row.
 *
 * Central safety rule: COSINE ONLY SCREENS. Embeddings are measured to conflate different facts
 * about the same topic ("flight at 3pm" vs "5pm"), so nothing is auto-superseded here. A write
 * whose top owner-scoped cosine is >= LO logs `needs_router` (a candidate the future LLM router
 * would judge); everything else logs `add`. There is no cosine-only NOOP/UPDATE.
 *
 * Slice 1 is LLM-free: only the gate runs, producing the max_cosine / band distribution used to
 * calibrate LO and size the router before slice 1.5 turns the router on.
 */

// Mirrors SCOPE_BOT_OWN in memory.ts:95. Kept LOCAL so this module imports nothing at runtime from
// memory.ts (memory.ts imports runReconcileShadow to wire it — a back-import would be a cycle).
const SCOPE_BOT_OWN = '__BOT_OWN__';

const K_CANDIDATES = 6;

export type ProposedOp = 'add' | 'update' | 'noop' | 'needs_router' | 'skip';
export type Band = 'hi' | 'mid' | 'lo' | 'none';

interface ShadowRow {
  memory_id: number;
  owner_wallet: string | null;
  mode: 'shadow';
  proposed_op: ProposedOp;
  target_memory_id: number | null;
  max_cosine: number | null;
  band: Band;
  router_used: boolean;
  router_model?: string | null;
  fact_key: null;
  reason: string;
  gate_version: string;
}

// Degrade-once (mirrors logOutboxDegradeOnce): a missing memory_reconciliation_log (42P01 when
// migration 046 is unapplied) must not spam one WARN per write. The write already succeeded; a
// dropped shadow row is only lost measurement, never lost data.
let reconcileDegradeLogged = false;
function logReconcileDegradeOnce(err: unknown, memoryId: number): void {
  if (reconcileDegradeLogged) return;
  reconcileDegradeLogged = true;
  const e = err as { code?: string; message?: string };
  log.warn(
    { code: e?.code, message: e?.message, memoryId },
    'Reconcile shadow degraded (migration 046 unapplied?) — skipping; write unaffected',
  );
}

/** @internal test-only reset for the once-guard. */
export function _resetReconcileDegradeLog(): void {
  reconcileDegradeLogged = false;
}

// Encodes the thresholds + code version onto every row so a later threshold change is filterable
// in the data (the shadow sample is only comparable within one gate regime).
function gateVersion(): string {
  const { reconcileFloor: f, reconcileLo: lo, reconcileHi: hi } = config.memory;
  return `c1-shadow-v1:floor=${f}:lo=${lo}:hi=${hi}`;
}

async function insertShadowRow(row: ShadowRow): Promise<void> {
  try {
    const { error } = await getDb().from('memory_reconciliation_log').insert(row);
    if (error) logReconcileDegradeOnce(error, row.memory_id);
  } catch (err) {
    logReconcileDegradeOnce(err, row.memory_id);
  }
}

/**
 * Run the SHADOW reconciliation decision for a just-written memory. MUST be called fully detached
 * (fire-and-forget) AFTER embedMemory has persisted memories.embedding — it reads that vector
 * rather than re-embedding (the batch embedder does not warm the cache, so a re-embed would be a
 * real extra API call on the write path). Never mutates a memory row; never throws.
 *
 * @param scope the RESOLVED owner scope — a wallet, or SCOPE_BOT_OWN for bot-own writes. NEVER
 *   null: the caller passes `ownerWallet ?? SCOPE_BOT_OWN`, so the candidate query is always
 *   owner-fenced. getOwnerScope() alone can return null (fail-open) when the C0 fence flag is off,
 *   which would screen against every tenant — so this path must not trust it.
 */
export async function runReconcileShadow(memoryId: number, scope: string): Promise<void> {
  // Off-switch under benchmarks: measurement must not add load or confound retrieval state.
  if (process.env.BENCH_MODE === 'true') return;

  const ownerWalletForRow = scope === SCOPE_BOT_OWN ? null : scope;
  const gv = gateVersion();
  const db = getDb();

  const skip = (reason: string): Promise<void> =>
    insertShadowRow({
      memory_id: memoryId, owner_wallet: ownerWalletForRow, mode: 'shadow', proposed_op: 'skip',
      target_memory_id: null, max_cosine: null, band: 'none', router_used: false, fact_key: null,
      reason, gate_version: gv,
    });

  const add = (reason: string, maxCosine: number | null, band: Band): Promise<void> =>
    insertShadowRow({
      memory_id: memoryId, owner_wallet: ownerWalletForRow, mode: 'shadow', proposed_op: 'add',
      target_memory_id: null, max_cosine: maxCosine, band, router_used: false, fact_key: null,
      reason, gate_version: gv,
    });

  // 1. Read the persisted summary embedding (embedMemory wrote memories.embedding = the summary
  //    vector — the same vector recall's primary lane screens on). No re-embed.
  let embedding: unknown;
  let newSummary = '';
  let newEventDate: string | null = null;
  try {
    const { data, error } = await db.from('memories')
      .select('embedding, summary, event_date, created_at').eq('id', memoryId).maybeSingle();
    if (error) { logReconcileDegradeOnce(error, memoryId); return; }
    const row = data as { embedding?: unknown; summary?: string; event_date?: string | null; created_at?: string | null } | null;
    embedding = row?.embedding ?? null;
    newSummary = row?.summary ?? '';
    newEventDate = row?.event_date ?? row?.created_at ?? null;
  } catch (err) {
    logReconcileDegradeOnce(err, memoryId); return;
  }
  if (!embedding) { await skip('no_embedding'); return; }
  const queryEmbedding = typeof embedding === 'string' ? embedding : JSON.stringify(embedding);

  // 2. Screen: top-K owner-scoped similar memories via match_memories_temporal (null dates = the
  //    non-temporal match_memories, which is NOT in the boot blob). match_threshold = the LOW floor
  //    so max_cosine is captured even for below-LO writes (LO is tuned from this data, not fixed).
  //    filter_owner = the resolved scope, NEVER null → always owner-fenced (the RPC handles the
  //    __BOT_OWN__ sentinel as owner_wallet IS NULL).
  let candidates: Array<{ id: number; similarity: number }>;
  try {
    const { data, error } = await db.rpc('match_memories_temporal', {
      query_embedding: queryEmbedding,
      match_threshold: config.memory.reconcileFloor,
      match_count: K_CANDIDATES,
      start_date: null,
      end_date: null,
      filter_types: null,
      filter_user: null,
      min_decay: 0,
      filter_owner: scope,
      filter_tags: null,
    });
    if (error) { logReconcileDegradeOnce(error, memoryId); return; }
    candidates = (data as Array<{ id: number; similarity: number }> | null) ?? [];
  } catch (err) {
    logReconcileDegradeOnce(err, memoryId); return;
  }

  // Drop the just-inserted row (belt-and-suspenders; it usually has no embedding yet so the RPC
  // won't surface it anyway).
  candidates = candidates.filter((c) => c.id !== memoryId);
  if (candidates.length === 0) { await add('no_candidate', null, 'none'); return; }

  // 3. Hydrate to drop already-invalidated candidates (match_memories_temporal predates 044 and
  //    does not filter invalid_at — best-effort; enforce re-checks in-txn). Re-fence by the
  //    resolved scope (defense-in-depth; the RPC already fenced, but scope here is trustworthy
  //    whereas getOwnerScope() is not when the C0 flag is off).
  const ids = candidates.map((c) => c.id);
  let validIds: Set<number>;
  const hydratedById = new Map<number, { summary: string; eventDate: string | null }>();
  try {
    // `any` on the builder: the PostgREST generic chain (.select().in().eq/is) is deep enough to
    // trip TS2589 (excessively deep instantiation); we validate the row shape ourselves below.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const base: any = db.from('memories').select('id, owner_wallet, invalid_at, summary, event_date, created_at').in('id', ids);
    const scoped = scope === SCOPE_BOT_OWN ? base.is('owner_wallet', null) : base.eq('owner_wallet', scope);
    const { data, error } = await scoped;
    if (error) { logReconcileDegradeOnce(error, memoryId); return; }
    const rows = (data as Array<{ id: number; owner_wallet: string | null; invalid_at: string | null; summary?: string; event_date?: string | null; created_at?: string | null }> | null) ?? [];
    const valid = rows
      .filter((r) => r.invalid_at == null)
      .filter((r) => (scope === SCOPE_BOT_OWN ? r.owner_wallet == null : r.owner_wallet === scope));
    validIds = new Set(valid.map((r) => r.id));
    for (const r of valid) hydratedById.set(r.id, { summary: r.summary ?? '', eventDate: r.event_date ?? r.created_at ?? null });
  } catch (err) {
    logReconcileDegradeOnce(err, memoryId); return;
  }

  // candidates are ordered by similarity DESC (RPC orders by distance ASC); keep that order.
  const surviving = candidates.filter((c) => validIds.has(c.id));
  if (surviving.length === 0) { await add('no_valid_candidate', null, 'none'); return; }

  const maxCosine = surviving[0].similarity;
  const { reconcileLo: LO, reconcileHi: HI } = config.memory;
  if (maxCosine < LO) { await add('below_lo', maxCosine, 'lo'); return; }

  // 4. >= LO: a similar prior fact exists. The LLM router (slice 1.5) classifies add/update/noop;
  //    cosine NEVER decides supersession. Router OFF / over budget / no provider → needs_router
  //    (gate-only instrumentation). The router only ever sees THIS owner's candidate summaries.
  const band: Band = maxCosine >= HI ? 'hi' : 'mid';
  const top = surviving[0];
  if (isRouterConfigured() && routerBudgetAvailable(ownerWalletForRow)) {
    noteRouterCall(ownerWalletForRow);
    const routerCandidates = surviving.map((c) => ({
      id: c.id,
      summary: hydratedById.get(c.id)?.summary ?? '',
      eventDate: hydratedById.get(c.id)?.eventDate ?? null,
    }));
    const decision = await routeReconcile({ summary: newSummary, eventDate: newEventDate }, routerCandidates);
    await insertShadowRow({
      memory_id: memoryId, owner_wallet: ownerWalletForRow, mode: 'shadow', proposed_op: decision.op,
      target_memory_id: decision.op === 'add' ? null : decision.targetId, max_cosine: maxCosine, band,
      router_used: true, router_model: decision.model, fact_key: null,
      reason: decision.reason || 'router', gate_version: gv,
    });
    return;
  }
  await insertShadowRow({
    memory_id: memoryId, owner_wallet: ownerWalletForRow, mode: 'shadow', proposed_op: 'needs_router',
    target_memory_id: top.id, max_cosine: maxCosine, band, router_used: false, fact_key: null,
    reason: 'similar_prior_fact', gate_version: gv,
  });
}
