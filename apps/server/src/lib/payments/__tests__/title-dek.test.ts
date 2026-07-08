/**
 * title-dek — TITLE-license DEK re-wrap + unlock-by-owner gate (the Base pack-title saga).
 *
 * The Base pack-TITLE trading saga, Phase 1 — rewrap-and-gate
 * (binding corrections M4 / RT7 / RT9 / B2; migration 034 schema).
 *
 * MONEY/ACCESS/DATA CODE. A TITLE sale does NOT clone the pack (unlike a copy sale) — the SAME
 * encrypted memories change hands when the 1-of-1 Base NFT moves. Two primitives pin that:
 *
 *   1. rewrapPackDekToTitleHolder — for EACH member memory of the pack, recover the per-memory
 *      DEK from the provider wrap (unwrapDek) and seal a fresh wrap to the NEW holder's key
 *      (wrapDek), UPSERTing a memory_dek_wraps row recipient='title_holder', holder_wallet=<new
 *      holder>. Exactly one title_holder wrap per memory; the UPSERT ROTATES it on transfer.
 *      ADDITIVE (RT7): it never deletes the prior holder's wrap — that is revokeTitleHolder's job,
 *      called LAST in the saga, so there is never a window where neither party can decrypt.
 *
 *   2. assertTitleUnlock — the unlock gate (B2 / RT9): compute the tokenId, read ownerOf(tokenId)
 *      on Base, and serve the title_holder DEK only if ownerOf === the verified caller address
 *      (case-insensitive EVM compare) AND a title_holder wrap exists for that caller. NEVER a
 *      token-balance check. FAIL CLOSED on an RPC error or a missing token (deny; never fall back
 *      to a cache).
 *
 *   3. revokeTitleHolder — removes ONLY the named former holder's title_holder wraps (the saga's
 *      last, revoke step). A wrap for a different holder is untouched.
 *
 * getDb is NOT used (db is passed in); the envelope (wrapDek/unwrapDek), the provider keypair
 * loader, and EvmTitleClient are all mocked — table-routed in-memory Supabase, same idiom as
 * grant-copy.test.ts / refund-clawback.test.ts. No real DB, no crypto, no live chain.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── memory-envelope: wrapDek seals the per-memory DEK to the new title holder; unwrapDek
//    recovers the provider-held DEK from a source wrap. Deterministic markers we can assert on. ──
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

// ── Provider keypair loader (used to unwrap the provider DEK before re-sealing). ──
vi.mock('@clude/shared/core/encryption-keys', () => ({
  loadProviderKeypair: () => ({ secretKey: new Uint8Array(32), publicKey: new Uint8Array(32) }),
}));

// ── Table-routed Supabase mock ──────────────────────────────────────────────
// Surface used by the three functions:
//   .select(cols).eq(c,v).order()              — pack_contents read (awaited → { data, error })
//   .select(cols).in(c,vals).eq(c,v)           — provider wraps read / title_holder wraps read
//   .upsert(row, {onConflict})                 — title_holder wrap write (awaited → { data, error })
//   .delete().eq(c,v).in(c,vals).eq(c,v)       — former-holder wrap delete (awaited, .select() → rows)
// memory_dek_wraps uniqueness is (memory_id, recipient, holder_wallet) (migration 036): one
// title_holder wrap per (memory, HOLDER), so distinct holders COEXIST. An upsert with onConflict
// 'memory_id,recipient,holder_wallet' overwrites only the SAME holder's row; a new holder is additive.
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const opLog: Array<{ table: string; op: 'upsert' | 'delete'; count: number }> = [];
/** Force the next read on this table to error (fail-closed assertions). Consumed once. */
let failReadOn: { table: string; error: { code?: string; message: string } } | null = null;
/** Force the next upsert on memory_dek_wraps to error. Consumed once. */
let failUpsertWith: { code?: string; message: string } | null = null;

function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  opLog.length = 0;
  failReadOn = null;
  failUpsertWith = null;
}
function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}

type Filter = (row: Row) => boolean;

function makeChain(table: string) {
  const filters: Filter[] = [];
  let pendingUpsert: { rows: Row[]; onConflict: string[] } | null = null;
  let pendingDelete = false;
  let settled = false;

  const matched = (): Row[] => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));

  const exec = (): { data: any; error: any } => {
    if (settled) return { data: null, error: null };
    settled = true;

    if (pendingUpsert) {
      if (failUpsertWith) {
        const err = failUpsertWith;
        failUpsertWith = null;
        return { data: null, error: err };
      }
      const arr = tables[table] ?? (tables[table] = []);
      const written: Row[] = [];
      for (const r of pendingUpsert.rows) {
        // onConflict columns identify the row to overwrite (rotate) if present.
        const keys = pendingUpsert.onConflict;
        const existing = arr.find((x) => keys.every((k) => x[k] === r[k]));
        if (existing) {
          Object.assign(existing, r);
          written.push({ ...existing });
        } else {
          const copy = { ...r };
          arr.push(copy);
          written.push({ ...copy });
        }
      }
      opLog.push({ table, op: 'upsert', count: written.length });
      return { data: written, error: null };
    }

    if (pendingDelete) {
      const arr = tables[table] ?? (tables[table] = []);
      const survivors: Row[] = [];
      const removed: Row[] = [];
      for (const row of arr) (filters.every((f) => f(row)) ? removed : survivors).push(row);
      tables[table] = survivors;
      opLog.push({ table, op: 'delete', count: removed.length });
      return { data: removed.map((r) => ({ ...r })), error: null };
    }

    // Plain read. Honour an injected read failure for this table (consumed once).
    if (failReadOn && failReadOn.table === table) {
      const err = failReadOn.error;
      failReadOn = null;
      return { data: null, error: err };
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
    order: () => chain,
    limit: () => chain,
    upsert: (row: Row | Row[], opts?: { onConflict?: string }) => {
      pendingUpsert = {
        rows: Array.isArray(row) ? row : [row],
        onConflict: (opts?.onConflict ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      };
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

// ── EvmTitleClient mock ─────────────────────────────────────────────────────
// tokenIdFor is local + deterministic. titleOwner reads ownerOf — we drive it per-test:
//   - a checksummed Address  → the on-chain owner
//   - null                   → the title does not exist (gate must deny, RT9)
//   - throw                  → an RPC error (gate must FAIL CLOSED, RT9)
let titleOwnerImpl: (tokenId: bigint) => Promise<string | null> = async () => null;
const TOKEN_ID = 0xabcdef123n;
const evm = {
  contractAddress: '0xf4ED013433bB79B8EC7C76CCAAbeB64A7B62863a',
  tokenIdFor: (_packId: string) => TOKEN_ID,
  titleOwner: (tokenId: bigint) => titleOwnerImpl(tokenId),
  // present for type-shape parity; unused by the gate.
  mintTitle: vi.fn(),
  transferTitle: vi.fn(),
  getBinding: vi.fn(),
  verifyBinding: vi.fn(),
} as any;

import {
  rewrapPackDekToTitleHolder,
  revokeTitleHolder,
  assertTitleUnlock,
} from '../title-dek.js';

const PACK = 'pack-deadbeef';
// Two EVM addresses. Stored holder_wallet uses the checksummed form; the gate compares
// case-insensitively, so an all-lowercase caller must still match (real wallets vary in case).
const HOLDER = '0x1111111111111111111111111111111111111111';
const FORMER = '0x2222222222222222222222222222222222222222';
const HOLDER_PUBKEY = new Uint8Array(Buffer.from('holder-pubkey-bytes'));

/** Seed an encrypted pack: `n` member memories, each with a provider DEK wrap. */
function seedEncryptedPack(n = 3) {
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const id = 1 + i;
    ids.push(id);
    seed('memory_pack_contents', [{ pack_id: PACK, memory_id: id, leaf_index: i, content_hash: `ch${i}` }]);
    seed('memory_dek_wraps', [
      { memory_id: id, recipient: 'provider', wrapped_dek: `provider-wrap-of-dek${i}`, wrap_pubkey: 'pk', holder_wallet: null },
    ]);
  }
  return ids;
}

beforeEach(() => {
  resetDb();
  wrapDekMock.mockClear();
  unwrapDekMock.mockClear();
  titleOwnerImpl = async () => null;
});

describe('rewrapPackDekToTitleHolder — additive re-wrap to the new title holder (RT7, 034)', () => {
  it('writes one title_holder wrap per member memory, naming the holder_wallet', async () => {
    const ids = seedEncryptedPack(3);

    await rewrapPackDekToTitleHolder(db, PACK, HOLDER, HOLDER_PUBKEY);

    const th = (tables.memory_dek_wraps ?? []).filter((w) => w.recipient === 'title_holder');
    expect(th).toHaveLength(3);
    // wrapDek called once per member, to the holder's key.
    expect(wrapDekMock).toHaveBeenCalledTimes(3);
    for (const w of th) {
      expect(ids).toContain(w.memory_id);
      expect(w.holder_wallet).toBe(HOLDER);
      // Sealed to the new holder (mock marker proves wrapDek(dek, holderPubkey)).
      expect(w.wrapped_dek).toBe(`wrapped-for-${Buffer.from(HOLDER_PUBKEY).toString('utf8')}`);
    }
    // The DEK was recovered from each provider wrap (unwrapDek once per member).
    expect(unwrapDekMock).toHaveBeenCalledTimes(3);
  });

  it('is ADDITIVE — it never deletes the prior holder wrap (RT7: revoke is a separate, later step)', async () => {
    seedEncryptedPack(2);
    // A prior holder already has title_holder wraps on these memories.
    seed('memory_dek_wraps', [
      { memory_id: 1, recipient: 'title_holder', wrapped_dek: 'old-1', wrap_pubkey: 'old', holder_wallet: FORMER },
      { memory_id: 2, recipient: 'title_holder', wrapped_dek: 'old-2', wrap_pubkey: 'old', holder_wallet: FORMER },
    ]);

    await rewrapPackDekToTitleHolder(db, PACK, HOLDER, HOLDER_PUBKEY);

    // Migration 036's unique (memory_id, recipient, holder_wallet): the NEW holder's wrap is ADDED
    // ALONGSIDE the prior holder's — both coexist (RT7: never a window where neither can decrypt).
    // The prior (seller) wrap is removed LAST by revokeTitleHolder — never by the re-wrap, which
    // issues no DELETE.
    const th = (tables.memory_dek_wraps ?? []).filter((w) => w.recipient === 'title_holder');
    expect(th).toHaveLength(4); // 2 FORMER (survived) + 2 HOLDER (added)
    expect(th.filter((w) => w.holder_wallet === FORMER)).toHaveLength(2);
    expect(th.filter((w) => w.holder_wallet === HOLDER)).toHaveLength(2);
    expect(opLog.some((o) => o.op === 'delete')).toBe(false);
  });

  it('rotates idempotently — re-running for the same holder leaves exactly one wrap per memory', async () => {
    seedEncryptedPack(2);

    await rewrapPackDekToTitleHolder(db, PACK, HOLDER, HOLDER_PUBKEY);
    await rewrapPackDekToTitleHolder(db, PACK, HOLDER, HOLDER_PUBKEY);

    const th = (tables.memory_dek_wraps ?? []).filter((w) => w.recipient === 'title_holder');
    expect(th).toHaveLength(2);
    for (const w of th) expect(w.holder_wallet).toBe(HOLDER);
  });

  it('throws when the pack has no member memories (cannot re-wrap a phantom pack)', async () => {
    // No memory_pack_contents seeded.
    await expect(rewrapPackDekToTitleHolder(db, PACK, HOLDER, HOLDER_PUBKEY)).rejects.toThrow(/member/i);
  });

  it('throws when a member memory has no provider wrap (cannot recover its DEK to re-seal)', async () => {
    seed('memory_pack_contents', [{ pack_id: PACK, memory_id: 1, leaf_index: 0, content_hash: 'h' }]);
    // No provider wrap for memory 1.
    await expect(rewrapPackDekToTitleHolder(db, PACK, HOLDER, HOLDER_PUBKEY)).rejects.toThrow(/provider wrap/i);
    // Nothing half-written.
    expect((tables.memory_dek_wraps ?? []).filter((w) => w.recipient === 'title_holder')).toHaveLength(0);
  });

  it('throws (recoverable) on a contents-read DB error rather than silently skipping', async () => {
    seedEncryptedPack(1);
    failReadOn = { table: 'memory_pack_contents', error: { code: '53300', message: 'too many connections' } };
    await expect(rewrapPackDekToTitleHolder(db, PACK, HOLDER, HOLDER_PUBKEY)).rejects.toThrow(/contents/i);
  });

  it('throws (recoverable) on a wrap upsert DB error rather than half-rotating', async () => {
    seedEncryptedPack(2);
    failUpsertWith = { code: '53300', message: 'too many connections' };
    await expect(rewrapPackDekToTitleHolder(db, PACK, HOLDER, HOLDER_PUBKEY)).rejects.toThrow(/wrap/i);
  });
});

describe('assertTitleUnlock — ownerOf gate, fail-closed (B2 / RT9)', () => {
  it('ALLOWS when ownerOf === caller AND a title_holder wrap exists for the caller', async () => {
    seedEncryptedPack(1);
    seed('memory_dek_wraps', [
      { memory_id: 1, recipient: 'title_holder', wrapped_dek: 'w', wrap_pubkey: 'p', holder_wallet: HOLDER },
    ]);
    titleOwnerImpl = async () => HOLDER; // on-chain owner is the caller.

    const res = await assertTitleUnlock(db, evm, PACK, HOLDER);
    expect(res.allowed).toBe(true);
  });

  it('ALLOWS on a case-mismatched (lowercase) caller — EVM address compare is case-insensitive', async () => {
    seedEncryptedPack(1);
    // Stored holder_wallet is checksummed; the on-chain owner is checksummed.
    seed('memory_dek_wraps', [
      { memory_id: 1, recipient: 'title_holder', wrapped_dek: 'w', wrap_pubkey: 'p', holder_wallet: HOLDER },
    ]);
    titleOwnerImpl = async () => HOLDER;

    // Caller passes the SAME address all-lowercase (wallets often do). Must still match.
    const res = await assertTitleUnlock(db, evm, PACK, HOLDER.toLowerCase());
    expect(res.allowed).toBe(true);
  });

  it('DENIES (fail-closed) when titleOwner throws — an RPC error must NOT fall back to a cache (RT9)', async () => {
    seedEncryptedPack(1);
    seed('memory_dek_wraps', [
      { memory_id: 1, recipient: 'title_holder', wrapped_dek: 'w', wrap_pubkey: 'p', holder_wallet: HOLDER },
    ]);
    titleOwnerImpl = async () => {
      throw new Error('eth_call timeout');
    };

    const res = await assertTitleUnlock(db, evm, PACK, HOLDER);
    expect(res.allowed).toBe(false);
    expect(res.reason).toMatch(/rpc|chain|owner|read/i);
  });

  it('DENIES when the title does not exist on-chain (titleOwner === null)', async () => {
    seedEncryptedPack(1);
    seed('memory_dek_wraps', [
      { memory_id: 1, recipient: 'title_holder', wrapped_dek: 'w', wrap_pubkey: 'p', holder_wallet: HOLDER },
    ]);
    titleOwnerImpl = async () => null; // token not minted / burned.

    const res = await assertTitleUnlock(db, evm, PACK, HOLDER);
    expect(res.allowed).toBe(false);
  });

  it('DENIES when ownerOf is someone OTHER than the caller (the caller does not hold the title)', async () => {
    seedEncryptedPack(1);
    seed('memory_dek_wraps', [
      { memory_id: 1, recipient: 'title_holder', wrapped_dek: 'w', wrap_pubkey: 'p', holder_wallet: FORMER },
    ]);
    titleOwnerImpl = async () => FORMER; // someone else owns the title on-chain.

    const res = await assertTitleUnlock(db, evm, PACK, HOLDER);
    expect(res.allowed).toBe(false);
  });

  it('DENIES when ownerOf === caller but NO title_holder wrap exists for them (no DEK to serve)', async () => {
    seedEncryptedPack(1);
    // On-chain owner is the caller, but the re-wrap has not run — no title_holder wrap for them.
    titleOwnerImpl = async () => HOLDER;

    const res = await assertTitleUnlock(db, evm, PACK, HOLDER);
    expect(res.allowed).toBe(false);
  });

  it('DENIES (fail-closed) on a wrap-table read error — never default-allow', async () => {
    seedEncryptedPack(1);
    titleOwnerImpl = async () => HOLDER;
    failReadOn = { table: 'memory_dek_wraps', error: { code: '53300', message: 'too many connections' } };

    const res = await assertTitleUnlock(db, evm, PACK, HOLDER);
    expect(res.allowed).toBe(false);
  });

  it('NEVER consults a token balance — denial comes purely from ownerOf + the wrap (B2)', async () => {
    // No balanceOf on the mock at all; if the gate tried one it would throw. ownerOf says the
    // caller is NOT the owner → deny, with no balance fallback rescuing the unlock.
    seedEncryptedPack(1);
    seed('memory_dek_wraps', [
      { memory_id: 1, recipient: 'title_holder', wrapped_dek: 'w', wrap_pubkey: 'p', holder_wallet: HOLDER },
    ]);
    titleOwnerImpl = async () => FORMER; // not the caller.

    const res = await assertTitleUnlock(db, evm, PACK, HOLDER);
    expect(res.allowed).toBe(false);
  });
});

describe('revokeTitleHolder — remove ONLY the named former holder (saga last step)', () => {
  it('deletes the former holder wraps but leaves a wrap that already names a DIFFERENT holder untouched', async () => {
    seedEncryptedPack(2);
    // The 034 PK is (memory_id, recipient): exactly ONE title_holder wrap per memory. Here memory 1
    // still names FORMER (not yet rotated) and memory 2 has ALREADY been rotated to HOLDER. Revoking
    // FORMER must remove ONLY memory 1's wrap — memory 2 (now HOLDER's) is left untouched.
    seed('memory_dek_wraps', [
      { memory_id: 1, recipient: 'title_holder', wrapped_dek: 'old-1', wrap_pubkey: 'o', holder_wallet: FORMER },
      { memory_id: 2, recipient: 'title_holder', wrapped_dek: 'new-2', wrap_pubkey: 'n', holder_wallet: HOLDER },
    ]);

    await revokeTitleHolder(db, PACK, FORMER);

    const th = (tables.memory_dek_wraps ?? []).filter((w) => w.recipient === 'title_holder');
    // Only HOLDER's wrap (memory 2) survives.
    expect(th).toHaveLength(1);
    expect(th[0].holder_wallet).toBe(HOLDER);
    expect(th[0].memory_id).toBe(2);
    // The provider wraps are never touched.
    expect((tables.memory_dek_wraps ?? []).filter((w) => w.recipient === 'provider')).toHaveLength(2);
  });

  it('matches the former holder case-insensitively (EVM addresses vary in case)', async () => {
    seedEncryptedPack(1);
    seed('memory_dek_wraps', [
      { memory_id: 1, recipient: 'title_holder', wrapped_dek: 'old-1', wrap_pubkey: 'o', holder_wallet: FORMER },
    ]);

    // Caller names the former holder all-lowercase; the stored wallet is checksummed.
    await revokeTitleHolder(db, PACK, FORMER.toLowerCase());

    expect((tables.memory_dek_wraps ?? []).filter((w) => w.recipient === 'title_holder')).toHaveLength(0);
  });

  it('is idempotent — a re-run after the wraps are gone deletes nothing and does not throw', async () => {
    seedEncryptedPack(1);
    seed('memory_dek_wraps', [
      { memory_id: 1, recipient: 'title_holder', wrapped_dek: 'old-1', wrap_pubkey: 'o', holder_wallet: FORMER },
    ]);

    await revokeTitleHolder(db, PACK, FORMER);
    await expect(revokeTitleHolder(db, PACK, FORMER)).resolves.toBeUndefined();

    expect((tables.memory_dek_wraps ?? []).filter((w) => w.recipient === 'title_holder')).toHaveLength(0);
  });

  it('throws (recoverable) on a delete DB error rather than reporting a false success', async () => {
    seedEncryptedPack(1);
    seed('memory_dek_wraps', [
      { memory_id: 1, recipient: 'title_holder', wrapped_dek: 'old-1', wrap_pubkey: 'o', holder_wallet: FORMER },
    ]);
    failReadOn = { table: 'memory_pack_contents', error: { code: '53300', message: 'too many connections' } };
    await expect(revokeTitleHolder(db, PACK, FORMER)).rejects.toThrow();
  });
});
