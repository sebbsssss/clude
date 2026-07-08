/**
 * Listing-lifecycle hardening tests — invariants + failure modes the happy-path
 * suite (pack-marketplace.routes.test.ts) does not cover.
 *
 * Tradeable Memory Packs — Slice 1, Part A, Task 6 (spec §3D). Companion to the
 * green pack-marketplace.routes.test.ts; same table-routed Supabase idiom, but the
 * mock is extended to also force a UNIQUE violation on UPDATE (not just INSERT) and
 * to force a DB error on a specific terminal op, so the previously-untested
 * fail-closed branches in create/publish/patch become reachable.
 *
 * Audited invariants:
 *   - uq_pack_listings_active_pack: at most one active listing per pack. Both the
 *     create-time (INSERT 23505 → 409) and republish-time (UPDATE 23505 → 409)
 *     unique violations map to `listing_exists`.
 *   - status machine: publish is allowed only FROM {draft, pending_compliance,
 *     delisted}; an already-`listed`/`sold_out`/`suspended`/`sold` listing → 409
 *     not_publishable. delisted → listed is a valid republish (gate re-checked).
 *   - compliance_gate must be 'passed' before status='listed': a listing whose row
 *     says compliance_gate='passed' but whose pack is NOT provably clean still
 *     cannot publish — the gate is re-resolved from pack facts at publish time.
 *     moderation status in FLAGGED_MODERATION_STATUSES blocks even with no findings.
 *   - supply accounting: unlimited ⇒ supply_total NULL; limited/single ⇒ a coherent,
 *     positive supply_total; single ⇒ exactly 1; supply_sold always seeded 0.
 *   - content_category is SERVER-derived: publish re-denormalises the trusted pack
 *     category onto the listing even if the listing row carried a stale value.
 *   - PATCH immutability: license_type / compliance_gate / seller_wallet / listing_id
 *     are refused (422 field_immutable), like status / content_category / pack_id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { buildPackTree } from '@clude/tokenization';

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

vi.mock('@clude/brain/auth/require-ownership', () => ({
  requireOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
  optionalOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── Table-routed Supabase mock (extended: unique-violation + error on UPDATE too) ──
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const insertedRows: Array<{ table: string; rows: Row[] }> = [];
// Force a forced error on the next terminal op against `table` (any op kind).
let forceError: { table: string; error: any } | null = null;
// Force a UNIQUE (23505) violation on the next INSERT into `table`.
let forceInsertUnique: string | null = null;
// Force a UNIQUE (23505) violation on the next UPDATE against `table`.
let forceUpdateUnique: string | null = null;

function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  insertedRows.length = 0;
  forceError = null;
  forceInsertUnique = null;
  forceUpdateUnique = null;
}
function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}

interface Filter {
  kind: 'eq' | 'in' | 'overlaps';
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
      return true;
    }),
  );
}

const UNIQUE_ERR = { code: '23505', message: 'duplicate key value violates unique constraint' };

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

    if (pendingInsert) {
      const rows = pendingInsert;
      pendingInsert = null;
      if (forceInsertUnique === table) {
        forceInsertUnique = null;
        return Promise.resolve({ data: null, error: { ...UNIQUE_ERR } });
      }
      tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
      insertedRows.push({ table, rows: rows.map((r) => ({ ...r })) });
      return Promise.resolve({ data: rows.length === 1 ? { ...rows[0] } : rows.map((r) => ({ ...r })), error: null });
    }

    if (pendingUpdate) {
      const patch = pendingUpdate;
      pendingUpdate = null;
      if (forceUpdateUnique === table) {
        forceUpdateUnique = null;
        return Promise.resolve({ data: null, error: { ...UNIQUE_ERR } });
      }
      const matched = applyFilters(tables[table] ?? [], filters);
      for (const row of matched) Object.assign(row, patch);
      return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null });
    }

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
    or: () => chain,
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

// ── Fixtures ──
const SELLER = 'SeLLeRwallet1111111111111111111111111111111';
const OTHER = 'OtherWaLLet2222222222222222222222222222222';

/** A tokenised pack owned by SELLER, with a real two-leaf Merkle root. */
function seedPack(
  packId: string,
  opts: { category?: 'personal' | 'knowledge' | 'agent' | null; saleMode?: 'copy' | 'title'; owner?: string } = {},
) {
  const leafHashes = ['a'.repeat(64), 'b'.repeat(64)];
  const tree = buildPackTree(leafHashes);
  seed('memory_packs', [
    {
      pack_id: packId,
      author_wallet: opts.owner ?? SELLER,
      name: 'Solana Trading Notes',
      version: '1.0.0',
      memory_count: 2,
      merkle_root: tree.root,
      pack_token_address: 'TokenAddr1111111111111111111111111111111111',
      content_category: opts.category ?? 'knowledge',
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

function seedTos(wallet = SELLER) {
  seed('legal_acceptances', [{ id: 1, owner_wallet: wallet, doc_id: 'marketplace_tos', doc_version: 1 }]);
}
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
function seedModerationClean(packId: string) {
  seed('pack_moderation', [{ pack_id: packId, status: 'clean', filter_version: 'v1', findings: [], severity: null }]);
}
/** A moderation row whose STATUS is flagged-ish but findings are empty (status-only block). */
function seedModerationStatus(packId: string, status: string) {
  seed('pack_moderation', [{ pack_id: packId, status, filter_version: 'v1', findings: [], severity: null }]);
}
/** A pack that, given full ToS+attestation+clean-scan, would PASS the gate. */
function seedPublishablePack(packId: string) {
  seedPack(packId, { category: 'knowledge' });
  seedTos();
  seedAttestation(packId);
  seedModerationClean(packId);
}
function seedDraftListing(listingId: string, packId: string, overrides: Partial<Row> = {}) {
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

// ─────────── INVARIANT: one active listing per pack (uq_pack_listings_active_pack) ───────────

describe('uq_pack_listings_active_pack — one active listing per pack', () => {
  it('409 listing_exists when create hits the UNIQUE violation (active listing already exists)', async () => {
    authedWallet = SELLER;
    seedPublishablePack('pack-1');
    forceInsertUnique = 'pack_listings'; // the partial unique index rejects the second active listing

    const res = await request(app()).post('/v1/listings').send({ pack_id: 'pack-1', title: 'dupe' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('listing_exists');
    // No audit event for a create that never landed.
    expect(insertedRows.find((i) => i.table === 'pack_listing_events')).toBeUndefined();
  });

  it('409 listing_exists when republish (delisted → listed) collides with a new active listing', async () => {
    // Scenario: a delisted listing is republished, but meanwhile a fresh active
    // listing was created for the same pack → the UPDATE trips the partial unique index.
    authedWallet = SELLER;
    seedPublishablePack('pack-1');
    seedDraftListing('lst-1', 'pack-1', { status: 'delisted', content_category: 'knowledge' });
    forceUpdateUnique = 'pack_listings';

    const res = await request(app()).post('/v1/listings/lst-1/publish').send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('listing_exists');
    // The listing stays delisted; the publish did not take effect.
    expect(tables['pack_listings'][0].status).toBe('delisted');
  });
});

// ─────────── STATUS MACHINE: publishable-from transitions ───────────

describe('publish status machine', () => {
  it.each(['listed', 'sold_out', 'suspended', 'sold'])(
    '409 not_publishable when the listing is already %s',
    async (status) => {
      authedWallet = SELLER;
      seedPublishablePack('pack-1');
      seedDraftListing('lst-1', 'pack-1', { status, content_category: 'knowledge', compliance_gate: 'passed' });

      const res = await request(app()).post('/v1/listings/lst-1/publish').send({});

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('not_publishable');
      // Status unchanged — no transition out of a terminal/active state via publish.
      expect(tables['pack_listings'][0].status).toBe(status);
    },
  );

  it('republishes a DELISTED listing back to listed when the gate still passes', async () => {
    authedWallet = SELLER;
    seedPublishablePack('pack-1');
    seedDraftListing('lst-1', 'pack-1', { status: 'delisted', content_category: 'knowledge' });

    const res = await request(app()).post('/v1/listings/lst-1/publish').send({});

    expect(res.status).toBe(200);
    expect(res.body.listing.status).toBe('listed');
    expect(tables['pack_listings'][0].status).toBe('listed');
  });

  it('publishes from pending_compliance once the gate passes', async () => {
    authedWallet = SELLER;
    seedPublishablePack('pack-1');
    seedDraftListing('lst-1', 'pack-1', { status: 'pending_compliance', content_category: 'knowledge' });

    const res = await request(app()).post('/v1/listings/lst-1/publish').send({});

    expect(res.status).toBe(200);
    expect(res.body.listing.status).toBe('listed');
  });
});

// ─────────── COMPLIANCE GATE re-resolved from pack facts at publish ───────────

describe('compliance_gate must be re-proven from pack facts at publish', () => {
  it('a stale compliance_gate=passed on the row does NOT let a not-scanned pack publish', async () => {
    authedWallet = SELLER;
    // Pack is attested + ToS-accepted, but NEVER scanned (no moderation row).
    seedPack('pack-1', { category: 'knowledge' });
    seedTos();
    seedAttestation('pack-1');
    // Listing row LIES: it claims the gate already passed.
    seedDraftListing('lst-1', 'pack-1', { status: 'draft', content_category: 'knowledge', compliance_gate: 'passed' });

    const res = await request(app()).post('/v1/listings/lst-1/publish').send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('compliance_blocked');
    expect(res.body.blocking_reasons).toContain('not_scanned');
    expect(tables['pack_listings'][0].status).toBe('draft');
  });

  it.each(['flagged', 'quarantined', 'rejected', 'taken_down', 'suspended'])(
    '422 moderation_flagged when the moderation status is %s even with zero findings',
    async (modStatus) => {
      authedWallet = SELLER;
      seedPack('pack-1', { category: 'knowledge' });
      seedTos();
      seedAttestation('pack-1');
      seedModerationStatus('pack-1', modStatus); // no findings, but a blocking status
      seedDraftListing('lst-1', 'pack-1', { status: 'draft', content_category: 'knowledge' });

      const res = await request(app()).post('/v1/listings/lst-1/publish').send({});

      expect(res.status).toBe(422);
      expect(res.body.blocking_reasons).toContain('moderation_flagged');
      expect(tables['pack_listings'][0].status).toBe('draft');
    },
  );

  it('422 title_sales_not_in_slice1 when the backing pack is sale_mode=title', async () => {
    authedWallet = SELLER;
    seedPack('pack-1', { category: 'knowledge', saleMode: 'title' });
    seedTos();
    seedAttestation('pack-1');
    seedModerationClean('pack-1');
    seedDraftListing('lst-1', 'pack-1', { status: 'draft', content_category: 'knowledge' });

    const res = await request(app()).post('/v1/listings/lst-1/publish').send({});

    expect(res.status).toBe(422);
    expect(res.body.blocking_reasons).toContain('title_sales_not_in_slice1');
  });

  it('re-denormalises the trusted pack category onto the listing at publish (heals a stale row)', async () => {
    authedWallet = SELLER;
    // Pack is truly 'agent'; the listing row carries a stale 'knowledge'.
    seedPack('pack-1', { category: 'agent' });
    seedTos();
    seedAttestation('pack-1');
    seedModerationClean('pack-1');
    seedDraftListing('lst-1', 'pack-1', { status: 'draft', content_category: 'knowledge' });

    const res = await request(app()).post('/v1/listings/lst-1/publish').send({});

    expect(res.status).toBe(200);
    expect(res.body.listing.content_category).toBe('agent');
    expect(tables['pack_listings'][0].content_category).toBe('agent');
  });
});

// ─────────── SUPPLY ACCOUNTING ───────────

describe('supply accounting on create', () => {
  it('unlimited ⇒ supply_total is NULL even if a supply_total is sent', async () => {
    authedWallet = SELLER;
    seedPublishablePack('pack-1');

    const res = await request(app())
      .post('/v1/listings')
      .send({ pack_id: 'pack-1', title: 'x', supply_kind: 'unlimited', supply_total: 50 });

    expect(res.status).toBe(201);
    expect(res.body.listing.supply_kind).toBe('unlimited');
    expect(res.body.listing.supply_total).toBeNull();
    expect(res.body.listing.supply_sold).toBe(0);
  });

  it('limited ⇒ keeps the positive supply_total and seeds supply_sold=0', async () => {
    authedWallet = SELLER;
    seedPublishablePack('pack-1');

    const res = await request(app())
      .post('/v1/listings')
      .send({ pack_id: 'pack-1', title: 'x', supply_kind: 'limited', supply_total: 25 });

    expect(res.status).toBe(201);
    expect(res.body.listing.supply_kind).toBe('limited');
    expect(res.body.listing.supply_total).toBe(25);
    expect(res.body.listing.supply_sold).toBe(0);
  });

  it('single ⇒ supply_total is pinned to exactly 1', async () => {
    authedWallet = SELLER;
    seedPublishablePack('pack-1');

    const res = await request(app())
      .post('/v1/listings')
      // Client claims 99 units on a SINGLE-supply listing — server must pin to 1.
      .send({ pack_id: 'pack-1', title: 'x', supply_kind: 'single', supply_total: 99 });

    expect(res.status).toBe(201);
    expect(res.body.listing.supply_kind).toBe('single');
    expect(res.body.listing.supply_total).toBe(1);
  });

  it('422 when supply_kind=limited but supply_total is missing (a limit with no number is incoherent)', async () => {
    authedWallet = SELLER;
    seedPublishablePack('pack-1');

    const res = await request(app())
      .post('/v1/listings')
      .send({ pack_id: 'pack-1', title: 'x', supply_kind: 'limited' });

    expect(res.status).toBe(422);
    // Nothing persisted for an incoherent supply config.
    expect(insertedRows.find((i) => i.table === 'pack_listings')).toBeUndefined();
  });

  it('422 when supply_kind=limited and supply_total is zero or negative', async () => {
    authedWallet = SELLER;
    seedPublishablePack('pack-1');

    const zero = await request(app())
      .post('/v1/listings')
      .send({ pack_id: 'pack-1', title: 'x', supply_kind: 'limited', supply_total: 0 });
    expect(zero.status).toBe(422);

    resetDb();
    authedWallet = SELLER;
    seedPublishablePack('pack-1');
    const neg = await request(app())
      .post('/v1/listings')
      .send({ pack_id: 'pack-1', title: 'x', supply_kind: 'limited', supply_total: -5 });
    expect(neg.status).toBe(422);
  });
});

describe('supply accounting on PATCH', () => {
  it('rejects flipping to supply_kind=limited without a coherent supply_total', async () => {
    authedWallet = SELLER;
    // Existing unlimited listing (supply_total NULL).
    seedDraftListing('lst-1', 'pack-1', { supply_kind: 'unlimited', supply_total: null });

    const res = await request(app()).patch('/v1/listings/lst-1').send({ supply_kind: 'limited' });

    expect(res.status).toBe(422);
    // The persisted row stays unlimited — no half-applied limited state.
    expect(tables['pack_listings'][0].supply_kind).toBe('unlimited');
    expect(tables['pack_listings'][0].supply_total).toBeNull();
  });

  it('rejects setting a non-positive supply_total on a limited listing', async () => {
    authedWallet = SELLER;
    seedDraftListing('lst-1', 'pack-1', { supply_kind: 'limited', supply_total: 10 });

    const res = await request(app()).patch('/v1/listings/lst-1').send({ supply_total: 0 });

    expect(res.status).toBe(422);
    expect(tables['pack_listings'][0].supply_total).toBe(10);
  });

  it('allows raising the limited supply_total to a larger positive number', async () => {
    authedWallet = SELLER;
    seedDraftListing('lst-1', 'pack-1', { supply_kind: 'limited', supply_total: 10, supply_sold: 3 });

    const res = await request(app()).patch('/v1/listings/lst-1').send({ supply_total: 40 });

    expect(res.status).toBe(200);
    expect(tables['pack_listings'][0].supply_total).toBe(40);
    // supply_sold is untouched by an edit and never exceeds the new total.
    expect(tables['pack_listings'][0].supply_sold).toBe(3);
    expect(tables['pack_listings'][0].supply_sold).toBeLessThanOrEqual(tables['pack_listings'][0].supply_total);
  });

  it('rejects lowering supply_total below the already-sold count (supply_sold must never exceed supply_total)', async () => {
    authedWallet = SELLER;
    seedDraftListing('lst-1', 'pack-1', { supply_kind: 'limited', supply_total: 10, supply_sold: 7 });

    const res = await request(app()).patch('/v1/listings/lst-1').send({ supply_total: 5 });

    expect(res.status).toBe(422);
    // Invariant preserved: total stays >= sold.
    expect(tables['pack_listings'][0].supply_total).toBe(10);
    expect(tables['pack_listings'][0].supply_sold).toBeLessThanOrEqual(tables['pack_listings'][0].supply_total);
  });
});

// ─────────── PATCH immutability (beyond status/category/pack_id) ───────────

describe('PATCH immutability — every immutable field is refused', () => {
  it.each(['license_type', 'compliance_gate', 'seller_wallet', 'listing_id'])(
    '422 field_immutable when trying to PATCH %s',
    async (field) => {
      authedWallet = SELLER;
      seedDraftListing('lst-1', 'pack-1');
      const before = { ...tables['pack_listings'][0] };

      const res = await request(app())
        .patch('/v1/listings/lst-1')
        .send({ [field]: field === 'compliance_gate' ? 'passed' : 'tampered' });

      expect(res.status).toBe(422);
      expect(res.body.reason).toBe('field_immutable');
      // Row is byte-for-byte untouched.
      expect(tables['pack_listings'][0]).toEqual(before);
    },
  );

  it('422 no_editable_fields when the body has only unknown keys', async () => {
    authedWallet = SELLER;
    seedDraftListing('lst-1', 'pack-1');

    const res = await request(app()).patch('/v1/listings/lst-1').send({ bogus_key: 'whatever' });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('no_editable_fields');
  });

  it('422 invalid_id when the listing id is absurdly long', async () => {
    authedWallet = SELLER;
    const res = await request(app()).patch(`/v1/listings/${'x'.repeat(65)}`).send({ title: 'x' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_id');
  });
});

// ─────────── DB failure → 500 (fail-closed, no partial transition) ───────────

describe('DB failure modes', () => {
  it('500 listing_failed when the create insert errors (non-unique)', async () => {
    authedWallet = SELLER;
    seedPublishablePack('pack-1');
    forceError = { table: 'pack_listings', error: { code: 'XX000', message: 'boom' } };

    const res = await request(app()).post('/v1/listings').send({ pack_id: 'pack-1', title: 'x' });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('listing_failed');
  });

  it('500 listing_failed when the delist update errors, leaving status unchanged', async () => {
    authedWallet = SELLER;
    seedDraftListing('lst-1', 'pack-1', { status: 'listed' });
    forceError = { table: 'pack_listings', error: { code: 'XX000', message: 'boom' } };

    const res = await request(app()).post('/v1/listings/lst-1/delist').send({});

    expect(res.status).toBe(500);
    expect(tables['pack_listings'][0].status).toBe('listed');
  });
});
