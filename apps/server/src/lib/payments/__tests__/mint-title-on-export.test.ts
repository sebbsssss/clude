/**
 * mintTitleOnExport — make a pack EXIST ON BASE at export time (the founder correction: title is
 * minted at EXPORT, not at list). MONEY/IRREVERSIBLE-ASSET CODE.
 *
 * This suite drives the WHOLE export→Base chain for real against the in-memory DB + a stateful mock
 * EvmTitleClient (no live chain): snapshotPackForTitle → mintTitleForPack → creator title_owner grant.
 * It pins:
 *   1. The Base title is minted, bound to the SNAPSHOT's commitment (merkle_root = the source's, the
 *      one anchored on Solana), owned by the creator's custodial Base address.
 *   2. The creator is recorded as title_owner (app-wallet-keyed access cache).
 *   3. IDEMPOTENT: re-exporting the same pack never double-mints, never double-grants.
 *
 * computeArtifactBinding + snapshot + mint run FOR REAL; only the chain + the Base identity publish
 * are mocked. ensureCustodialTitleIdentity has its own suite.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPackTree } from '@clude/tokenization';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@clude/shared/core/memory-envelope', () => ({
  wrapDek: (_d: Uint8Array, pub: Uint8Array) => ({ wrapped: `wrapped-for-${Buffer.from(pub).toString('utf8')}`, wrapPubkey: 'eph' }),
  unwrapDek: (w: string) => (w.startsWith('provider-wrap-of-') ? new TextEncoder().encode(w.slice(17)) : null),
}));
vi.mock('@clude/shared/core/encryption-keys', () => ({
  loadProviderKeypair: () => ({ secretKey: new Uint8Array(32), publicKey: new Uint8Array(32) }),
  providerPublicKeyBase64: () => Buffer.from('provider-pub').toString('base64'),
}));

const CREATOR_APP = 'CreAtoRappWallet1111111111111111111111111';
const CREATOR_BASE = '0xCreatorBaseAddrCAFEBABE0000000000000001';
vi.mock('../base-title-identity.js', () => ({
  ensureCustodialTitleIdentity: vi.fn(async () => ({
    appWallet: CREATOR_APP,
    baseAddress: CREATOR_BASE,
    x25519PublicKeyB64: Buffer.from('creator-title-pub').toString('base64'),
  })),
}));

// ── Table-routed Supabase mock (snapshot-test engine + update + entitlement UNIQUE) ──
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
let nextMemoryId = 7000;
function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  nextMemoryId = 7000;
}
function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}
type Filter = (row: Row) => boolean;
function makeChain(table: string) {
  const filters: Filter[] = [];
  let pendingInsert: Row[] | null = null;
  let pendingUpdate: Row | null = null;
  let settled = false;
  const matched = (): Row[] => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
  const settleInsert = (): { data: any; error: any } => {
    const rows = pendingInsert!;
    const arr = tables[table] ?? (tables[table] = []);
    for (const row of rows) {
      if (table === 'memory_packs' && arr.some((x) => x.pack_id === row.pack_id)) return { data: null, error: { code: '23505' } };
      if (table === 'memory_pack_contents' && arr.some((x) => x.pack_id === row.pack_id && x.leaf_index === row.leaf_index)) return { data: null, error: { code: '23505' } };
      if (table === 'pmp_artifacts' && arr.some((x) => x.owner_wallet === row.owner_wallet && x.manifest_hash === row.manifest_hash)) return { data: null, error: { code: '23505' } };
      if (table === 'pack_entitlements' && arr.some((x) => x.pack_id === row.pack_id && x.holder_wallet === row.holder_wallet && x.grant_kind === row.grant_kind)) return { data: null, error: { code: '23505' } };
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
    if (pendingUpdate) {
      const hits = matched();
      for (const row of hits) Object.assign(row, pendingUpdate);
      return { data: hits.map((r) => ({ ...r })), error: null };
    }
    return { data: matched().map((r) => ({ ...r })), error: null };
  };
  const chain: Record<string, any> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: (col: string, val: any) => { filters.push((row) => row[col] === val); return chain; },
    in: (col: string, vals: any[]) => { filters.push((row) => vals.includes(row[col])); return chain; },
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
    insert: (row: Row | Row[]) => { pendingInsert = Array.isArray(row) ? row : [row]; return chain; },
    update: (patch: Row) => { pendingUpdate = patch; return chain; },
    maybeSingle: async () => { const r = exec(); const a = Array.isArray(r.data) ? r.data : r.data == null ? [] : [r.data]; return { data: a[0] ?? null, error: r.error }; },
    single: async () => { const r = exec(); const a = Array.isArray(r.data) ? r.data : r.data == null ? [] : [r.data]; return { data: a[0] ?? null, error: r.error }; },
    then: (resolve: (v: any) => any, reject?: (e: any) => any) => Promise.resolve(exec()).then(resolve, reject),
  });
  return chain;
}
const db = { from: (t: string) => makeChain(t) };
const resolver = { custodial: true } as any;

// ── Stateful mock EvmTitleClient: deterministic tokenId, tracks minted ownership + mint binding. ──
function makeMockEvm() {
  const ownerByToken = new Map<string, string>();
  let mintCalls = 0;
  let lastBinding: any = null;
  const tokenIdFor = (packId: string) => {
    let h = 0n;
    for (const ch of packId) h = (h * 131n + BigInt(ch.charCodeAt(0))) % (1n << 64n);
    return h;
  };
  return {
    contractAddress: '0xContractAddr0000000000000000000000000001',
    tokenIdFor,
    titleOwner: async (tokenId: bigint) => ownerByToken.get(tokenId.toString()) ?? null,
    mintTitle: async (to: string, packId: string, binding: any) => {
      mintCalls += 1;
      lastBinding = binding;
      ownerByToken.set(tokenIdFor(packId).toString(), to);
      return { txHash: '0xMINTTX' };
    },
    transferTitle: async () => ({ txHash: '0xXFER' }),
    getBinding: async () => null,
    verifyBinding: async () => true,
    mintCallCount: () => mintCalls,
    lastMintBinding: () => lastBinding,
  } as any;
}

import { mintTitleOnExport } from '../mint-title-on-export.js';

const AUTHOR = CREATOR_APP; // the exporting creator owns the source pack
const SOURCE = 'pack-export-cafe';
const LEAVES = ['aa'.repeat(32), 'bb'.repeat(32), 'cc'.repeat(32)];
const SOURCE_ROOT = buildPackTree(LEAVES).root;

function seedTitlePack(n = 3) {
  seed('memory_packs', [
    { pack_id: SOURCE, author_wallet: AUTHOR, name: 'Solana Alpha Pack', description: 'notes', version: '1.0.0', memory_count: n, merkle_root: buildPackTree(LEAVES.slice(0, n)).root, content_category: 'knowledge', sale_mode: 'title' },
  ]);
  for (let i = 0; i < n; i++) {
    const id = 20 + i;
    seed('memory_pack_contents', [{ pack_id: SOURCE, memory_id: id, leaf_index: i, content_hash: LEAVES[i] }]);
    seed('memories', [
      { id, memory_type: 'semantic', content: `member ${i}`, summary: `m${i}`, tags: [], concepts: [], importance: 0.5, source: 'desktop', related_user: null, related_wallet: null, metadata: {}, decay_factor: 1.0, owner_wallet: AUTHOR, encrypted: false, created_at: '2026-01-01T00:00:00.000Z', content_hash: LEAVES[i] },
    ]);
  }
}

let evm: ReturnType<typeof makeMockEvm>;
beforeEach(() => {
  resetDb();
  evm = makeMockEvm();
});

describe('mintTitleOnExport — pack exists on Base at export', () => {
  it('mints the title bound to the snapshot (= source root), owned by the creator Base addr', async () => {
    seedTitlePack(3);
    const res = await mintTitleOnExport(db, evm, resolver, { sourcePackId: SOURCE, creatorAppWallet: CREATOR_APP });

    expect(res.alreadyMinted).toBe(false);
    expect(res.mintTx).toBe('0xMINTTX');
    expect(res.creatorBase).toBe(CREATOR_BASE);
    expect(evm.mintCallCount()).toBe(1);

    // The mint bound the SNAPSHOT's commitment — the same Merkle root the source anchored on Solana.
    const binding = evm.lastMintBinding();
    expect(binding.merkleRoot).toBe(SOURCE_ROOT);
    expect(binding.memoryCount).toBe(3);
    expect(binding.creator).toBe(CREATOR_BASE);

    // pack_titles mirror reflects a minted title owned by the creator Base addr.
    const mirror = tables.pack_titles!.find((t) => t.pack_id === res.snapshotPackId);
    expect(mirror).toMatchObject({ status: 'minted', current_owner: CREATOR_BASE, creator_wallet: CREATOR_BASE });
    expect(mirror!.token_id).toBe(res.tokenId);

    // The snapshot pack + its title artifact exist (the title binds the snapshot, not the live pack).
    expect(tables.memory_packs!.some((p) => p.pack_id === res.snapshotPackId && p.sale_mode === 'title')).toBe(true);
    expect(tables.pmp_artifacts!.some((a) => a.pack_id === res.snapshotPackId && a.license_type === 'title')).toBe(true);
    // The creator's LIVE source pack is untouched (still author-owned, not re-keyed).
    expect(tables.memory_packs!.find((p) => p.pack_id === SOURCE)!.author_wallet).toBe(AUTHOR);
  });

  it('records the creator as an active title_owner (app-wallet-keyed access cache)', async () => {
    seedTitlePack(2);
    const res = await mintTitleOnExport(db, evm, resolver, { sourcePackId: SOURCE, creatorAppWallet: CREATOR_APP });

    const ents = (tables.pack_entitlements ?? []).filter((e) => e.pack_id === res.snapshotPackId);
    expect(ents).toHaveLength(1);
    expect(ents[0]).toMatchObject({ holder_wallet: CREATOR_APP, grant_kind: 'title_owner', status: 'active', order_id: null });
  });

  it('is idempotent: re-exporting the same pack never double-mints or double-grants', async () => {
    seedTitlePack(3);
    const first = await mintTitleOnExport(db, evm, resolver, { sourcePackId: SOURCE, creatorAppWallet: CREATOR_APP });
    const clonesAfterFirst = tables.memories!.filter((m) => m.owner_wallet === CREATOR_BASE).length;

    const second = await mintTitleOnExport(db, evm, resolver, { sourcePackId: SOURCE, creatorAppWallet: CREATOR_APP });

    expect(second.snapshotPackId).toBe(first.snapshotPackId);
    expect(second.alreadyMinted).toBe(true); // the mint was a no-op the second time
    expect(second.mintTx).toBe(first.mintTx); // returns the original tx, not a new broadcast
    expect(evm.mintCallCount()).toBe(1); // never broadcast a second mint
    // No new clones, packs, artifacts, titles, or entitlements.
    expect(tables.memories!.filter((m) => m.owner_wallet === CREATOR_BASE)).toHaveLength(clonesAfterFirst);
    expect(tables.memory_packs!.filter((p) => p.pack_id === first.snapshotPackId)).toHaveLength(1);
    expect(tables.pack_titles!.filter((t) => t.pack_id === first.snapshotPackId)).toHaveLength(1);
    expect(tables.pack_entitlements!.filter((e) => e.pack_id === first.snapshotPackId)).toHaveLength(1);
  });
});
