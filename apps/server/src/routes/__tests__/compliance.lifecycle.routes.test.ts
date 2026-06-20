/**
 * Compliance-lifecycle hardening tests — attestation derivation + gate invariants
 * the happy-path compliance suite (compliance.routes.test.ts) does not cover.
 *
 * Tradeable Memory Packs — Slice 1, Part A, Task 4 (spec §3F). Companion to the
 * green compliance.routes.test.ts; same table-routed Supabase idiom (upsert-aware).
 *
 * Audited invariants:
 *   - content_category is SERVER-derived from the attestation's content_source and is
 *     NEVER client-set: a client-supplied content_category in the body is ignored; the
 *     persisted value is the SOURCE_TO_CATEGORY mapping, and a re-attest overwrites an
 *     existing category from the new source.
 *   - attestation completeness is mandatory: any false pledge (owns_or_licensed /
 *     no_thirdparty_pii / not_investment_advice) → 422 incomplete_attestation, nothing
 *     written, and the pack category is untouched.
 *   - scan severity is fail-closed: a plaintext PII member → flagged + has_pii (severity
 *     hold, never reject); an encrypted member → flagged + cannot_scan_encrypted with a
 *     reject severity (ciphertext can't be proven safe), NEVER clean.
 *   - the gate (GET /compliance) re-derives from persisted facts: a blocking moderation
 *     STATUS (flagged/quarantined/…) blocks even with zero findings (moderation_flagged);
 *     a missing ToS acceptance alone yields tos_not_accepted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

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

// ── Table-routed Supabase mock (upsert-aware, same idiom as compliance.routes.test.ts) ──
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

const FULL_ATTEST = { owns_or_licensed: true, no_thirdparty_pii: true, not_investment_advice: true };

beforeEach(() => {
  authedWallet = null;
  resetDb();
});

// ─────────── attest: server-derives category, ignores client claims ───────────

describe('POST /v1/packs/:id/attest — category is SERVER-derived', () => {
  it('IGNORES a client-supplied content_category and derives it from content_source', async () => {
    authedWallet = AUTHOR;
    seedPack('pack-1', { category: null });

    const res = await request(app())
      .post('/v1/packs/pack-1/attest')
      // Client lies: claims knowledge while the source is agent_memory.
      .send({ content_source: 'agent_memory', content_category: 'knowledge', ...FULL_ATTEST });

    expect(res.status).toBe(201);
    expect(res.body.content_category).toBe('agent'); // derived from source, not the client claim
    expect(tables['memory_packs'][0].content_category).toBe('agent');
  });

  it('a re-attest with a new content_source OVERWRITES the prior server category', async () => {
    authedWallet = AUTHOR;
    // Pack was previously classified 'knowledge'.
    seedPack('pack-1', { category: 'knowledge' });

    const res = await request(app())
      .post('/v1/packs/pack-1/attest')
      .send({ content_source: 'own_personal', ...FULL_ATTEST });

    expect(res.status).toBe(201);
    expect(res.body.content_category).toBe('personal');
    expect(tables['memory_packs'][0].content_category).toBe('personal');
  });

  it.each([
    ['owns_or_licensed', { owns_or_licensed: false, no_thirdparty_pii: true, not_investment_advice: true }],
    ['no_thirdparty_pii', { owns_or_licensed: true, no_thirdparty_pii: false, not_investment_advice: true }],
    ['not_investment_advice', { owns_or_licensed: true, no_thirdparty_pii: true, not_investment_advice: false }],
  ])('422 incomplete_attestation when %s is false — nothing written, category untouched', async (_name, pledges) => {
    authedWallet = AUTHOR;
    seedPack('pack-1', { category: null });

    const res = await request(app())
      .post('/v1/packs/pack-1/attest')
      .send({ content_source: 'curated_knowledge', ...pledges });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe('incomplete_attestation');
    // No attestation row, and the pack category stays NULL (fail-closed).
    expect(insertedRows.find((i) => i.table === 'pack_attestations')).toBeUndefined();
    expect(tables['memory_packs'][0].content_category).toBeNull();
  });

  it('422 invalid_id for an over-long pack id', async () => {
    authedWallet = AUTHOR;
    const res = await request(app())
      .post(`/v1/packs/${'p'.repeat(65)}/attest`)
      .send({ content_source: 'curated_knowledge', ...FULL_ATTEST });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_id');
  });
});

// ─────────── scan: PII (hold) vs encrypted (reject) severity ───────────

describe('POST /v1/packs/:id/scan — severity is fail-closed', () => {
  it('flags a plaintext PII member as has_pii (severity hold, NOT a hard reject)', async () => {
    authedWallet = AUTHOR;
    seedPack('pack-1', { bodies: ['contact me at jane.doe@example.com anytime', 'all good here'] });

    const res = await request(app()).post('/v1/packs/pack-1/scan').send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('flagged');
    expect(res.body.has_pii).toBe(true);
    expect(res.body.has_secrets).toBe(false);
    const mod = tables['pack_moderation'][0];
    expect(mod.status).toBe('flagged');
    // PII holds, it does not hard-reject.
    expect(mod.severity).toBe('hold');
  });

  it('an encrypted member yields cannot_scan_encrypted + reject severity (never clean)', async () => {
    authedWallet = AUTHOR;
    seedPack('pack-1', { bodies: ['plaintext', 'ciphertextblob'], encrypted: [false, true] });

    const res = await request(app()).post('/v1/packs/pack-1/scan').send({});

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('flagged');
    expect(res.body.reason).toBe('cannot_scan_encrypted');
    const mod = tables['pack_moderation'][0];
    expect(mod.status).toBe('flagged');
    // Ciphertext cannot be proven safe → modeled as a reject-severity block.
    expect(mod.severity).toBe('reject');
  });

  it('re-scan UPSERTs the single moderation row (one row per pack), flipping flagged→clean', async () => {
    authedWallet = AUTHOR;
    // First scan: a secret present → flagged.
    const rawKey = 'sk-ant-api03-' + 'C'.repeat(80) + 'AA';
    seedPack('pack-1', { bodies: [`leak ${rawKey}`, 'note'] });
    const first = await request(app()).post('/v1/packs/pack-1/scan').send({});
    expect(first.body.status).toBe('flagged');

    // The author removes the secret and re-scans: the SAME row updates to clean.
    tables['memories'][0].content = 'cleaned up, nothing here';
    const second = await request(app()).post('/v1/packs/pack-1/scan').send({});
    expect(second.body.status).toBe('clean');
    // Still exactly one moderation row for the pack.
    expect(tables['pack_moderation'].filter((m) => m.pack_id === 'pack-1')).toHaveLength(1);
    expect(tables['pack_moderation'][0].status).toBe('clean');
  });
});

// ─────────── GET /compliance — gate re-derives from persisted facts ───────────

describe('GET /v1/packs/:id/compliance — gate invariants', () => {
  it.each(['flagged', 'quarantined', 'rejected', 'taken_down', 'suspended'])(
    'blocked + moderation_flagged when the moderation status is %s with zero findings',
    async (modStatus) => {
      authedWallet = AUTHOR;
      seedPack('pack-1', { category: 'knowledge' });
      seed('legal_acceptances', [{ id: 1, owner_wallet: AUTHOR, doc_id: TOS_DOC_ID, doc_version: 1 }]);
      seed('pack_attestations', [
        { id: 1, pack_id: 'pack-1', author_wallet: AUTHOR, content_source: 'curated_knowledge', owns_or_licensed: true, no_thirdparty_pii: true, not_investment_advice: true, signature: 'sig', created_at: '2026-06-01T00:00:00Z' },
      ]);
      seed('pack_moderation', [{ pack_id: 'pack-1', status: modStatus, filter_version: 'v1', severity: null, findings: [] }]);

      const res = await request(app()).get('/v1/packs/pack-1/compliance');
      expect(res.status).toBe(200);
      expect(res.body.gate).toBe('blocked');
      expect(res.body.blocking_reasons).toContain('moderation_flagged');
    },
  );

  it('blocked + tos_not_accepted when only the ToS acceptance is missing', async () => {
    authedWallet = AUTHOR;
    seedPack('pack-1', { category: 'knowledge' });
    // Attested + scanned clean, but NO legal_acceptances row.
    seed('pack_attestations', [
      { id: 1, pack_id: 'pack-1', author_wallet: AUTHOR, content_source: 'curated_knowledge', owns_or_licensed: true, no_thirdparty_pii: true, not_investment_advice: true, signature: 'sig', created_at: '2026-06-01T00:00:00Z' },
    ]);
    seed('pack_moderation', [{ pack_id: 'pack-1', status: 'clean', filter_version: 'v1', severity: null, findings: [] }]);

    const res = await request(app()).get('/v1/packs/pack-1/compliance');
    expect(res.status).toBe(200);
    expect(res.body.gate).toBe('blocked');
    expect(res.body.blocking_reasons).toContain('tos_not_accepted');
    // ToS is the ONLY thing missing.
    expect(res.body.blocking_reasons).not.toContain('attestation_missing');
    expect(res.body.blocking_reasons).not.toContain('not_scanned');
  });

  it('reports sale_mode and scanned flags alongside the gate', async () => {
    authedWallet = AUTHOR;
    seedPack('pack-1', { category: 'knowledge' });
    seed('legal_acceptances', [{ id: 1, owner_wallet: AUTHOR, doc_id: TOS_DOC_ID, doc_version: 1 }]);
    seed('pack_attestations', [
      { id: 1, pack_id: 'pack-1', author_wallet: AUTHOR, content_source: 'curated_knowledge', owns_or_licensed: true, no_thirdparty_pii: true, not_investment_advice: true, signature: 'sig', created_at: '2026-06-01T00:00:00Z' },
    ]);
    seed('pack_moderation', [{ pack_id: 'pack-1', status: 'clean', filter_version: 'v1', severity: null, findings: [] }]);

    const res = await request(app()).get('/v1/packs/pack-1/compliance');
    expect(res.status).toBe(200);
    expect(res.body.gate).toBe('passed');
    expect(res.body.scanned).toBe(true);
    expect(res.body.sale_mode).toBe('copy');
  });
});
