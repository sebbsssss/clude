/**
 * Integration tests for the PMP ARTIFACTS endpoints — the server side of the
 * desktop `.pmp` integration the user's existing Clude desktop app consumes.
 *
 * Tradeable Memory Packs — Part C, Task 2 (spec §2 PMP ARTIFACTS · §3C · §4 .pmp format).
 *
 * Surface (spec §3C):
 *   POST /v1/pmp/export        build a .pmp from the owner's pack, register a pmp_artifacts row
 *   GET  /v1/pmp/artifacts     owner-scoped artifact list
 *   GET  /v1/pmp/artifacts/:id owner-scoped artifact metadata
 *   POST /v1/pmp/verify        hosted twin of memorypack verify — NO auth, recompute root
 *   POST /v1/pmp/import        hash-verify + dedupe-by-content_hash + ingest as owner memories
 *
 * The four guarantees pinned here (the task's TDD acceptance):
 *   1. export registers an artifact with the RIGHT manifest_hash (the sha256 the server
 *      re-derives over the written .pmp's manifest), scoped to the owner.
 *   2. import HASH-VERIFIES each record, DEDUPES by content_hash against the owner's existing
 *      memories, INGESTS the rest as owner-scoped rows, and writes a pmp_imports receipt with
 *      the right counts.
 *   3. verify REJECTS a tampered pack (recomputed Merkle root != declared root) → verified:false.
 *   4. OWNER-SCOPING is enforced: export of a pack you don't own → 403; an artifact owned by
 *      another wallet is 404 to you; import lands rows ONLY in the caller's namespace.
 *
 * @clude/memorypack and @clude/tokenization are unit-mocked so the HTTP layer is tested in
 * isolation from the real tar/zstd writer + the filesystem. getDb is the table-routed
 * in-memory Supabase mock (same idiom as pack-marketplace.routes / marketplace-payments.routes).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { writeFileSync } from 'node:fs';
import nacl from 'tweetnacl';

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── Auth injection — flip `authedWallet` per test ──
let authedWallet: string | null = null;
vi.mock('@clude/brain/auth/privy-auth', () => ({
  optionalPrivyAuth: (req: Request, _res: Response, next: NextFunction) => {
    if (authedWallet) (req as Request & { verifiedWallet?: string }).verifiedWallet = authedWallet;
    next();
  },
  requirePrivyAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!authedWallet) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    (req as Request & { verifiedWallet?: string }).verifiedWallet = authedWallet;
    next();
  },
}));

// requireOwnership runs AFTER the (mocked) requirePrivyAuth — verifiedWallet is already set,
// so it passes through. The real DID-resolution middleware isn't exercised in unit tests; the
// route's ownerFromReq() reads ONLY req.verifiedWallet (never a client ?owner=).
vi.mock('@clude/brain/auth/require-ownership', () => ({
  requireOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
  optionalOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── @clude/memorypack — unit-mocked. The route stages a .pmp on disk and reads it back; the
//    mock substitutes a deterministic in-memory writer/reader so no tar/zstd or fs is needed.
//    A small registry maps the staged path → the records + manifest the route "wrote", so
//    readMemoryPack returns exactly what writeMemoryPack was handed (round-trip fidelity).
const memorypackState = vi.hoisted(() => {
  const written = new Map<string, { records: any[]; manifest: any }>();
  return { written };
});

const {
  writeMemoryPack,
  readMemoryPack,
} = vi.hoisted(() => ({
  writeMemoryPack: vi.fn(),
  readMemoryPack: vi.fn(),
}));

vi.mock('@clude/memorypack', () => ({
  MEMORYPACK_VERSION: '0.2',
  writeMemoryPack,
  readMemoryPack,
}));

// ── @clude/tokenization — unit-mocked. memoryContentHash is the leaf-hash function
//    (memory-hash-v1); buildPackTree builds the Merkle root. We make memoryContentHash
//    deterministic on `content` so a test can assert dedupe + tamper detection precisely.
const { memoryContentHash, buildPackTree, inclusionProof } = vi.hoisted(() => ({
  // leaf hash = `lh:<content>` so the test controls collisions without sha256 ceremony.
  memoryContentHash: vi.fn((input: { content: string }) => `lh:${input.content}`),
  // root = deterministic join of the leaves so a tamper flips it.
  buildPackTree: vi.fn((leaves: string[]) => ({
    root: `root(${leaves.join('|')})`,
    leaves: [...leaves],
    depth: leaves.length,
    algorithm: 'sha256-merkle-v1',
    levels: [leaves],
  })),
  inclusionProof: vi.fn((tree: any, i: number) => ({
    leaf: tree.leaves[i],
    leafIndex: i,
    siblings: [],
    algorithm: 'sha256-merkle-v1',
  })),
  HASH_ALGORITHM: 'memory-hash-v1',
  MERKLE_ALGORITHM: 'sha256-merkle-v1',
}));

vi.mock('@clude/tokenization', () => ({
  memoryContentHash,
  buildPackTree,
  inclusionProof,
  HASH_ALGORITHM: 'memory-hash-v1',
  MERKLE_ALGORITHM: 'sha256-merkle-v1',
}));

// ── owner-context: withOwnerWallet just runs the fn (no AsyncLocalStorage in tests). ──
vi.mock('@clude/shared/core/owner-context', () => ({
  withOwnerWallet: (_wallet: string | null, fn: () => any) => fn(),
  getContextOwnerWallet: () => undefined,
}));

// ── Table-routed Supabase mock (same shape as pack-marketplace.routes.test.ts). ──
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const insertedRows: Array<{ table: string; rows: Row[] }> = [];
let forceError: { table: string; error: any } | null = null;
let forceUniqueViolation: string | null = null;
// monotonically increasing BIGSERIAL for memory inserts that read back an id.
let nextSerial = 1000;

function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  insertedRows.length = 0;
  forceError = null;
  forceUniqueViolation = null;
  nextSerial = 1000;
}

function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}

interface Filter {
  kind: 'eq' | 'in' | 'overlaps' | 'or' | 'contains' | 'gte' | 'lte';
  col?: string;
  val?: any;
  vals?: any[];
}

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((row) =>
    filters.every((f) => {
      if (f.kind === 'eq') return row[f.col!] === f.val;
      if (f.kind === 'in') return (f.vals ?? []).includes(row[f.col!]);
      // gte/lte compare lexically — created_at is an ISO string, so string ordering = time ordering.
      if (f.kind === 'gte') return row[f.col!] >= f.val;
      if (f.kind === 'lte') return row[f.col!] <= f.val;
      if (f.kind === 'overlaps') {
        const have: any[] = Array.isArray(row[f.col!]) ? row[f.col!] : [];
        return (f.vals ?? []).some((v) => have.includes(v));
      }
      if (f.kind === 'contains') {
        const have = row[f.col!] ?? {};
        const want = f.val ?? {};
        return Object.keys(want).every((k) => (have as any)[k] === (want as any)[k]);
      }
      if (f.kind === 'or') return true;
      return true;
    }),
  );
}

function makeChain(table: string) {
  const filters: Filter[] = [];
  let pendingInsert: Row[] | null = null;
  let pendingUpdate: Row | null = null;
  let pendingDelete = false;
  let orderCol: { col: string; ascending: boolean } | null = null;
  let limitN: number | null = null;
  let rangeBounds: { from: number; to: number } | null = null;
  let countMode = false;
  let headOnly = false;

  const settle = (): Promise<{ data: any; count: number | null; error: any }> => {
    if (forceError && forceError.table === table) {
      const err = forceError.error;
      forceError = null;
      return Promise.resolve({ data: null, count: null, error: err });
    }

    // INSERT (memories get a fresh BIGSERIAL id when one isn't supplied, so the route can read it back)
    if (pendingInsert) {
      const rows = pendingInsert;
      pendingInsert = null;
      if (forceUniqueViolation === table) {
        forceUniqueViolation = null;
        return Promise.resolve({ data: null, count: null, error: { code: '23505', message: 'duplicate key value' } });
      }
      const stamped = rows.map((r) => {
        const copy = { ...r };
        if (table === 'memories' && copy.id === undefined) copy.id = nextSerial++;
        return copy;
      });
      tables[table] = (tables[table] ?? []).concat(stamped.map((r) => ({ ...r })));
      insertedRows.push({ table, rows: stamped.map((r) => ({ ...r })) });
      return Promise.resolve({
        data: stamped.length === 1 ? { ...stamped[0] } : stamped.map((r) => ({ ...r })),
        count: null,
        error: null,
      });
    }

    // UPDATE
    if (pendingUpdate) {
      const patch = pendingUpdate;
      pendingUpdate = null;
      const matched = applyFilters(tables[table] ?? [], filters);
      for (const row of matched) Object.assign(row, patch);
      return Promise.resolve({ data: matched.map((r) => ({ ...r })), count: null, error: null });
    }

    // DELETE
    if (pendingDelete) {
      pendingDelete = false;
      const keep = (tables[table] ?? []).filter((r) => !applyFilters([r], filters).length);
      const removed = (tables[table] ?? []).filter((r) => applyFilters([r], filters).length);
      tables[table] = keep;
      return Promise.resolve({ data: removed.map((r) => ({ ...r })), count: null, error: null });
    }

    // SELECT
    let rows = applyFilters(tables[table] ?? [], filters);
    if (orderCol) {
      rows = [...rows].sort((a, b) => {
        const av = a[orderCol!.col];
        const bv = b[orderCol!.col];
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (orderCol!.ascending ? 1 : -1);
      });
    }
    // count:exact reports the FILTERED total (before range/limit) — matches PostgREST semantics.
    const matchCount = rows.length;
    // .range(from,to) is an inclusive slice applied after ordering (the export pagination path).
    if (rangeBounds) rows = rows.slice(rangeBounds.from, rangeBounds.to + 1);
    if (limitN !== null) rows = rows.slice(0, limitN);
    return Promise.resolve({
      // head:true → no rows hydrated, only the count is meaningful (preview path).
      data: headOnly ? null : rows.map((r) => ({ ...r })),
      count: countMode ? matchCount : null,
      error: null,
    });
  };

  const chain: Record<string, any> = {};
  Object.assign(chain, {
    select: (_cols?: string, opts?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) => {
      if (opts?.count) countMode = true;
      if (opts?.head) headOnly = true;
      return chain;
    },
    eq: (col: string, val: any) => {
      filters.push({ kind: 'eq', col, val });
      return chain;
    },
    in: (col: string, vals: any[]) => {
      filters.push({ kind: 'in', col, vals });
      return chain;
    },
    gte: (col: string, val: any) => {
      filters.push({ kind: 'gte', col, val });
      return chain;
    },
    lte: (col: string, val: any) => {
      filters.push({ kind: 'lte', col, val });
      return chain;
    },
    overlaps: (col: string, vals: any[]) => {
      filters.push({ kind: 'overlaps', col, vals });
      return chain;
    },
    contains: (col: string, val: any) => {
      filters.push({ kind: 'contains', col, val });
      return chain;
    },
    or: () => {
      filters.push({ kind: 'or' });
      return chain;
    },
    not: () => chain,
    order: (col: string, opts?: { ascending?: boolean }) => {
      orderCol = { col, ascending: opts?.ascending !== false };
      return chain;
    },
    limit: (n: number) => {
      limitN = n;
      return chain;
    },
    range: (from: number, to: number) => {
      rangeBounds = { from, to };
      return chain;
    },
    insert: (rows: Row | Row[]) => {
      pendingInsert = Array.isArray(rows) ? rows : [rows];
      return chain;
    },
    update: (patch: Row) => {
      pendingUpdate = patch;
      return chain;
    },
    delete: () => {
      pendingDelete = true;
      return chain;
    },
    maybeSingle: async () => {
      const { data, error } = await settle();
      if (error) return { data: null, error };
      const arr = Array.isArray(data) ? data : data ? [data] : [];
      return { data: arr[0] ?? null, error: null };
    },
    single: async () => {
      const { data, error } = await settle();
      if (error) return { data: null, error };
      const arr = Array.isArray(data) ? data : data ? [data] : [];
      return { data: arr[0] ?? null, error: null };
    },
    then: (resolve: (v: any) => any, reject?: (e: any) => any) => settle().then(resolve, reject),
  });
  return chain;
}

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({ from: (table: string) => makeChain(table) }),
}));

import { pmpArtifactsRoutes, resolveTitleMintChain } from '../pmp-artifacts.routes.js';

function app() {
  const a = express();
  a.use(express.json({ limit: '25mb' }));
  a.use(pmpArtifactsRoutes());
  return a;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER = 'OwnerWaLLet1111111111111111111111111111111';
const OTHER = 'OtherWaLLet2222222222222222222222222222222';

/** A tokenised pack owned by OWNER with two minted member memories. */
function seedOwnedPack(packId = 'pack-aaaa') {
  seed('memory_packs', [
    {
      pack_id: packId,
      author_wallet: OWNER,
      name: 'Solana Trading Patterns',
      description: 'curated knowledge',
      version: '1.0.0',
      memory_count: 2,
      merkle_root: 'root(lh:alpha|lh:beta)',
      pack_token_address: 'memo:txsig',
      content_category: 'knowledge',
      sale_mode: 'copy',
    },
  ]);
  seed('memory_pack_contents', [
    { pack_id: packId, memory_id: 1, leaf_index: 0, content_hash: 'lh:alpha' },
    { pack_id: packId, memory_id: 2, leaf_index: 1, content_hash: 'lh:beta' },
  ]);
  seed('memories', [
    {
      id: 1,
      hash_id: 'clude-aaaa0001',
      memory_type: 'semantic',
      content: 'alpha',
      summary: 'alpha summary',
      owner_wallet: OWNER,
      created_at: '2026-01-01T00:00:00.000Z',
      tags: ['solana'],
      source: 'chat',
      related_user: null,
      related_wallet: null,
      content_hash: 'lh:alpha',
      tokenization_status: 'minted',
    },
    {
      id: 2,
      hash_id: 'clude-aaaa0002',
      memory_type: 'semantic',
      content: 'beta',
      summary: 'beta summary',
      owner_wallet: OWNER,
      created_at: '2026-01-02T00:00:00.000Z',
      tags: ['trading'],
      source: 'chat',
      related_user: null,
      related_wallet: null,
      content_hash: 'lh:beta',
      tokenization_status: 'minted',
    },
  ]);
  return packId;
}

/**
 * A free-floating memory corpus (NOT tied to any pack) for the selection-export path.
 *   OWNER: 2 episodic, 1 semantic, 1 procedural — spread across distinct dates + tags.
 *   OTHER: rows that DELIBERATELY collide on type ('episodic'), tag ('solana') and date so a
 *          selection that forgets the owner scope would wrongly pull them. They must never appear.
 * Content strings are unique → the mock memoryContentHash gives each a distinct leaf.
 */
function seedSelectionCorpus() {
  seed('memories', [
    {
      id: 10,
      hash_id: 'clude-sel-0010',
      memory_type: 'episodic',
      content: 'sel-ep-one',
      summary: 'ep one',
      owner_wallet: OWNER,
      created_at: '2026-03-01T00:00:00.000Z',
      tags: ['solana', 'trade'],
      source: 'chat',
      related_user: null,
      related_wallet: null,
      content_hash: 'lh:sel-ep-one',
      importance: 0.6,
      tokenization_status: 'stored',
    },
    {
      id: 11,
      hash_id: 'clude-sel-0011',
      memory_type: 'episodic',
      content: 'sel-ep-two',
      summary: 'ep two',
      owner_wallet: OWNER,
      created_at: '2026-03-05T00:00:00.000Z',
      tags: ['defi'],
      source: 'chat',
      related_user: null,
      related_wallet: null,
      content_hash: 'lh:sel-ep-two',
      importance: 0.4,
      tokenization_status: 'stored',
    },
    {
      id: 12,
      hash_id: 'clude-sel-0012',
      memory_type: 'semantic',
      content: 'sel-sem-one',
      summary: 'sem one',
      owner_wallet: OWNER,
      created_at: '2026-03-10T00:00:00.000Z',
      tags: ['solana'],
      source: 'chat',
      related_user: null,
      related_wallet: null,
      content_hash: 'lh:sel-sem-one',
      importance: 0.8,
      tokenization_status: 'stored',
    },
    {
      id: 13,
      hash_id: 'clude-sel-0013',
      memory_type: 'procedural',
      content: 'sel-proc-one',
      summary: 'proc one',
      owner_wallet: OWNER,
      created_at: '2026-03-20T00:00:00.000Z',
      tags: ['howto'],
      source: 'chat',
      related_user: null,
      related_wallet: null,
      content_hash: 'lh:sel-proc-one',
      importance: 0.5,
      tokenization_status: 'stored',
    },
    // ── OTHER tenant — colliding type/tag/date, MUST stay invisible to OWNER selections ──
    {
      id: 90,
      hash_id: 'clude-other-0090',
      memory_type: 'episodic',
      content: 'other-ep-secret',
      summary: 'secret',
      owner_wallet: OTHER,
      created_at: '2026-03-02T00:00:00.000Z',
      tags: ['solana', 'trade'],
      source: 'chat',
      related_user: null,
      related_wallet: null,
      content_hash: 'lh:other-ep-secret',
      importance: 0.9,
      tokenization_status: 'stored',
    },
    {
      id: 91,
      hash_id: 'clude-other-0091',
      memory_type: 'semantic',
      content: 'other-sem-secret',
      summary: 'secret',
      owner_wallet: OTHER,
      created_at: '2026-03-11T00:00:00.000Z',
      tags: ['solana'],
      source: 'chat',
      related_user: null,
      related_wallet: null,
      content_hash: 'lh:other-sem-secret',
      importance: 0.9,
      tokenization_status: 'stored',
    },
  ]);
}

/**
 * Seed an `encryption_keys` row for `wallet` so encryptRecordsForHolder (real crypto, NOT mocked)
 * can seal the pack DEK to a registered X25519 key. The pubkey is a REAL nacl.box keypair's public
 * key (base64) so wrapDek produces a genuine sealed box; verifier_ct is an opaque copy-through field.
 * Returns the keypair in case a test wants to unwrap + assert the DEK round-trips (none do yet).
 */
function seedHolderKey(wallet = OWNER): nacl.BoxKeyPair {
  const kp = nacl.box.keyPair();
  seed('encryption_keys', [
    {
      owner_wallet: wallet,
      x25519_pubkey: Buffer.from(kp.publicKey).toString('base64'),
      verifier_ct: 'verifier-ct-opaque-base64',
    },
  ]);
  return kp;
}

/**
 * Make readMemoryPack return a verifiable .pmp: two records whose leaf hashes match
 * memoryContentHash, with the declared pmp.manifest_hash + merkle_root in the manifest.
 * `tamper` flips one record's content so the recomputed root diverges from the declared one.
 */
function stubReadablePmp(opts: { tamper?: boolean } = {}) {
  const records = [
    {
      id: 'clude-aaaa0001',
      created_at: '2026-01-01T00:00:00.000Z',
      kind: 'semantic',
      content: opts.tamper ? 'alpha-TAMPERED' : 'alpha',
      tags: ['solana'],
      importance: 0.5,
      source: 'chat',
    },
    {
      id: 'clude-aaaa0002',
      created_at: '2026-01-02T00:00:00.000Z',
      kind: 'semantic',
      content: 'beta',
      tags: ['trading'],
      importance: 0.5,
      source: 'chat',
    },
  ];
  // The manifest's declared root is over the UNTAMPERED leaves — a tampered record body
  // therefore recomputes a different root, which is exactly what verify must catch.
  const declaredRoot = 'root(lh:alpha|lh:beta)';
  readMemoryPack.mockReturnValue({
    manifest: {
      memorypack_version: '0.2',
      producer: { name: 'clude-desktop', version: '1.0.0', public_key: 'CreatorPubKey' },
      record_count: 2,
      record_schema: 'clude-memory-v1',
      pmp: {
        pmp_version: '0.8',
        artifact_id: 'pmpa-source01',
        title: 'Solana Trading Patterns',
        license_type: 'copy',
        merkle_root: declaredRoot,
        manifest_sig: 'base58:sig',
      },
    },
    records,
    minimalRecords: records,
    verifiedRecords: new Set<string>(),
    unsignedRecords: new Set<string>(),
    anchors: [],
    verifiedBlobs: new Set<string>(),
    verifiedAnchors: new Set<string>(),
    revocations: [],
    revokedRecordHashes: new Set<string>(),
    revocationAnchors: [],
    verifiedRevocationAnchors: new Set<string>(),
    warnings: [],
  });
  return { records, declaredRoot };
}

beforeEach(() => {
  resetDb();
  authedWallet = null;
  writeMemoryPack.mockReset();
  readMemoryPack.mockReset();
  memoryContentHash.mockClear();
  buildPackTree.mockClear();
  // writeMemoryPack is a void side-effect; default no-op.
  writeMemoryPack.mockImplementation(() => undefined);
});

// ───────────────────────── resolveTitleMintChain ─────────────────────────

describe('resolveTitleMintChain (export-time mint routing)', () => {
  it('defaults an omitted chain to solana (fail-safe — never silently routes to Base)', () => {
    expect(resolveTitleMintChain(undefined)).toBe('solana');
  });
  it('keeps an explicit solana', () => {
    expect(resolveTitleMintChain('solana')).toBe('solana');
  });
  it('routes to base only on an explicit base opt-in', () => {
    expect(resolveTitleMintChain('base')).toBe('base');
  });
});

// ───────────────────────── POST /v1/pmp/export ─────────────────────────

describe('POST /v1/pmp/export', () => {
  it('mint_as_title flags an owned tokenised pack as a title (the trigger that fires the Base mint)', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack(); // tokenised, sale_mode 'copy'
    seedHolderKey(OWNER); // export now encrypts by default → needs the owner's registered key
    writeMemoryPack.mockImplementationOnce((file: string) => writeFileSync(file, Buffer.from('PMP')));

    const res = await request(app()).post('/v1/pmp/export').send({ pack_id: packId, mint_as_title: true });

    // Export still succeeds; the on-chain mint is best-effort + Base-env-gated (a no-op in tests).
    expect(res.status).toBe(201);
    // The pack is now 'title' — the exact flag the export-time mint (mintTitleAtExportBestEffort) gates on.
    const pack = (tables['memory_packs'] ?? []).find((p) => p.pack_id === packId);
    expect(pack?.sale_mode).toBe('title');
    // The mark flowed through: the registered artifact carries the title license.
    const reg = insertedRows.find((r) => r.table === 'pmp_artifacts');
    expect(reg!.rows[0].license_type).toBe('title');
  });

  it('mint_as_title on an UN-tokenised pack is rejected (a title must bind a committed root)', async () => {
    authedWallet = OWNER;
    seed('memory_packs', [
      { pack_id: 'pack-draft', author_wallet: OWNER, name: 'Draft', version: '1.0.0', memory_count: 1, merkle_root: null, content_category: 'knowledge', sale_mode: 'copy' },
    ]);
    const res = await request(app()).post('/v1/pmp/export').send({ pack_id: 'pack-draft', mint_as_title: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('pack_not_tokenised');
  });

  it('accepts chain:"base" on a tokenised title pack (the Base PORT opt-in) and still exports', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();
    seedHolderKey(OWNER); // encrypt-by-default needs the owner's registered key
    writeMemoryPack.mockImplementationOnce((file: string) => writeFileSync(file, Buffer.from('PMP')));

    const res = await request(app())
      .post('/v1/pmp/export')
      .send({ pack_id: packId, mint_as_title: true, chain: 'base' });

    // Export succeeds; the Base mint is best-effort + env-gated (a no-op in tests), exactly like Solana.
    expect(res.status).toBe(201);
    const pack = (tables['memory_packs'] ?? []).find((p) => p.pack_id === packId);
    expect(pack?.sale_mode).toBe('title');
  });

  it('rejects an unknown chain value (strict enum — only solana|base)', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();
    const res = await request(app())
      .post('/v1/pmp/export')
      .send({ pack_id: packId, mint_as_title: true, chain: 'ethereum' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_body');
  });

  it('builds a .pmp from the owner pack and registers an artifact with the right manifest_hash', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();
    seedHolderKey(OWNER); // encrypt-by-default needs the owner's registered key (manifest_hash is over
    // the pmp identity block, NOT the records, so it is unchanged by encryption)
    // Stage real .pmp bytes via the (mocked) writer so the route reads them back for the inline download.
    const pmpBytes = Buffer.from('PMP-TEST-BYTES');
    writeMemoryPack.mockImplementationOnce((file: string) => writeFileSync(file, pmpBytes));

    const res = await request(app()).post('/v1/pmp/export').send({ pack_id: packId });

    expect(res.status).toBe(201);
    // It actually wrote a pack via the reused writer.
    expect(writeMemoryPack).toHaveBeenCalledTimes(1);
    // A pmp_artifacts row was registered, scoped to the owner.
    const reg = insertedRows.find((r) => r.table === 'pmp_artifacts');
    expect(reg).toBeTruthy();
    const row = reg!.rows[0];
    expect(row.owner_wallet).toBe(OWNER);
    expect(row.pack_id).toBe(packId);
    expect(row.record_count).toBe(2);
    expect(row.license_type).toBe('copy');
    // manifest_hash is present, non-empty, and echoed in the response.
    expect(typeof row.manifest_hash).toBe('string');
    expect(row.manifest_hash.length).toBeGreaterThan(0);
    expect(res.body.artifact.manifest_hash).toBe(row.manifest_hash);
    // REGRESSION GUARD (export→verify round-trip): the writer MUST be handed the pmp identity
    // block so the merkle_root is PERSISTED into the .pmp. If export stops passing it, verify
    // reads a null declared root and silently returns verified:false for every real artifact.
    // Tie what's embedded in the file to what's registered in the DB — they must be the same root.
    expect(writeMemoryPack).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ pmp: expect.objectContaining({ merkle_root: row.merkle_root }) }),
    );
    // The artifact id identifies the registered pack.
    expect(res.body.artifact.artifact_id).toMatch(/^pmpa-/);
    // NO dangling `download` URL (the old window.open path 404'd). Instead the .pmp bytes are
    // returned INLINE (base64) with a filename, so the client saves the file directly — no round-trip.
    expect(res.body.download).toBeUndefined();
    expect(res.body.pmp_base64).toBe(pmpBytes.toString('base64'));
    expect(res.body.filename).toMatch(/\.pmp$/);
  });

  it('manifest_hash is deterministic for the same pack content (re-derivable)', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();
    seedHolderKey(OWNER); // encrypt-by-default; manifest_hash is over the pmp block (not the records
    // nor the per-export random DEK/wrap), so it stays deterministic across two encrypted exports
    const a = await request(app()).post('/v1/pmp/export').send({ pack_id: packId });
    // Reset only the registry table so the second export sees the same pack but a clean insert log.
    insertedRows.length = 0;
    tables['pmp_artifacts'] = [];
    const b = await request(app()).post('/v1/pmp/export').send({ pack_id: packId });
    expect(a.body.artifact.manifest_hash).toBe(b.body.artifact.manifest_hash);
  });

  it('refuses to export a pack the caller does not own (403)', async () => {
    authedWallet = OTHER; // authed, but not the pack author
    const packId = seedOwnedPack();
    const res = await request(app()).post('/v1/pmp/export').send({ pack_id: packId });
    expect(res.status).toBe(403);
    expect(insertedRows.find((r) => r.table === 'pmp_artifacts')).toBeFalsy();
    expect(writeMemoryPack).not.toHaveBeenCalled();
  });

  it('401 when unauthenticated', async () => {
    authedWallet = null;
    const res = await request(app()).post('/v1/pmp/export').send({ pack_id: 'pack-aaaa' });
    expect(res.status).toBe(401);
  });

  it('404 when the pack does not exist', async () => {
    authedWallet = OWNER;
    const res = await request(app()).post('/v1/pmp/export').send({ pack_id: 'pack-missing' });
    expect(res.status).toBe(404);
  });
});

// ───────────── REGRESSION: export must not advertise a dangling /download link ─────────────
// The stress test found that export advertised `download: <baseUrl>/v1/pmp/artifacts/<id>/download`
// in BOTH the 201 body and the dedup-200 body, but there is NO GET .../download handler and the
// .pmp bytes are written to a temp dir with storage_url=null — so any client (the @clude/ui
// MemoryExportPanel calls window.open(result.download)) followed the URL straight into a 404.
// Guarantee: the response advertises NO download URL, and the URL it used to advertise has no
// route (would 404). These FAIL against the pre-fix code (download was a truthy URL string).
describe('POST /v1/pmp/export — no dangling download link', () => {
  it('the 201 export response advertises no download URL', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();
    seedHolderKey(OWNER); // encrypt-by-default needs the owner's registered key

    const res = await request(app()).post('/v1/pmp/export').send({ pack_id: packId });

    expect(res.status).toBe(201);
    // The artifact is registered, but NO download link is handed back.
    expect(res.body.artifact).toBeTruthy();
    expect(res.body.download).toBeUndefined();
    // Nothing in the body is a /download URL the client could open.
    expect(JSON.stringify(res.body)).not.toContain('/download');
  });

  it('the dedup-200 export response advertises no download URL', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();
    seedHolderKey(OWNER); // encrypt-by-default needs the owner's registered key

    const first = await request(app()).post('/v1/pmp/export').send({ pack_id: packId });
    expect(first.status).toBe(201);

    // Collide the second insert on UNIQUE(owner_wallet, manifest_hash) → dedup branch.
    forceUniqueViolation = 'pmp_artifacts';
    const second = await request(app()).post('/v1/pmp/export').send({ pack_id: packId });

    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);
    expect(second.body.download).toBeUndefined();
    expect(JSON.stringify(second.body)).not.toContain('/download');
  });

  it('the formerly-advertised /download path has no handler (would 404)', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();
    seedHolderKey(OWNER); // encrypt-by-default needs the owner's registered key
    const exp = await request(app()).post('/v1/pmp/export').send({ pack_id: packId });
    const artifactId = exp.body.artifact.artifact_id as string;

    // This is the exact URL shape the pre-fix server advertised. It must NOT resolve — proving
    // that advertising it (as the bug did) would have dangled a 404 for every client that followed.
    const dl = await request(app()).get(`/v1/pmp/artifacts/${artifactId}/download`);
    expect(dl.status).toBe(404);
  });
});

// ───────────────── POST /v1/pmp/export — SELECTION path (no pack_id) ─────────────────
// The new gather: build a .pmp from the caller's OWN memories matching a selection filter,
// reusing the exact write+register tail the pack path uses. The four acceptance guarantees:
//   1. scope type/all build a pack from the matching owner memories (records + Merkle root).
//   2. a selection NEVER returns another wallet's memory (owner-scope is mandatory).
//   3. missing name OR missing category → 422 (selection metadata is required).
//   4. an empty match → 409 empty_selection.

describe('POST /v1/pmp/export — selection path', () => {
  it('scope=type builds a .pmp from the owner memories matching the type filter', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus(); // OWNER: 2 episodic + 1 semantic + 1 procedural

    const res = await request(app())
      .post('/v1/pmp/export')
      .send({
        // encrypt:false pins the PLAINTEXT path so the content assertions below test the GATHER
        // filter (not ciphertext). Encrypt-by-default has its own dedicated tests above.
        encrypt: false,
        selection: { scope: 'type', types: ['episodic'] },
        name: 'My Episodics',
        category: 'personal',
      });

    expect(res.status).toBe(201);
    // Wrote a pack via the REUSED writer with exactly the 2 OWNER episodic records.
    expect(writeMemoryPack).toHaveBeenCalledTimes(1);
    const [, writtenRecords] = writeMemoryPack.mock.calls[0] as [string, any[], any];
    expect(writtenRecords).toHaveLength(2);
    expect(writtenRecords.map((r) => r.content).sort()).toEqual(['sel-ep-one', 'sel-ep-two']);

    // Registered an owner-scoped artifact carrying the selection metadata + null pack_id.
    const reg = insertedRows.find((r) => r.table === 'pmp_artifacts');
    expect(reg).toBeTruthy();
    const row = reg!.rows[0];
    expect(row.owner_wallet).toBe(OWNER);
    expect(row.pack_id).toBeNull(); // a selection is not tied to a saved pack
    expect(row.title).toBe('My Episodics');
    expect(row.license_type).toBe('copy');
    expect(row.record_count).toBe(2);
    expect(res.body.artifact.artifact_id).toMatch(/^pmpa-/);
    // The writer is handed the pmp identity block so verify can read the root back (round-trip).
    expect(writeMemoryPack).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ pmp: expect.objectContaining({ merkle_root: row.merkle_root }) }),
    );
  });

  it('scope=all builds a .pmp from EVERY owner memory (and nothing belonging to another wallet)', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus(); // OWNER has 4 rows; OTHER has 2 colliding rows

    const res = await request(app())
      .post('/v1/pmp/export')
      .send({ encrypt: false, selection: { scope: 'all' }, name: 'Everything', category: 'knowledge' });

    expect(res.status).toBe(201);
    const [, writtenRecords] = writeMemoryPack.mock.calls[0] as [string, any[], any];
    // All 4 OWNER memories, none of OTHER's.
    expect(writtenRecords).toHaveLength(4);
    const contents = writtenRecords.map((r) => r.content).sort();
    expect(contents).toEqual(['sel-ep-one', 'sel-ep-two', 'sel-proc-one', 'sel-sem-one']);
    expect(contents).not.toContain('other-ep-secret');
    expect(contents).not.toContain('other-sem-secret');

    const row = insertedRows.find((r) => r.table === 'pmp_artifacts')!.rows[0];
    expect(row.content_source).toBeUndefined(); // content_source lives in the pmp block, not the row
    expect(row.record_count).toBe(4);
  });

  it('scope=tag gathers only the owner memories overlapping the tag', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus();

    const res = await request(app())
      .post('/v1/pmp/export')
      .send({ encrypt: false, selection: { scope: 'tag', tags: ['solana'] }, name: 'Solana', category: 'knowledge' });

    expect(res.status).toBe(201);
    const [, writtenRecords] = writeMemoryPack.mock.calls[0] as [string, any[], any];
    // OWNER rows tagged 'solana': sel-ep-one + sel-sem-one. OTHER's 'solana' rows excluded.
    expect(writtenRecords.map((r) => r.content).sort()).toEqual(['sel-ep-one', 'sel-sem-one']);
  });

  it('scope=range gathers only the owner memories created within [from, to]', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus();

    const res = await request(app())
      .post('/v1/pmp/export')
      .send({
        encrypt: false,
        selection: { scope: 'range', from: '2026-03-04T00:00:00.000Z', to: '2026-03-12T00:00:00.000Z' },
        name: 'Early March',
        category: 'personal',
      });

    expect(res.status).toBe(201);
    const [, writtenRecords] = writeMemoryPack.mock.calls[0] as [string, any[], any];
    // In-window OWNER rows: sel-ep-two (03-05) + sel-sem-one (03-10). 03-01 + 03-20 excluded.
    expect(writtenRecords.map((r) => r.content).sort()).toEqual(['sel-ep-two', 'sel-sem-one']);
  });

  it('OWNER-SCOPE: a selection NEVER pulls another wallet memory even when type+tag collide', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus(); // OTHER has an episodic 'solana'+'trade' row that overlaps this filter

    const res = await request(app())
      .post('/v1/pmp/export')
      .send({
        encrypt: false,
        selection: { scope: 'tag', tags: ['solana', 'trade'] },
        name: 'Solana Trades',
        category: 'personal',
      });

    expect(res.status).toBe(201);
    const [, writtenRecords] = writeMemoryPack.mock.calls[0] as [string, any[], any];
    // overlaps() is array-OR: OWNER rows sharing ANY of {solana, trade} → sel-ep-one + sel-sem-one.
    // The point of THIS test is the owner scope: OTHER's clude-other-0090 ALSO carries solana+trade
    // (and is episodic), yet is absent because its owner_wallet differs from the caller's.
    expect(writtenRecords.map((r) => r.content).sort()).toEqual(['sel-ep-one', 'sel-sem-one']);
    expect(writtenRecords.some((r) => r.content === 'other-ep-secret')).toBe(false);
    expect(writtenRecords.some((r) => r.content === 'other-sem-secret')).toBe(false);
    // And the persisted artifact is the caller's.
    expect(insertedRows.find((r) => r.table === 'pmp_artifacts')!.rows[0].owner_wallet).toBe(OWNER);
  });

  it('422 when name is missing on a selection export', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus();
    const res = await request(app())
      .post('/v1/pmp/export')
      .send({ selection: { scope: 'all' }, category: 'personal' });
    expect(res.status).toBe(422);
    expect(writeMemoryPack).not.toHaveBeenCalled();
    expect(insertedRows.find((r) => r.table === 'pmp_artifacts')).toBeFalsy();
  });

  it('422 when name is present but empty/whitespace', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus();
    const res = await request(app())
      .post('/v1/pmp/export')
      .send({ selection: { scope: 'all' }, name: '   ', category: 'personal' });
    expect(res.status).toBe(422);
    expect(writeMemoryPack).not.toHaveBeenCalled();
  });

  it('422 when category is missing on a selection export', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus();
    const res = await request(app())
      .post('/v1/pmp/export')
      .send({ selection: { scope: 'all' }, name: 'No Category' });
    expect(res.status).toBe(422);
    expect(writeMemoryPack).not.toHaveBeenCalled();
  });

  it('422 when category is not one of personal|knowledge|agent', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus();
    const res = await request(app())
      .post('/v1/pmp/export')
      .send({ selection: { scope: 'all' }, name: 'Bad Cat', category: 'enterprise' });
    expect(res.status).toBe(422);
    expect(writeMemoryPack).not.toHaveBeenCalled();
  });

  it('409 empty_selection when no owner memory matches the filter', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus(); // OWNER has no 'self_model' memories
    const res = await request(app())
      .post('/v1/pmp/export')
      .send({ selection: { scope: 'type', types: ['self_model'] }, name: 'None', category: 'personal' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('empty_selection');
    expect(writeMemoryPack).not.toHaveBeenCalled();
    expect(insertedRows.find((r) => r.table === 'pmp_artifacts')).toBeFalsy();
  });

  it('409 empty_selection when the only matching memories belong to ANOTHER wallet', async () => {
    authedWallet = OWNER;
    // Seed ONLY OTHER-owned rows; an OWNER 'all' selection must gather nothing → 409.
    seed('memories', [
      {
        id: 200,
        hash_id: 'clude-only-other',
        memory_type: 'semantic',
        content: 'only-other',
        summary: 's',
        owner_wallet: OTHER,
        created_at: '2026-03-01T00:00:00.000Z',
        tags: [],
        source: 'chat',
        related_user: null,
        related_wallet: null,
        content_hash: 'lh:only-other',
        importance: 0.5,
        tokenization_status: 'stored',
      },
    ]);
    const res = await request(app())
      .post('/v1/pmp/export')
      .send({ selection: { scope: 'all' }, name: 'Mine', category: 'personal' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('empty_selection');
  });

  it('401 when unauthenticated on a selection export', async () => {
    authedWallet = null;
    const res = await request(app())
      .post('/v1/pmp/export')
      .send({ selection: { scope: 'all' }, name: 'X', category: 'personal' });
    expect(res.status).toBe(401);
  });

  it('a selection export DEDUPES on UNIQUE(owner_wallet, manifest_hash) → 200 deduped', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus();
    seedHolderKey(OWNER); // encrypt-by-default needs the owner's registered key

    const first = await request(app())
      .post('/v1/pmp/export')
      .send({ selection: { scope: 'type', types: ['procedural'] }, name: 'Procs', category: 'knowledge' });
    expect(first.status).toBe(201);
    const firstId = first.body.artifact.artifact_id;

    // Same selection again → the next pmp_artifacts insert collides → existing row returned.
    forceUniqueViolation = 'pmp_artifacts';
    const second = await request(app())
      .post('/v1/pmp/export')
      .send({ selection: { scope: 'type', types: ['procedural'] }, name: 'Procs', category: 'knowledge' });
    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);
    expect(second.body.artifact.artifact_id).toBe(firstId);
  });

  it('a selection with scope=pack + pack_id routes through the PACK path (not the new gather)', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();
    seedHolderKey(OWNER); // encrypt-by-default needs the owner's registered key
    // No name/category supplied — proves scope:'pack' is the pack path, which does not require them.
    const res = await request(app())
      .post('/v1/pmp/export')
      .send({ selection: { scope: 'pack', pack_id: packId } });
    expect(res.status).toBe(201);
    // The pack path persists the pack_id on the artifact row.
    expect(insertedRows.find((r) => r.table === 'pmp_artifacts')!.rows[0].pack_id).toBe(packId);
  });

  it('422 when neither pack_id nor a non-pack selection is supplied', async () => {
    authedWallet = OWNER;
    const res = await request(app()).post('/v1/pmp/export').send({ name: 'orphan', category: 'personal' });
    expect(res.status).toBe(422);
    expect(writeMemoryPack).not.toHaveBeenCalled();
  });

  it('PAGINATION: gathers ALL owner memories past the 1000-row REST cap (not capped at one page)', async () => {
    authedWallet = OWNER;
    // 1500 OWNER rows > SELECTION_PAGE_SIZE (1000): a single .range() page would silently cap at
    // 1000. The gather must page (.range in a while-loop) until a short page, so all 1500 land.
    const TOTAL = 1500;
    const rows = Array.from({ length: TOTAL }, (_v, i) => {
      const n = String(i).padStart(5, '0'); // zero-pad so created_at string-orders == index order
      return {
        id: 5000 + i,
        hash_id: `clude-pg-${n}`,
        memory_type: 'episodic',
        content: `pg-${n}`,
        summary: `s-${n}`,
        owner_wallet: OWNER,
        // distinct, monotonically increasing ISO timestamps so ORDER BY created_at is stable
        created_at: `2026-04-01T00:00:${'00'}.${n.slice(-3)}Z`,
        tags: ['bulk'],
        source: 'chat',
        related_user: null,
        related_wallet: null,
        content_hash: `lh:pg-${n}`,
        importance: 0.5,
        tokenization_status: 'stored',
      };
    });
    // One OTHER-owned row that would slip in if the owner scope were dropped on any page.
    rows.push({
      id: 999999,
      hash_id: 'clude-pg-other',
      memory_type: 'episodic',
      content: 'pg-other-secret',
      summary: 's',
      owner_wallet: OTHER,
      created_at: '2026-04-01T00:00:00.500Z',
      tags: ['bulk'],
      source: 'chat',
      related_user: null,
      related_wallet: null,
      content_hash: 'lh:pg-other-secret',
      importance: 0.9,
      tokenization_status: 'stored',
    });
    seed('memories', rows);

    const res = await request(app())
      .post('/v1/pmp/export')
      .send({ encrypt: false, selection: { scope: 'tag', tags: ['bulk'] }, name: 'Bulk', category: 'knowledge' });

    expect(res.status).toBe(201);
    const [, writtenRecords] = writeMemoryPack.mock.calls[0] as [string, any[], any];
    // ALL 1500 OWNER rows present — proves the second page was fetched, not capped at 1000.
    expect(writtenRecords).toHaveLength(TOTAL);
    expect(res.body.artifact.record_count).toBe(TOTAL);
    // The OTHER-owned colliding row never leaked, on any page.
    expect(writtenRecords.some((r) => r.content === 'pg-other-secret')).toBe(false);
    // First + last by content confirm the full ordered range was assembled across both pages.
    const contents = writtenRecords.map((r) => r.content);
    expect(contents).toContain('pg-00000');
    expect(contents).toContain('pg-01499');
  });
});

// ───────────────── POST /v1/pmp/export — encryption (Task 4: encrypt-by-default, fail-CLOSED) ─────────────────
// The UI promises an encrypted export; the server must DELIVER ciphertext by default and never
// silently emit plaintext. encryptRecordsForHolder runs REAL crypto here (memory-envelope is not
// mocked), so the holder's encryption_keys row (a genuine nacl.box pubkey) is the only fixture the
// crypto needs. Four guarantees:
//   1. encrypt OMITTED  → the .pmp records are CIPHERTEXT (encrypted:true, content != plaintext),
//      the writer gets the owner-sealed header, and the row's encryption_scope is 'owner'.
//   2. encrypt:false    → plaintext records, NO owner header, encryption_scope 'none' (explicit opt-out).
//   3. holder has NO key + encrypt omitted → 422 holder_key_unregistered, and NO file is written
//      (writeMemoryPack is never called — fail closed, emit nothing).
//   4. the SELECTION path encrypts-by-default too (the dual write-site is wired, not just the pack path).

describe('POST /v1/pmp/export — encryption (encrypt-by-default, fail-closed)', () => {
  it('encrypts by default (encrypt OMITTED): records are ciphertext, writer gets the owner header, scope=owner', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack(); // member contents are plaintext 'alpha' + 'beta'
    seedHolderKey(OWNER); // a registered X25519 key to seal the pack DEK to
    writeMemoryPack.mockImplementationOnce((file: string) => writeFileSync(file, Buffer.from('PMP')));

    // No `encrypt` field at all — the fail-closed default must still encrypt.
    const res = await request(app()).post('/v1/pmp/export').send({ pack_id: packId });

    expect(res.status).toBe(201);
    expect(writeMemoryPack).toHaveBeenCalledTimes(1);

    // The records handed to the writer are CIPHERTEXT — every one flagged encrypted, none carrying
    // the seeded plaintext content. (Real secretbox output is base64 of nonce‖ct, never 'alpha'/'beta'.)
    const [, writtenRecords, writeOpts] = writeMemoryPack.mock.calls[0] as [string, any[], any];
    expect(writtenRecords).toHaveLength(2);
    expect(writtenRecords.every((r) => r.encrypted === true)).toBe(true);
    const writtenContents = writtenRecords.map((r) => r.content);
    expect(writtenContents).not.toContain('alpha');
    expect(writtenContents).not.toContain('beta');

    // The writer was handed the owner-sealed encryption header with all five contract fields.
    expect(writeOpts.ownerEncryption).toBeTruthy();
    expect(writeOpts.ownerEncryption).toEqual(
      expect.objectContaining({
        recipient_wallet: OWNER,
        recipient_pubkey: expect.any(String),
        verifier_ct: expect.any(String),
        dek_wrap: expect.any(String),
        wrap_pubkey: expect.any(String),
      }),
    );
    expect(writeOpts.ownerEncryption.recipient_wallet).toBe(OWNER);

    // The registered artifact row records the owner encryption scope.
    const row = insertedRows.find((r) => r.table === 'pmp_artifacts')!.rows[0];
    expect(row.encryption_scope).toBe('owner');

    // The merkle leaf is computed over PLAINTEXT upstream and survives encryption untouched, so the
    // embedded root is unchanged by encryption (the on-chain commitment is unaffected).
    expect(writeOpts.pmp.merkle_root).toBe(row.merkle_root);
  });

  it('F1: encrypt-by-default seals third-party related_user/related_wallet into related_ct (no plaintext PII reaches the writer)', async () => {
    authedWallet = OWNER;
    const packId = 'pack-rel1';
    const RELATED_USER = 'third-party-user-77ab';
    const RELATED_WALLET = 'GhostWaLLet9999999999999999999999third99';
    // A pack whose single member memory carries NON-NULL related_* — the social-graph PII the F1
    // leak shipped in cleartext. The route runs REAL encryptRecordsForHolder, so a leak here is a
    // leak in production bytes.
    seed('memory_packs', [
      {
        pack_id: packId,
        author_wallet: OWNER,
        name: 'Related pack',
        description: 'has a relation',
        version: '1.0.0',
        memory_count: 1,
        merkle_root: 'root(lh:rel)',
        pack_token_address: 'memo:txsig2',
        content_category: 'knowledge',
        sale_mode: 'copy',
      },
    ]);
    seed('memory_pack_contents', [
      { pack_id: packId, memory_id: 91, leaf_index: 0, content_hash: 'lh:rel' },
    ]);
    seed('memories', [
      {
        id: 91,
        hash_id: 'clude-rel00091',
        memory_type: 'semantic',
        content: 'gamma references a counterparty',
        summary: 'gamma summary',
        owner_wallet: OWNER,
        created_at: '2026-02-01T00:00:00.000Z',
        tags: ['solana'],
        source: 'chat',
        related_user: RELATED_USER,
        related_wallet: RELATED_WALLET,
        content_hash: 'lh:rel',
        tokenization_status: 'minted',
      },
    ]);
    seedHolderKey(OWNER);
    writeMemoryPack.mockImplementationOnce((file: string) => writeFileSync(file, Buffer.from('PMP')));

    const res = await request(app()).post('/v1/pmp/export').send({ pack_id: packId });
    expect(res.status).toBe(201);

    const [, writtenRecords, writeOpts] = writeMemoryPack.mock.calls[0] as [string, any[], any];
    expect(writtenRecords).toHaveLength(1);
    const meta = writtenRecords[0].metadata as Record<string, unknown>;
    // No plaintext related_* in the emitted record metadata.
    expect(meta.related_user).toBeUndefined();
    expect(meta.related_wallet).toBeUndefined();
    // related_ct is present (base64 ciphertext); leaf_hash + owner_wallet stay plaintext.
    expect(typeof meta.related_ct).toBe('string');
    expect(typeof meta.leaf_hash).toBe('string');
    expect(meta.owner_wallet).toBe(OWNER);
    // Belt-and-braces: serialise everything the writer was handed and confirm the PII is GONE.
    const blob = JSON.stringify({ writtenRecords, ownerEncryption: writeOpts.ownerEncryption });
    expect(blob).not.toContain(RELATED_USER);
    expect(blob).not.toContain(RELATED_WALLET);
  });

  it('encrypt:false opts out: records stay plaintext, NO owner header, scope=none', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();
    seedHolderKey(OWNER); // present, but an explicit opt-out must ignore it
    writeMemoryPack.mockImplementationOnce((file: string) => writeFileSync(file, Buffer.from('PMP')));

    const res = await request(app()).post('/v1/pmp/export').send({ pack_id: packId, encrypt: false });

    expect(res.status).toBe(201);
    const [, writtenRecords, writeOpts] = writeMemoryPack.mock.calls[0] as [string, any[], any];
    // Plaintext path: the seeded content rides through verbatim, nothing flagged encrypted.
    expect(writtenRecords.map((r) => r.content).sort()).toEqual(['alpha', 'beta']);
    expect(writtenRecords.some((r) => r.encrypted === true)).toBe(false);
    // No owner-sealed header is handed to the writer.
    expect(writeOpts.ownerEncryption).toBeUndefined();
    // And the row records no encryption scope.
    const row = insertedRows.find((r) => r.table === 'pmp_artifacts')!.rows[0];
    expect(row.encryption_scope).toBe('none');
  });

  it('FAIL-CLOSED: holder has NO registered key + encrypt omitted → 422 holder_key_unregistered, NO file written', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();
    // Deliberately DO NOT seed an encryption_keys row → encryptRecordsForHolder throws.

    const res = await request(app()).post('/v1/pmp/export').send({ pack_id: packId });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('holder_key_unregistered');
    // The crux: NO bytes were emitted — the writer was never called, and no artifact row landed.
    expect(writeMemoryPack).not.toHaveBeenCalled();
    expect(insertedRows.find((r) => r.table === 'pmp_artifacts')).toBeFalsy();
  });

  it('SELECTION path also encrypts by default (the dual write-site is wired)', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus(); // OWNER: 2 episodic + 1 semantic + 1 procedural
    seedHolderKey(OWNER);
    writeMemoryPack.mockImplementationOnce((file: string) => writeFileSync(file, Buffer.from('PMP')));

    // encrypt OMITTED on the selection body — must still encrypt.
    const res = await request(app())
      .post('/v1/pmp/export')
      .send({ selection: { scope: 'type', types: ['episodic'] }, name: 'My Episodics', category: 'personal' });

    expect(res.status).toBe(201);
    const [, writtenRecords, writeOpts] = writeMemoryPack.mock.calls[0] as [string, any[], any];
    expect(writtenRecords).toHaveLength(2);
    expect(writtenRecords.every((r) => r.encrypted === true)).toBe(true);
    // The seeded plaintext is NOT present in the ciphertext records.
    const writtenContents = writtenRecords.map((r) => r.content);
    expect(writtenContents).not.toContain('sel-ep-one');
    expect(writtenContents).not.toContain('sel-ep-two');
    // Owner-sealed header present, and the row carries the owner scope.
    expect(writeOpts.ownerEncryption).toBeTruthy();
    expect(writeOpts.ownerEncryption.recipient_wallet).toBe(OWNER);
    const row = insertedRows.find((r) => r.table === 'pmp_artifacts')!.rows[0];
    expect(row.encryption_scope).toBe('owner');
  });
});

// ───────────────── POST /v1/pmp/export/preview ─────────────────

describe('POST /v1/pmp/export/preview', () => {
  it('returns total + by_type counts for an owner all-selection (owner-scoped)', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus(); // OWNER: 2 episodic, 1 semantic, 1 procedural; OTHER: 2 rows

    const res = await request(app())
      .post('/v1/pmp/export/preview')
      .send({ selection: { scope: 'all' } });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(4); // OWNER only — OTHER's 2 rows are NOT counted
    expect(res.body.by_type).toEqual({ episodic: 2, semantic: 1, procedural: 1 });
  });

  it('by_type reflects a type-scoped selection (only the requested types count)', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus();

    const res = await request(app())
      .post('/v1/pmp/export/preview')
      .send({ selection: { scope: 'type', types: ['episodic'] } });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.by_type).toEqual({ episodic: 2 });
  });

  it('by_type reflects a tag-scoped selection', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus();

    const res = await request(app())
      .post('/v1/pmp/export/preview')
      .send({ selection: { scope: 'tag', tags: ['solana'] } });

    expect(res.status).toBe(200);
    // OWNER 'solana' rows: sel-ep-one (episodic) + sel-sem-one (semantic).
    expect(res.body.total).toBe(2);
    expect(res.body.by_type).toEqual({ episodic: 1, semantic: 1 });
  });

  it('OWNER-SCOPE: the preview never counts another wallet rows', async () => {
    authedWallet = OWNER;
    // ONLY OTHER-owned rows exist → an OWNER preview must total 0.
    seed('memories', [
      {
        id: 300,
        hash_id: 'clude-x-300',
        memory_type: 'episodic',
        content: 'x',
        owner_wallet: OTHER,
        created_at: '2026-03-01T00:00:00.000Z',
        tags: ['solana'],
        source: 'chat',
        content_hash: 'lh:x',
        importance: 0.5,
      },
    ]);
    const res = await request(app())
      .post('/v1/pmp/export/preview')
      .send({ selection: { scope: 'all' } });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.by_type).toEqual({});
  });

  it('total 0 / empty by_type when the owner has no memories', async () => {
    authedWallet = OWNER;
    const res = await request(app())
      .post('/v1/pmp/export/preview')
      .send({ selection: { scope: 'all' } });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.by_type).toEqual({});
  });

  it('401 when unauthenticated', async () => {
    authedWallet = null;
    const res = await request(app())
      .post('/v1/pmp/export/preview')
      .send({ selection: { scope: 'all' } });
    expect(res.status).toBe(401);
  });

  it('422 when the selection body is malformed (bad scope)', async () => {
    authedWallet = OWNER;
    const res = await request(app())
      .post('/v1/pmp/export/preview')
      .send({ selection: { scope: 'nonsense' } });
    expect(res.status).toBe(422);
  });

  it('422 when the selection is missing entirely', async () => {
    authedWallet = OWNER;
    const res = await request(app()).post('/v1/pmp/export/preview').send({});
    expect(res.status).toBe(422);
  });

  it('500 preview_failed when a count query errors', async () => {
    authedWallet = OWNER;
    seedSelectionCorpus();
    forceError = { table: 'memories', error: { message: 'count blew up' } };
    const res = await request(app())
      .post('/v1/pmp/export/preview')
      .send({ selection: { scope: 'all' } });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('preview_failed');
  });
});

// ───────────────────── GET /v1/pmp/artifacts (+ /:id) ─────────────────────

describe('GET /v1/pmp/artifacts', () => {
  it('lists ONLY the caller-owned artifacts', async () => {
    authedWallet = OWNER;
    seed('pmp_artifacts', [
      { artifact_id: 'pmpa-mine01', owner_wallet: OWNER, pack_id: 'pack-aaaa', title: 'Mine', license_type: 'copy', record_count: 2, manifest_hash: 'mh1', pmp_version: '0.8', creator_pubkey: 'pk', manifest_sig: 'sig', created_at: '2026-02-01T00:00:00Z' },
      { artifact_id: 'pmpa-theirs', owner_wallet: OTHER, pack_id: 'pack-bbbb', title: 'Theirs', license_type: 'copy', record_count: 1, manifest_hash: 'mh2', pmp_version: '0.8', creator_pubkey: 'pk', manifest_sig: 'sig', created_at: '2026-02-01T00:00:00Z' },
    ]);
    const res = await request(app()).get('/v1/pmp/artifacts');
    expect(res.status).toBe(200);
    expect(res.body.artifacts).toHaveLength(1);
    expect(res.body.artifacts[0].artifact_id).toBe('pmpa-mine01');
  });

  it('GET /:id returns owner metadata; another wallet sees 404', async () => {
    seed('pmp_artifacts', [
      { artifact_id: 'pmpa-mine01', owner_wallet: OWNER, pack_id: 'pack-aaaa', title: 'Mine', license_type: 'copy', record_count: 2, manifest_hash: 'mh1', pmp_version: '0.8', creator_pubkey: 'pk', manifest_sig: 'sig', created_at: '2026-02-01T00:00:00Z' },
    ]);
    authedWallet = OWNER;
    const ok = await request(app()).get('/v1/pmp/artifacts/pmpa-mine01');
    expect(ok.status).toBe(200);
    expect(ok.body.artifact.artifact_id).toBe('pmpa-mine01');
    // B2.2: the owner card carries the trust bundle (attestation null without an anchor key here).
    expect(ok.body.proof).toBeDefined();

    authedWallet = OTHER;
    const denied = await request(app()).get('/v1/pmp/artifacts/pmpa-mine01');
    expect(denied.status).toBe(404); // not 403 — don't leak existence cross-tenant
  });
});

// ─────────────────── GET /v1/pmp/artifacts/:id/proof (B2.2, public oracle) ───────────────────

describe('GET /v1/pmp/artifacts/:id/proof (public verification oracle)', () => {
  const anchored = {
    artifact_id: 'pmpa-anchor',
    owner_wallet: OWNER,
    pack_id: 'pack-aaaa',
    title: 'Anchored',
    license_type: 'copy',
    record_count: 3,
    merkle_root: 'a'.repeat(64),
    manifest_hash: 'b'.repeat(64),
    pmp_version: '0.8',
    creator_pubkey: 'CreatorPubKey111',
    manifest_sig: '',
    anchor_chain: 'solana',
    anchor_tx_sig: '3XRgTxSigForTheAnchorMemo',
    created_at: '2026-07-01T00:00:00.000Z',
  };

  it('is PUBLIC (no auth) and derives the Solscan explorer link from anchor_tx_sig', async () => {
    seed('pmp_artifacts', [anchored]);
    authedWallet = null; // unauthenticated caller — proof-of-commitment is public
    const res = await request(app()).get('/v1/pmp/artifacts/pmpa-anchor/proof');
    expect(res.status).toBe(200);
    expect(res.body.merkle_root).toBe('a'.repeat(64));
    expect(res.body.manifest_hash).toBe('b'.repeat(64));
    expect(res.body.anchor).toEqual({
      chain: 'solana',
      tx_sig: '3XRgTxSigForTheAnchorMemo',
      explorer_url: 'https://solscan.io/tx/3XRgTxSigForTheAnchorMemo',
    });
  });

  it('does NOT leak owner_wallet or private metadata', async () => {
    seed('pmp_artifacts', [anchored]);
    authedWallet = null;
    const res = await request(app()).get('/v1/pmp/artifacts/pmpa-anchor/proof');
    expect(res.body.owner_wallet).toBeUndefined();
    expect(res.body.title).toBeUndefined();
    // Proof-relevant identity only.
    expect(res.body.creator_pubkey).toBe('CreatorPubKey111');
  });

  it('reports anchor:null for an un-anchored artifact (attestation still present once keyed)', async () => {
    seed('pmp_artifacts', [{ ...anchored, artifact_id: 'pmpa-noanchor', anchor_tx_sig: null, anchor_chain: null }]);
    authedWallet = null;
    const res = await request(app()).get('/v1/pmp/artifacts/pmpa-noanchor/proof');
    expect(res.status).toBe(200);
    expect(res.body.anchor).toBeNull();
    expect(res.body).toHaveProperty('attestation'); // null here (no ANCHOR key in test env), but always present
  });

  it('404s an unknown artifact', async () => {
    authedWallet = null;
    const res = await request(app()).get('/v1/pmp/artifacts/pmpa-ghost/proof');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('artifact_not_found');
  });
});

// ───────────────────────── POST /v1/pmp/verify ─────────────────────────

describe('POST /v1/pmp/verify (no auth, hosted twin of memorypack verify)', () => {
  it('verifies an intact pack: recomputed root == declared root', async () => {
    const { declaredRoot } = stubReadablePmp();
    const res = await request(app())
      .post('/v1/pmp/verify')
      .send({ pmp_base64: Buffer.from('fake-tarball-bytes').toString('base64') });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.root).toBe(declaredRoot);
    expect(res.body.recomputed_root).toBe(declaredRoot);
  });

  it('REJECTS a tampered pack: a mutated record body recomputes a different root', async () => {
    stubReadablePmp({ tamper: true });
    const res = await request(app())
      .post('/v1/pmp/verify')
      .send({ pmp_base64: Buffer.from('fake-tarball-bytes').toString('base64') });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.recomputed_root).not.toBe(res.body.root);
  });

  it('requires a pmp payload (422 when missing)', async () => {
    const res = await request(app()).post('/v1/pmp/verify').send({});
    expect(res.status).toBe(422);
  });

  it('does NOT require auth', async () => {
    authedWallet = null;
    stubReadablePmp();
    const res = await request(app())
      .post('/v1/pmp/verify')
      .send({ pmp_base64: Buffer.from('x').toString('base64') });
    expect(res.status).toBe(200);
  });
});

// ───────────────────────── POST /v1/pmp/import ─────────────────────────

describe('POST /v1/pmp/import', () => {
  it('hash-verifies, dedupes by content_hash, ingests the rest, writes a pmp_imports receipt', async () => {
    authedWallet = OWNER;
    stubReadablePmp(); // 2 records, leaves lh:alpha + lh:beta, root matches
    // The owner ALREADY has a memory whose content_hash == lh:alpha → that record dedupes.
    seed('memories', [
      {
        id: 50,
        hash_id: 'clude-existing',
        owner_wallet: OWNER,
        content: 'alpha',
        content_hash: 'lh:alpha',
        memory_type: 'semantic',
        tags: ['solana'],
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const res = await request(app())
      .post('/v1/pmp/import')
      .send({ pmp_base64: Buffer.from('fake').toString('base64') });

    expect(res.status).toBe(201);
    // 2 in the pack, 1 deduped (lh:alpha), 1 imported (lh:beta), 0 rejected.
    expect(res.body.record_count).toBe(2);
    expect(res.body.deduped_count).toBe(1);
    expect(res.body.imported_count).toBe(1);
    expect(res.body.rejected_count).toBe(0);

    // The imported memory landed in the OWNER's namespace only.
    const memInserts = insertedRows.filter((r) => r.table === 'memories');
    const importedRows = memInserts.flatMap((r) => r.rows);
    expect(importedRows).toHaveLength(1);
    expect(importedRows[0].owner_wallet).toBe(OWNER);
    expect(importedRows[0].content).toBe('beta');
    expect(importedRows[0].content_hash).toBe('lh:beta');

    // A pmp_imports receipt row was written with the right counts, scoped to the owner.
    const receipt = insertedRows.find((r) => r.table === 'pmp_imports');
    expect(receipt).toBeTruthy();
    expect(receipt!.rows[0].owner_wallet).toBe(OWNER);
    expect(receipt!.rows[0].imported_count).toBe(1);
    expect(receipt!.rows[0].deduped_count).toBe(1);
    expect(receipt!.rows[0].record_count).toBe(2);
  });

  it('REJECTS records whose recomputed leaf hash does not match the declared content (counted, not ingested)', async () => {
    authedWallet = OWNER;
    // A pack carrying a per-record declared leaf_hash that DISAGREES with the recomputed one.
    const records = [
      {
        id: 'clude-good',
        created_at: '2026-01-01T00:00:00.000Z',
        kind: 'semantic',
        content: 'good',
        tags: [],
        importance: 0.5,
        source: 'chat',
        leaf_hash: 'lh:good', // matches memoryContentHash('good') = lh:good
      },
      {
        id: 'clude-bad',
        created_at: '2026-01-02T00:00:00.000Z',
        kind: 'semantic',
        content: 'bad',
        tags: [],
        importance: 0.5,
        source: 'chat',
        leaf_hash: 'lh:NOT-bad', // disagrees with memoryContentHash('bad') = lh:bad → reject
      },
    ];
    readMemoryPack.mockReturnValue({
      manifest: { memorypack_version: '0.2', producer: { name: 'd', version: '1', public_key: 'pk' }, record_count: 2, record_schema: 's', pmp: { merkle_root: 'whatever', manifest_sig: 'sig' } },
      records,
      minimalRecords: records,
      verifiedRecords: new Set<string>(),
      unsignedRecords: new Set<string>(),
      anchors: [],
      verifiedBlobs: new Set<string>(),
      verifiedAnchors: new Set<string>(),
      revocations: [],
      revokedRecordHashes: new Set<string>(),
      revocationAnchors: [],
      verifiedRevocationAnchors: new Set<string>(),
      warnings: [],
    });

    const res = await request(app())
      .post('/v1/pmp/import')
      .send({ pmp_base64: Buffer.from('fake').toString('base64') });

    expect(res.status).toBe(201);
    expect(res.body.rejected_count).toBe(1);
    expect(res.body.imported_count).toBe(1);
    const importedRows = insertedRows.filter((r) => r.table === 'memories').flatMap((r) => r.rows);
    expect(importedRows).toHaveLength(1);
    expect(importedRows[0].content).toBe('good');
  });

  it('401 when unauthenticated', async () => {
    authedWallet = null;
    const res = await request(app()).post('/v1/pmp/import').send({ pmp_base64: 'eA==' });
    expect(res.status).toBe(401);
  });

  it('422 when no pmp payload is supplied', async () => {
    authedWallet = OWNER;
    const res = await request(app()).post('/v1/pmp/import').send({});
    expect(res.status).toBe(422);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  COVERAGE-HARDENING — edge cases, failure modes, and cross-leg invariants the
//  four happy-path acceptance tests above do not exercise. Same harness/idiom.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a readMemoryPack stub from an explicit record list + declared root. Lets each
 * hardening test drive verify/import with exactly the bytes it wants (ciphertext records,
 * intra-pack duplicate leaves, an empty record list, etc.) without the fixed 2-record shape.
 */
function stubReadPmp(opts: {
  records: any[];
  declaredRoot?: string | null;
  producerPubkey?: string | null;
  creatorPubkey?: string | null;
  artifactId?: string;
}) {
  const producer =
    opts.producerPubkey === null
      ? { name: 'd', version: '1' }
      : { name: 'clude-desktop', version: '1.0.0', public_key: opts.producerPubkey ?? 'CreatorPubKey' };
  readMemoryPack.mockReturnValue({
    manifest: {
      memorypack_version: '0.2',
      producer,
      record_count: opts.records.length,
      record_schema: 'clude-memory-v1',
      pmp: {
        pmp_version: '0.8',
        artifact_id: opts.artifactId ?? 'pmpa-source01',
        title: 'Some Pack',
        license_type: 'copy',
        ...(opts.declaredRoot !== undefined ? { merkle_root: opts.declaredRoot } : {}),
        ...(opts.creatorPubkey !== undefined ? { creator_pubkey: opts.creatorPubkey } : {}),
        manifest_sig: 'base58:sig',
      },
    },
    records: opts.records,
    minimalRecords: opts.records,
    verifiedRecords: new Set<string>(),
    unsignedRecords: new Set<string>(),
    anchors: [],
    verifiedBlobs: new Set<string>(),
    verifiedAnchors: new Set<string>(),
    revocations: [],
    revokedRecordHashes: new Set<string>(),
    revocationAnchors: [],
    verifiedRevocationAnchors: new Set<string>(),
    warnings: [],
  });
}

function plainRecord(content: string, extra: Record<string, any> = {}) {
  return {
    id: `clude-${content}`,
    created_at: '2026-01-01T00:00:00.000Z',
    kind: 'semantic',
    content,
    tags: [],
    importance: 0.5,
    source: 'chat',
    ...extra,
  };
}

const b64 = (s: string) => Buffer.from(s).toString('base64');

// ── B1.3: owner-sealed pack stub — like stubReadPmp but the manifest carries the
//    owner-sealed encryption header and the records are ciphertext with declared leaves. ──
function stubEncryptedPmp(opts: { recipientWallet: string; records: any[] }) {
  readMemoryPack.mockReturnValue({
    manifest: {
      memorypack_version: '0.2',
      producer: { name: 'clude-server', version: '0.2', public_key: 'ExporterPubKey' },
      record_count: opts.records.length,
      record_schema: 'clude-memory-v1',
      encryption: {
        algorithm: 'xsalsa20-poly1305',
        nonce_strategy: 'per-record-random',
        key_derivation: 'owner-sealed',
        scope: 'records',
        owner: {
          recipient_wallet: opts.recipientWallet,
          recipient_pubkey: 'b64:recipient-x25519',
          verifier_ct: 'b64:verifier',
          dek_wrap: 'b64:sealed-dek',
          wrap_pubkey: 'b64:ephemeral-pub',
        },
      },
      pmp: {
        pmp_version: '0.8',
        artifact_id: 'pmpa-enc01',
        title: 'Sealed Pack',
        license_type: 'copy',
        merkle_root: 'root(lh:secret)',
      },
    },
    records: opts.records,
    minimalRecords: opts.records,
    verifiedRecords: new Set<string>(),
    unsignedRecords: new Set<string>(),
    anchors: [],
    verifiedBlobs: new Set<string>(),
    verifiedAnchors: new Set<string>(),
    revocations: [],
    revokedRecordHashes: new Set<string>(),
    revocationAnchors: [],
    verifiedRevocationAnchors: new Set<string>(),
    warnings: [],
  });
}

const ENC_RECORD = {
  kind: 'semantic',
  content: 'CIPHERTEXTBYTES',
  encrypted: true,
  nonce: 'b64:nonce1',
  leaf_hash: 'lh:secret',
  tags: [],
  created_at: '2026-06-01T00:00:00.000Z',
};

describe('POST /v1/pmp/import — encrypted records (B1.3 ciphertext-preserving)', () => {
  const postImport = () =>
    request(app()).post('/v1/pmp/import').send({ pmp_base64: b64('fake') });

  it('still rejects encrypted records in a pack WITHOUT an owner-sealed header (legacy)', async () => {
    authedWallet = OWNER;
    stubReadPmp({ records: [ENC_RECORD], declaredRoot: 'root(lh:secret)' });
    const res = await postImport();
    expect(res.status).toBe(201);
    expect(res.body.rejected_count).toBe(1);
    expect(res.body.imported_count).toBe(0);
  });

  it('rejects encrypted records sealed to a DIFFERENT wallet (unreadable forever for this owner)', async () => {
    authedWallet = OWNER;
    stubEncryptedPmp({ recipientWallet: 'SomeoneElseWallet', records: [ENC_RECORD] });
    const res = await postImport();
    expect(res.status).toBe(201);
    expect(res.body.rejected_count).toBe(1);
    expect(res.body.imported_encrypted_count).toBe(0);
  });

  it('rejects an encrypted record with NO declared leaf hash (no identity, no dedup, no proof)', async () => {
    authedWallet = OWNER;
    const hashless: Record<string, any> = { ...ENC_RECORD };
    delete hashless.leaf_hash;
    stubEncryptedPmp({ recipientWallet: OWNER, records: [hashless] });
    const res = await postImport();
    expect(res.status).toBe(201);
    expect(res.body.rejected_count).toBe(1);
  });

  it('imports an encrypted record sealed to the importer as a cold owner-sealed row + DEK wrap', async () => {
    authedWallet = OWNER;
    stubEncryptedPmp({ recipientWallet: OWNER, records: [ENC_RECORD] });
    const res = await postImport();

    expect(res.status).toBe(201);
    expect(res.body.imported_count).toBe(1);
    expect(res.body.imported_encrypted_count).toBe(1);
    expect(res.body.rejected_count).toBe(0);

    // The inserted row preserves ciphertext + envelope semantics.
    const memRows = insertedRows.filter((i) => i.table === 'memories').flatMap((i) => i.rows);
    expect(memRows).toHaveLength(1);
    const row = memRows[0] as any;
    expect(row.encrypted).toBe(true);
    expect(row.provider_delegated).toBe(false); // the server can NEVER read it
    expect(row.content).toBe('CIPHERTEXTBYTES');
    expect(row.content_hash).toBe('lh:secret'); // declared; trust anchored to the pack merkle root
    expect(row.encryption_pubkey).toBe('b64:recipient-x25519');
    expect(row.metadata.pmp_encrypted_import).toEqual({ hash_verified: false, nonce: 'b64:nonce1' });

    // The pack DEK wrap was copied onto the row so owner-key machinery can decrypt it.
    const wraps = insertedRows.filter((i) => i.table === 'memory_dek_wraps').flatMap((i) => i.rows);
    expect(wraps).toHaveLength(1);
    expect(wraps[0]).toMatchObject({
      recipient: 'owner',
      wrapped_dek: 'b64:sealed-dek',
      wrap_pubkey: 'b64:ephemeral-pub',
    });
  });

  it('JOIN PROPERTY (B1.2a x B1.5): an import receipt for a pack hashes to the export row it came from', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();
    seedHolderKey(OWNER);

    // Export: the writer mock RETURNS a full as-written manifest (real
    // created_at, tarball format, owner-sealed encryption block) — the shape
    // that used to break the join when import hashed it raw.
    let fullManifest: any = null;
    writeMemoryPack.mockImplementationOnce((file: string, records: any[], opts: any) => {
      writeFileSync(file, Buffer.from('PMP'));
      fullManifest = {
        memorypack_version: '0.2',
        producer: opts.producer,
        created_at: '2026-07-03T09:00:00.000Z', // real wall clock, unlike the identity form
        record_count: records.length,
        record_schema: opts.record_schema,
        pack_format: 'tarball',
        ...(opts.ownerEncryption
          ? {
              encryption: {
                algorithm: 'xsalsa20-poly1305',
                nonce_strategy: 'per-record-random',
                key_derivation: 'owner-sealed',
                scope: 'records',
                owner: opts.ownerEncryption,
              },
            }
          : {}),
        pmp: opts.pmp,
      };
      return fullManifest;
    });

    const exportRes = await request(app()).post('/v1/pmp/export').send({ pack_id: packId });
    expect(exportRes.status).toBe(201);
    const exportedHash = exportRes.body.artifact.manifest_hash as string;
    expect(exportedHash).toBeTruthy();
    expect(fullManifest).not.toBeNull();

    // Import the SAME manifest (as a reader would find it in the file).
    readMemoryPack.mockReturnValue({
      manifest: fullManifest,
      records: [],
      minimalRecords: [],
      verifiedRecords: new Set<string>(),
      unsignedRecords: new Set<string>(),
      anchors: [],
      verifiedBlobs: new Set<string>(),
      verifiedAnchors: new Set<string>(),
      revocations: [],
      revokedRecordHashes: new Set<string>(),
      revocationAnchors: [],
      verifiedRevocationAnchors: new Set<string>(),
      warnings: [],
    });
    const importRes = await request(app()).post('/v1/pmp/import').send({ pmp_base64: b64('fake') });
    expect(importRes.status).toBe(201);

    const receipts = insertedRows.filter((i) => i.table === 'pmp_imports').flatMap((i) => i.rows);
    expect(receipts).toHaveLength(1);
    expect((receipts[0] as any).artifact_manifest_hash).toBe(exportedHash);
  });

  it('dedupes an encrypted record whose DECLARED hash matches an existing plaintext memory', async () => {
    authedWallet = OWNER;
    stubEncryptedPmp({ recipientWallet: OWNER, records: [ENC_RECORD] });
    seed('memories', [
      {
        id: 61,
        owner_wallet: OWNER,
        content: 'secret',
        content_hash: 'lh:secret',
        memory_type: 'semantic',
        tags: [],
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const res = await postImport();
    expect(res.status).toBe(201);
    expect(res.body.deduped_count).toBe(1);
    expect(res.body.imported_encrypted_count).toBe(0);
  });
});

// ───────────────────── export → verify round-trip (closed loop) ─────────────────────
// The four acceptance tests verify EACH leg with hand-stubbed records, but never feed
// export's ACTUAL written output into verify. This closes the loop: take the records +
// pmp identity the route handed to writeMemoryPack, replay them through readMemoryPack,
// and assert verify says verified:true — then tamper a byte and assert verified:false.

describe('export → verify round-trip', () => {
  it('an intact exported pack verifies true when its own written bytes are replayed through verify', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();

    // encrypt:false — server-side /v1/pmp/verify is the PLAINTEXT path (an encrypted pack is verified
    // in the browser after decrypt). The round-trip leaf-recompute only closes over plaintext content.
    const exp = await request(app()).post('/v1/pmp/export').send({ pack_id: packId, encrypt: false });
    expect(exp.status).toBe(201);

    // Capture exactly what the route handed the writer: the records + the embedded pmp block.
    expect(writeMemoryPack).toHaveBeenCalledTimes(1);
    const [, writtenRecords, writeOpts] = writeMemoryPack.mock.calls[0] as [string, any[], any];
    expect(writeOpts.pmp.merkle_root).toBe(exp.body.artifact.merkle_root);

    // Replay those bytes through the reader the way a download → verify would.
    stubReadPmp({ records: writtenRecords, declaredRoot: writeOpts.pmp.merkle_root });

    const ver = await request(app()).post('/v1/pmp/verify').send({ pmp_base64: b64('exported') });
    expect(ver.status).toBe(200);
    expect(ver.body.verified).toBe(true);
    // The root verify reports is the very root export embedded + registered (single source of truth).
    expect(ver.body.recomputed_root).toBe(writeOpts.pmp.merkle_root);
    expect(ver.body.root).toBe(exp.body.artifact.merkle_root);
  });

  it('verify rejects the exported pack once a single record body is mutated post-export', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();
    // encrypt:false — same plaintext-verify rationale as the intact round-trip above.
    const exp = await request(app()).post('/v1/pmp/export').send({ pack_id: packId, encrypt: false });
    const [, writtenRecords, writeOpts] = writeMemoryPack.mock.calls[0] as [string, any[], any];

    // Tamper ONE record's content after export; the declared root still describes the original.
    const tampered = writtenRecords.map((r, i) => (i === 0 ? { ...r, content: `${r.content}-EVIL` } : r));
    stubReadPmp({ records: tampered, declaredRoot: writeOpts.pmp.merkle_root });

    const ver = await request(app()).post('/v1/pmp/verify').send({ pmp_base64: b64('tampered') });
    expect(ver.status).toBe(200);
    expect(ver.body.verified).toBe(false);
    expect(ver.body.recomputed_root).not.toBe(ver.body.root);
  });
});

// ───────────────────── export edge cases ─────────────────────

describe('POST /v1/pmp/export — edge cases', () => {
  it('422 when pack_id is missing from the body', async () => {
    authedWallet = OWNER;
    const res = await request(app()).post('/v1/pmp/export').send({});
    expect(res.status).toBe(422);
    expect(writeMemoryPack).not.toHaveBeenCalled();
  });

  it('409 empty_pack when the owned pack has zero member memories', async () => {
    authedWallet = OWNER;
    // Pack exists + is owned, but no memory_pack_contents rows.
    seed('memory_packs', [
      {
        pack_id: 'pack-empty',
        author_wallet: OWNER,
        name: 'Empty',
        description: null,
        version: '1.0.0',
        memory_count: 0,
        merkle_root: null,
        pack_token_address: null,
        content_category: 'knowledge',
        sale_mode: 'copy',
      },
    ]);

    const res = await request(app()).post('/v1/pmp/export').send({ pack_id: 'pack-empty' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('empty_pack');
    // Nothing written, nothing registered.
    expect(writeMemoryPack).not.toHaveBeenCalled();
    expect(insertedRows.find((r) => r.table === 'pmp_artifacts')).toBeFalsy();
  });

  it('409 when contents reference members that fail the owner scope (no owned records to write)', async () => {
    authedWallet = OWNER;
    // Pack + contents exist, but the referenced memories belong to OTHER, so the
    // owner-scoped hydrate returns nothing → zero records → 409 (defence in depth).
    seed('memory_packs', [
      {
        pack_id: 'pack-foreign',
        author_wallet: OWNER,
        name: 'Foreign members',
        description: null,
        version: '1.0.0',
        memory_count: 1,
        merkle_root: null,
        pack_token_address: null,
        content_category: 'knowledge',
        sale_mode: 'copy',
      },
    ]);
    seed('memory_pack_contents', [
      { pack_id: 'pack-foreign', memory_id: 99, leaf_index: 0, content_hash: 'lh:ghost' },
    ]);
    seed('memories', [
      {
        id: 99,
        hash_id: 'clude-ghost',
        memory_type: 'semantic',
        content: 'ghost',
        owner_wallet: OTHER, // NOT the caller — owner-scoped hydrate skips it
        created_at: '2026-01-01T00:00:00.000Z',
        tags: [],
        source: 'chat',
        related_user: null,
        related_wallet: null,
        content_hash: 'lh:ghost',
      },
    ]);

    const res = await request(app()).post('/v1/pmp/export').send({ pack_id: 'pack-foreign' });
    expect(res.status).toBe(409);
    expect(writeMemoryPack).not.toHaveBeenCalled();
    expect(insertedRows.find((r) => r.table === 'pmp_artifacts')).toBeFalsy();
  });

  it('a duplicate export of the same pack dedupes on UNIQUE(owner_wallet, manifest_hash) → 200 deduped', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();
    seedHolderKey(OWNER); // encrypt-by-default needs the owner's registered key

    // First export registers the artifact (201).
    const first = await request(app()).post('/v1/pmp/export').send({ pack_id: packId });
    expect(first.status).toBe(201);
    const firstId = first.body.artifact.artifact_id;

    // Force the NEXT pmp_artifacts insert to hit the unique violation — the row from the first
    // export is already in the table, so the dedupe branch reads it back and returns it.
    forceUniqueViolation = 'pmp_artifacts';
    const second = await request(app()).post('/v1/pmp/export').send({ pack_id: packId });

    expect(second.status).toBe(200);
    expect(second.body.deduped).toBe(true);
    // Returns the EXISTING artifact (same id), not a freshly minted one.
    expect(second.body.artifact.artifact_id).toBe(firstId);
    // Dedup response also advertises no `download` link (same dangling-404 reason as the 201 path).
    expect(second.body.download).toBeUndefined();
    // Only one artifact row ever persisted for this owner+hash.
    expect(tables['pmp_artifacts'].filter((r) => r.owner_wallet === OWNER)).toHaveLength(1);
  });

  it('500 export_failed when the pack lookup errors', async () => {
    authedWallet = OWNER;
    seedOwnedPack();
    forceError = { table: 'memory_packs', error: { message: 'db down' } };
    const res = await request(app()).post('/v1/pmp/export').send({ pack_id: 'pack-aaaa' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('export_failed');
  });
});

// ───────────────────── verify edge cases ─────────────────────

describe('POST /v1/pmp/verify — edge cases', () => {
  it('verified:false with reason no_records for a pack carrying zero records', async () => {
    stubReadPmp({ records: [], declaredRoot: 'root()' });
    const res = await request(app()).post('/v1/pmp/verify').send({ pmp_base64: b64('empty') });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.reason).toBe('no_records');
    expect(res.body.recomputed_root).toBeNull();
  });

  it('verified:false when the manifest declares NO merkle_root (nothing to compare against)', async () => {
    // A well-formed pack body, but the pmp block omits merkle_root → cannot be vouched for.
    stubReadPmp({ records: [plainRecord('alpha')], declaredRoot: undefined });
    const res = await request(app()).post('/v1/pmp/verify').send({ pmp_base64: b64('norootdecl') });
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.root).toBeNull();
    // It still recomputed a root from the bytes; it just had nothing trusted to match it to.
    expect(res.body.recomputed_root).toBe('root(lh:alpha)');
  });

  it('422 unreadable_pmp when the artifact cannot be parsed', async () => {
    readMemoryPack.mockImplementation(() => {
      throw new Error('not a tarball');
    });
    const res = await request(app()).post('/v1/pmp/verify').send({ pmp_base64: b64('garbage') });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('unreadable_pmp');
  });
});

// ───────────────────── import edge cases / invariants ─────────────────────

describe('POST /v1/pmp/import — edge cases and invariants', () => {
  it('the receipt records source_pubkey + rejected_count and is owner-scoped', async () => {
    authedWallet = OWNER;
    // One good record, one whose declared leaf_hash disagrees (rejected), provenance pubkey present.
    stubReadPmp({
      records: [
        plainRecord('keep', { leaf_hash: 'lh:keep' }),
        plainRecord('tampered', { leaf_hash: 'lh:WRONG' }),
      ],
      producerPubkey: 'AuthorPubKey99',
    });

    const res = await request(app()).post('/v1/pmp/import').send({ pmp_base64: b64('mixed') });
    expect(res.status).toBe(201);
    expect(res.body.rejected_count).toBe(1);
    expect(res.body.imported_count).toBe(1);
    expect(res.body.source_pubkey).toBe('AuthorPubKey99');

    const receipt = insertedRows.find((r) => r.table === 'pmp_imports');
    expect(receipt).toBeTruthy();
    const row = receipt!.rows[0];
    expect(row.owner_wallet).toBe(OWNER);
    expect(row.source_pubkey).toBe('AuthorPubKey99');
    expect(row.rejected_count).toBe(1);
    expect(row.imported_count).toBe(1);
    expect(row.record_count).toBe(2);
    // The receipt binds the artifact identity it ingested (non-empty manifest hash).
    expect(typeof row.artifact_manifest_hash).toBe('string');
    expect(row.artifact_manifest_hash.length).toBeGreaterThan(0);
  });

  it('REJECTS an encrypted (ciphertext-without-key) record — it cannot be leaf-verified', async () => {
    authedWallet = OWNER;
    stubReadPmp({
      records: [
        plainRecord('clear'),
        plainRecord('ZW5jcnlwdGVkLWJ5dGVz', { encrypted: true }), // ciphertext, no key
      ],
    });

    const res = await request(app()).post('/v1/pmp/import').send({ pmp_base64: b64('hasciphertext') });
    expect(res.status).toBe(201);
    expect(res.body.rejected_count).toBe(1);
    expect(res.body.imported_count).toBe(1);

    const imported = insertedRows.filter((r) => r.table === 'memories').flatMap((r) => r.rows);
    expect(imported).toHaveLength(1);
    expect(imported[0].content).toBe('clear');
    // The ciphertext NEVER landed as a memory row.
    expect(imported.some((m) => m.content === 'ZW5jcnlwdGVkLWJ5dGVz')).toBe(false);
  });

  it('dedupes WITHIN the batch: two records hashing identically are ingested once', async () => {
    authedWallet = OWNER;
    // Two distinct record ids but identical content → identical leaf (lh:dup) under the mock hash.
    stubReadPmp({
      records: [
        plainRecord('dup', { id: 'clude-dup-1' }),
        plainRecord('dup', { id: 'clude-dup-2' }),
      ],
    });

    const res = await request(app()).post('/v1/pmp/import').send({ pmp_base64: b64('intradup') });
    expect(res.status).toBe(201);
    expect(res.body.record_count).toBe(2);
    expect(res.body.imported_count).toBe(1);
    expect(res.body.deduped_count).toBe(1);

    const imported = insertedRows.filter((r) => r.table === 'memories').flatMap((r) => r.rows);
    expect(imported).toHaveLength(1);
    expect(imported[0].content_hash).toBe('lh:dup');
  });

  it('OWNER-SCOPING: a colliding content_hash owned by ANOTHER wallet does NOT dedupe the caller', async () => {
    authedWallet = OWNER;
    stubReadPmp({ records: [plainRecord('shared')] }); // leaf lh:shared
    // OTHER already has a memory with the SAME content_hash. Because the dedupe lookup is
    // owner-scoped, the caller must still ingest its own copy — no cross-tenant dedupe.
    seed('memories', [
      {
        id: 77,
        hash_id: 'clude-others',
        owner_wallet: OTHER,
        content: 'shared',
        content_hash: 'lh:shared',
        memory_type: 'semantic',
        tags: [],
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const res = await request(app()).post('/v1/pmp/import').send({ pmp_base64: b64('crosstenant') });
    expect(res.status).toBe(201);
    expect(res.body.imported_count).toBe(1);
    expect(res.body.deduped_count).toBe(0);

    const imported = insertedRows.filter((r) => r.table === 'memories').flatMap((r) => r.rows);
    expect(imported).toHaveLength(1);
    // It landed in the CALLER's namespace, not OTHER's.
    expect(imported[0].owner_wallet).toBe(OWNER);
  });

  it('an all-deduped import inserts ZERO memory rows but still writes a receipt', async () => {
    authedWallet = OWNER;
    stubReadPmp({ records: [plainRecord('already')] }); // leaf lh:already
    seed('memories', [
      {
        id: 60,
        hash_id: 'clude-have',
        owner_wallet: OWNER,
        content: 'already',
        content_hash: 'lh:already',
        memory_type: 'semantic',
        tags: [],
        created_at: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const res = await request(app()).post('/v1/pmp/import').send({ pmp_base64: b64('alldup') });
    expect(res.status).toBe(201);
    expect(res.body.imported_count).toBe(0);
    expect(res.body.deduped_count).toBe(1);

    // No memory insert happened (the route guards `toInsert.length > 0`).
    expect(insertedRows.filter((r) => r.table === 'memories')).toHaveLength(0);
    // But the accounting receipt is still written.
    const receipt = insertedRows.find((r) => r.table === 'pmp_imports');
    expect(receipt).toBeTruthy();
    expect(receipt!.rows[0].imported_count).toBe(0);
    expect(receipt!.rows[0].deduped_count).toBe(1);
  });

  it('still returns 201 (memories already landed) when the receipt insert fails', async () => {
    authedWallet = OWNER;
    stubReadPmp({ records: [plainRecord('survivor')] });
    // The memories insert succeeds; the receipt insert errors. The route logs + reports, not 500.
    forceError = { table: 'pmp_imports', error: { message: 'receipt table down' } };

    const res = await request(app()).post('/v1/pmp/import').send({ pmp_base64: b64('receiptfail') });
    expect(res.status).toBe(201);
    expect(res.body.imported_count).toBe(1);
    const imported = insertedRows.filter((r) => r.table === 'memories').flatMap((r) => r.rows);
    expect(imported).toHaveLength(1);
  });

  it('500 import_failed when the dedupe lookup errors (no partial ingest)', async () => {
    authedWallet = OWNER;
    stubReadPmp({ records: [plainRecord('alpha')] });
    forceError = { table: 'memories', error: { message: 'select blew up' } };

    const res = await request(app()).post('/v1/pmp/import').send({ pmp_base64: b64('dedupeerr') });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('import_failed');
    // The dedupe SELECT failed BEFORE any insert — nothing was written.
    expect(insertedRows.filter((r) => r.table === 'memories')).toHaveLength(0);
    expect(insertedRows.filter((r) => r.table === 'pmp_imports')).toHaveLength(0);
  });

  it('422 unreadable_pmp when the uploaded artifact cannot be parsed', async () => {
    authedWallet = OWNER;
    readMemoryPack.mockImplementation(() => {
      throw new Error('corrupt tarball');
    });
    const res = await request(app()).post('/v1/pmp/import').send({ pmp_base64: b64('junk') });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('unreadable_pmp');
  });

  it('422 too_many_records when the pack exceeds the import cap', async () => {
    authedWallet = OWNER;
    const many = Array.from({ length: 10_001 }, (_, i) => plainRecord(`r${i}`, { id: `clude-${i}` }));
    stubReadPmp({ records: many });
    const res = await request(app()).post('/v1/pmp/import').send({ pmp_base64: b64('toomany') });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('too_many_records');
    expect(insertedRows.filter((r) => r.table === 'memories')).toHaveLength(0);
  });

  it('imports records with NO declared leaf_hash at their recomputed hash (accepted, not rejected)', async () => {
    authedWallet = OWNER;
    // No leaf_hash field at all → accepted at the recomputed leaf (spec: undeclared = trust recompute).
    stubReadPmp({ records: [plainRecord('undeclared')] });
    const res = await request(app()).post('/v1/pmp/import').send({ pmp_base64: b64('nodeclared') });
    expect(res.status).toBe(201);
    expect(res.body.imported_count).toBe(1);
    expect(res.body.rejected_count).toBe(0);
    const imported = insertedRows.filter((r) => r.table === 'memories').flatMap((r) => r.rows);
    expect(imported[0].content_hash).toBe('lh:undeclared');
    // Ingest carries the provenance import tag + owner scope.
    expect(imported[0].owner_wallet).toBe(OWNER);
    expect(imported[0].tags).toContain('imported_from_pmp:pmpa-source01');
  });
});
