import { describe, it, expect } from 'vitest';
import {
  resolveDbConnection,
  activeEmbeddingSpace,
  shouldRunInProcessTimers,
  assertValidMigrationProfile,
  describeMigrationProfile,
  type MigrationProfile,
} from '../migration-profile';

// The default profile: exactly today's live behavior (Supabase + Voyage + timers on).
const baseProfile: MigrationProfile = {
  dbTarget: 'supabase',
  cloudsqlUrl: '',
  cloudsqlServiceKey: '',
  embeddingActive: 'voyage',
  runInProcessTimers: true,
};

const SUPA = { url: 'https://supa.example', serviceKey: 'supa-key' };

describe('resolveDbConnection', () => {
  it('returns the Supabase connection when dbTarget is supabase', () => {
    expect(resolveDbConnection(baseProfile, SUPA)).toEqual({
      url: 'https://supa.example',
      serviceKey: 'supa-key',
    });
  });

  it('returns the Cloud SQL connection when dbTarget is cloudsql', () => {
    const profile: MigrationProfile = {
      ...baseProfile,
      dbTarget: 'cloudsql',
      cloudsqlUrl: 'https://pgrest.gcp',
      cloudsqlServiceKey: 'gcp-key',
    };
    expect(resolveDbConnection(profile, SUPA)).toEqual({
      url: 'https://pgrest.gcp',
      serviceKey: 'gcp-key',
    });
  });

  it('throws when dbTarget is cloudsql but the Cloud SQL URL is missing', () => {
    const profile: MigrationProfile = { ...baseProfile, dbTarget: 'cloudsql', cloudsqlServiceKey: 'gcp-key' };
    expect(() => resolveDbConnection(profile, SUPA)).toThrow(/CLOUDSQL_PGREST_URL/);
  });

  it('throws on an unknown dbTarget rather than silently defaulting to Supabase', () => {
    const profile = { ...baseProfile, dbTarget: 'mongo' } as unknown as MigrationProfile;
    expect(() => resolveDbConnection(profile, SUPA)).toThrow(/Invalid DB_TARGET/);
  });
});

describe('activeEmbeddingSpace', () => {
  it('returns voyage by default', () => {
    expect(activeEmbeddingSpace(baseProfile)).toBe('voyage');
  });

  it('returns vertex when selected', () => {
    expect(activeEmbeddingSpace({ ...baseProfile, embeddingActive: 'vertex' })).toBe('vertex');
  });

  it('throws on an unknown embedding space', () => {
    const profile = { ...baseProfile, embeddingActive: 'cohere' } as unknown as MigrationProfile;
    expect(() => activeEmbeddingSpace(profile)).toThrow(/Invalid EMBEDDING_ACTIVE/);
  });
});

describe('shouldRunInProcessTimers', () => {
  it('is true by default (current Railway single-instance behavior)', () => {
    expect(shouldRunInProcessTimers(baseProfile)).toBe(true);
  });

  it('is false when the process opts out (Cloud Run server delegates to the worker)', () => {
    expect(shouldRunInProcessTimers({ ...baseProfile, runInProcessTimers: false })).toBe(false);
  });
});

describe('assertValidMigrationProfile', () => {
  it('passes for the default profile', () => {
    expect(() => assertValidMigrationProfile(baseProfile)).not.toThrow();
  });

  it('throws when cloudsql is selected without credentials', () => {
    expect(() => assertValidMigrationProfile({ ...baseProfile, dbTarget: 'cloudsql' })).toThrow();
  });

  it('throws on an invalid embedding space', () => {
    const profile = { ...baseProfile, embeddingActive: 'nope' } as unknown as MigrationProfile;
    expect(() => assertValidMigrationProfile(profile)).toThrow(/Invalid EMBEDDING_ACTIVE/);
  });
});

describe('describeMigrationProfile', () => {
  it('summarizes the active profile for the boot log', () => {
    expect(describeMigrationProfile(baseProfile)).toBe(
      'db=supabase embeddings=voyage inProcessTimers=true',
    );
  });
});
