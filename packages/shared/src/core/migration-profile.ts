import { config } from '../config';

// ============================================================
// MIGRATION PROFILE — the switch layer for the GCP parallel-run
//
// Pure resolvers over config.migration. Everything defaults to the
// current live infra (Supabase + Voyage + in-process timers on), so
// importing/consuming this changes nothing until a flag is flipped.
// See docs/gcp-migration/00-switch-layer.md.
// ============================================================

export type DbTarget = 'supabase' | 'cloudsql';
export type EmbeddingSpace = 'voyage' | 'vertex';

export interface MigrationProfile {
  dbTarget: DbTarget;
  cloudsqlUrl: string;
  cloudsqlServiceKey: string;
  embeddingActive: EmbeddingSpace;
  runInProcessTimers: boolean;
}

export interface DbConnection {
  url: string;
  serviceKey: string;
}

const DB_TARGETS: readonly string[] = ['supabase', 'cloudsql'];
const EMBEDDING_SPACES: readonly string[] = ['voyage', 'vertex'];

function defaultSupabaseConnection(): DbConnection {
  return { url: config.supabase.url, serviceKey: config.supabase.serviceKey };
}

/**
 * Resolve the (url, serviceKey) that getDb() should connect to.
 *
 * Cloud SQL is fronted by a PostgREST-compatible endpoint, so switching backends
 * is only a connection swap — the ~600 supabase-js call sites are untouched.
 * Throws on an unknown target, or on cloudsql without credentials, so a mistyped
 * cutover flag fails fast instead of silently pointing at the wrong database.
 */
export function resolveDbConnection(
  profile: MigrationProfile = config.migration,
  supabase: DbConnection = defaultSupabaseConnection(),
): DbConnection {
  if (!DB_TARGETS.includes(profile.dbTarget)) {
    throw new Error(
      `Invalid DB_TARGET '${profile.dbTarget}' (expected 'supabase' | 'cloudsql')`,
    );
  }
  if (profile.dbTarget === 'cloudsql') {
    if (!profile.cloudsqlUrl || !profile.cloudsqlServiceKey) {
      throw new Error(
        'DB_TARGET=cloudsql requires CLOUDSQL_PGREST_URL and CLOUDSQL_SERVICE_KEY',
      );
    }
    return { url: profile.cloudsqlUrl, serviceKey: profile.cloudsqlServiceKey };
  }
  return { url: supabase.url, serviceKey: supabase.serviceKey };
}

/** The embedding vector space ingest + recall should use. Throws on an unknown value. */
export function activeEmbeddingSpace(
  profile: MigrationProfile = config.migration,
): EmbeddingSpace {
  if (!EMBEDDING_SPACES.includes(profile.embeddingActive)) {
    throw new Error(
      `Invalid EMBEDDING_ACTIVE '${profile.embeddingActive}' (expected 'voyage' | 'vertex')`,
    );
  }
  return profile.embeddingActive;
}

/** Whether this process should run the in-server singleton timers. */
export function shouldRunInProcessTimers(
  profile: MigrationProfile = config.migration,
): boolean {
  return profile.runInProcessTimers;
}

/**
 * Resolve the recall RPC name for the active embedding space: the Voyage originals
 * (e.g. `match_memories`) read the `embedding` column; the `_vertex` variants
 * (`match_memories_vertex`) read the shadow `embedding_vertex` column (migration 040).
 * Recall must call the variant that matches the space its query vector was embedded in.
 */
export function vectorRpcName(
  baseRpc: string,
  profile: MigrationProfile = config.migration,
): string {
  return activeEmbeddingSpace(profile) === 'vertex' ? `${baseRpc}_vertex` : baseRpc;
}

/** Fail-fast validation for boot: rejects a mistyped or under-configured cutover flag. */
export function assertValidMigrationProfile(
  profile: MigrationProfile = config.migration,
): void {
  resolveDbConnection(profile);
  activeEmbeddingSpace(profile);
}

/** One-line summary of the active profile for the boot log. */
export function describeMigrationProfile(
  profile: MigrationProfile = config.migration,
): string {
  return `db=${profile.dbTarget} embeddings=${profile.embeddingActive} inProcessTimers=${profile.runInProcessTimers}`;
}
