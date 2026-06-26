/**
 * entitlement-gate — the COPY unlock authority.
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 2), Task 2
 * (spec §00 B2 + §1.2 Flow A step 10 · §3 "/unlock gate sees active entitlement").
 *
 * MONEY/ACCESS CODE. `hasActiveCopyEntitlement(pack_id, holder_wallet)` is the SINGLE
 * off-chain authority a copy-license buyer unlocks through. The §00 B2 binding correction
 * is the whole point of this file: copy unlock reads `pack_entitlements` and NEVER touches
 * the chain / a token balance (that balance check is the title double-spend bug). So this
 * suite pins three things:
 *
 *   1. AUTHORITATIVE READ. An ACTIVE 'copy_license' row for (pack, holder) → true. The query
 *      is scoped to all four of: pack_id, holder_wallet, grant_kind='copy_license',
 *      status='active' (owner-scoped on holder_wallet — never returns another wallet's grant).
 *   2. FAIL-CLOSED. No row, a 'title_owner' grant, a different holder, a different pack, or a
 *      non-active status ('refunded'/'revoked' — the §00 M10 clawback target) → false.
 *   3. NO CHAIN. The module imports no Solana client; resolving an answer touches getDb only.
 *      A DB error fails closed (false), never throws an unlock open.
 *
 * getDb is mocked (table-routed in-memory Supabase, same idiom as grant-copy.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── Table-routed Supabase mock (minimal: .select().eq()×N.maybeSingle()) ──────
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
let forceError: { table: string; error: any } | null = null;

function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  forceError = null;
}
function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}

type Filter = (row: Row) => boolean;

function makeChain(table: string) {
  const filters: Filter[] = [];
  const matched = (): Row[] => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
  const result = () => {
    if (forceError && forceError.table === table) return { data: null, error: forceError.error };
    return { data: matched(), error: null };
  };
  const chain: Record<string, any> = {};
  Object.assign(chain, {
    select: (_cols?: string) => chain,
    eq: (col: string, val: any) => {
      filters.push((row) => row[col] === val);
      return chain;
    },
    limit: () => chain,
    maybeSingle: async () => {
      const r = result();
      const arr = Array.isArray(r.data) ? r.data : r.data == null ? [] : [r.data];
      return { data: arr[0] ?? null, error: r.error };
    },
  });
  return chain;
}

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({ from: (table: string) => makeChain(table) }),
}));

import { hasActiveCopyEntitlement } from '../entitlement-gate.js';

const PACK = 'pack-deadbeef';
const BUYER = 'BuYeRwallet2222222222222222222222222222222';
const OTHER = 'OtHeRwallet3333333333333333333333333333333';

function activeCopyGrant(overrides: Row = {}): Row {
  return {
    id: 1,
    pack_id: PACK,
    holder_wallet: BUYER,
    grant_kind: 'copy_license',
    status: 'active',
    order_id: 'ord-aabbccdd',
    payment_rail: 'stripe',
    delivered_copy: true,
    ...overrides,
  };
}

beforeEach(() => {
  resetDb();
});

describe('hasActiveCopyEntitlement — authoritative copy unlock read (§00 B2)', () => {
  it('returns true for an ACTIVE copy_license grant on (pack, holder)', async () => {
    seed('pack_entitlements', [activeCopyGrant()]);
    await expect(hasActiveCopyEntitlement(PACK, BUYER)).resolves.toBe(true);
  });

  it('returns false when there is NO entitlement at all', async () => {
    await expect(hasActiveCopyEntitlement(PACK, BUYER)).resolves.toBe(false);
  });

  it('returns false when the only grant belongs to a DIFFERENT holder', async () => {
    seed('pack_entitlements', [activeCopyGrant({ holder_wallet: OTHER })]);
    await expect(hasActiveCopyEntitlement(PACK, BUYER)).resolves.toBe(false);
  });

  it('returns false when the only grant is for a DIFFERENT pack', async () => {
    seed('pack_entitlements', [activeCopyGrant({ pack_id: 'pack-other' })]);
    await expect(hasActiveCopyEntitlement(PACK, BUYER)).resolves.toBe(false);
  });

  it('returns false for a title_owner grant (copy unlock only honours copy_license)', async () => {
    seed('pack_entitlements', [activeCopyGrant({ grant_kind: 'title_owner' })]);
    await expect(hasActiveCopyEntitlement(PACK, BUYER)).resolves.toBe(false);
  });
});

describe('hasActiveCopyEntitlement — fail-closed on non-active status (§00 M10 clawback)', () => {
  it('returns false for a REFUNDED grant (chargeback clawback flipped status)', async () => {
    seed('pack_entitlements', [activeCopyGrant({ status: 'refunded' })]);
    await expect(hasActiveCopyEntitlement(PACK, BUYER)).resolves.toBe(false);
  });

  it('returns false for a REVOKED grant', async () => {
    seed('pack_entitlements', [activeCopyGrant({ status: 'revoked' })]);
    await expect(hasActiveCopyEntitlement(PACK, BUYER)).resolves.toBe(false);
  });
});

describe('hasActiveCopyEntitlement — fail-closed on DB error (never throws an unlock open)', () => {
  it('returns false (not throw) when the entitlement read errors', async () => {
    forceError = { table: 'pack_entitlements', error: { code: 'XX000', message: 'boom' } };
    await expect(hasActiveCopyEntitlement(PACK, BUYER)).resolves.toBe(false);
  });
});

describe('hasActiveCopyEntitlement — empty-arg guard (deny before touching the DB)', () => {
  it('returns false for an empty packId without issuing a query', async () => {
    // Even if a (matching-everything) grant were present, a blank pack id must deny up front — a
    // missing identifier can never authorise an unlock.
    seed('pack_entitlements', [activeCopyGrant({ pack_id: '' })]);
    await expect(hasActiveCopyEntitlement('', BUYER)).resolves.toBe(false);
  });

  it('returns false for an empty holderWallet without issuing a query', async () => {
    seed('pack_entitlements', [activeCopyGrant({ holder_wallet: '' })]);
    await expect(hasActiveCopyEntitlement(PACK, '')).resolves.toBe(false);
  });
});
