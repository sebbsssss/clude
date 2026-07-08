/**
 * Backfill the Vertex shadow embedding space (migration 040) for the Voyage -> Vertex
 * cutover. Re-embeds every memory summary + fragment that already has a Voyage vector
 * into the embedding_vertex column via Vertex gemini-embedding-001.
 *
 * Properties:
 *  - RESUMABLE: only touches rows where embedding_vertex IS NULL. Keyset-paginated by
 *    id so it makes forward progress even if some rows fail; a fresh re-run retries them.
 *  - READ-ONLY on the Voyage space: never writes the `embedding` column.
 *  - RATE-LIMIT AWARE: batch size + inter-batch delay are configurable.
 *
 * Prereqs: migration 040 applied; VERTEX_PROJECT set with ADC or VERTEX_ACCESS_TOKEN;
 * SUPABASE_URL/SUPABASE_SERVICE_KEY (or DB_TARGET=cloudsql + CLOUDSQL_*) pointing at the
 * SAME database the app reads.
 *
 * Run (from repo root):
 *   VERTEX_PROJECT=clude-query-sol-data \
 *   VERTEX_ACCESS_TOKEN="$(gcloud auth print-access-token)" \
 *   pnpm exec tsx scripts/backfill-vertex-embeddings.ts
 *
 * Env flags: BACKFILL_BATCH (default 64), BACKFILL_DELAY_MS (default 250),
 *   BACKFILL_TABLE (memories | fragments | both, default both).
 */
import { getDb } from '@clude/shared/core/database';
import { generateVertexEmbeddings, isVertexConfigured } from '@clude/shared/core/embeddings';

type Db = ReturnType<typeof getDb>;

const BATCH = parseInt(process.env.BACKFILL_BATCH ?? '64', 10);
const DELAY_MS = parseInt(process.env.BACKFILL_DELAY_MS ?? '250', 10);
const TABLE = process.env.BACKFILL_TABLE ?? 'both';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Backfill one table (keyset-paginated by id). `textCol` is the source text to embed. */
async function backfill(db: Db, table: 'memories' | 'memory_fragments', textCol: string): Promise<void> {
  let lastId = 0;
  let scanned = 0;
  let wroteTotal = 0;
  for (;;) {
    const { data, error } = await db
      .from(table)
      .select(`id, ${textCol}`)
      .is('embedding_vertex', null)
      .not('embedding', 'is', null)
      .gt('id', lastId)
      .order('id', { ascending: true })
      .limit(BATCH);
    if (error) throw new Error(`[${table}] select failed: ${error.message}`);
    if (!data || data.length === 0) break;

    const rows = data as Array<Record<string, unknown>>;
    const texts = rows.map((r) => String(r[textCol] ?? '').slice(0, 8000));
    const vecs = await generateVertexEmbeddings(texts);

    let wrote = 0;
    for (let i = 0; i < rows.length; i++) {
      const v = vecs[i];
      if (!v) continue; // leave NULL so a re-run retries this row
      const { error: uErr } = await db
        .from(table)
        .update({ embedding_vertex: JSON.stringify(v) })
        .eq('id', rows[i].id as number);
      if (uErr) {
        console.error(`[${table}] update id=${rows[i].id}: ${uErr.message}`);
        continue;
      }
      wrote++;
    }

    scanned += rows.length;
    wroteTotal += wrote;
    lastId = Number(rows[rows.length - 1].id);
    console.log(`[${table}] scanned=${scanned} wrote_total=${wroteTotal} lastId=${lastId}`);

    if (wrote === 0) {
      // Whole batch failed to embed (auth/quota) — stop rather than burn the rest.
      throw new Error(`[${table}] batch produced 0 embeddings — check Vertex auth/quota and retry`);
    }
    await sleep(DELAY_MS);
  }
  console.log(`[${table}] DONE — scanned=${scanned} wrote_total=${wroteTotal}`);
}

async function main(): Promise<void> {
  if (!isVertexConfigured()) {
    console.error('VERTEX_PROJECT is not set — nothing to do. Set VERTEX_PROJECT (+ ADC or VERTEX_ACCESS_TOKEN).');
    process.exit(1);
  }
  const db = getDb();
  if (TABLE === 'memories' || TABLE === 'both') await backfill(db, 'memories', 'summary');
  if (TABLE === 'fragments' || TABLE === 'both') await backfill(db, 'memory_fragments', 'content');
  console.log('Backfill complete. Build the shadow HNSW indexes now (see runbook), then validate with the LongMemEval harness under EMBEDDING_ACTIVE=vertex before flipping.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
