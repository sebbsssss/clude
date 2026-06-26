/**
 * Integration tests for the marketplace listing endpoints (copy-only, gated).
 *
 * Tradeable Memory Packs — Slice 1, Part A, Task 6.
 *
 * Surface (spec §3D):
 *   POST   /v1/listings            create a draft from an owned pack (copy-only)
 *   PATCH  /v1/listings/:id        edit draft fields (NEVER status/category/pack_id)
 *   POST   /v1/listings/:id/publish  draft → listed, ONLY if the compliance gate passes
 *   POST   /v1/listings/:id/delist   listed → delisted
 *   GET    /v1/listings/:id        full listing
 *   GET    /v1/listings/mine       seller's own listings
 *   GET    /v1/listings/:id/preview  sealed-safe preview (reuses pack-preview.ts)
 *   GET    /v1/listings            browse (only status='listed')
 *
 * Fail-closed guarantees proven here: a secret-bearing pack, a personal-category
 * pack, and an unclassified (NULL content_category) pack can NEVER reach
 * status='listed'; status is immutable via PATCH; you cannot list another wallet's
 * pack; title listings are refused (422) in this slice.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { buildPackTree } from '@clude/tokenization';

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
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

// requireOwnership runs after the (mocked) requirePrivyAuth, which already set
// verifiedWallet — pass through so the real DID-resolution middleware isn't hit in tests.
vi.mock('@clude/brain/auth/require-ownership', () => ({
  requireOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
  optionalOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── Table-routed Supabase mock ───────────────────────────────────────────────
// Each table is backed by an in-memory array of rows. The chain records the
// filters/ops applied and resolves them against that array on a terminal call
// (.maybeSingle / .single / awaited). This is deliberately routed-by-table (not a
// strict ordered queue) so the branchy create/publish handlers stay deterministic
// regardless of intra-handler query order.

type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const insertedRows: Array<{ table: string; rows: Row[] }> = [];
// When set, the next terminal read/write on this table returns a forced error.
let forceError: { table: string; error: any } | null = null;
// When set, simulate a UNIQUE-violation on the next insert into this table.
let forceUniqueViolation: string | null = null;

function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  insertedRows.length = 0;
  forceError = null;
  forceUniqueViolation = null;
}

function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}

interface Filter {
  kind: 'eq' | 'in' | 'overlaps' | 'or';
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
      if (f.kind === 'or') return true; // two-party scoping not used in Part A reads
      return true;
    }),
  );
}

function makeChain(table: string) {
  const filters: Filter[] = [];
  let pendingInsert: Row[] | null = null;
  let pendingUpdate: Row | null = null;
  let orderCol: { col: string; ascending: boolean } | null = null;
  let limitN: number | null = null;

  const settle = (): Promise<{ data: any; error: any }> => {
    if (forceError && forceError.table === table) {
      const err = forceError.error;
      forceError = null;
      return Promise.resolve({ data: null, error: err });
    }

    // INSERT
    if (pendingInsert) {
      const rows = pendingInsert;
      pendingInsert = null;
      if (forceUniqueViolation === table) {
        forceUniqueViolation = null;
        return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value' } });
      }
      tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
      insertedRows.push({ table, rows: rows.map((r) => ({ ...r })) });
      return Promise.resolve({ data: rows.length === 1 ? { ...rows[0] } : rows.map((r) => ({ ...r })), error: null });
    }

    // UPDATE (applies the patch to every filter-matched row)
    if (pendingUpdate) {
      const patch = pendingUpdate;
      pendingUpdate = null;
      const matched = applyFilters(tables[table] ?? [], filters);
      for (const row of matched) Object.assign(row, patch);
      return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null });
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
    delete: () => chain,
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

import { packMarketplaceRoutes } from '../pack-marketplace.routes.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use(packMarketplaceRoutes());
  return a;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const SELLER = 'SeLLeRwallet1111111111111111111111111111111';
const OTHER = 'OtherWaLLet2222222222222222222222222222222';

/** A tokenised pack owned by SELLER. Two member leaves so the Merkle root is real. */
function seedPack(
  packId: string,
  opts: { category: 'personal' | 'knowledge' | 'agent' | null; saleMode?: 'copy' | 'title'; owner?: string } = {
    category: 'knowledge',
  },
) {
  const leafHashes = [
    'a'.repeat(64),
    'b'.repeat(64),
  ];
  const tree = buildPackTree(leafHashes);
  seed('memory_packs', [
    {
      pack_id: packId,
      author_wallet: opts.owner ?? SELLER,
      name: 'Solana Trading Notes',
      version: '1.0.0',
      description: 'Curated knowledge',
      memory_count: 2,
      merkle_root: tree.root,
      pack_token_address: 'TokenAddr1111111111111111111111111111111111',
      content_category: opts.category,
      sale_mode: opts.saleMode ?? 'copy',
    },
  ]);
  seed('memory_pack_contents', [
    { pack_id: packId, memory_id: 1, leaf_index: 0, content_hash: leafHashes[0] },
    { pack_id: packId, memory_id: 2, leaf_index: 1, content_hash: leafHashes[1] },
  ]);
  seed('memories', [
    { id: 1, hash_id: 'mem-1', memory_type: 'semantic', content: 'Body one', owner_wallet: SELLER, created_at: '2026-01-01T00:00:00Z', tags: ['solana'] },
    { id: 2, hash_id: 'mem-2', memory_type: 'semantic', content: 'Body two', owner_wallet: SELLER, created_at: '2026-01-02T00:00:00Z', tags: [] },
  ]);
  return tree.root;
}

/** ToS accepted by SELLER. */
function seedTos(wallet = SELLER) {
  seed('legal_acceptances', [{ id: 1, owner_wallet: wallet, doc_id: 'marketplace_tos', doc_version: 1 }]);
}

/** A complete, truthful attestation for a pack. */
function seedAttestation(packId: string, wallet = SELLER) {
  seed('pack_attestations', [
    {
      id: 1,
      pack_id: packId,
      author_wallet: wallet,
      content_source: 'curated_knowledge',
      owns_or_licensed: true,
      no_thirdparty_pii: true,
      not_investment_advice: true,
      attestation_hash: 'h'.repeat(64),
      signature: 'sig',
    },
  ]);
}

/** A clean moderation row (no findings). */
function seedModerationClean(packId: string) {
  seed('pack_moderation', [
    { pack_id: packId, status: 'clean', filter_version: 'v1', findings: [], severity: null },
  ]);
}

/** A flagged moderation row carrying a redacted secret finding. */
function seedModerationSecret(packId: string) {
  seed('pack_moderation', [
    {
      pack_id: packId,
      status: 'flagged',
      filter_version: 'v1',
      findings: [{ category: 'secret_api_key', severity: 'reject', sample: 'sk-a…(51)', index: 12 }],
      severity: 'reject',
    },
  ]);
}

/** Insert a draft listing row directly (so publish/patch/delist tests don't re-run create). */
function seedDraftListing(
  listingId: string,
  packId: string,
  overrides: Partial<Row> = {},
) {
  seed('pack_listings', [
    {
      listing_id: listingId,
      pack_id: packId,
      seller_wallet: SELLER,
      title: 'My Listing',
      description: null,
      tags: [],
      content_category: 'knowledge',
      license_type: 'copy',
      supply_kind: 'unlimited',
      supply_total: null,
      supply_sold: 0,
      preview_sample_count: 1,
      preview_redaction: 'none',
      status: 'draft',
      compliance_gate: 'blocked',
      ...overrides,
    },
  ]);
}

beforeEach(() => {
  authedWallet = null;
  resetDb();
});

// ─────────── POST /v1/listings (create draft) ───────────

describe('POST /v1/listings', () => {
  it('401 when unauthenticated', async () => {
    const res = await request(app()).post('/v1/listings').send({ pack_id: 'pack-1', title: 'x' });
    expect(res.status).toBe(401);
  });

  it('creates a draft listing on your OWN knowledge pack', async () => {
    authedWallet = SELLER;
    seedPack('pack-1', { category: 'knowledge' });
    seedTos();
    seedAttestation('pack-1');
    seedModerationClean('pack-1');

    const res = await request(app())
      .post('/v1/listings')
      .send({ pack_id: 'pack-1', title: 'Solana Notes', description: 'great', tags: ['solana'] });

    expect(res.status).toBe(201);
    expect(res.body.listing.status).toBe('draft');
    expect(res.body.listing.license_type).toBe('copy');
    // content_category is server-derived from the pack, never the client.
    expect(res.body.listing.content_category).toBe('knowledge');
    expect(res.body.listing.seller_wallet).toBe(SELLER);
    expect(typeof res.body.listing.listing_id).toBe('string');
    // The created row is persisted via insert.
    const ins = insertedRows.find((i) => i.table === 'pack_listings');
    expect(ins).toBeDefined();
  });

  it("403 when creating a listing on someone else's pack", async () => {
    authedWallet = OTHER;
    seedPack('pack-1', { category: 'knowledge', owner: SELLER });

    const res = await request(app())
      .post('/v1/listings')
      .send({ pack_id: 'pack-1', title: 'theft' });

    expect(res.status).toBe(403);
    // No listing row should have been inserted.
    expect(insertedRows.find((i) => i.table === 'pack_listings')).toBeUndefined();
  });

  it('404 when the pack does not exist', async () => {
    authedWallet = SELLER;
    const res = await request(app()).post('/v1/listings').send({ pack_id: 'nope', title: 'x' });
    expect(res.status).toBe(404);
  });

  it('422 title_not_in_slice1 when license_type is title', async () => {
    authedWallet = SELLER;
    seedPack('pack-1', { category: 'knowledge' });

    const res = await request(app())
      .post('/v1/listings')
      .send({ pack_id: 'pack-1', title: 'x', license_type: 'title' });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('title_not_in_slice1');
    expect(insertedRows.find((i) => i.table === 'pack_listings')).toBeUndefined();
  });

  it('422 when title is missing', async () => {
    authedWallet = SELLER;
    seedPack('pack-1', { category: 'knowledge' });
    const res = await request(app()).post('/v1/listings').send({ pack_id: 'pack-1' });
    expect(res.status).toBe(422);
  });

  it('ignores a client-supplied content_category (server derives from the pack)', async () => {
    authedWallet = SELLER;
    // Pack is 'agent' on the server; client lies and says 'knowledge'.
    seedPack('pack-1', { category: 'agent' });
    seedTos();
    seedAttestation('pack-1');
    seedModerationClean('pack-1');

    const res = await request(app())
      .post('/v1/listings')
      .send({ pack_id: 'pack-1', title: 'x', content_category: 'knowledge' });

    expect(res.status).toBe(201);
    expect(res.body.listing.content_category).toBe('agent');
  });
});

// ─────────── PATCH /v1/listings/:id (edit draft) ───────────

describe('PATCH /v1/listings/:id', () => {
  it('edits whitelisted fields on your own draft', async () => {
    authedWallet = SELLER;
    seedDraftListing('lst-1', 'pack-1');

    const res = await request(app())
      .patch('/v1/listings/lst-1')
      .send({ title: 'New Title', description: 'desc', tags: ['a', 'b'] });

    expect(res.status).toBe(200);
    expect(res.body.listing.title).toBe('New Title');
    expect(res.body.listing.description).toBe('desc');
    expect(res.body.listing.tags).toEqual(['a', 'b']);
  });

  it('MUST NOT change status via PATCH (422 field_immutable)', async () => {
    authedWallet = SELLER;
    seedDraftListing('lst-1', 'pack-1', { status: 'draft' });

    const res = await request(app())
      .patch('/v1/listings/lst-1')
      .send({ status: 'listed' });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('field_immutable');
    // The persisted row's status is untouched.
    expect(tables['pack_listings'][0].status).toBe('draft');
  });

  it('MUST NOT change content_category or pack_id via PATCH', async () => {
    authedWallet = SELLER;
    seedDraftListing('lst-1', 'pack-1', { content_category: 'knowledge' });

    const res = await request(app())
      .patch('/v1/listings/lst-1')
      .send({ content_category: 'personal' });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('field_immutable');
    expect(tables['pack_listings'][0].content_category).toBe('knowledge');
  });

  it("403 when editing someone else's listing", async () => {
    authedWallet = OTHER;
    seedDraftListing('lst-1', 'pack-1'); // owned by SELLER

    const res = await request(app()).patch('/v1/listings/lst-1').send({ title: 'hijack' });
    expect(res.status).toBe(403);
    expect(tables['pack_listings'][0].title).toBe('My Listing');
  });

  it('404 when the listing does not exist', async () => {
    authedWallet = SELLER;
    const res = await request(app()).patch('/v1/listings/nope').send({ title: 'x' });
    expect(res.status).toBe(404);
  });
});

// ─────────── POST /v1/listings/:id/publish (gated) ───────────

describe('POST /v1/listings/:id/publish', () => {
  it('publishes a clean, attested knowledge listing → status listed', async () => {
    authedWallet = SELLER;
    seedPack('pack-1', { category: 'knowledge' });
    seedTos();
    seedAttestation('pack-1');
    seedModerationClean('pack-1');
    seedDraftListing('lst-1', 'pack-1', { content_category: 'knowledge', status: 'draft' });

    const res = await request(app()).post('/v1/listings/lst-1/publish').send({});

    expect(res.status).toBe(200);
    expect(res.body.listing.status).toBe('listed');
    expect(res.body.listing.compliance_gate).toBe('passed');
    expect(tables['pack_listings'][0].status).toBe('listed');
  });

  it('422 contains_secrets — a secret-bearing pack can NEVER be listed', async () => {
    authedWallet = SELLER;
    seedPack('pack-1', { category: 'knowledge' });
    seedTos();
    seedAttestation('pack-1');
    seedModerationSecret('pack-1'); // flagged + reject finding
    seedDraftListing('lst-1', 'pack-1', { content_category: 'knowledge', status: 'draft' });

    const res = await request(app()).post('/v1/listings/lst-1/publish').send({});

    expect(res.status).toBe(422);
    expect(res.body.blocking_reasons).toContain('contains_secrets');
    expect(tables['pack_listings'][0].status).toBe('draft');
  });

  it('422 personal_packs_not_yet_supported — personal packs are held back', async () => {
    authedWallet = SELLER;
    seedPack('pack-1', { category: 'personal' });
    seedTos();
    seedAttestation('pack-1');
    seedModerationClean('pack-1');
    seedDraftListing('lst-1', 'pack-1', { content_category: 'personal', status: 'draft' });

    const res = await request(app()).post('/v1/listings/lst-1/publish').send({});

    expect(res.status).toBe(422);
    expect(res.body.blocking_reasons).toContain('personal_packs_not_yet_supported');
    expect(tables['pack_listings'][0].status).toBe('draft');
  });

  it('422 category_unset — an un-attested pack (NULL category) fails closed', async () => {
    authedWallet = SELLER;
    seedPack('pack-1', { category: null });
    seedTos();
    // no attestation, no moderation
    seedDraftListing('lst-1', 'pack-1', { content_category: 'knowledge', status: 'draft' });

    const res = await request(app()).post('/v1/listings/lst-1/publish').send({});

    expect(res.status).toBe(422);
    expect(res.body.blocking_reasons).toContain('category_unset');
    expect(res.body.blocking_reasons).toContain('attestation_missing');
    expect(tables['pack_listings'][0].status).toBe('draft');
  });

  it('422 when the pack has not been scanned (no moderation row → cannot prove safety)', async () => {
    authedWallet = SELLER;
    seedPack('pack-1', { category: 'knowledge' });
    seedTos();
    seedAttestation('pack-1');
    // NO moderation row.
    seedDraftListing('lst-1', 'pack-1', { content_category: 'knowledge', status: 'draft' });

    const res = await request(app()).post('/v1/listings/lst-1/publish').send({});

    expect(res.status).toBe(422);
    expect(res.body.blocking_reasons).toContain('not_scanned');
    expect(tables['pack_listings'][0].status).toBe('draft');
  });

  it("403 when publishing someone else's listing", async () => {
    authedWallet = OTHER;
    seedPack('pack-1', { category: 'knowledge' });
    seedTos();
    seedAttestation('pack-1');
    seedModerationClean('pack-1');
    seedDraftListing('lst-1', 'pack-1'); // owned by SELLER

    const res = await request(app()).post('/v1/listings/lst-1/publish').send({});
    expect(res.status).toBe(403);
    expect(tables['pack_listings'][0].status).toBe('draft');
  });
});

// ─────────── POST /v1/listings/:id/delist ───────────

describe('POST /v1/listings/:id/delist', () => {
  it('delists a listed listing → status delisted', async () => {
    authedWallet = SELLER;
    seedDraftListing('lst-1', 'pack-1', { status: 'listed' });

    const res = await request(app()).post('/v1/listings/lst-1/delist').send({});

    expect(res.status).toBe(200);
    expect(res.body.listing.status).toBe('delisted');
    expect(tables['pack_listings'][0].status).toBe('delisted');
  });

  it("403 when delisting someone else's listing", async () => {
    authedWallet = OTHER;
    seedDraftListing('lst-1', 'pack-1', { status: 'listed' });
    const res = await request(app()).post('/v1/listings/lst-1/delist').send({});
    expect(res.status).toBe(403);
    expect(tables['pack_listings'][0].status).toBe('listed');
  });
});

// ─────────── GET /v1/listings/:id + /mine ───────────

describe('GET /v1/listings/:id and /mine', () => {
  it('returns a full listing by id', async () => {
    authedWallet = SELLER;
    seedDraftListing('lst-1', 'pack-1', { status: 'listed' });
    const res = await request(app()).get('/v1/listings/lst-1');
    expect(res.status).toBe(200);
    expect(res.body.listing.listing_id).toBe('lst-1');
  });

  it('404 for an unknown listing', async () => {
    const res = await request(app()).get('/v1/listings/nope');
    expect(res.status).toBe(404);
  });

  it('/mine returns only the caller-owned listings', async () => {
    authedWallet = SELLER;
    seedDraftListing('lst-1', 'pack-1', { status: 'listed' });
    seed('pack_listings', [
      { listing_id: 'lst-2', pack_id: 'pack-2', seller_wallet: OTHER, title: 'theirs', tags: [], content_category: 'knowledge', license_type: 'copy', supply_kind: 'unlimited', status: 'listed', compliance_gate: 'passed' },
    ]);

    const res = await request(app()).get('/v1/listings/mine');
    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(1);
    expect(res.body.listings[0].seller_wallet).toBe(SELLER);
  });

  it('/mine requires auth', async () => {
    const res = await request(app()).get('/v1/listings/mine');
    expect(res.status).toBe(401);
  });
});

// ─────────── GET /v1/listings (browse) ───────────

describe('GET /v1/listings (browse)', () => {
  it('returns only status=listed rows', async () => {
    seedDraftListing('lst-1', 'pack-1', { status: 'listed', content_category: 'knowledge', tags: ['solana'] });
    seed('pack_listings', [
      { listing_id: 'lst-2', pack_id: 'pack-2', seller_wallet: SELLER, title: 'draft one', tags: [], content_category: 'knowledge', license_type: 'copy', supply_kind: 'unlimited', status: 'draft', compliance_gate: 'blocked' },
      { listing_id: 'lst-3', pack_id: 'pack-3', seller_wallet: SELLER, title: 'delisted one', tags: [], content_category: 'agent', license_type: 'copy', supply_kind: 'unlimited', status: 'delisted', compliance_gate: 'passed' },
    ]);

    const res = await request(app()).get('/v1/listings');
    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(1);
    expect(res.body.listings[0].listing_id).toBe('lst-1');
  });

  it('filters by content_category', async () => {
    seedDraftListing('lst-1', 'pack-1', { status: 'listed', content_category: 'knowledge' });
    seed('pack_listings', [
      { listing_id: 'lst-2', pack_id: 'pack-2', seller_wallet: SELLER, title: 'agent one', tags: [], content_category: 'agent', license_type: 'copy', supply_kind: 'unlimited', status: 'listed', compliance_gate: 'passed' },
    ]);

    const res = await request(app()).get('/v1/listings?category=agent');
    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(1);
    expect(res.body.listings[0].content_category).toBe('agent');
  });

  it('filters by tag', async () => {
    seedDraftListing('lst-1', 'pack-1', { status: 'listed', tags: ['solana', 'defi'] });
    seed('pack_listings', [
      { listing_id: 'lst-2', pack_id: 'pack-2', seller_wallet: SELLER, title: 'other', tags: ['cooking'], content_category: 'knowledge', license_type: 'copy', supply_kind: 'unlimited', status: 'listed', compliance_gate: 'passed' },
    ]);

    const res = await request(app()).get('/v1/listings?tag=defi');
    expect(res.status).toBe(200);
    expect(res.body.listings).toHaveLength(1);
    expect(res.body.listings[0].listing_id).toBe('lst-1');
  });
});

// ─────────── GET /v1/listings/:id/preview (sealed-safe) ───────────

describe('GET /v1/listings/:id/preview', () => {
  it('returns the sealed-safe preview shape for a listed pack', async () => {
    seedPack('pack-1', { category: 'knowledge' });
    seedDraftListing('lst-1', 'pack-1', { status: 'listed', preview_sample_count: 1 });

    const res = await request(app()).get('/v1/listings/lst-1/preview');

    expect(res.status).toBe(200);
    expect(res.body.pack).toBeDefined();
    expect(res.body.revealed_count).toBe(1);
    expect(res.body.unrevealed_count).toBe(1);
    // Sealed-safe: a non-personal pack reveals leaf hashes + proofs.
    expect(res.body.revealed[0].proof).not.toBeNull();
  });

  it('404 when the listing does not exist', async () => {
    const res = await request(app()).get('/v1/listings/nope/preview');
    expect(res.status).toBe(404);
  });
});
