import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Slice 2 — getDb() is the switch-layer seam.
 *
 * getDb() must connect to whatever resolveDbConnection() resolves, NOT read
 * config.supabase directly. That is what lets DB_TARGET flip Supabase <-> Cloud
 * SQL for the parallel-run cutover without touching the ~600 .from()/.rpc()
 * call sites. Behavior is unchanged at the default (DB_TARGET=supabase) because
 * resolveDbConnection() returns the Supabase connection there — proven in
 * migration-profile.test.ts.
 */

vi.hoisted(() => {
  process.env.SITE_ONLY = 'true';
});

const logSpies = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../logger', () => ({ createChildLogger: () => logSpies }));

const createClientMock = vi.hoisted(() =>
  vi.fn((url: string, key: string) => ({ __client: true, url, key })),
);
vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
  SupabaseClient: class {},
}));

const resolveDbConnectionMock = vi.hoisted(() => vi.fn());
vi.mock('../migration-profile', () => ({
  resolveDbConnection: resolveDbConnectionMock,
}));

import { getDb, _setDb } from '../database';

beforeEach(() => {
  vi.clearAllMocks();
  // Reset the module-level singleton so each test re-initializes the client.
  _setDb(undefined as unknown as never);
});

describe('getDb (migration switch seam)', () => {
  it('connects to the connection resolved by resolveDbConnection (Cloud SQL when flipped)', () => {
    resolveDbConnectionMock.mockReturnValue({ url: 'https://pgrest.gcp', serviceKey: 'gcp-key' });

    const db = getDb();

    expect(resolveDbConnectionMock).toHaveBeenCalledTimes(1);
    expect(createClientMock).toHaveBeenCalledWith('https://pgrest.gcp', 'gcp-key');
    expect(db).toEqual({ __client: true, url: 'https://pgrest.gcp', key: 'gcp-key' });
  });

  it('caches the client as a singleton — createClient runs once across calls', () => {
    resolveDbConnectionMock.mockReturnValue({ url: 'u', serviceKey: 'k' });

    const a = getDb();
    const b = getDb();

    expect(a).toBe(b);
    expect(createClientMock).toHaveBeenCalledTimes(1);
    expect(resolveDbConnectionMock).toHaveBeenCalledTimes(1);
  });
});
