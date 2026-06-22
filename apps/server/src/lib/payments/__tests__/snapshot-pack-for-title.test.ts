/**
 * snapshotPackForTitle — freeze a pack into a title-governed SNAPSHOT (the sole-key model).
 *
 * Tradeable Memory Packs — Slice 2 (Base titles), the snapshot producer. MONEY/ACCESS/DATA CODE.
 * This suite pins the snapshot contract:
 *
 *   1. CLONE ISOLATION. Every member is cloned into the creator's BASE namespace (owner_wallet =
 *      creatorBase), tagged title_snapshot:<snap>. The creator's ORIGINALS are never mutated.
 *
 *   2. BINDING REUSE. The snapshot's leaves are the source pack's committed content_hashes, so the
 *      snapshot merkle_root EQUALS the source's (the root already anchored on Solana). A pmp_artifacts
 *      row (license_type='title') is registered with that root + a manifest_hash the Base mint reads.
 *
 *   3. DEK RE-KEY. An encrypted pack's clone carries a `provider` wrap (so a future sale can re-key to
 *      the buyer, exactly as title-saga.ts expects) + a `title_holder` wrap to creatorBase (so the
 *      creator decrypts via the title). A plaintext pack writes no wraps.
 *
 *   4. IDEMPOTENT. A snapshot already registered for (source, creator) is returned untouched — no
 *      re-clone, no second pack/artifact.
 *
 *   5. FAIL CLOSED. Untokenised source (no merkle_root), tampered members (not author-owned), and a
 *      source whose stored root disagrees with its committed leaves all THROW rather than bind a
 *      phantom or inconsistent commitment.
 *
 * The DB is the table-routed in-memory Supabase mock (same idiom as grant-copy.test.ts). The Base
 * identity publish (ensureCustodialTitleIdentity) is mocked to a fixed custodial identity — it is
 * covered by its own suite. computeArtifactBinding runs FOR REAL (real buildPackTree) so the
 * merkle_root assertions are meaningful.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPackTree } from '@clude/tokenization';

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── memory-envelope: wrapDek seals the snapshot DEK (provider + title_holder); unwrapDek recovers
//    the source provider DEK. Deterministic markers so we can assert the recipient of each wrap. ──
const wrapDekMock = vi.fn((_dek: Uint8Array, recipientPubkey: Uint8Array) => ({
  wrapped: `wrapped-for-${Buffer.from(recipientPubkey).toString('utf8')}`,
  wrapPubkey: 'eph-pub',
}));
const unwrapDekMock = vi.fn((wrapped: string, _wrapPubkey: string, _secret: Uint8Array) => {
  if (wrapped.startsWith('provider-wrap-of-')) {
    return new TextEncoder().encode(wrapped.slice('provider-wrap-of-'.length));
  }
  return null;
});
vi.mock('@clude/shared/core/memory-envelope', () => ({
  wrapDek: (dek: Uint8Array, pub: Uint8Array) => wrapDekMock(dek, pub),
  unwrapDek: (wrapped: string, wrapPubkey: string, secret: Uint8Array) => unwrapDekMock(wrapped, wrapPubkey, secret),
}));

// ── Provider keypair (unwrap source DEK + provider pubkey for the clone's provider wrap). The
//    provider pubkey decodes (base64) to the ASCII 'provider-pub' so wrapDek's marker is readable. ──
vi.mock('@clude/shared/core/encryption-keys', () => ({
  loadProviderKeypair: () => ({ secretKey: new Uint8Array(32), publicKey: new Uint8Array(32) }),
  providerPublicKeyBase64: () => Buffer.from('provider-pub').toString('base64'),
}));

// ── Base title identity: fixed custodial identity (its own suite covers the publish). ──
const CREATOR_APP = 'CreAtoRappWallet1111111111111111111111111';
const CREATOR_BASE = '0xCreatorBaseAddrCAFEBABE0000000000000001';
const CREATOR_X25519_B64 = Buffer.from('creator-title-pub').toString('base64');
vi.mock('../base-title-identity.js', () => ({
  ensureCustodialTitleIdentity: vi.fn(async () => ({
    appWallet: CREATOR_APP,
    baseAddress: CREATOR_BASE,
    x25519PublicKeyB64: CREATOR_X25519_B64,
  })),
}));

// ── Table-routed Supabase mock (same engine as grant-copy.test.ts) ──────────────
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
let nextMemoryId = 5000;
function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  nextMemoryId = 5000;
}
function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}
type Filter = (row: Row) => boolean;
function makeChain(table: string) {
  const filters: Filter[] = [];
  let pendingInsert: Row[] | null = null;
  let settled = false;
  const matched = (): Row[] => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
  const settleInsert = (): { data: any; error: any } => {
    const rows = pendingInsert!;
    const arr = tables[table] ?? (tables[table] = []);
    // UNIQUE(pack_id, leaf_index) on memory_pack_contents; PK pack_id on memory_packs; (owner,
    // manifest_hash) on pmp_artifacts — model the collisions the module treats as benign (23505).
    for (const row of rows) {
      if (table === 'memory_packs' && arr.some((x) => x.pack_id === row.pack_id)) {
        return { data: null, error: { code: '23505', message: 'dup memory_packs pk' } };
      }
      if (table === 'memory_pack_contents' && arr.some((x) => x.pack_id === row.pack_id && x.leaf_index === row.leaf_index)) {
        return { data: null, error: { code: '23505', message: 'dup contents leaf_index' } };
      }
      if (table === 'pmp_artifacts' && arr.some((x) => x.owner_wallet === row.owner_wallet && x.manifest_hash === row.manifest_hash)) {
        return { data: null, error: { code: '23505', message: 'dup artifact' } };
      }
    }
    const written = rows.map((r) => {
      const withId = table === 'memories' && r.id == null ? { ...r, id: nextMemoryId++ } : { ...r };
      arr.push(withId);
      return withId;
    });
    return { data: written, error: null };
  };
  const exec = (): { data: any; error: any } => {
    if (settled) return { data: null, error: null };
    settled = true;
    if (pendingInsert) return settleInsert();
    return { data: matched().map((r) => ({ ...r })), error: null };
  };
  const chain: Record<string, any> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: (col: string, val: any) => {
      filters.push((row) => row[col] === val);
      return chain;
    },
    in: (col: string, vals: any[]) => {
      filters.push((row) => vals.includes(row[col]));
      return chain;
    },
    contains: (col: string, obj: Record<string, any>) => {
      filters.push((row) => {
        const val = row[col];
        if (val == null || typeof val !== 'object') return false;
        return Object.entries(obj).every(([k, v]) => (val as Record<string, any>)[k] === v);
      });
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    insert: (row: Row | Row[]) => {
      pendingInsert = Array.isArray(row) ? row : [row];
      return chain;
    },
    maybeSingle: async () => {
      const r = exec();
      const arr = Array.isArray(r.data) ? r.data : r.data == null ? [] : [r.data];
      return { data: arr[0] ?? null, error: r.error };
    },
    single: async () => {
      const r = exec();
      const arr = Array.isArray(r.data) ? r.data : r.data == null ? [] : [r.data];
      return { data: arr[0] ?? null, error: r.error };
    },
    then: (resolve: (v: any) => any, reject?: (e: any) => any) => Promise.resolve(exec()).then(resolve, reject),
  });
  return chain;
}
const db = { from: (table: string) => makeChain(table) };
const resolver = { custodial: true } as any; // unused (ensureCustodialTitleIdentity is mocked)

import { snapshotPackForTitle } from '../snapshot-pack-for-title.js';

const AUTHOR = 'AuThoRappWallet22222222222222222222222222';
const SOURCE = 'pack-source-cafe';
// Valid 64-char hex leaves so the REAL buildPackTree can hex-decode them.
const LEAVES = ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)];
const SOURCE_ROOT = buildPackTree(LEAVES).root;

/** Seed a tokenised source pack (correct committed root) with `n` author-owned members. */
function seedSourcePack(n: number, opts: { encrypted?: boolean; root?: string } = {}) {
  seed('memory_packs', [
    {
      pack_id: SOURCE,
      author_wallet: AUTHOR,
      name: 'Solana Alpha Pack',
      description: 'curated notes',
      version: '1.2.0',
      memory_count: n,
      merkle_root: opts.root ?? buildPackTree(LEAVES.slice(0, n)).root,
      content_category: 'knowledge',
    },
  ]);
  for (let i = 0; i < n; i++) {
    const id = 10 + i;
    seed('memory_pack_contents', [{ pack_id: SOURCE, memory_id: id, leaf_index: i, content_hash: LEAVES[i] }]);
    seed('memories', [
      {
        id,
        memory_type: 'semantic',
        content: `member ${i} content`,
        summary: `m${i}`,
        tags: [`topic${i}`],
        concepts: [],
        importance: 0.6,
        source: 'desktop',
        related_user: null,
        related_wallet: null,
        metadata: {},
        decay_factor: 1.0,
        owner_wallet: AUTHOR,
        encrypted: !!opts.encrypted,
        provider_delegated: !!opts.encrypted,
        created_at: '2026-01-01T00:00:00.000Z',
        content_hash: LEAVES[i],
      },
    ]);
    if (opts.encrypted) {
      seed('memory_dek_wraps', [
        { memory_id: id, recipient: 'provider', wrapped_dek: `provider-wrap-of-dek${i}`, wrap_pubkey: 'pk' },
      ]);
    }
  }
}

beforeEach(() => {
  resetDb();
  wrapDekMock.mockClear();
  unwrapDekMock.mockClear();
});

describe('snapshotPackForTitle — clone isolation + binding reuse (plaintext)', () => {
  it('clones every member to the creator BASE namespace, leaving the originals untouched', async () => {
    seedSourcePack(3);
    const res = await snapshotPackForTitle(db, resolver, SOURCE, CREATOR_APP);

    const clones = tables.memories!.filter((m) => m.owner_wallet === CREATOR_BASE);
    expect(clones).toHaveLength(3);
    // Originals (author-owned) are untouched.
    expect(tables.memories!.filter((m) => m.owner_wallet === AUTHOR)).toHaveLength(3);
    for (const c of clones) {
      expect(c.tags).toContain(`title_snapshot:${res.snapshotPackId}`);
      expect(c.metadata?.title_snapshot_of).toBe(SOURCE);
      expect(c.content_hash).toMatch(/^[a-f0-9]{64}$/); // the committed leaf, preserved
    }
    // Frozen: clone content + timestamp carried from the source.
    expect(clones.map((c) => c.content).sort()).toEqual(['member 0 content', 'member 1 content', 'member 2 content']);
    expect(clones.every((c) => c.created_at === '2026-01-01T00:00:00.000Z')).toBe(true);
  });

  it('binds the SAME merkle_root the source committed, and registers a title artifact + pack', async () => {
    seedSourcePack(3);
    const res = await snapshotPackForTitle(db, resolver, SOURCE, CREATOR_APP);

    expect(res.merkleRoot).toBe(SOURCE_ROOT); // identical to what the source anchored on Solana
    expect(res.memberCount).toBe(3);
    expect(res.creatorBase).toBe(CREATOR_BASE);
    expect(res.reused).toBe(false);

    // Snapshot pack row (sale_mode='title', author = the Base identity).
    const snapPack = tables.memory_packs!.find((p) => p.pack_id === res.snapshotPackId);
    expect(snapPack).toMatchObject({ sale_mode: 'title', author_wallet: CREATOR_BASE, merkle_root: SOURCE_ROOT, memory_count: 3 });
    // No phantom manifest_hash column on memory_packs.
    expect(snapPack).not.toHaveProperty('manifest_hash');

    // Snapshot contents reference the CLONE ids, carry the committed leaves, in order.
    const snapContents = tables.memory_pack_contents!.filter((c) => c.pack_id === res.snapshotPackId);
    expect(snapContents).toHaveLength(3);
    expect(snapContents.map((c) => c.content_hash).sort()).toEqual([...LEAVES].sort());
    const cloneIds = new Set(tables.memories!.filter((m) => m.owner_wallet === CREATOR_BASE).map((m) => m.id));
    expect(snapContents.every((c) => cloneIds.has(c.memory_id))).toBe(true);

    // The pmp_artifacts binding the Base mint reads: license 'title', creator_pubkey = Base addr.
    const art = tables.pmp_artifacts!.find((a) => a.pack_id === res.snapshotPackId);
    expect(art).toMatchObject({
      license_type: 'title',
      merkle_root: SOURCE_ROOT,
      manifest_hash: res.manifestHash,
      record_count: 3,
      creator_pubkey: CREATOR_BASE,
      owner_wallet: CREATOR_BASE,
    });
    expect(res.manifestHash).toMatch(/^[a-f0-9]{64}$/); // bare hex, no 0x (consistent with every artifact)
  });

  it('writes NO DEK wraps for a plaintext pack', async () => {
    seedSourcePack(2);
    await snapshotPackForTitle(db, resolver, SOURCE, CREATOR_APP);
    expect(wrapDekMock).not.toHaveBeenCalled();
    expect(tables.memory_dek_wraps ?? []).toHaveLength(0);
  });
});

describe('snapshotPackForTitle — encrypted pack (DEK re-key)', () => {
  it('seals a provider wrap + a creator title_holder wrap per clone (what the sale + unlock read)', async () => {
    seedSourcePack(2, { encrypted: true });
    await snapshotPackForTitle(db, resolver, SOURCE, CREATOR_APP);

    const clones = tables.memories!.filter((m) => m.owner_wallet === CREATOR_BASE);
    expect(clones).toHaveLength(2);
    const cloneIds = new Set(clones.map((m) => m.id));

    // Per member: unwrap the source provider DEK once, wrap twice (provider + title_holder).
    expect(unwrapDekMock).toHaveBeenCalledTimes(2);
    expect(wrapDekMock).toHaveBeenCalledTimes(4);

    // Clone wraps are keyed to the CLONE ids (not source ids), with the right recipients.
    const cloneWraps = (tables.memory_dek_wraps ?? []).filter((w) => cloneIds.has(w.memory_id));
    const providerWraps = cloneWraps.filter((w) => w.recipient === 'provider');
    const holderWraps = cloneWraps.filter((w) => w.recipient === 'title_holder');
    expect(providerWraps).toHaveLength(2);
    expect(holderWraps).toHaveLength(2);
    // The title_holder wrap is sealed to the creator's Base identity (holder_wallet = creatorBase),
    // exactly the (memory, title_holder, holder_wallet) shape title-saga.revokeSeller deletes on sale.
    for (const w of holderWraps) {
      expect(w.holder_wallet).toBe(CREATOR_BASE);
      expect(w.wrapped_dek).toBe('wrapped-for-creator-title-pub');
    }
    for (const w of providerWraps) {
      expect(w.holder_wallet).toBeNull();
      expect(w.wrapped_dek).toBe('wrapped-for-provider-pub');
    }
    // Clones flagged encrypted + provider-delegated.
    for (const c of clones) {
      expect(c.encrypted).toBe(true);
      expect(c.provider_delegated).toBe(true);
    }
  });
});

describe('snapshotPackForTitle — idempotent', () => {
  it('a second call returns the existing snapshot (reused) without re-cloning', async () => {
    seedSourcePack(3);
    const first = await snapshotPackForTitle(db, resolver, SOURCE, CREATOR_APP);
    const clonesAfterFirst = tables.memories!.filter((m) => m.owner_wallet === CREATOR_BASE).length;

    const second = await snapshotPackForTitle(db, resolver, SOURCE, CREATOR_APP);
    expect(second.reused).toBe(true);
    expect(second.snapshotPackId).toBe(first.snapshotPackId);
    expect(second.merkleRoot).toBe(first.merkleRoot);
    expect(second.manifestHash).toBe(first.manifestHash);
    // No new clones / packs / artifacts.
    expect(tables.memories!.filter((m) => m.owner_wallet === CREATOR_BASE)).toHaveLength(clonesAfterFirst);
    expect(tables.memory_packs!.filter((p) => p.pack_id === first.snapshotPackId)).toHaveLength(1);
    expect(tables.pmp_artifacts!.filter((a) => a.pack_id === first.snapshotPackId)).toHaveLength(1);
  });
});

describe('snapshotPackForTitle — fail closed', () => {
  it('refuses an untokenised source pack (no merkle_root)', async () => {
    seed('memory_packs', [
      { pack_id: SOURCE, author_wallet: AUTHOR, name: 'Draft', version: '1.0.0', memory_count: 1, merkle_root: null, content_category: 'knowledge' },
    ]);
    seed('memory_pack_contents', [{ pack_id: SOURCE, memory_id: 10, leaf_index: 0, content_hash: LEAVES[0] }]);
    seed('memories', [{ id: 10, memory_type: 'semantic', content: 'x', owner_wallet: AUTHOR, created_at: 'now', content_hash: LEAVES[0] }]);

    await expect(snapshotPackForTitle(db, resolver, SOURCE, CREATOR_APP)).rejects.toThrow(/not tokenised/i);
    expect(tables.memories!.filter((m) => m.owner_wallet === CREATOR_BASE)).toHaveLength(0);
  });

  it('refuses when members are NOT owned by the pack author (tampered contents row)', async () => {
    seed('memory_packs', [
      { pack_id: SOURCE, author_wallet: AUTHOR, name: 'Tampered', version: '1.0.0', memory_count: 1, merkle_root: SOURCE_ROOT, content_category: 'knowledge' },
    ]);
    seed('memory_pack_contents', [{ pack_id: SOURCE, memory_id: 99, leaf_index: 0, content_hash: LEAVES[0] }]);
    seed('memories', [{ id: 99, memory_type: 'semantic', content: 'someone elses', owner_wallet: 'NotTheAuthor', created_at: 'now', content_hash: LEAVES[0] }]);

    await expect(snapshotPackForTitle(db, resolver, SOURCE, CREATOR_APP)).rejects.toThrow(/not owned by author/i);
    expect(tables.memories!.filter((m) => m.owner_wallet === CREATOR_BASE)).toHaveLength(0);
  });

  it('refuses when the source stored root disagrees with its committed leaves (inconsistent commitment)', async () => {
    // Stored merkle_root is a lie (does not equal buildPackTree of the seeded content_hashes).
    seedSourcePack(3, { root: 'de'.repeat(32) });
    await expect(snapshotPackForTitle(db, resolver, SOURCE, CREATOR_APP)).rejects.toThrow(/inconsistent/i);
  });
});
