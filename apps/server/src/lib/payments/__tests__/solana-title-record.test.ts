/**
 * solana-title-record — mintSolanaTitleForPack orchestration (Solana-native title mint + DB mirror).
 *
 * Unit-tested with a mocked Supabase handle + a mocked SolanaTitleMintClient (no live chain). Covers:
 *   - the fresh-pack path: mint → INSERT the mirror → INSERT the title_owner grant
 *   - chain mapping (devnet → 'solana-devnet', mainnet → 'solana')
 *   - idempotency: an already-minted title still records (UPDATE, not a 2nd INSERT) + skips a live grant
 *   - the phantom-commitment guard: no pmp_artifacts binding ⇒ throw BEFORE minting (never mint a phantom)
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { mintSolanaTitleForPack } from '../solana-title-record.js';

const PACK = 'clude-pack-xyz';
const USER = 'User9osNw7d44tryaeaiZ5KScQckB83okeaB3UDLj8u';
const FRESH = { mintAddress: 'Mint111deterministic', txSig: 'sig-abc', alreadyMinted: false };

/** A chainable Supabase-shaped mock. select/eq are chainable; maybeSingle resolves per-table; insert
 *  and update are captured; update().eq() resolves via the builder's thenable. */
function makeDb(opts: {
  pmpArtifact?: { data: unknown; error?: unknown };
  packTitleExisting?: unknown;
  entitlementExisting?: unknown;
  insertError?: Record<string, unknown>;
  updateError?: Record<string, unknown>;
} = {}) {
  const calls = { inserts: [] as Array<{ table: string; row: any }>, updates: [] as Array<{ table: string; patch: any }> };
  const maybeSingleByTable: Record<string, { data: unknown; error: unknown }> = {
    pmp_artifacts: (opts.pmpArtifact as { data: unknown; error: unknown }) ?? {
      data: { merkle_root: '0xroot', manifest_hash: '0xman', record_count: 5 },
      error: null,
    },
    pack_titles: { data: opts.packTitleExisting ?? null, error: null },
    pack_entitlements: { data: opts.entitlementExisting ?? null, error: null },
  };
  const db = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        maybeSingle: () => Promise.resolve(maybeSingleByTable[table] ?? { data: null, error: null }),
        insert: (row: any) => {
          calls.inserts.push({ table, row });
          return Promise.resolve({ error: opts.insertError?.[table] ?? null });
        },
        update: (patch: any) => {
          calls.updates.push({ table, patch });
          return q;
        },
        then: (resolve: (v: { error: unknown }) => unknown) => resolve({ error: opts.updateError?.[table] ?? null }),
      };
      return q;
    },
  };
  return { db, calls };
}

const solClient = (network: 'devnet' | 'mainnet-beta', mintResult: unknown) => ({
  network,
  mintTitle: vi.fn(async () => mintResult),
  titleOwner: vi.fn(),
});

describe('mintSolanaTitleForPack — fresh pack', () => {
  it('mints to the user, INSERTs the mirror, and grants title_owner', async () => {
    const { db, calls } = makeDb();
    const sol = solClient('devnet', FRESH);
    const res = await mintSolanaTitleForPack(db, sol as any, PACK, USER);

    // bound to the pack commitment, minted to the user's OWN wallet
    expect(sol.mintTitle).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ packId: PACK, merkleRoot: '0xroot', manifestHash: '0xman', memoryCount: 5 }),
    );
    expect(res).toEqual({ mintAddress: 'Mint111deterministic', txSig: 'sig-abc', alreadyMinted: false, chain: 'solana-devnet' });

    const titleInsert = calls.inserts.find((c) => c.table === 'pack_titles');
    expect(titleInsert?.row).toMatchObject({
      pack_id: PACK,
      creator_wallet: USER,
      mint_address: 'Mint111deterministic',
      chain: 'solana-devnet',
      current_owner: USER,
      status: 'minted',
      mint_tx: 'sig-abc',
    });
    // a Solana row leaves the Base-only columns unset (037 made them nullable)
    expect(titleInsert?.row).not.toHaveProperty('token_id');
    expect(titleInsert?.row).not.toHaveProperty('contract_address');

    const entInsert = calls.inserts.find((c) => c.table === 'pack_entitlements');
    expect(entInsert?.row).toMatchObject({
      pack_id: PACK,
      holder_wallet: USER,
      grant_kind: 'title_owner',
      payment_rail: 'clude_solana',
      status: 'active',
      order_id: null,
    });
  });

  it('maps mainnet-beta → chain "solana"', async () => {
    const { db } = makeDb();
    const res = await mintSolanaTitleForPack(db, solClient('mainnet-beta', FRESH) as any, PACK, USER);
    expect(res.chain).toBe('solana');
  });
});

describe('mintSolanaTitleForPack — idempotency', () => {
  it('an already-minted title UPDATEs the mirror (no 2nd insert) and skips a live grant', async () => {
    const { db, calls } = makeDb({
      packTitleExisting: { pack_id: PACK },
      entitlementExisting: { id: 1, status: 'active' },
    });
    const sol = solClient('devnet', { mintAddress: 'Mint111deterministic', txSig: null, alreadyMinted: true });
    const res = await mintSolanaTitleForPack(db, sol as any, PACK, USER);

    expect(res.alreadyMinted).toBe(true);
    expect(res.txSig).toBeNull();
    expect(calls.updates.some((c) => c.table === 'pack_titles')).toBe(true);
    expect(calls.inserts.some((c) => c.table === 'pack_titles')).toBe(false);
    // an active entitlement is left untouched
    expect(calls.inserts.some((c) => c.table === 'pack_entitlements')).toBe(false);
    expect(calls.updates.some((c) => c.table === 'pack_entitlements')).toBe(false);
  });

  it('re-activates a previously revoked title_owner entitlement', async () => {
    const { db, calls } = makeDb({ entitlementExisting: { id: 1, status: 'revoked' } });
    await mintSolanaTitleForPack(db, solClient('devnet', FRESH) as any, PACK, USER);
    const entUpdate = calls.updates.find((c) => c.table === 'pack_entitlements');
    expect(entUpdate?.patch).toMatchObject({ status: 'active', revoked_at: null });
  });

  it('treats a concurrent mirror INSERT collision (23505) as a no-op, not a failure, and still grants', async () => {
    const { db, calls } = makeDb({ insertError: { pack_titles: { code: '23505' } } });
    const res = await mintSolanaTitleForPack(db, solClient('devnet', FRESH) as any, PACK, USER);
    expect(res.alreadyMinted).toBe(false); // a concurrent (re-)export won the PK race — not an error
    expect(calls.inserts.some((c) => c.table === 'pack_entitlements')).toBe(true); // grant still happens
  });

  it('still throws on a NON-23505 mirror INSERT error (e.g. a real NOT NULL violation)', async () => {
    const { db } = makeDb({ insertError: { pack_titles: { code: '23502' } } });
    await expect(mintSolanaTitleForPack(db, solClient('devnet', FRESH) as any, PACK, USER)).rejects.toThrow(
      /failed to insert title mirror/i,
    );
  });
});

describe('mintSolanaTitleForPack — phantom-commitment guard', () => {
  it('throws (and never mints) when the pack has no pmp_artifacts row', async () => {
    const { db } = makeDb({ pmpArtifact: { data: null, error: null } });
    const sol = solClient('devnet', FRESH);
    await expect(mintSolanaTitleForPack(db, sol as any, PACK, USER)).rejects.toThrow(/no pmp_artifacts binding/i);
    expect(sol.mintTitle).not.toHaveBeenCalled();
  });

  it('throws (and never mints) when merkle_root is missing (half-formed artifact)', async () => {
    const { db } = makeDb({ pmpArtifact: { data: { merkle_root: null, manifest_hash: '0xman', record_count: 5 }, error: null } });
    const sol = solClient('devnet', FRESH);
    await expect(mintSolanaTitleForPack(db, sol as any, PACK, USER)).rejects.toThrow(/binding/i);
    expect(sol.mintTitle).not.toHaveBeenCalled();
  });
});
