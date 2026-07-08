/**
 * solana-title-gate — assertSolanaTitleUnlock, the chain-aware unlock ownership check.
 *
 * Covers: non-titled fall-through (no row / Base row / null mint), the live 1-of-1 holder verdict
 * (holds → ok, other holder → not_title_owner), fail-closed on an on-chain RPC error, and throw on a
 * DB lookup error. Mocked db + SolanaTitleMintClient — no live chain.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { assertSolanaTitleUnlock } from '../solana-title-gate.js';

const PACK = 'clude-pack-xyz';
const OWNER = 'OwnerWa11et1111111111111111111111111111111';
const OTHER = 'OtherWa11et2222222222222222222222222222222';
const MINT = 'Mint333deterministic';

/** db mock: from('pack_titles').select().eq().maybeSingle() → {data,error}. */
const makeDb = (data: unknown, error: unknown = null) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data, error }) }) }) }),
});

/** sol mock: assertTitleOwner calls client.titleOwner(mint); we drive its result here. */
const makeSol = (titleOwner: () => Promise<string | null>) =>
  ({ network: 'devnet' as const, titleOwner: vi.fn(titleOwner), mintTitle: vi.fn() }) as any;

describe('assertSolanaTitleUnlock — not a Solana title (fall back to legacy gate)', () => {
  it('no pack_titles row → titled:false', async () => {
    const res = await assertSolanaTitleUnlock(makeDb(null) as any, makeSol(async () => OWNER), PACK, OWNER);
    expect(res).toEqual({ titled: false });
  });

  it('a Base-titled row → titled:false (not a Solana chain)', async () => {
    const db = makeDb({ chain: 'base-sepolia', mint_address: null, status: 'minted' });
    const res = await assertSolanaTitleUnlock(db as any, makeSol(async () => OWNER), PACK, OWNER);
    expect(res).toEqual({ titled: false });
  });

  it('a Solana chain row with a null mint_address → titled:false (defensive)', async () => {
    const db = makeDb({ chain: 'solana-devnet', mint_address: null, status: 'pending_mint' });
    const res = await assertSolanaTitleUnlock(db as any, makeSol(async () => OWNER), PACK, OWNER);
    expect(res).toEqual({ titled: false });
  });

  it('does NOT touch the chain on the fall-through path (no cache/chain read for a non-Solana pack)', async () => {
    const sol = makeSol(async () => OWNER);
    await assertSolanaTitleUnlock(makeDb({ chain: 'base-sepolia', mint_address: null, status: 'minted' }) as any, sol, PACK, OWNER);
    expect(sol.titleOwner).not.toHaveBeenCalled();
  });
});

describe('assertSolanaTitleUnlock — live 1-of-1 ownership verdict', () => {
  const db = () => makeDb({ chain: 'solana-devnet', mint_address: MINT, status: 'minted' });

  it('wallet holds the 1-of-1 → titled:true, ok:true', async () => {
    const res = await assertSolanaTitleUnlock(db() as any, makeSol(async () => OWNER), PACK, OWNER);
    expect(res).toEqual({ titled: true, ok: true, mintAddress: MINT });
  });

  it('a MAINNET solana title still runs the live on-chain check', async () => {
    const dbMain = makeDb({ chain: 'solana', mint_address: MINT, status: 'minted' });
    const res = await assertSolanaTitleUnlock(dbMain as any, makeSol(async () => OWNER), PACK, OWNER);
    expect(res).toEqual({ titled: true, ok: true, mintAddress: MINT });
  });

  it('someone else holds it → titled:true, ok:false, not_title_owner', async () => {
    const res = await assertSolanaTitleUnlock(db() as any, makeSol(async () => OTHER), PACK, OWNER);
    expect(res).toEqual({ titled: true, ok: false, reason: 'not_title_owner' });
  });

  it('unheld / burned (titleOwner null) → not_title_owner', async () => {
    const res = await assertSolanaTitleUnlock(db() as any, makeSol(async () => null), PACK, OWNER);
    expect(res).toEqual({ titled: true, ok: false, reason: 'not_title_owner' });
  });

  it('on-chain read throws → fails CLOSED with rpc_unavailable (never serves on an RPC error)', async () => {
    const sol = makeSol(async () => {
      throw new Error('429 Too Many Requests');
    });
    const res = await assertSolanaTitleUnlock(db() as any, sol, PACK, OWNER);
    expect(res).toEqual({ titled: true, ok: false, reason: 'rpc_unavailable' });
  });
});

describe('assertSolanaTitleUnlock — DB error', () => {
  it('throws on a pack_titles lookup error (the route maps it to a transient 503)', async () => {
    const db = makeDb(null, { message: 'connection reset' });
    await expect(assertSolanaTitleUnlock(db as any, makeSol(async () => OWNER), PACK, OWNER)).rejects.toThrow(
      /failed to read pack_titles/i,
    );
  });
});
