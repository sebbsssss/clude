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
  kind: 'eq' | 'in' | 'overlaps' | 'or' | 'contains';
  col?: string;
  val?: any;
  vals?: any[];
}

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((row) =>
    filters.every((f) => {
      if (f.kind === 'eq') return row[f.col!] === f.val;
      if (f.kind === 'in') return (f.vals ?? []).includes(row[f.col!]);
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

  const settle = (): Promise<{ data: any; error: any }> => {
    if (forceError && forceError.table === table) {
      const err = forceError.error;
      forceError = null;
      return Promise.resolve({ data: null, error: err });
    }

    // INSERT (memories get a fresh BIGSERIAL id when one isn't supplied, so the route can read it back)
    if (pendingInsert) {
      const rows = pendingInsert;
      pendingInsert = null;
      if (forceUniqueViolation === table) {
        forceUniqueViolation = null;
        return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value' } });
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
        error: null,
      });
    }

    // UPDATE
    if (pendingUpdate) {
      const patch = pendingUpdate;
      pendingUpdate = null;
      const matched = applyFilters(tables[table] ?? [], filters);
      for (const row of matched) Object.assign(row, patch);
      return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null });
    }

    // DELETE
    if (pendingDelete) {
      pendingDelete = false;
      const keep = (tables[table] ?? []).filter((r) => !applyFilters([r], filters).length);
      const removed = (tables[table] ?? []).filter((r) => applyFilters([r], filters).length);
      tables[table] = keep;
      return Promise.resolve({ data: removed.map((r) => ({ ...r })), error: null });
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
    if (limitN !== null) rows = rows.slice(0, limitN);
    return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
  };

  const chain: Record<string, any> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: (col: string, val: any) => {
      filters.push({ kind: 'eq', col, val });
      return chain;
    },
    in: (col: string, vals: any[]) => {
      filters.push({ kind: 'in', col, vals });
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

import { pmpArtifactsRoutes } from '../pmp-artifacts.routes.js';

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

// ───────────────────────── POST /v1/pmp/export ─────────────────────────

describe('POST /v1/pmp/export', () => {
  it('builds a .pmp from the owner pack and registers an artifact with the right manifest_hash', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();

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
    // A signed/owned download ref is returned (not a public link).
    expect(res.body.artifact.artifact_id).toMatch(/^pmpa-/);
    expect(res.body.download).toBeTruthy();
  });

  it('manifest_hash is deterministic for the same pack content (re-derivable)', async () => {
    authedWallet = OWNER;
    const packId = seedOwnedPack();
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

    authedWallet = OTHER;
    const denied = await request(app()).get('/v1/pmp/artifacts/pmpa-mine01');
    expect(denied.status).toBe(404); // not 403 — don't leak existence cross-tenant
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
