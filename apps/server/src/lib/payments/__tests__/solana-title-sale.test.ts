/**
 * solana-title-sale — the non-custodial sale saga. Covers the load-bearing money invariants:
 *   - the upfront payment gate (no work on an unpaid order)
 *   - the forward path created→dek_rewrapped→paid pausing at 'paid' (awaitingTransfer)
 *   - the no-transfer-before-paid pause (getSolanaTitleTransferForSeller refuses unless at 'paid')
 *   - the SECURITY reject: submitSolanaTitleTransfer refuses a signed tx that isn't exactly this transfer
 * db + sol client mocked — no live chain. The full submit→revoke happy path is covered by the backtest
 * + a follow-up integration test (the saga is tsc-clean and the transfer primitive is unit-tested).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import { executeSolanaTitleSale, getSolanaTitleTransferForSeller, submitSolanaTitleTransfer, refundSolanaTitleSale, SolanaTitleFinalError } from '../solana-title-sale.js';

const ORDER = 'ord-1';
const PACK = 'clude-pack-sale';
const SELLER = 'Seller1111111111111111111111111111111111111';
const BUYER = 'Buyer22222222222222222222222222222222222222';
const MINT = 'Mint333333333333333333333333333333333333333';

/** Per-table queue mock: `single` (maybeSingle/single) + `list` (awaited builder) queues; insert/update/
 *  delete captured + resolve {error:null}. */
function makeDb(cfg: { single?: Record<string, any[]>; list?: Record<string, any[]> } = {}) {
  const writes: Array<{ table: string; op: string; row?: any }> = [];
  const single: Record<string, any[]> = {};
  const list: Record<string, any[]> = {};
  for (const k in cfg.single ?? {}) single[k] = [...cfg.single![k]];
  for (const k in cfg.list ?? {}) list[k] = [...cfg.list![k]];
  const db = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        in: () => q,
        maybeSingle: () => Promise.resolve((single[table] ?? []).shift() ?? { data: null, error: null }),
        single: () => Promise.resolve((single[table] ?? []).shift() ?? { data: null, error: null }),
        insert: (row: any) => {
          writes.push({ table, op: 'insert', row });
          return Promise.resolve({ error: null });
        },
        update: (row: any) => {
          writes.push({ table, op: 'update', row });
          return q;
        },
        delete: () => {
          writes.push({ table, op: 'delete' });
          return q;
        },
        then: (resolve: (v: any) => unknown) => resolve((list[table] ?? []).shift() ?? { data: [], error: null }),
      };
      return q;
    },
  };
  return { db, writes };
}

const solClient = (titleOwner: () => Promise<string | null>) =>
  ({ network: 'devnet' as const, connection: {} as any, titleOwner: vi.fn(titleOwner), mintTitle: vi.fn() }) as any;

const order = (status: string) => ({ order_id: ORDER, pack_id: PACK, buyer_wallet: BUYER, seller_wallet: SELLER, status, rail: 'solana', payment_rail: 'clude_solana' });
const solTitleRow = { chain: 'solana-devnet', mint_address: MINT };

describe('executeSolanaTitleSale — payment gate + forward path', () => {
  it('refuses to do ANY work on an unpaid order', async () => {
    const { db, writes } = makeDb({ single: { marketplace_orders: [{ data: order('created') }] } });
    await expect(executeSolanaTitleSale(db as any, ORDER)).rejects.toThrow(/not paid/i);
    expect(writes).toHaveLength(0); // no saga created, no DEK touched
  });

  it('a paid PLAINTEXT pack advances created→dek_rewrapped→paid and PAUSES (awaitingTransfer)', async () => {
    const { db } = makeDb({
      single: {
        marketplace_orders: [{ data: order('paid') }],
        title_sale_sagas: [{ data: null }], // no existing saga → create
      },
      list: {
        memory_pack_contents: [{ data: [{ memory_id: 1 }, { memory_id: 2 }] }],
        memory_dek_wraps: [{ data: [] }], // no provider wraps → plaintext, nothing to seal
      },
    });
    const res = await executeSolanaTitleSale(db as any, ORDER);
    expect(res).toEqual({ step: 'paid', awaitingTransfer: true });
  });
});

describe('getSolanaTitleTransferForSeller — no transfer before paid', () => {
  it('refuses to build a transfer unless the saga is at the paid step', async () => {
    const { db } = makeDb({
      single: {
        marketplace_orders: [{ data: order('paid') }],
        title_sale_sagas: [{ data: { step: 'dek_rewrapped' } }], // not yet paid
      },
    });
    await expect(getSolanaTitleTransferForSeller(db as any, solClient(async () => null), ORDER)).rejects.toThrow(/not at the paid step/i);
  });
});

describe('submitSolanaTitleTransfer — security: only the exact transfer is submitted', () => {
  it('refuses a signed tx that is not exactly this 1-of-1 seller→buyer', async () => {
    const { db } = makeDb({
      single: {
        marketplace_orders: [{ data: order('paid') }],
        title_sale_sagas: [{ data: { step: 'paid', order_id: ORDER } }],
        pack_titles: [{ data: solTitleRow }],
      },
    });
    // titleOwner != buyer → the saga proceeds to verify; an undecodable tx fails verification → throw.
    const sol = solClient(async () => SELLER);
    await expect(submitSolanaTitleTransfer(db as any, sol, ORDER, '@@bogus-signed-tx@@')).rejects.toThrow(/not exactly this 1-of-1/i);
  });

  it('is idempotent: if the chain already shows the buyer as owner, it does not re-submit and revokes the seller', async () => {
    const { db, writes } = makeDb({
      single: {
        marketplace_orders: [{ data: order('paid') }],
        title_sale_sagas: [{ data: { step: 'paid', order_id: ORDER } }],
        pack_titles: [{ data: solTitleRow }],
        title_transfers: [{ data: null }], // no prior audit row
        pack_entitlements: [{ data: null }], // buyer has no grant yet → insert
      },
      list: {
        memory_pack_contents: [{ data: [{ memory_id: 1 }] }],
      },
    });
    const sol = solClient(async () => BUYER); // already the owner → idempotent skip of verify+submit
    const res = await submitSolanaTitleTransfer(db as any, sol, ORDER, 'unused');
    expect(res).toEqual({ step: 'revoked', awaitingTransfer: false });
    // seller revoked + buyer granted
    expect(writes.some((w) => w.table === 'memory_dek_wraps' && w.op === 'delete')).toBe(true);
    expect(writes.some((w) => w.table === 'pack_entitlements' && w.op === 'insert' && w.row.holder_wallet === BUYER)).toBe(true);
  });
});

describe('refundSolanaTitleSale — the refund boundary (no refund after the irreversible transfer)', () => {
  it('ALLOWS a refund before the transfer (paid) and marks the saga refunded', async () => {
    const { db, writes } = makeDb({ single: { title_sale_sagas: [{ data: { step: 'paid', order_id: ORDER } }] } });
    const res = await refundSolanaTitleSale(db as any, ORDER);
    expect(res).toEqual({ refundable: true });
    expect(writes.some((w) => w.table === 'title_sale_sagas' && w.op === 'update' && w.row.step === 'refunded')).toBe(true);
  });

  it('with NO saga and NO transfer → refundable (a paid-but-not-yet-sold title order, nothing to abort)', async () => {
    const { db, writes } = makeDb({
      single: { title_sale_sagas: [{ data: null }], marketplace_orders: [{ data: order('paid') }], title_transfers: [{ data: null }] },
    });
    expect(await refundSolanaTitleSale(db as any, ORDER)).toEqual({ refundable: true });
    expect(writes).toHaveLength(0);
  });

  it('REFUSES a refund once transferred → TITLE_FINAL (this is the seller-double-loss guard)', async () => {
    const { db } = makeDb({ single: { title_sale_sagas: [{ data: { step: 'transferred', order_id: ORDER } }] } });
    await expect(refundSolanaTitleSale(db as any, ORDER)).rejects.toMatchObject({ code: 'TITLE_FINAL' });
  });

  it('REFUSES after revoke too → SolanaTitleFinalError', async () => {
    const { db } = makeDb({ single: { title_sale_sagas: [{ data: { step: 'revoked', order_id: ORDER } }] } });
    await expect(refundSolanaTitleSale(db as any, ORDER)).rejects.toBeInstanceOf(SolanaTitleFinalError);
  });

  it('is idempotent on an already-refunded saga (no re-write)', async () => {
    const { db, writes } = makeDb({ single: { title_sale_sagas: [{ data: { step: 'refunded', order_id: ORDER } }] } });
    expect(await refundSolanaTitleSale(db as any, ORDER)).toEqual({ refundable: true });
    expect(writes).toHaveLength(0);
  });

  it('with NO saga row but a title_transfers row for the order → TITLE_FINAL (defence in depth)', async () => {
    const { db } = makeDb({
      single: {
        title_sale_sagas: [{ data: null }],
        marketplace_orders: [{ data: order('settled') }],
        title_transfers: [{ data: { transfer_id: 1 } }],
      },
    });
    await expect(refundSolanaTitleSale(db as any, ORDER)).rejects.toMatchObject({ code: 'TITLE_FINAL' });
  });
});
