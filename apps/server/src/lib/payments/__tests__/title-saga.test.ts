/**
 * title-saga — the forward-only Base pack-title transfer saga (Tradeable Memory Packs, Slice 2).
 *
 * MONEY / IRREVERSIBLE-ASSET CODE. This suite pins the M4 ordering correction and its binding
 * sub-rules (RT1 / RT3 / RT7 / B2 / RT9) verbatim against the actual EvmTitleClient surface
 * (evm-title-client.ts) + the migration-034 title_holder DEK wrap.
 *
 * TWO entry points under test:
 *
 *   mintTitleForPack(db, evm, packId, toWallet)
 *     - mints the 1-of-1 title bound to the pack's merkle_root + manifest_hash (from pmp_artifacts),
 *     - upserts the pack_titles mirror (status='minted', current_owner=toWallet, token_id, mint_tx),
 *     - IDEMPOTENT: a title that already exists on-chain (titleOwner != null) OR a 'minted' mirror
 *       row → no-op return of the existing title; NEVER a second mint.
 *
 *   executeTitleSale(db, evm, orderId) — the forward-only, RESUMABLE saga, driven by
 *   title_sale_sagas.step, ordered so the IRREVERSIBLE on-chain move is LAST (M4):
 *       created -> dek_rewrapped : additively wrap the pack DEK to the BUYER (title_holder). advance.
 *       -> paid                  : confirm payment (testnet: gate on order.status='paid'). advance.
 *       -> transferred           : EvmTitleClient.transferTitle(seller, buyer) — THE IRREVERSIBLE
 *                                  STEP, LAST. record transfer_tx + a title_transfers row +
 *                                  pack_titles.current_owner=buyer. advance. (refunds now IMPOSSIBLE.)
 *       -> revoked               : revoke the SELLER title_holder wrap + flip seller title_owner
 *                                  entitlement to 'revoked' + grant the buyer title_owner. DONE.
 *   Each step is idempotent (re-running from any step checks chain/DB state before acting) and
 *   persists step + last_error.
 *
 *   refundTitleSale(db, orderId) — asserts step < transferred, else throws TITLE_FINAL (RT3).
 *
 * EvmTitleClient + getDb + the payment + memory-envelope (title DEK) are all mocked — NO live
 * network, NO real crypto, the same table-routed in-memory Supabase idiom as grant-copy.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── memory-envelope (title DEK re-wrap): the saga unwraps the provider wrap and re-seals the DEK
//    to the new holder, exactly as grant-copy does. Deterministic markers; no real X25519. ──
const wrapDekMock = vi.fn((_dek: Uint8Array, recipientPubkey: Uint8Array) => ({
  wrapped: `wrapped-for-${Buffer.from(recipientPubkey).toString('utf8')}`,
  wrapPubkey: 'eph-pub',
}));
const unwrapDekMock = vi.fn((wrapped: string, _wrapPubkey: string, _secret: Uint8Array) => {
  if (wrapped.startsWith('provider-wrap-of-')) {
    return new TextEncoder().encode(wrapped.slice('provider-wrap-of-'.length));
  }
  return null;
});
vi.mock('@clude/shared/core/memory-envelope', () => ({
  wrapDek: (dek: Uint8Array, pub: Uint8Array) => wrapDekMock(dek, pub),
  unwrapDek: (wrapped: string, wrapPubkey: string, secret: Uint8Array) =>
    unwrapDekMock(wrapped, wrapPubkey, secret),
}));

// ── Provider keypair loader (recovers the provider-held DEK on encrypted packs). ──
vi.mock('@clude/shared/core/encryption-keys', () => ({
  loadProviderKeypair: () => ({ secretKey: new Uint8Array(32), publicKey: new Uint8Array(32) }),
}));

// ── Table-routed Supabase mock (insert / select / update / delete; per-op log). ──────────────
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const opLog: Array<{ table: string; op: 'insert' | 'update' | 'delete'; rows: Row[] }> = [];
let nextMemoryId = 5000;
/** Inject a one-shot DB error on the next write to a given table (consumed once). */
let failNextWriteOn: { table: string; error: { code?: string; message: string } } | null = null;

function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  opLog.length = 0;
  nextMemoryId = 5000;
  failNextWriteOn = null;
}
function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}
function opCount(table: string, op: 'insert' | 'update' | 'delete'): number {
  return opLog.filter((o) => o.table === table && o.op === op).length;
}

type Filter = (row: Row) => boolean;

function makeChain(table: string) {
  const filters: Filter[] = [];
  let pendingInsert: Row[] | null = null;
  let pendingUpdate: Row | null = null;
  let pendingDelete = false;
  let settled = false;

  const matched = (): Row[] => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));

  const maybeFail = (): { code?: string; message: string } | null => {
    if (failNextWriteOn && failNextWriteOn.table === table) {
      const e = failNextWriteOn.error;
      failNextWriteOn = null;
      return e;
    }
    return null;
  };

  const exec = (): { data: any; error: any } => {
    if (settled) return { data: null, error: null };
    settled = true;

    if (pendingInsert) {
      const err = maybeFail();
      if (err) return { data: null, error: err };
      const arr = tables[table] ?? (tables[table] = []);
      const written = pendingInsert.map((r) => {
        const withId = table === 'memories' && r.id == null ? { ...r, id: nextMemoryId++ } : { ...r };
        arr.push(withId);
        return withId;
      });
      opLog.push({ table, op: 'insert', rows: written.map((r) => ({ ...r })) });
      return { data: written, error: null };
    }

    if (pendingUpdate) {
      const err = maybeFail();
      if (err) return { data: null, error: err };
      const hits = matched();
      for (const row of hits) Object.assign(row, pendingUpdate);
      opLog.push({ table, op: 'update', rows: hits.map((r) => ({ ...r })) });
      return { data: hits.map((r) => ({ ...r })), error: null };
    }

    if (pendingDelete) {
      const err = maybeFail();
      if (err) return { data: null, error: err };
      const arr = tables[table] ?? (tables[table] = []);
      const survivors: Row[] = [];
      const removed: Row[] = [];
      for (const row of arr) (filters.every((f) => f(row)) ? removed : survivors).push(row);
      tables[table] = survivors;
      opLog.push({ table, op: 'delete', rows: removed.map((r) => ({ ...r })) });
      return { data: removed.map((r) => ({ ...r })), error: null };
    }

    return { data: matched().map((r) => ({ ...r })), error: null };
  };

  const chain: Record<string, any> = {};
  Object.assign(chain, {
    select: (_cols?: string) => chain,
    eq: (col: string, val: any) => {
      filters.push((row) => row[col] === val);
      return chain;
    },
    in: (col: string, vals: any[]) => {
      filters.push((row) => vals.includes(row[col]));
      return chain;
    },
    contains: (col: string, obj: Record<string, any>) => {
      filters.push((row) => {
        const val = row[col];
        if (val == null || typeof val !== 'object') return false;
        return Object.entries(obj).every(([k, v]) => (val as Record<string, any>)[k] === v);
      });
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    insert: (row: Row | Row[]) => {
      pendingInsert = Array.isArray(row) ? row : [row];
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
      const r = exec();
      const arr = Array.isArray(r.data) ? r.data : r.data == null ? [] : [r.data];
      return { data: arr[0] ?? null, error: r.error };
    },
    single: async () => {
      const r = exec();
      const arr = Array.isArray(r.data) ? r.data : r.data == null ? [] : [r.data];
      return { data: arr[0] ?? null, error: r.error };
    },
    then: (resolve: (v: any) => any, reject?: (e: any) => any) =>
      Promise.resolve(exec()).then(resolve, reject),
  });
  return chain;
}

const db = { from: (table: string) => makeChain(table) } as any;

// ── Mock EvmTitleClient — an in-memory ERC-721 the saga drives. ────────────────────────────
// titleOwner reflects the current on-chain owner; mintTitle / transferTitle mutate it and bump
// the call counters so we can prove no double-mint / no double-transfer.
type EvmState = { owner: string | null; tokenId: bigint; binding: any | null };
function makeEvm(initial: Partial<EvmState> = {}) {
  const state: EvmState = {
    owner: initial.owner ?? null,
    tokenId: initial.tokenId ?? 777n,
    binding: initial.binding ?? null,
  };
  const calls = { mint: 0, transfer: 0, owner: 0 };
  /** Inject a one-shot throw on the next transferTitle (a broadcast failure). */
  let throwNextTransfer: Error | null = null;
  const evm = {
    contractAddress: '0xCONTRACT' as any,
    tokenIdFor: (_packId: string) => state.tokenId,
    mintTitle: vi.fn(async (to: string, _packId: string, binding: any) => {
      calls.mint++;
      state.owner = to;
      state.binding = binding;
      return { txHash: `0xmint${calls.mint}` as any, tokenId: state.tokenId };
    }),
    transferTitle: vi.fn(async (from: string, to: string, _tokenId: bigint) => {
      calls.transfer++;
      if (throwNextTransfer) {
        const e = throwNextTransfer;
        throwNextTransfer = null;
        throw e;
      }
      state.owner = to;
      return { txHash: `0xxfer${calls.transfer}` as any };
    }),
    titleOwner: vi.fn(async (_tokenId: bigint) => {
      calls.owner++;
      return state.owner;
    }),
    getBinding: vi.fn(async (_tokenId: bigint) => state.binding),
    verifyBinding: vi.fn(async () => true),
  };
  return {
    evm: evm as any,
    state,
    calls,
    setThrowNextTransfer: (e: Error) => {
      throwNextTransfer = e;
    },
  };
}

import {
  mintTitleForPack,
  executeTitleSale,
  refundTitleSale,
  TITLE_SAGA_STEPS,
  isStepBefore,
} from '../title-saga.js';

const AUTHOR = '0xAuthor000000000000000000000000000000aaaa';
const SELLER = AUTHOR; // creator first sells their own minted title
const BUYER = '0xBuyer1111111111111111111111111111111bbbb';
const PACK = 'pack-deadbeef';
const ORDER_ID = 'ord-title01';
const MERKLE = '0x' + 'aa'.repeat(32);
const MANIFEST = '0x' + 'bb'.repeat(32);

/** Seed a pmp_artifacts row carrying the on-chain binding inputs for the pack. */
function seedArtifact(overrides: Row = {}) {
  seed('pmp_artifacts', [
    {
      artifact_id: 'pmpa-1',
      pack_id: PACK,
      owner_wallet: AUTHOR,
      merkle_root: MERKLE,
      manifest_hash: MANIFEST,
      record_count: 3,
      creator_pubkey: 'ed25519pub',
      license_type: 'title',
      ...overrides,
    },
  ]);
}

/** Seed the memory_packs row + its (encrypted) member memories with provider DEK wraps. */
function seedTitlePack(memberCount = 2, encrypted = true) {
  seed('memory_packs', [{ pack_id: PACK, author_wallet: AUTHOR, name: 'Title Pack', memory_count: memberCount }]);
  for (let i = 0; i < memberCount; i++) {
    const id = 10 + i;
    seed('memory_pack_contents', [{ pack_id: PACK, memory_id: id, leaf_index: i, content_hash: `ch${i}` }]);
    seed('memories', [
      {
        id,
        memory_type: 'semantic',
        content: `enc-${i}`,
        summary: `s${i}`,
        tags: [],
        owner_wallet: AUTHOR,
        encrypted,
        provider_delegated: encrypted,
        created_at: new Date().toISOString(),
      },
    ]);
    if (encrypted) {
      seed('memory_dek_wraps', [
        { memory_id: id, recipient: 'provider', wrapped_dek: `provider-wrap-of-dek${i}`, wrap_pubkey: 'pk', holder_wallet: null },
      ]);
      // Seller currently holds a title_holder wrap (sealed at mint time).
      seed('memory_dek_wraps', [
        { memory_id: id, recipient: 'title_holder', wrapped_dek: `seller-wrap-${i}`, wrap_pubkey: 'pk', holder_wallet: SELLER },
      ]);
    }
  }
}

/** Buyer has published an encryption key (needed for the title_holder re-wrap). */
function seedBuyerKey() {
  seed('encryption_keys', [{ owner_wallet: BUYER, x25519_pubkey: Buffer.from(BUYER).toString('base64'), verifier_ct: 'v' }]);
}

/** A PAID title order, seller=AUTHOR, buyer=BUYER. */
function titleOrder(overrides: Row = {}) {
  return {
    order_id: ORDER_ID,
    pack_id: PACK,
    listing_id: 'lst-title',
    listing_kind: 'title',
    buyer_wallet: BUYER,
    buyer_account_id: null,
    seller_wallet: SELLER,
    rail: 'stripe',
    currency: 'usd',
    amount: '50.00',
    fee_amount: '5.00',
    payout_amount: '45.00',
    status: 'paid',
    rail_ref: 'pi_title',
    rail_tx: null,
    client_token: 'ct-title',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    metadata: {},
    ...overrides,
  };
}

/** Seed the order + an already-minted pack_titles mirror owned by the SELLER. */
function seedSaleFixtures(orderOverrides: Row = {}) {
  seedTitlePack(2, true);
  seedBuyerKey();
  seed('marketplace_orders', [titleOrder(orderOverrides)]);
  seed('pack_titles', [
    {
      pack_id: PACK,
      chain: 'base',
      token_id: '777',
      contract_address: '0xCONTRACT',
      merkle_root: MERKLE,
      manifest_hash: MANIFEST,
      current_owner: SELLER,
      status: 'minted',
      mint_tx: '0xmint1',
    },
  ]);
}

beforeEach(() => {
  resetDb();
  wrapDekMock.mockClear();
  unwrapDekMock.mockClear();
});

// ════════════════════════════════════════════════════════════════════════════
// executeTitleSale — the seller-revoke is PACK-SCOPED (regression: no collateral wipe)
// ════════════════════════════════════════════════════════════════════════════
describe('executeTitleSale — revoke is PACK-SCOPED (no collateral title wipe)', () => {
  it('selling one title does NOT delete the seller title_holder wraps for their OTHER titled packs', async () => {
    seedSaleFixtures(); // pack A (members 10,11) + a PAID order + the SELLER-owned mirror

    // Pack B — a SECOND titled pack the same seller holds (members 20,21). memory_dek_wraps' PK is
    // (memory_id, recipient), so an unscoped delete-by-holder during pack A's sale would silently
    // wipe these and strip the seller's decryption on pack B. They MUST survive.
    seed('memory_pack_contents', [
      { pack_id: 'pack-other222', memory_id: 20, leaf_index: 0, content_hash: 'b0' },
      { pack_id: 'pack-other222', memory_id: 21, leaf_index: 1, content_hash: 'b1' },
    ]);
    seed('memory_dek_wraps', [
      { memory_id: 20, recipient: 'title_holder', wrapped_dek: 'b-seller-0', wrap_pubkey: 'pk', holder_wallet: SELLER },
      { memory_id: 21, recipient: 'title_holder', wrapped_dek: 'b-seller-1', wrap_pubkey: 'pk', holder_wallet: SELLER },
    ]);

    const { evm } = makeEvm({ owner: SELLER }); // the transfer step moves SELLER -> BUYER
    const res = await executeTitleSale(db, evm, ORDER_ID);
    expect(res.step).toBe('revoked');

    // The seller's surviving title_holder wraps are EXACTLY pack B's (20, 21); pack A's (10, 11) revoked.
    const survivors = (tables.memory_dek_wraps ?? [])
      .filter((w) => w.recipient === 'title_holder' && w.holder_wallet === SELLER)
      .map((w) => w.memory_id as number)
      .sort((a, b) => a - b);
    expect(survivors).toEqual([20, 21]);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// mintTitleForPack
// ════════════════════════════════════════════════════════════════════════════
describe('mintTitleForPack — mint the 1-of-1 + mirror, idempotent', () => {
  it('mints the title bound to the pack merkle_root + manifest_hash and upserts the pack_titles mirror', async () => {
    seedArtifact();
    seedTitlePack(2, true);
    const { evm, calls, state } = makeEvm({ owner: null });

    const res = await mintTitleForPack(db, evm, PACK, AUTHOR);

    expect(calls.mint).toBe(1);
    // Minted to the creator, bound to the pack's content commitment.
    expect(evm.mintTitle).toHaveBeenCalledTimes(1);
    const [to, packIdArg, binding] = evm.mintTitle.mock.calls[0];
    expect(to).toBe(AUTHOR);
    expect(packIdArg).toBe(PACK);
    expect(binding.merkleRoot).toBe(MERKLE);
    expect(binding.manifestHash).toBe(MANIFEST);
    expect(binding.memoryCount).toBe(3);
    // Mirror row written: minted, owned by creator, token + tx recorded.
    const titles = tables.pack_titles ?? [];
    expect(titles).toHaveLength(1);
    expect(titles[0]).toMatchObject({ pack_id: PACK, status: 'minted', current_owner: AUTHOR });
    expect(titles[0].token_id).toBe(state.tokenId.toString());
    expect(titles[0].mint_tx).toBe('0xmint1');
    expect(res.tokenId).toBe(state.tokenId);
  });

  it('is idempotent when the title already exists ON-CHAIN (titleOwner != null) — no second mint', async () => {
    seedArtifact();
    seedTitlePack(2, true);
    // Already minted on-chain to AUTHOR (no mirror row yet — mirror is reconstructed/no-op).
    const { evm, calls } = makeEvm({ owner: AUTHOR });

    const res = await mintTitleForPack(db, evm, PACK, AUTHOR);

    expect(calls.mint).toBe(0); // never re-mint a live token
    expect(res.alreadyMinted).toBe(true);
  });

  it('is idempotent when a minted MIRROR row already exists — no chain read needed to no-op', async () => {
    seedArtifact();
    seedTitlePack(2, true);
    seed('pack_titles', [{ pack_id: PACK, status: 'minted', current_owner: AUTHOR, token_id: '777', mint_tx: '0xmint1', merkle_root: MERKLE, manifest_hash: MANIFEST, contract_address: '0xCONTRACT' }]);
    const { evm, calls } = makeEvm({ owner: null });

    const res = await mintTitleForPack(db, evm, PACK, AUTHOR);

    expect(calls.mint).toBe(0);
    expect(res.alreadyMinted).toBe(true);
    expect((tables.pack_titles ?? []).length).toBe(1); // no duplicate mirror
  });

  it('throws when no pmp_artifacts binding exists for the pack (cannot bind a phantom commitment)', async () => {
    seedTitlePack(2, true); // no seedArtifact()
    const { evm, calls } = makeEvm({ owner: null });
    await expect(mintTitleForPack(db, evm, PACK, AUTHOR)).rejects.toThrow(/binding|artifact|merkle/i);
    expect(calls.mint).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// executeTitleSale — full forward progression
// ════════════════════════════════════════════════════════════════════════════
describe('executeTitleSale — advances created → dek_rewrapped → paid → transferred → revoked (M4)', () => {
  it('runs the whole saga to completion: buyer can decrypt before they own it, transfer is LAST, seller revoked last', async () => {
    seedSaleFixtures();
    const { evm, calls, state } = makeEvm({ owner: SELLER });

    const res = await executeTitleSale(db, evm, ORDER_ID);

    expect(res.step).toBe('revoked');
    expect(res.done).toBe(true);

    // STEP 1 (dek_rewrapped): buyer title_holder wrap sealed additively, per member, BEFORE transfer.
    const buyerWraps = (tables.memory_dek_wraps ?? []).filter(
      (w) => w.recipient === 'title_holder' && w.holder_wallet === BUYER,
    );
    expect(buyerWraps).toHaveLength(2);
    expect(wrapDekMock).toHaveBeenCalledTimes(2);

    // STEP 3 (transferred): exactly ONE on-chain transfer, seller → buyer; owner is now the buyer.
    expect(calls.transfer).toBe(1);
    expect(evm.transferTitle).toHaveBeenCalledWith(SELLER, BUYER, state.tokenId);
    expect(state.owner).toBe(BUYER);
    // a title_transfers audit row + the mirror updated to the buyer.
    const xfers = tables.title_transfers ?? [];
    expect(xfers).toHaveLength(1);
    expect(xfers[0]).toMatchObject({ order_id: ORDER_ID, from_wallet: SELLER, to_wallet: BUYER });
    expect((tables.pack_titles ?? [])[0].current_owner).toBe(BUYER);

    // STEP 4 (revoked): seller's title_holder wrap is gone; seller title_owner entitlement revoked;
    // buyer granted title_owner.
    const sellerWraps = (tables.memory_dek_wraps ?? []).filter(
      (w) => w.recipient === 'title_holder' && w.holder_wallet === SELLER,
    );
    expect(sellerWraps).toHaveLength(0);
    const ents = tables.pack_entitlements ?? [];
    const buyerGrant = ents.find((e) => e.holder_wallet === BUYER && e.grant_kind === 'title_owner');
    expect(buyerGrant?.status).toBe('active');
    const sellerGrant = ents.find((e) => e.holder_wallet === SELLER && e.grant_kind === 'title_owner');
    // seller grant only exists if it was seeded; here none was, so the assertion is conditional.
    if (sellerGrant) expect(sellerGrant.status).toBe('revoked');

    // The saga row reflects completion.
    const saga = (tables.title_sale_sagas ?? [])[0];
    expect(saga.step).toBe('revoked');
  });

  it('ORDERING (M4): the rewrap + the paid-confirm both happen BEFORE the irreversible transfer', async () => {
    seedSaleFixtures();
    const { evm } = makeEvm({ owner: SELLER });

    // Spy ordering: capture the sequence of meaningful effects.
    const sequence: string[] = [];
    wrapDekMock.mockImplementation((_d: Uint8Array, pub: Uint8Array) => {
      sequence.push('rewrap');
      return { wrapped: `wrapped-for-${Buffer.from(pub).toString('utf8')}`, wrapPubkey: 'eph-pub' };
    });
    evm.transferTitle.mockImplementation(async (from: string, to: string) => {
      sequence.push('transfer');
      return { txHash: '0xxfer1' as any };
    });

    await executeTitleSale(db, evm, ORDER_ID);

    // Every rewrap precedes the single transfer.
    const firstTransfer = sequence.indexOf('transfer');
    const lastRewrap = sequence.lastIndexOf('rewrap');
    expect(firstTransfer).toBeGreaterThan(-1);
    expect(lastRewrap).toBeGreaterThan(-1);
    expect(lastRewrap).toBeLessThan(firstTransfer);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// executeTitleSale — idempotent / resumable from each step
// ════════════════════════════════════════════════════════════════════════════
describe('executeTitleSale — resumable + idempotent from any step (no double-mint, no double-transfer)', () => {
  it('re-running a COMPLETED saga is a clean no-op (no second transfer, no extra wraps/grants)', async () => {
    seedSaleFixtures();
    const { evm, calls } = makeEvm({ owner: SELLER });

    await executeTitleSale(db, evm, ORDER_ID); // first run completes
    const wrapCountAfter1 = (tables.memory_dek_wraps ?? []).length;
    const entCountAfter1 = (tables.pack_entitlements ?? []).length;

    await executeTitleSale(db, evm, ORDER_ID); // resume on an already-done saga

    expect(calls.transfer).toBe(1); // the irreversible step happened EXACTLY once
    expect((tables.memory_dek_wraps ?? []).length).toBe(wrapCountAfter1);
    expect((tables.pack_entitlements ?? []).length).toBe(entCountAfter1);
  });

  it('resuming at step=paid (rewrap already done) does NOT re-wrap and proceeds to transfer + revoke', async () => {
    seedSaleFixtures();
    // Buyer wraps already present (step 1 done); saga persisted at 'paid'.
    for (const id of [10, 11]) {
      seed('memory_dek_wraps', [{ memory_id: id, recipient: 'title_holder', wrapped_dek: `wrapped-for-${BUYER}`, wrap_pubkey: 'eph-pub', holder_wallet: BUYER }]);
    }
    seed('title_sale_sagas', [{ order_id: ORDER_ID, pack_id: PACK, token_id: '777', from_wallet: SELLER, to_wallet: BUYER, step: 'paid', last_error: null }]);
    const { evm, calls } = makeEvm({ owner: SELLER });

    const res = await executeTitleSale(db, evm, ORDER_ID);

    expect(wrapDekMock).not.toHaveBeenCalled(); // rewrap NOT repeated
    expect(calls.transfer).toBe(1);
    expect(res.step).toBe('revoked');
    // still exactly 2 buyer wraps (no duplicates).
    expect((tables.memory_dek_wraps ?? []).filter((w) => w.holder_wallet === BUYER)).toHaveLength(2);
  });

  it('resuming at step=transferred (chain already shows buyer as owner) does NOT transfer again — just revokes', async () => {
    seedSaleFixtures();
    for (const id of [10, 11]) {
      seed('memory_dek_wraps', [{ memory_id: id, recipient: 'title_holder', wrapped_dek: `wrapped-for-${BUYER}`, wrap_pubkey: 'eph-pub', holder_wallet: BUYER }]);
    }
    seed('title_sale_sagas', [{ order_id: ORDER_ID, pack_id: PACK, token_id: '777', from_wallet: SELLER, to_wallet: BUYER, step: 'transferred', last_error: null }]);
    seed('title_transfers', [{ order_id: ORDER_ID, token_id: '777', from_wallet: SELLER, to_wallet: BUYER, transfer_tx: '0xxfer1' }]);
    // Chain already reflects the completed transfer.
    const { evm, calls } = makeEvm({ owner: BUYER });

    const res = await executeTitleSale(db, evm, ORDER_ID);

    expect(calls.transfer).toBe(0); // NEVER re-broadcast an already-mined transfer
    expect(res.step).toBe('revoked');
    const sellerWraps = (tables.memory_dek_wraps ?? []).filter((w) => w.recipient === 'title_holder' && w.holder_wallet === SELLER);
    expect(sellerWraps).toHaveLength(0);
  });

  it('IDEMPOTENT transfer: even with the saga persisted at "paid", if the chain ALREADY shows the buyer owns it, the on-chain transfer is skipped (crash-after-broadcast resume)', async () => {
    seedSaleFixtures();
    for (const id of [10, 11]) {
      seed('memory_dek_wraps', [{ memory_id: id, recipient: 'title_holder', wrapped_dek: `wrapped-for-${BUYER}`, wrap_pubkey: 'eph-pub', holder_wallet: BUYER }]);
    }
    seed('title_sale_sagas', [{ order_id: ORDER_ID, pack_id: PACK, token_id: '777', from_wallet: SELLER, to_wallet: BUYER, step: 'paid', last_error: null }]);
    // The previous run broadcast + the tx mined, but crashed before persisting 'transferred'.
    const { evm, calls } = makeEvm({ owner: BUYER });

    const res = await executeTitleSale(db, evm, ORDER_ID);

    expect(calls.transfer).toBe(0); // ownerOf==buyer pre-check skips the re-broadcast (M4/RT1)
    expect(res.step).toBe('revoked');
    expect((tables.pack_titles ?? [])[0].current_owner).toBe(BUYER);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// executeTitleSale — failure leaves the saga resumable (not lost)
// ════════════════════════════════════════════════════════════════════════════
describe('executeTitleSale — a failure is recorded + the saga stays resumable', () => {
  it('a transfer broadcast failure throws, records last_error, leaves step < transferred, and does NOT revoke the seller', async () => {
    seedSaleFixtures();
    const { evm, state } = makeEvm({ owner: SELLER });
    // One-shot broadcast failure (mockRejectedValueOnce overrides the impl, so assert on the
    // vi.fn call count — which counts the rejected attempt too — not the internal owner-mutation).
    evm.transferTitle.mockRejectedValueOnce(new Error('RPC 429: rate limited'));

    await expect(executeTitleSale(db, evm, ORDER_ID)).rejects.toThrow(/429|transfer/i);

    // The saga did not advance past paid; the transfer did not land; the seller is NOT revoked.
    const saga = (tables.title_sale_sagas ?? [])[0];
    expect(saga).toBeDefined();
    expect(isStepBefore(saga.step, 'transferred')).toBe(true);
    expect(saga.last_error).toMatch(/429|rate limited/i);
    expect(state.owner).toBe(SELLER); // never transferred
    // Seller wrap intact (RT7: never revoke before transfer succeeds).
    const sellerWraps = (tables.memory_dek_wraps ?? []).filter((w) => w.recipient === 'title_holder' && w.holder_wallet === SELLER);
    expect(sellerWraps).toHaveLength(2);

    // RESUMABLE: a later sweep (transfer now succeeds) completes the saga.
    const res2 = await executeTitleSale(db, evm, ORDER_ID);
    expect(evm.transferTitle).toHaveBeenCalledTimes(2); // first failed throw + second success
    expect(res2.step).toBe('revoked');
    expect(state.owner).toBe(BUYER);
  });

  it('refuses to run when the order is not yet paid (testnet payment gate) and leaves the chain untouched', async () => {
    seedSaleFixtures({ status: 'awaiting_payment' });
    const { evm, calls } = makeEvm({ owner: SELLER });

    await expect(executeTitleSale(db, evm, ORDER_ID)).rejects.toThrow(/paid|payment/i);
    expect(calls.transfer).toBe(0);
    expect(wrapDekMock).not.toHaveBeenCalled();
  });

  it('RT7: never opens a window where NEITHER party can decrypt — the seller wrap is removed only AFTER the buyer wrap exists', async () => {
    seedSaleFixtures();
    const { evm } = makeEvm({ owner: SELLER });

    await executeTitleSale(db, evm, ORDER_ID);

    // At completion: buyer has wraps, seller does not. Crucially the buyer wrap insert (step 1)
    // ordered strictly before the seller wrap delete (step 4).
    const insertWrapAt = opLog.findIndex(
      (o) => o.table === 'memory_dek_wraps' && o.op === 'insert' && o.rows.some((r) => r.holder_wallet === BUYER),
    );
    const deleteSellerWrapAt = opLog.findIndex(
      (o) => o.table === 'memory_dek_wraps' && o.op === 'delete',
    );
    expect(insertWrapAt).toBeGreaterThan(-1);
    expect(deleteSellerWrapAt).toBeGreaterThan(-1);
    expect(insertWrapAt).toBeLessThan(deleteSellerWrapAt);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// refundTitleSale — refundable before transfer, IMPOSSIBLE after (RT3)
// ════════════════════════════════════════════════════════════════════════════
describe('refundTitleSale — RT3: refundable before transfer, TITLE_FINAL after the on-chain move', () => {
  it('allows a refund while step < transferred (created / dek_rewrapped / paid)', async () => {
    for (const step of ['created', 'dek_rewrapped', 'paid'] as const) {
      resetDb();
      seed('title_sale_sagas', [{ order_id: ORDER_ID, pack_id: PACK, token_id: '777', from_wallet: SELLER, to_wallet: BUYER, step, last_error: null }]);
      seed('marketplace_orders', [titleOrder({ status: 'paid' })]);

      const res = await refundTitleSale(db, ORDER_ID);
      expect(res.refundable).toBe(true);
      // The saga is marked refunded/aborted so it can never resume into a transfer.
      const saga = (tables.title_sale_sagas ?? [])[0];
      expect(saga.step).toBe('refunded');
    }
  });

  it('THROWS TITLE_FINAL once step === transferred (the buyer NFT cannot be clawed back)', async () => {
    seed('title_sale_sagas', [{ order_id: ORDER_ID, pack_id: PACK, token_id: '777', from_wallet: SELLER, to_wallet: BUYER, step: 'transferred', last_error: null }]);
    seed('marketplace_orders', [titleOrder({ status: 'delivering' })]);

    await expect(refundTitleSale(db, ORDER_ID)).rejects.toThrow(/TITLE_FINAL/);
  });

  it('THROWS TITLE_FINAL once step === revoked (sale fully final)', async () => {
    seed('title_sale_sagas', [{ order_id: ORDER_ID, pack_id: PACK, token_id: '777', from_wallet: SELLER, to_wallet: BUYER, step: 'revoked', last_error: null }]);
    await expect(refundTitleSale(db, ORDER_ID)).rejects.toThrow(/TITLE_FINAL/);
  });

  it('throws TITLE_FINAL when the saga row is missing but the chain shows the title already moved (defence in depth)', async () => {
    // No saga row, but a title_transfers audit row proves the irreversible move happened.
    seed('title_transfers', [{ order_id: ORDER_ID, token_id: '777', from_wallet: SELLER, to_wallet: BUYER, transfer_tx: '0xxfer1' }]);
    await expect(refundTitleSale(db, ORDER_ID)).rejects.toThrow(/TITLE_FINAL/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// step ordering helpers
// ════════════════════════════════════════════════════════════════════════════
describe('TITLE_SAGA_STEPS ordering', () => {
  it('is the forward-only M4 order with the irreversible transfer 4th of 5', () => {
    expect(TITLE_SAGA_STEPS).toEqual(['created', 'dek_rewrapped', 'paid', 'transferred', 'revoked']);
  });
  it('isStepBefore is a strict total order', () => {
    expect(isStepBefore('paid', 'transferred')).toBe(true);
    expect(isStepBefore('transferred', 'paid')).toBe(false);
    expect(isStepBefore('transferred', 'transferred')).toBe(false);
    expect(isStepBefore('created', 'revoked')).toBe(true);
  });
});
