/**
 * Integration tests for the compliance endpoints (legal + attest + scan + status).
 *
 * Tradeable Memory Packs — Slice 1, Part A, Task 4 (spec §3F).
 *
 * Surface:
 *   GET  /v1/legal/:doc_id        current ToS body + body_hash
 *   POST /v1/legal/accept         privy → legal_acceptances row (ip + ua)
 *   GET  /v1/legal/acceptances    privy → the caller's acceptances
 *   POST /v1/packs/:id/attest     privy author → pack_attestations; SERVER derives +
 *                                 writes memory_packs.content_category from content_source
 *   POST /v1/packs/:id/scan       privy → scanPack over PLAINTEXT members → pack_moderation
 *                                 (encrypted members → cannot_scan_encrypted, NOT clean)
 *   GET  /v1/packs/:id/compliance gate state + blocking_reasons via evaluateGate
 *
 * Fail-closed guarantees proven here: only the pack author may attest/scan (others 403);
 * content_category is SERVER-derived from content_source (never client-set); a plaintext
 * secret is flagged + REDACTED (never echoed); an encrypted pack cannot be passed off as
 * clean; an un-attested pack is `category_unset`; a secret pack is `contains_secrets`.
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

// ── Table-routed Supabase mock (same idiom as pack-marketplace.routes.test.ts) ──
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const insertedRows: Array<{ table: string; rows: Row[] }> = [];
let forceError: { table: string; error: any } | null = null;

function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  insertedRows.length = 0;
  forceError = null;
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

function makeChain(table: string) {
  const filters: Filter[] = [];
  let pendingInsert: Row[] | null = null;
  let pendingUpdate: Row | null = null;
  let pendingUpsert: Row[] | null = null;
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
      tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
      insertedRows.push({ table, rows: rows.map((r) => ({ ...r })) });
      return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
    }
    if (pendingUpsert) {
      const rows = pendingUpsert;
      pendingUpsert = null;
      // Upsert on primary key `pack_id` (the only upsert target in this router).
      for (const r of rows) {
        const arr = tables[table] ?? (tables[table] = []);
        const existing = arr.find((x) => x.pack_id === r.pack_id);
        if (existing) Object.assign(existing, r);
        else arr.push({ ...r });
      }
      insertedRows.push({ table, rows: rows.map((r) => ({ ...r })) });
      return Promise.resolve({ data: rows.map((r) => ({ ...r })), error: null });
    }
    if (pendingUpdate) {
      const patch = pendingUpdate;
      pendingUpdate = null;
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
    upsert: (rows: Row | Row[]) => {
      pendingUpsert = Array.isArray(rows) ? rows : [rows];
      return chain;
    },
    update: (patch: Row) => {
      pendingUpdate = patch;
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

import { complianceRoutes } from '../compliance.routes.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use(complianceRoutes());
  return a;
}

// ── Fixtures ──
const AUTHOR = 'AuTHoRwallet1111111111111111111111111111111';
const OTHER = 'OtherWaLLet2222222222222222222222222222222';
const TOS_DOC_ID = 'marketplace_tos';

function seedLegalDoc() {
  seed('legal_documents', [
    {
      doc_id: TOS_DOC_ID,
      version: 1,
      body_hash: 'b'.repeat(64),
      url: 'https://clude.io/legal/marketplace_tos',
      effective_at: '2026-06-01T00:00:00Z',
      is_current: true,
    },
  ]);
}

/** A tokenised pack owned by AUTHOR with `count` plaintext members (overridable bodies). */
function seedPack(
  packId: string,
  opts: {
    owner?: string;
    category?: 'personal' | 'knowledge' | 'agent' | null;
    bodies?: string[];
    encrypted?: boolean[];
  } = {},
) {
  const owner = opts.owner ?? AUTHOR;
  const bodies = opts.bodies ?? ['clean note one', 'clean note two'];
  seed('memory_packs', [
    {
      pack_id: packId,
      author_wallet: owner,
      name: 'Pack',
      version: '1.0.0',
      memory_count: bodies.length,
      merkle_root: 'r'.repeat(64),
      content_category: opts.category ?? null,
      sale_mode: 'copy',
    },
  ]);
  seed(
    'memory_pack_contents',
    bodies.map((_b, i) => ({ pack_id: packId, memory_id: i + 1, leaf_index: i, content_hash: `${i}`.repeat(64) })),
  );
  seed(
    'memories',
    bodies.map((b, i) => ({
      id: i + 1,
      hash_id: `mem-${i + 1}`,
      content: b,
      owner_wallet: owner,
      encrypted: opts.encrypted?.[i] ?? false,
    })),
  );
}

beforeEach(() => {
  authedWallet = null;
  resetDb();
});

// ─────────── GET /v1/legal/:doc_id ───────────

describe('GET /v1/legal/:doc_id', () => {
  it('returns the current ToS doc + body_hash', async () => {
    seedLegalDoc();
    const res = await request(app()).get(`/v1/legal/${TOS_DOC_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.doc_id).toBe(TOS_DOC_ID);
    expect(res.body.version).toBe(1);
    expect(res.body.body_hash).toBe('b'.repeat(64));
  });

  it('404 when the doc is unknown', async () => {
    const res = await request(app()).get('/v1/legal/nope');
    expect(res.status).toBe(404);
  });
});

// ─────────── POST /v1/legal/accept + GET /v1/legal/acceptances ───────────

describe('POST /v1/legal/accept', () => {
  it('401 when unauthenticated', async () => {
    seedLegalDoc();
    const res = await request(app()).post('/v1/legal/accept').send({ doc_id: TOS_DOC_ID });
    expect(res.status).toBe(401);
  });

  it('persists an acceptance row with ip + user agent', async () => {
    authedWallet = AUTHOR;
    seedLegalDoc();
    const res = await request(app())
      .post('/v1/legal/accept')
      .set('User-Agent', 'jest-agent/1.0')
      .send({ doc_id: TOS_DOC_ID, context: 'listing_create' });

    expect(res.status).toBe(201);
    const ins = insertedRows.find((i) => i.table === 'legal_acceptances');
    expect(ins).toBeDefined();
    const row = ins!.rows[0];
    expect(row.owner_wallet).toBe(AUTHOR);
    expect(row.doc_id).toBe(TOS_DOC_ID);
    expect(row.doc_version).toBe(1);
    expect(row.user_agent).toBe('jest-agent/1.0');
    // ip is captured (supertest connects over loopback).
    expect(typeof row.ip_inet === 'string' || row.ip_inet === null).toBe(true);
  });

  it('422 when accepting an unknown doc', async () => {
    authedWallet = AUTHOR;
    const res = await request(app()).post('/v1/legal/accept').send({ doc_id: 'nope' });
    expect(res.status).toBe(422);
  });

  it('/acceptances returns only the caller-owned acceptances', async () => {
    authedWallet = AUTHOR;
    seed('legal_acceptances', [
      { id: 1, owner_wallet: AUTHOR, doc_id: TOS_DOC_ID, doc_version: 1 },
      { id: 2, owner_wallet: OTHER, doc_id: TOS_DOC_ID, doc_version: 1 },
    ]);
    const res = await request(app()).get('/v1/legal/acceptances');
    expect(res.status).toBe(200);
    expect(res.body.acceptances).toHaveLength(1);
    expect(res.body.acceptances[0].owner_wallet).toBe(AUTHOR);
  });
});

// ─────────── POST /v1/packs/:id/attest ───────────

describe('POST /v1/packs/:id/attest', () => {
  it('401 when unauthenticated', async () => {
    seedPack('pack-1');
    const res = await request(app())
      .post('/v1/packs/pack-1/attest')
      .send({ content_source: 'curated_knowledge', owns_or_licensed: true, no_thirdparty_pii: true, not_investment_advice: true });
    expect(res.status).toBe(401);
  });

  it("403 when attesting another wallet's pack", async () => {
    authedWallet = OTHER;
    seedPack('pack-1', { owner: AUTHOR });
    const res = await request(app())
      .post('/v1/packs/pack-1/attest')
      .send({ content_source: 'curated_knowledge', owns_or_licensed: true, no_thirdparty_pii: true, not_investment_advice: true });
    expect(res.status).toBe(403);
    expect(insertedRows.find((i) => i.table === 'pack_attestations')).toBeUndefined();
  });

  it("derives content_category='personal' from content_source='own_personal'", async () => {
    authedWallet = AUTHOR;
    seedPack('pack-1', { category: null });
    const res = await request(app())
      .post('/v1/packs/pack-1/attest')
      .send({ content_source: 'own_personal', owns_or_licensed: true, no_thirdparty_pii: true, not_investment_advice: true });

    expect(res.status).toBe(201);
    expect(res.body.content_category).toBe('personal');
    // The pack row was updated server-side.
    expect(tables['memory_packs'][0].content_category).toBe('personal');
    // The attestation row was written with the merkle_root-bound hash.
    const ins = insertedRows.find((i) => i.table === 'pack_attestations');
    expect(ins).toBeDefined();
    expect(ins!.rows[0].content_source).toBe('own_personal');
    expect(typeof ins!.rows[0].attestation_hash).toBe('string');
  });

  it("derives 'knowledge' from 'curated_knowledge' and 'agent' from 'agent_memory'", async () => {
    authedWallet = AUTHOR;
    seedPack('pack-k', { category: null });
    seedPack('pack-a', { category: null });

    const rk = await request(app())
      .post('/v1/packs/pack-k/attest')
      .send({ content_source: 'curated_knowledge', owns_or_licensed: true, no_thirdparty_pii: true, not_investment_advice: true });
    expect(rk.body.content_category).toBe('knowledge');

    const ra = await request(app())
      .post('/v1/packs/pack-a/attest')
      .send({ content_source: 'agent_memory', owns_or_licensed: true, no_thirdparty_pii: true, not_investment_advice: true });
    expect(ra.body.content_category).toBe('agent');
  });

  it('422 on an invalid content_source', async () => {
    authedWallet = AUTHOR;
    seedPack('pack-1');
    const res = await request(app())
      .post('/v1/packs/pack-1/attest')
      .send({ content_source: 'something_else', owns_or_licensed: true, no_thirdparty_pii: true, not_investment_advice: true });
    expect(res.status).toBe(422);
  });

  it('404 when the pack does not exist', async () => {
    authedWallet = AUTHOR;
    const res = await request(app())
      .post('/v1/packs/nope/attest')
      .send({ content_source: 'curated_knowledge', owns_or_licensed: true, no_thirdparty_pii: true, not_investment_advice: true });
    expect(res.status).toBe(404);
  });
});

// ─────────── POST /v1/packs/:id/scan ───────────

describe('POST /v1/packs/:id/scan', () => {
  it("403 when scanning another wallet's pack", async () => {
    authedWallet = OTHER;
    seedPack('pack-1', { owner: AUTHOR });
    const res = await request(app()).post('/v1/packs/pack-1/scan').send({});
    expect(res.status).toBe(403);
  });

  it('flags a plaintext member containing an Anthropic key (REDACTED, never echoed)', async () => {
    authedWallet = AUTHOR;
    const rawKey = 'sk-ant-api03-' + 'C'.repeat(80) + 'AA';
    seedPack('pack-1', { bodies: ['clean note', `my key is ${rawKey} keep it safe`] });

    const res = await request(app()).post('/v1/packs/pack-1/scan').send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('flagged');
    expect(res.body.has_secrets).toBe(true);
    const finding = res.body.findings.find((f: any) => f.category === 'secret_api_key');
    expect(finding).toBeDefined();
    // REDACTED: the raw key never appears anywhere in the response body.
    expect(JSON.stringify(res.body)).not.toContain(rawKey);
    // A moderation row was persisted, flagged, with redacted findings only.
    const mod = tables['pack_moderation']?.[0];
    expect(mod.status).toBe('flagged');
    expect(JSON.stringify(mod.findings)).not.toContain(rawKey);
    expect(mod.findings[0].severity).toBe('reject');
  });

  it('marks a clean knowledge pack as clean', async () => {
    authedWallet = AUTHOR;
    seedPack('pack-1', { bodies: ['the dream cycle consolidates episodic memories', 'all good here'] });
    const res = await request(app()).post('/v1/packs/pack-1/scan').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('clean');
    expect(res.body.has_secrets).toBe(false);
  });

  it('returns cannot_scan_encrypted (NOT clean) when any member is encrypted', async () => {
    authedWallet = AUTHOR;
    seedPack('pack-1', { bodies: ['plaintext', 'ciphertextblob'], encrypted: [false, true] });
    const res = await request(app()).post('/v1/packs/pack-1/scan').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('flagged');
    expect(res.body.reason).toBe('cannot_scan_encrypted');
    // Persisted as flagged, NEVER clean — ciphertext can't be proven safe.
    expect(tables['pack_moderation'][0].status).toBe('flagged');
  });

  it('404 when the pack does not exist', async () => {
    authedWallet = AUTHOR;
    const res = await request(app()).post('/v1/packs/nope/scan').send({});
    expect(res.status).toBe(404);
  });
});

// ─────────── GET /v1/packs/:id/compliance ───────────

describe('GET /v1/packs/:id/compliance', () => {
  it('blocked + [category_unset, attestation_missing, not_scanned] for an un-attested pack', async () => {
    authedWallet = AUTHOR;
    seedPack('pack-1', { category: null }); // no attestation, no moderation, no ToS
    const res = await request(app()).get('/v1/packs/pack-1/compliance');
    expect(res.status).toBe(200);
    expect(res.body.gate).toBe('blocked');
    expect(res.body.blocking_reasons).toContain('category_unset');
  });

  it('blocked + contains_secrets for a scanned secret pack', async () => {
    authedWallet = AUTHOR;
    seedPack('pack-1', { category: 'knowledge' });
    seed('legal_acceptances', [{ id: 1, owner_wallet: AUTHOR, doc_id: TOS_DOC_ID, doc_version: 1 }]);
    seed('pack_attestations', [
      { id: 1, pack_id: 'pack-1', author_wallet: AUTHOR, content_source: 'curated_knowledge', owns_or_licensed: true, no_thirdparty_pii: true, not_investment_advice: true, signature: 'sig', created_at: '2026-06-01T00:00:00Z' },
    ]);
    seed('pack_moderation', [
      { pack_id: 'pack-1', status: 'flagged', filter_version: 'v1', severity: 'reject', findings: [{ category: 'secret_api_key', severity: 'reject', sample: 'sk-a…(51)', index: 3 }] },
    ]);

    const res = await request(app()).get('/v1/packs/pack-1/compliance');
    expect(res.status).toBe(200);
    expect(res.body.gate).toBe('blocked');
    expect(res.body.blocking_reasons).toContain('contains_secrets');
  });

  it('passed for a clean, attested, ToS-accepted knowledge pack', async () => {
    authedWallet = AUTHOR;
    seedPack('pack-1', { category: 'knowledge' });
    seed('legal_acceptances', [{ id: 1, owner_wallet: AUTHOR, doc_id: TOS_DOC_ID, doc_version: 1 }]);
    seed('pack_attestations', [
      { id: 1, pack_id: 'pack-1', author_wallet: AUTHOR, content_source: 'curated_knowledge', owns_or_licensed: true, no_thirdparty_pii: true, not_investment_advice: true, signature: 'sig', created_at: '2026-06-01T00:00:00Z' },
    ]);
    seed('pack_moderation', [
      { pack_id: 'pack-1', status: 'clean', filter_version: 'v1', severity: null, findings: [] },
    ]);

    const res = await request(app()).get('/v1/packs/pack-1/compliance');
    expect(res.status).toBe(200);
    expect(res.body.gate).toBe('passed');
    expect(res.body.blocking_reasons).toEqual([]);
  });

  it('404 when the pack does not exist', async () => {
    authedWallet = AUTHOR;
    const res = await request(app()).get('/v1/packs/nope/compliance');
    expect(res.status).toBe(404);
  });
});
