/**
 * grantCopy — COPY-license delivery (clone pack member memories into the buyer's
 * namespace + active entitlement). The deliver(order) callback the durable
 * delivery-dispatcher injects.
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 2), Task 1 (spec §1.2 Flow A step 8,
 * §2 pack_entitlements, §00 B2 + M10).
 *
 * MONEY/DATA CODE. This suite pins the delivery contract:
 *
 *   1. CLONE-COUNT. Every member memory of the pack is cloned exactly once into the
 *      buyer's namespace (owner_wallet = order.buyer_wallet), tagged
 *      imported_from_pack:<pack_id> (so a refund clawback can find + delete them, §00 M10).
 *      The creator's own rows are NEVER mutated.
 *
 *   2. ENTITLEMENT. A pack_entitlements row is inserted with grant_kind='copy_license',
 *      status='active', holder_wallet=buyer, order_id bound. This is the SINGLE off-chain
 *      authority the copy unlock honours — never a chain/token-balance check (§00 B2).
 *
 *   3. IDEMPOTENT. Re-running grantCopy for the same order (worker crash-resume) does NOT
 *      double-clone and does NOT insert a second entitlement. An already-active
 *      copy_license grant for (pack_id, buyer) short-circuits the whole delivery.
 *
 *   4. ENCRYPTED PACK. If the pack's member memories carry provider DEK wraps, grantCopy
 *      seals a fresh buyer DEK wrap per cloned memory (wrapDek), so the buyer can decrypt
 *      their own copy. A plaintext pack writes no wraps.
 *
 * getDb + memory-envelope are mocked (table-routed in-memory Supabase, same idiom as
 * delivery-dispatcher.test.ts / order-orchestrator.test.ts). No real DB, no crypto.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── memory-envelope: wrapDek is the only primitive grantCopy needs (seal the per-memory
//    DEK to the buyer). unwrapDek recovers the provider-held DEK from a source wrap. We mock
//    both so no real X25519 runs; wrapDek returns a deterministic marker we can assert on. ──
const wrapDekMock = vi.fn((_dek: Uint8Array, recipientPubkey: Uint8Array) => ({
  wrapped: `wrapped-for-${Buffer.from(recipientPubkey).toString('utf8')}`,
  wrapPubkey: 'eph-pub',
}));
const unwrapDekMock = vi.fn((wrapped: string, _wrapPubkey: string, _secret: Uint8Array) => {
  // The provider wrap encodes the DEK bytes after a known prefix; recover them.
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

// ── Provider keypair loader (used to unwrap the provider DEK on encrypted packs). ──
vi.mock('@clude/shared/core/encryption-keys', () => ({
  loadProviderKeypair: () => ({ secretKey: new Uint8Array(32), publicKey: new Uint8Array(32) }),
}));

// ── Table-routed Supabase mock ──────────────────────────────────────────────
// Supports the exact surface grantCopy uses:
//   .select(cols).eq(c,v).eq(c,v).maybeSingle()        — entitlement idempotency lookup
//   .select(cols).eq(c,v)…  (awaited)                  — pack_contents / dek_wraps reads
//   .select(cols).in(c,vals)… (awaited)                — member memories / member wraps reads
//   .insert(row).select(cols).single()                 — clone insert, returns assigned id
//   .insert(row|rows)  (awaited)                        — entitlement / wrap inserts
// memories.id is auto-assigned (BIGSERIAL) on insert. pack_entitlements enforces
// UNIQUE(pack_id, holder_wallet, grant_kind) → a duplicate insert returns Postgres 23505.
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const insertCalls: Array<{ table: string; rows: Row[] }> = [];
let nextMemoryId = 1000;
/** Next pack_entitlements insert returns this generic (non-23505) error, consumed once. */
let failEntitlementInsertWith: { code?: string; message: string } | null = null;
/**
 * Simulate a concurrent sweep: just before grantCopy's own pack_entitlements insert lands, push a
 * matching (pack, holder, copy_license) row so the real UNIQUE check fires 23505. Consumed once.
 */
let insertConcurrentEntitlementBeforeInsert = false;

function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  insertCalls.length = 0;
  nextMemoryId = 1000;
  failEntitlementInsertWith = null;
  insertConcurrentEntitlementBeforeInsert = false;
}
function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}

type Filter = (row: Row) => boolean;

function makeChain(table: string) {
  const filters: Filter[] = [];
  let pendingInsert: Row[] | null = null;
  let settled = false;

  const matched = (): Row[] => (tables[table] ?? []).filter((row) => filters.every((f) => f(row)));

  const settleInsert = (): { data: any; error: any } => {
    const rows = pendingInsert!;
    const arr = tables[table] ?? (tables[table] = []);
    if (table === 'pack_entitlements') {
      // Injected generic (non-23505) entitlement-insert failure, consumed once.
      if (failEntitlementInsertWith) {
        const err = failEntitlementInsertWith;
        failEntitlementInsertWith = null;
        return { data: null, error: err };
      }
      // Injected concurrent sweep: land a matching grant FIRST so our insert collides on the UNIQUE.
      if (insertConcurrentEntitlementBeforeInsert) {
        insertConcurrentEntitlementBeforeInsert = false;
        for (const row of rows) {
          arr.push({
            pack_id: row.pack_id,
            holder_wallet: row.holder_wallet,
            grant_kind: row.grant_kind,
            status: 'active',
            order_id: 'ord-concurrent-sweep',
          });
        }
      }
    }
    // UNIQUE(pack_id, holder_wallet, grant_kind) on pack_entitlements.
    if (table === 'pack_entitlements') {
      for (const row of rows) {
        if (
          arr.some(
            (x) =>
              x.pack_id === row.pack_id &&
              x.holder_wallet === row.holder_wallet &&
              x.grant_kind === row.grant_kind,
          )
        ) {
          return {
            data: null,
            error: { code: '23505', message: 'duplicate key value violates uq pack_entitlements' },
          };
        }
      }
    }
    const written = rows.map((r) => {
      // memories.id is BIGSERIAL — auto-assign on insert so clones get distinct ids.
      const withId = table === 'memories' && r.id == null ? { ...r, id: nextMemoryId++ } : { ...r };
      arr.push(withId);
      return withId;
    });
    insertCalls.push({ table, rows: written.map((r) => ({ ...r })) });
    return { data: written, error: null };
  };

  const exec = (): { data: any; error: any } => {
    if (settled) return { data: null, error: null };
    settled = true;
    if (pendingInsert) return settleInsert();
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
    // JSONB containment: .contains('metadata', { imported_from_pack: pack }) — every key in
    // `obj` must be present + equal in the row's column value.
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

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({ from: (table: string) => makeChain(table) }),
}));

import { grantCopy } from '../grant-copy.js';
import type { OrderRow } from '../order-orchestrator.js';

const AUTHOR = 'AuThoRwallet11111111111111111111111111111';
const BUYER = 'BuYeRwallet2222222222222222222222222222222';
const SELLER = AUTHOR; // creator sells their own pack
const PACK = 'pack-deadbeef';

/** A delivering copy order for PACK, bought by BUYER. */
function order(overrides: Partial<OrderRow> = {}): OrderRow {
  return {
    order_id: 'ord-aabbccdd',
    pack_id: PACK,
    listing_id: 'lst-1234',
    listing_kind: 'copy',
    buyer_wallet: BUYER,
    buyer_account_id: null,
    seller_wallet: SELLER,
    rail: 'stripe',
    currency: 'usd',
    amount: '9.99',
    fee_amount: '0',
    payout_amount: '0',
    status: 'delivering',
    rail_ref: 'pi_1',
    rail_tx: null,
    client_token: 'ct-1',
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    metadata: {},
    ...overrides,
  };
}

/** Seed a plaintext pack: author owns 3 member memories committed to the pack. */
function seedPlaintextPack(memberCount = 3) {
  seed('memory_packs', [
    { pack_id: PACK, author_wallet: AUTHOR, name: 'Knowledge Pack', memory_count: memberCount },
  ]);
  const memberIds: number[] = [];
  for (let i = 0; i < memberCount; i++) {
    const id = 1 + i;
    memberIds.push(id);
    seed('memory_pack_contents', [
      { pack_id: PACK, memory_id: id, leaf_index: i, content_hash: `ch${i}` },
    ]);
    seed('memories', [
      {
        id,
        memory_type: 'semantic',
        content: `member ${i} content`,
        summary: `member ${i}`,
        tags: [`topic${i}`],
        concepts: [],
        importance: 0.6,
        source: 'desktop',
        owner_wallet: AUTHOR,
        encrypted: false,
        created_at: new Date().toISOString(),
      },
    ]);
  }
  return memberIds;
}

beforeEach(() => {
  resetDb();
  wrapDekMock.mockClear();
  unwrapDekMock.mockClear();
});

describe('grantCopy — clone count + entitlement (Flow A step 8, §2)', () => {
  it('clones every member memory into the buyer namespace, tagged imported_from_pack', async () => {
    seedPlaintextPack(3);

    await grantCopy(order());

    // 3 new memory rows, all owned by the BUYER (clones), the 3 originals owned by AUTHOR.
    const buyerMems = tables.memories!.filter((m) => m.owner_wallet === BUYER);
    expect(buyerMems).toHaveLength(3);
    // Originals are untouched.
    expect(tables.memories!.filter((m) => m.owner_wallet === AUTHOR)).toHaveLength(3);
    // Every clone carries the provenance tag for clawback.
    for (const m of buyerMems) {
      expect(m.tags).toContain(`imported_from_pack:${PACK}`);
      expect(m.metadata?.imported_from_pack).toBe(PACK);
    }
    // Clone content matches the source content (a real copy, not a stub).
    const contents = buyerMems.map((m) => m.content).sort();
    expect(contents).toEqual(['member 0 content', 'member 1 content', 'member 2 content']);
  });

  it('inserts an active copy_license entitlement bound to the order', async () => {
    seedPlaintextPack(2);

    await grantCopy(order());

    const ents = tables.pack_entitlements ?? [];
    expect(ents).toHaveLength(1);
    expect(ents[0]).toMatchObject({
      pack_id: PACK,
      holder_wallet: BUYER,
      grant_kind: 'copy_license',
      status: 'active',
      order_id: 'ord-aabbccdd',
    });
  });

  it('throws if the order carries no buyer_wallet (a copy must land in a named namespace)', async () => {
    seedPlaintextPack(1);
    await expect(grantCopy(order({ buyer_wallet: null }))).rejects.toThrow(/buyer/i);
  });
});

describe('grantCopy — idempotent (worker crash-resume)', () => {
  it('re-running for the same order does NOT double-clone and does NOT add a 2nd entitlement', async () => {
    seedPlaintextPack(3);

    await grantCopy(order());
    await grantCopy(order()); // crash-resume: the dispatcher may call deliver() again.

    // Still exactly 3 clones (6 total rows: 3 author + 3 buyer), and one entitlement.
    expect(tables.memories!.filter((m) => m.owner_wallet === BUYER)).toHaveLength(3);
    expect(tables.pack_entitlements ?? []).toHaveLength(1);
  });

  it('short-circuits when an active copy_license entitlement already exists (no clone at all)', async () => {
    seedPlaintextPack(3);
    // Pre-existing active grant for this (pack, buyer): a prior successful delivery.
    seed('pack_entitlements', [
      {
        pack_id: PACK,
        holder_wallet: BUYER,
        grant_kind: 'copy_license',
        status: 'active',
        order_id: 'ord-earlier',
      },
    ]);

    await grantCopy(order());

    // No new clones were written, entitlement count unchanged.
    expect(tables.memories!.filter((m) => m.owner_wallet === BUYER)).toHaveLength(0);
    expect(tables.pack_entitlements!).toHaveLength(1);
    expect(insertCalls.some((c) => c.table === 'memories')).toBe(false);
  });

  it('UNIQUE backstop: a concurrent sweep that inserts the entitlement between our pre-check and insert → 23505 is an idempotent no-op (not an error)', async () => {
    seedPlaintextPack(3);
    // The active-entitlement pre-check MISSES (no row yet), so grantCopy proceeds to clone. But a
    // concurrent sweep inserts the (pack, buyer, copy_license) grant just before our own entitlement
    // insert — the DB UNIQUE(pack_id, holder_wallet, grant_kind) raises 23505. grantCopy must treat
    // that as the idempotent no-op it is (the other sweep's delivery won), NOT surface an error.
    insertConcurrentEntitlementBeforeInsert = true;

    await expect(grantCopy(order())).resolves.toBeUndefined();

    // Exactly ONE entitlement exists (the concurrent sweep's) — our insert collided and did not add a
    // second. The grant is active; the buyer is entitled exactly once.
    const ents = tables.pack_entitlements ?? [];
    expect(ents).toHaveLength(1);
    expect(ents[0].grant_kind).toBe('copy_license');
    expect(ents[0].status).toBe('active');
  });

  it('a generic (non-23505) entitlement insert failure throws so the dispatcher leaves the order recoverable', async () => {
    seedPlaintextPack(2);
    // The final entitlement insert fails with an opaque DB error (not the idempotency conflict).
    // grantCopy must throw → the dispatcher leaves the order at 'delivering' (recoverable) and a
    // later sweep retries. (grantCopy is idempotent, so the retry is safe.)
    failEntitlementInsertWith = { code: '53300', message: 'too many connections' };
    await expect(grantCopy(order())).rejects.toThrow(/insert entitlement/i);
  });
});

describe('grantCopy — fail-closed guards (never half-deliver)', () => {
  it('throws when the pack is not found (cannot deliver a phantom pack)', async () => {
    // No memory_packs row seeded → the pack lookup misses.
    seed('memory_pack_contents', [{ pack_id: PACK, memory_id: 1, leaf_index: 0, content_hash: 'h0' }]);
    await expect(grantCopy(order())).rejects.toThrow(/not found/i);
    // No entitlement, no clones written on a failed delivery.
    expect(tables.pack_entitlements ?? []).toHaveLength(0);
  });

  it('throws when the pack has NO member memories (an empty pack is undeliverable, not a silent success)', async () => {
    seed('memory_packs', [{ pack_id: PACK, author_wallet: AUTHOR, name: 'Empty', memory_count: 0 }]);
    // memory_pack_contents intentionally empty.
    await expect(grantCopy(order())).rejects.toThrow(/no member memories/i);
    expect(tables.pack_entitlements ?? []).toHaveLength(0);
  });

  it('refuses to deliver when member memories are NOT owned by the pack author (tampered contents row)', async () => {
    // Defence in depth: a tampered memory_pack_contents points at a memory owned by SOMEONE ELSE.
    // The author-scoped hydrate (.eq("owner_wallet", author)) drops it → no owner-verified members
    // → grantCopy refuses rather than pulling another tenant's memory into the buyer's brain.
    seed('memory_packs', [{ pack_id: PACK, author_wallet: AUTHOR, name: 'Tampered', memory_count: 1 }]);
    seed('memory_pack_contents', [{ pack_id: PACK, memory_id: 99, leaf_index: 0, content_hash: 'h' }]);
    seed('memories', [
      { id: 99, memory_type: 'semantic', content: 'someone elses', summary: 's', tags: [], concepts: [], owner_wallet: 'NotTheAuthor', encrypted: false, created_at: new Date().toISOString() },
    ]);
    await expect(grantCopy(order())).rejects.toThrow(/not owned by author/i);
    expect(tables.memories!.filter((m) => m.owner_wallet === BUYER)).toHaveLength(0);
    expect(tables.pack_entitlements ?? []).toHaveLength(0);
  });

  it('an ENCRYPTED pack whose buyer has NOT published an encryption key fails closed (no key → no half-sealed copy)', async () => {
    // Encrypted member (carries a provider DEK wrap) but NO encryption_keys row for the buyer.
    // grantCopy must throw (the order stays recoverable) rather than clone ciphertext the buyer can
    // never decrypt or — worse — leave a half-sealed copy.
    seed('memory_packs', [{ pack_id: PACK, author_wallet: AUTHOR, name: 'Encrypted', memory_count: 1 }]);
    seed('memory_pack_contents', [{ pack_id: PACK, memory_id: 1, leaf_index: 0, content_hash: 'h0' }]);
    seed('memories', [
      { id: 1, memory_type: 'semantic', content: 'enc', summary: 's', tags: [], concepts: [], owner_wallet: AUTHOR, encrypted: true, provider_delegated: true, created_at: new Date().toISOString() },
    ]);
    seed('memory_dek_wraps', [
      { memory_id: 1, recipient: 'provider', wrapped_dek: 'provider-wrap-of-dek0', wrap_pubkey: 'pk' },
    ]);
    // No encryption_keys row for BUYER.

    await expect(grantCopy(order())).rejects.toThrow(/no published encryption key/i);
    // No entitlement minted, no buyer DEK wrap written.
    expect(tables.pack_entitlements ?? []).toHaveLength(0);
    expect((tables.memory_dek_wraps ?? []).filter((w) => w.recipient === 'owner')).toHaveLength(0);
  });
});

describe('grantCopy — encrypted pack (per-memory buyer DEK wrap)', () => {
  it('seals a fresh buyer DEK wrap per cloned memory when the pack is encrypted', async () => {
    // Encrypted pack: 2 members, each with a provider DEK wrap; buyer has a published key.
    seed('memory_packs', [
      { pack_id: PACK, author_wallet: AUTHOR, name: 'Encrypted Pack', memory_count: 2 },
    ]);
    seed('encryption_keys', [
      { owner_wallet: BUYER, x25519_pubkey: Buffer.from(BUYER).toString('base64'), verifier_ct: 'v' },
    ]);
    for (let i = 0; i < 2; i++) {
      const id = 1 + i;
      seed('memory_pack_contents', [
        { pack_id: PACK, memory_id: id, leaf_index: i, content_hash: `ch${i}` },
      ]);
      seed('memories', [
        {
          id,
          memory_type: 'semantic',
          content: `enc-ciphertext-${i}`,
          summary: `s${i}`,
          tags: [],
          concepts: [],
          importance: 0.5,
          source: 'desktop',
          owner_wallet: AUTHOR,
          encrypted: true,
          provider_delegated: true,
          created_at: new Date().toISOString(),
        },
      ]);
      // Provider wrap of the per-memory DEK (mock unwrapDek decodes the suffix as DEK bytes).
      seed('memory_dek_wraps', [
        { memory_id: id, recipient: 'provider', wrapped_dek: `provider-wrap-of-dek${i}`, wrap_pubkey: 'pk' },
      ]);
    }

    await grantCopy(order());

    // 2 clones for the buyer.
    const buyerMems = tables.memories!.filter((m) => m.owner_wallet === BUYER);
    expect(buyerMems).toHaveLength(2);
    // A buyer (owner) DEK wrap was written per clone — wrapDek called once per member, to the buyer.
    expect(wrapDekMock).toHaveBeenCalledTimes(2);
    const wraps = (tables.memory_dek_wraps ?? []).filter((w) => w.recipient === 'owner');
    expect(wraps).toHaveLength(2);
    // Each new wrap is keyed to one of the buyer's CLONE ids (not the source ids).
    const cloneIds = new Set(buyerMems.map((m) => m.id));
    for (const w of wraps) {
      expect(cloneIds.has(w.memory_id)).toBe(true);
      expect(w.wrapped_dek).toBe(`wrapped-for-${BUYER}`);
    }
    // The clone is still flagged encrypted.
    for (const m of buyerMems) expect(m.encrypted).toBe(true);
  });

  it('a plaintext pack writes no DEK wraps and never calls wrapDek', async () => {
    seedPlaintextPack(2);

    await grantCopy(order());

    expect(wrapDekMock).not.toHaveBeenCalled();
    expect(tables.memory_dek_wraps ?? []).toHaveLength(0);
  });
});
