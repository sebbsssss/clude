import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('recall-canary');

/**
 * Recall canary (Memory 3.0 · C0 integrity floor).
 *
 * The migration-028 class of failure: a schema change (e.g. a second match_memories
 * overload) silently kills a recall lane, recall degrades to keyword-only, and nobody
 * notices for weeks. This worker converts that into a loud, hourly alert:
 *
 *   1. Insert two sentinel memories under a dedicated system owner, carrying a
 *      deterministic unit vector as their embedding (no embedding provider needed —
 *      we query with the SAME vector, so cosine similarity is exactly 1.0 if and
 *      only if the vector lane round-trips).
 *   2. Probe every recall RPC lane: match_memories, match_memory_fragments,
 *      match_memories_temporal, get_linked_memories.
 *   3. A lane that errors OR returns no sentinel hit is BROKEN → log.error (the
 *      Railway alert surface) + the report is exposed for /health integration.
 *   4. Delete the sentinels (fragments + links follow via FK ON DELETE CASCADE).
 *
 * Owner scoping: all probes filter by CANARY_OWNER, so the canary never reads or
 * pollutes tenant data.
 */

export const CANARY_OWNER = 'system:recall-canary';
export const CANARY_INTERVAL_MS = 60 * 60 * 1000; // hourly
const CANARY_BOOT_DELAY_MS = 15_000; // let the DB pool settle post-deploy
const EMBEDDING_DIM = 1024; // memories.embedding vector(1024)
const CANARY_MATCH_THRESHOLD = 0.8; // identical vector scores 1.0; anything real clears this

export interface LaneStatus {
  ok: boolean;
  rows: number;
  error: string | null;
}

export interface CanaryReport {
  at: string;
  healthy: boolean;
  lanes: Record<string, LaneStatus>;
}

let lastReport: CanaryReport | null = null;

/** Last canary result, for /health or dashboard surfacing. Null until the first run. */
export function getLastCanaryReport(): CanaryReport | null {
  return lastReport;
}

/**
 * Deterministic pseudo-random unit vector (LCG-seeded). Stable across runs and
 * processes, so a leftover sentinel from a crashed run still matches the next probe.
 */
export function canaryEmbedding(): number[] {
  let seed = 0xc1de;
  const v: number[] = new Array(EMBEDDING_DIM);
  for (let i = 0; i < EMBEDDING_DIM; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    v[i] = seed / 0x7fffffff - 0.5;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

type RpcResult = { data: unknown; error: { message?: string } | null };

async function probeLane(
  run: () => PromiseLike<RpcResult>,
  hit: (rows: any[]) => boolean,
): Promise<LaneStatus> {
  try {
    const { data, error } = await run();
    if (error) return { ok: false, rows: 0, error: error.message ?? String(error) };
    const rows = Array.isArray(data) ? data : [];
    return { ok: hit(rows), rows: rows.length, error: null };
  } catch (err) {
    return { ok: false, rows: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function cleanupSentinels(): Promise<void> {
  // Fragments + links cascade via FK ON DELETE CASCADE.
  const db = getDb();
  const { error } = await db.from('memories').delete().eq('owner_wallet', CANARY_OWNER);
  if (error) log.warn({ err: error.message }, 'Canary sentinel cleanup failed (next run will retry)');
}

export async function runRecallCanary(): Promise<CanaryReport> {
  const db = getDb();
  const emb = JSON.stringify(canaryEmbedding());
  const now = new Date();
  const lanes: Record<string, LaneStatus> = {};

  const fail = (error: string): CanaryReport => {
    for (const lane of ['match_memories', 'match_memory_fragments', 'match_memories_temporal', 'get_linked_memories']) {
      lanes[lane] = lanes[lane] ?? { ok: false, rows: 0, error: `seed failed: ${error}` };
    }
    const report: CanaryReport = { at: now.toISOString(), healthy: false, lanes };
    lastReport = report;
    log.error({ lanes }, 'RECALL CANARY FAILED — could not seed sentinels; recall health UNKNOWN');
    return report;
  };

  // Clear any leftovers from a crashed prior run, then seed fresh sentinels.
  await cleanupSentinels();

  const { data: inserted, error: insertErr } = await db
    .from('memories')
    .insert([
      {
        memory_type: 'semantic',
        content: 'Recall canary sentinel A (system health probe, auto-deleted)',
        summary: 'Recall canary sentinel A',
        importance: 0.05,
        owner_wallet: CANARY_OWNER,
        source: 'recall-canary',
        tags: ['system:canary'],
        embedding: emb,
        event_date: now.toISOString(),
        decay_factor: 1.0,
      },
      {
        memory_type: 'semantic',
        content: 'Recall canary sentinel B (system health probe, auto-deleted)',
        summary: 'Recall canary sentinel B',
        importance: 0.05,
        owner_wallet: CANARY_OWNER,
        source: 'recall-canary',
        tags: ['system:canary'],
        embedding: emb,
        decay_factor: 1.0,
      },
    ])
    .select('id');

  if (insertErr || !inserted || inserted.length < 2) {
    return fail(insertErr?.message ?? `expected 2 sentinel ids, got ${inserted?.length ?? 0}`);
  }
  const [idA, idB] = [inserted[0].id, inserted[1].id];

  // Fragment + link seeds are per-lane: if one fails, only its lane reports broken.
  const { error: fragErr } = await db.from('memory_fragments').insert({
    memory_id: idA,
    fragment_type: 'fact',
    content: 'Recall canary sentinel fragment',
    embedding: emb,
  });
  const { error: linkErr } = await db.from('memory_links').insert({
    source_id: idA,
    target_id: idB,
    link_type: 'relates',
    strength: 0.9,
  });

  lanes.match_memories = await probeLane(
    () =>
      db.rpc('match_memories', {
        query_embedding: emb,
        match_threshold: CANARY_MATCH_THRESHOLD,
        match_count: 5,
        filter_types: null,
        filter_user: null,
        min_decay: 0.1,
        filter_owner: CANARY_OWNER,
        filter_tags: null,
      }),
    (rows) => rows.some((r) => r.id === idA || r.id === idB),
  );

  lanes.match_memory_fragments = fragErr
    ? { ok: false, rows: 0, error: `fragment seed failed: ${fragErr.message}` }
    : await probeLane(
        () =>
          db.rpc('match_memory_fragments', {
            query_embedding: emb,
            match_threshold: CANARY_MATCH_THRESHOLD,
            match_count: 5,
            filter_owner: CANARY_OWNER,
          }),
        (rows) => rows.some((r) => r.memory_id === idA),
      );

  const dayMs = 24 * 60 * 60 * 1000;
  lanes.match_memories_temporal = await probeLane(
    () =>
      db.rpc('match_memories_temporal', {
        query_embedding: emb,
        match_threshold: CANARY_MATCH_THRESHOLD,
        match_count: 5,
        start_date: new Date(now.getTime() - dayMs).toISOString(),
        end_date: new Date(now.getTime() + dayMs).toISOString(),
        filter_types: null,
        filter_user: null,
        min_decay: 0.1,
        filter_owner: CANARY_OWNER,
        filter_tags: null,
      }),
    (rows) => rows.some((r) => r.id === idA),
  );

  lanes.get_linked_memories = linkErr
    ? { ok: false, rows: 0, error: `link seed failed: ${linkErr.message}` }
    : await probeLane(
        () =>
          db.rpc('get_linked_memories', {
            seed_ids: [idA],
            min_strength: 0.1,
            max_results: 5,
            filter_owner: CANARY_OWNER,
          }),
        (rows) => rows.some((r) => r.memory_id === idB),
      );

  await cleanupSentinels();

  const healthy = Object.values(lanes).every((l) => l.ok);
  const report: CanaryReport = { at: now.toISOString(), healthy, lanes };
  lastReport = report;

  if (healthy) {
    log.info({ lanes }, 'Recall canary healthy — all recall lanes round-trip');
  } else {
    const broken = Object.entries(lanes)
      .filter(([, l]) => !l.ok)
      .map(([name]) => name);
    log.error({ lanes, broken }, 'RECALL CANARY FAILED — recall lane(s) broken; vector recall may be silently degraded');
  }
  return report;
}

/** Start the canary: one probe shortly after boot (the deploy check), then hourly. */
export function startRecallCanary(opts: { intervalMs?: number } = {}): NodeJS.Timeout {
  const intervalMs = opts.intervalMs ?? CANARY_INTERVAL_MS;
  const kickoff = setTimeout(() => {
    void runRecallCanary().catch((err) => log.error({ err }, 'Recall canary run crashed'));
  }, CANARY_BOOT_DELAY_MS);
  kickoff.unref?.();

  const timer = setInterval(() => {
    void runRecallCanary().catch((err) => log.error({ err }, 'Recall canary run crashed'));
  }, intervalMs);
  timer.unref?.();

  log.info({ intervalMs }, 'Recall canary scheduled');
  return timer;
}
