/**
 * snapshot-pack-for-title-solana — the non-custodial title snapshot.
 *
 * Covers the asset-critical paths: the author/tokenised/published-key GUARDS (fail closed), the plaintext
 * clone path (owner_wallet = snapId recall-isolation, no wraps), the encrypted path (provider + title_holder
 * wraps sealed to the CREATOR'S OWN wallet), and idempotency. db + crypto + artifact binding are mocked.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../pmp/artifact-core.js', () => ({
  PMP_FORMAT_VERSION: '1.0',
  computeArtifactBinding: () => ({ merkleRoot: 'ROOT', manifestHash: 'MANIFEST' }),
}));
vi.mock('@clude/shared/core/memory-envelope', () => ({
  wrapDek: () => ({ wrapped: 'WRAPPED', wrapPubkey: 'WPUB' }),
  unwrapDek: () => new Uint8Array([1, 2, 3, 4]),
}));
vi.mock('@clude/shared/core/encryption-keys', () => ({
  loadProviderKeypair: () => ({ secretKey: new Uint8Array(32) }),
  providerPublicKeyBase64: () => Buffer.from(new Uint8Array(32)).toString('base64'),
}));

import { snapshotPackForTitleSolana, solanaSnapshotPackId } from '../snapshot-pack-for-title-solana.js';

const SOURCE = 'clude-pack-src';
const USER = 'User9osNw7d44tryaeaiZ5KScQckB83okeaB3UDLj8u';
const SNAP = solanaSnapshotPackId(SOURCE, USER);

const sourcePack = {
  author_wallet: USER,
  name: 'My Pack',
  description: 'd',
  version: '1.0.0',
  merkle_root: 'ROOT',
  content_category: 'knowledge' as const,
};
const contents = [
  { memory_id: 1, leaf_index: 0, content_hash: 'h0' },
  { memory_id: 2, leaf_index: 1, content_hash: 'h1' },
];
const members = [
  { id: 1, memory_type: 'semantic', content: 'a', summary: null, tags: [], concepts: [], emotional_valence: 0, importance: 0.5, source: null, related_user: null, related_wallet: null, metadata: {}, decay_factor: 1, encrypted: false, encryption_pubkey: null, event_date: null, event_date_precision: null, created_at: '2026-01-01', content_hash: 'h0' },
  { id: 2, memory_type: 'semantic', content: 'b', summary: null, tags: [], concepts: [], emotional_valence: 0, importance: 0.5, source: null, related_user: null, related_wallet: null, metadata: {}, decay_factor: 1, encrypted: false, encryption_pubkey: null, event_date: null, event_date_precision: null, created_at: '2026-01-01', content_hash: 'h1' },
];

/** Queue-based Supabase mock: per-table `single` (maybeSingle/single) + `list` (awaited builder) queues. */
function makeDb(cfg: { single?: Record<string, any[]>; list?: Record<string, any[]>; insertError?: Record<string, any> } = {}) {
  const inserts: Array<{ table: string; rows: any }> = [];
  const single: Record<string, any[]> = {};
  const list: Record<string, any[]> = {};
  for (const k in cfg.single ?? {}) single[k] = [...cfg.single![k]];
  for (const k in cfg.list ?? {}) list[k] = [...cfg.list![k]];
  let cloneId = 1000;
  const db = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        order: () => q,
        contains: () => q,
        maybeSingle: () => Promise.resolve((single[table] ?? []).shift() ?? { data: null, error: null }),
        single: () => Promise.resolve((single[table] ?? []).shift() ?? { data: null, error: null }),
        insert: (rows: any) => {
          inserts.push({ table, rows });
          if (table === 'memories') {
            return { select: () => ({ single: () => Promise.resolve({ data: { id: ++cloneId }, error: null }) }) };
          }
          return Promise.resolve({ error: cfg.insertError?.[table] ?? null });
        },
        then: (resolve: (v: { data: any; error: any }) => unknown) => resolve((list[table] ?? []).shift() ?? { data: [], error: null }),
      };
      return q;
    },
  };
  return { db, inserts };
}

describe('snapshotPackForTitleSolana — guards (fail closed before any write)', () => {
  it('refuses when the caller is not the source pack author', async () => {
    const { db } = makeDb({ single: { memory_packs: [{ data: null }, { data: { ...sourcePack, author_wallet: 'someone-else' } }] } });
    await expect(snapshotPackForTitleSolana(db as any, SOURCE, USER)).rejects.toThrow(/not the source pack author/i);
  });

  it('refuses an un-tokenised pack (no merkle_root)', async () => {
    const { db } = makeDb({ single: { memory_packs: [{ data: null }, { data: { ...sourcePack, merkle_root: null } }] } });
    await expect(snapshotPackForTitleSolana(db as any, SOURCE, USER)).rejects.toThrow(/not tokenised/i);
  });

  it('refuses an ENCRYPTED pack when the creator has no published key (would strand it undecryptable)', async () => {
    const { db } = makeDb({
      single: { memory_packs: [{ data: null }, { data: sourcePack }], encryption_keys: [{ data: null }] },
      list: {
        memory_pack_contents: [{ data: contents }],
        memories: [{ data: members }, { data: [] }],
        memory_dek_wraps: [{ data: [{ memory_id: 1, wrapped_dek: 'w', wrap_pubkey: 'p', recipient: 'provider' }] }],
      },
    });
    await expect(snapshotPackForTitleSolana(db as any, SOURCE, USER)).rejects.toThrow(/no published encryption key/i);
  });
});

describe('snapshotPackForTitleSolana — plaintext pack', () => {
  it('clones into the recall-isolated snapshot namespace with no DEK wraps', async () => {
    const { db, inserts } = makeDb({
      single: { memory_packs: [{ data: null }, { data: sourcePack }] },
      list: {
        memory_pack_contents: [{ data: contents }],
        memories: [{ data: members }, { data: [] }], // members, then prior-clones (none)
        memory_dek_wraps: [{ data: [] }], // no provider wraps → plaintext
      },
    });
    const res = await snapshotPackForTitleSolana(db as any, SOURCE, USER);

    expect(res).toEqual({ snapshotPackId: SNAP, merkleRoot: 'ROOT', manifestHash: 'MANIFEST', memberCount: 2, reused: false });

    const memInserts = inserts.filter((i) => i.table === 'memories');
    expect(memInserts).toHaveLength(2);
    for (const m of memInserts) {
      expect(m.rows.owner_wallet).toBe(SNAP); // recall-isolated, NOT the user's wallet
      expect(m.rows.metadata.title_snapshot_pack).toBe(SNAP);
      expect(m.rows.provider_delegated).toBe(false);
      expect(m.rows.tokenization_status).toBe('skipped'); // backfill must never recompute the inherited leaf
    }
    expect(inserts.some((i) => i.table === 'memory_dek_wraps')).toBe(false); // plaintext → no wraps
    const packIns = inserts.find((i) => i.table === 'memory_packs');
    expect(packIns?.rows).toMatchObject({ pack_id: SNAP, author_wallet: SNAP, merkle_root: 'ROOT', sale_mode: 'title' });
    const artIns = inserts.find((i) => i.table === 'pmp_artifacts');
    expect(artIns?.rows).toMatchObject({ pack_id: SNAP, owner_wallet: SNAP, creator_pubkey: USER, encryption_scope: 'none' });
  });
});

describe('snapshotPackForTitleSolana — encrypted pack', () => {
  it('seals a provider wrap + a title_holder wrap to the CREATOR\'S OWN wallet', async () => {
    const { db, inserts } = makeDb({
      single: { memory_packs: [{ data: null }, { data: sourcePack }], encryption_keys: [{ data: { x25519_pubkey: Buffer.from(new Uint8Array(32)).toString('base64') } }] },
      list: {
        memory_pack_contents: [{ data: contents }],
        memories: [{ data: members }, { data: [] }],
        memory_dek_wraps: [{ data: [
          { memory_id: 1, wrapped_dek: 'w1', wrap_pubkey: 'p1', recipient: 'provider' },
          { memory_id: 2, wrapped_dek: 'w2', wrap_pubkey: 'p2', recipient: 'provider' },
        ] }],
      },
    });
    const res = await snapshotPackForTitleSolana(db as any, SOURCE, USER);
    expect(res.memberCount).toBe(2);

    const wrapInserts = inserts.filter((i) => i.table === 'memory_dek_wraps');
    expect(wrapInserts).toHaveLength(2); // one [provider, title_holder] pair per member
    for (const w of wrapInserts) {
      const rows = w.rows as Array<{ recipient: string; holder_wallet: string | null }>;
      const provider = rows.find((r) => r.recipient === 'provider');
      const holder = rows.find((r) => r.recipient === 'title_holder');
      expect(provider?.holder_wallet).toBeNull();
      expect(holder?.holder_wallet).toBe(USER); // non-custodial: sealed to the user's OWN wallet
    }
    expect(inserts.find((i) => i.table === 'memories')?.rows.provider_delegated).toBe(true);
    expect(inserts.find((i) => i.table === 'pmp_artifacts')?.rows.encryption_scope).toBe('pack');
  });
});

describe('snapshotPackForTitleSolana — idempotency', () => {
  it('returns the existing snapshot untouched (no clones) when it already exists', async () => {
    const { db, inserts } = makeDb({
      single: {
        memory_packs: [{ data: { pack_id: SNAP, merkle_root: 'ROOT', memory_count: 2 } }],
        pmp_artifacts: [{ data: { manifest_hash: 'MANIFEST' } }],
      },
    });
    const res = await snapshotPackForTitleSolana(db as any, SOURCE, USER);
    expect(res).toEqual({ snapshotPackId: SNAP, merkleRoot: 'ROOT', manifestHash: 'MANIFEST', memberCount: 2, reused: true });
    expect(inserts).toHaveLength(0); // nothing cloned or written
  });
});
