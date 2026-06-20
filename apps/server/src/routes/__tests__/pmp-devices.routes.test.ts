/**
 * Integration tests for the DESKTOP DEVICE PAIRING endpoints — the secure server side of the
 * desktop `.pmp` integration the user's existing Clude desktop (Tauri) app consumes.
 *
 * Tradeable Memory Packs — Part C, Task 3 (spec §2 DESKTOP PAIRING · §3C · §4.2 desktop flow).
 *
 * Surface (spec §3C):
 *   POST /v1/pmp/devices/pair/init      none/device  a NEW device posts its ed25519 pubkey +
 *                                                    name/platform → server stores a pending code
 *                                                    (hash only), returns the short code to read.
 *   POST /v1/pmp/devices/pair/claim     privy+owner  the AUTHENTICATED user enters the code on
 *                                                    clude.io → binds owner_wallet, surfaces the
 *                                                    device name/platform for confirmation, claimed.
 *   POST /v1/pmp/devices/pair/complete  device-sig   the device proves possession of its key →
 *                                                    consumed + a pmp_devices row is created.
 *   GET  /v1/pmp/devices                privy+owner  list the owner's active paired devices.
 *   POST /v1/pmp/devices/:id/revoke     privy+owner  revoke a device (drops it from active lookup).
 *   POST /v1/pmp/desktop/memories       device-sig   paginated owner-scoped memory pull for the
 *                                                    paired device to build a .pmp locally.
 *
 * The anti-phishing contract pinned here (§00 MINOR 11, the task's TDD acceptance):
 *   1. a pairing code EXPIRES after <2 min — a claim past expires_at is rejected, and init writes
 *      an expires_at inside the 2-minute window.
 *   2. claim WITHOUT an authenticated session → 401. A code read aloud to an attacker is useless
 *      without the victim's login (the binding fix).
 *   3. claim BINDS the owner_wallet (req.verifiedWallet only — never a client ?owner=) and returns
 *      the device name/platform for EXPLICIT human confirmation.
 *   4. complete needs the DEVICE SIGNATURE over its pubkey (a wrong/missing signature → 401/403);
 *      only a CLAIMED code can be completed; completing creates the pmp_devices row + a 'paired'
 *      notification event.
 *   5. the desktop/memories pull is DEVICE-SIGNATURE-GATED + OWNER-SCOPED + REJECTS a stale
 *      timestamp (±120s) and a revoked device.
 *
 * getDb is the table-routed in-memory Supabase mock (same idiom as pmp-artifacts.routes.test.ts).
 * Real tweetnacl + bs58 are used (no crypto mock) so the signature checks are exercised end-to-end.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { createHash } from 'node:crypto';
import nacl from 'tweetnacl';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as bs58Module from 'bs58';
const bs58 = (bs58Module as any).default || bs58Module;

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── Auth injection — flip `authedWallet` per test (mirrors pmp-artifacts.routes.test.ts). ──
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

// requireOwnership runs AFTER the (mocked) requirePrivyAuth — verifiedWallet is already set, so it
// passes through. The route's ownerFromReq() reads ONLY req.verifiedWallet (never a client ?owner=).
vi.mock('@clude/brain/auth/require-ownership', () => ({
  requireOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
  optionalOwnership: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

// ── Table-routed Supabase mock (same shape as pmp-artifacts.routes.test.ts). ──
type Row = Record<string, any>;
const tables: Record<string, Row[]> = {};
const insertedRows: Array<{ table: string; rows: Row[] }> = [];
let forceError: { table: string; error: any } | null = null;
let forceUniqueViolation: string | null = null;
let nextSerial = 1000;

function resetDb() {
  for (const k of Object.keys(tables)) delete tables[k];
  insertedRows.length = 0;
  forceError = null;
  forceUniqueViolation = null;
  nextSerial = 1000;
}

function seed(table: string, rows: Row[]) {
  tables[table] = (tables[table] ?? []).concat(rows.map((r) => ({ ...r })));
}

interface Filter {
  kind: 'eq' | 'in' | 'lt' | 'gt' | 'is';
  col?: string;
  val?: any;
  vals?: any[];
}

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  return rows.filter((row) =>
    filters.every((f) => {
      if (f.kind === 'eq') return row[f.col!] === f.val;
      if (f.kind === 'in') return (f.vals ?? []).includes(row[f.col!]);
      if (f.kind === 'lt') return row[f.col!] < f.val;
      if (f.kind === 'gt') return row[f.col!] > f.val;
      if (f.kind === 'is') return f.val === null ? row[f.col!] == null : row[f.col!] === f.val;
      return true;
    }),
  );
}

function makeChain(table: string) {
  const filters: Filter[] = [];
  let pendingInsert: Row[] | null = null;
  let pendingUpdate: Row | null = null;
  let pendingDelete = false;
  let orderCol: { col: string; ascending: boolean } | null = null;
  let limitN: number | null = null;
  let rangeFromTo: { from: number; to: number } | null = null;

  const settle = (): Promise<{ data: any; error: any }> => {
    if (forceError && forceError.table === table) {
      const err = forceError.error;
      forceError = null;
      return Promise.resolve({ data: null, error: err });
    }

    if (pendingInsert) {
      const rows = pendingInsert;
      pendingInsert = null;
      if (forceUniqueViolation === table) {
        forceUniqueViolation = null;
        return Promise.resolve({ data: null, error: { code: '23505', message: 'duplicate key value' } });
      }
      const stamped = rows.map((r) => {
        const copy = { ...r };
        if (copy.event_id === undefined && table.endsWith('_events')) copy.event_id = nextSerial++;
        return copy;
      });
      tables[table] = (tables[table] ?? []).concat(stamped.map((r) => ({ ...r })));
      insertedRows.push({ table, rows: stamped.map((r) => ({ ...r })) });
      return Promise.resolve({
        data: stamped.length === 1 ? { ...stamped[0] } : stamped.map((r) => ({ ...r })),
        error: null,
      });
    }

    if (pendingUpdate) {
      const patch = pendingUpdate;
      pendingUpdate = null;
      const matched = applyFilters(tables[table] ?? [], filters);
      for (const row of matched) Object.assign(row, patch);
      return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null });
    }

    if (pendingDelete) {
      pendingDelete = false;
      const keep = (tables[table] ?? []).filter((r) => !applyFilters([r], filters).length);
      const removed = (tables[table] ?? []).filter((r) => applyFilters([r], filters).length);
      tables[table] = keep;
      return Promise.resolve({ data: removed.map((r) => ({ ...r })), error: null });
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
    if (rangeFromTo) rows = rows.slice(rangeFromTo.from, rangeFromTo.to + 1);
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
    lt: (col: string, val: any) => {
      filters.push({ kind: 'lt', col, val });
      return chain;
    },
    gt: (col: string, val: any) => {
      filters.push({ kind: 'gt', col, val });
      return chain;
    },
    is: (col: string, val: any) => {
      filters.push({ kind: 'is', col, val });
      return chain;
    },
    not: () => chain,
    order: (col: string, opts?: { ascending?: boolean }) => {
      orderCol = { col, ascending: opts?.ascending !== false };
      return chain;
    },
    limit: (n: number) => {
      limitN = n;
      return chain;
    },
    range: (from: number, to: number) => {
      rangeFromTo = { from, to };
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
    delete: () => {
      pendingDelete = true;
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

import { pmpDevicesRoutes } from '../pmp-devices.routes.js';

function app() {
  const a = express();
  a.use(express.json({ limit: '25mb' }));
  a.use(pmpDevicesRoutes());
  return a;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const OWNER = 'OwnerWaLLet1111111111111111111111111111111';
const OTHER = 'OtherWaLLet2222222222222222222222222222222';

/** A fresh ed25519 device keypair; pubkey is base58 (the device identity the desktop holds). */
function makeDeviceKey() {
  const kp = nacl.sign.keyPair();
  return {
    secretKey: kp.secretKey,
    pubkey: bs58.encode(Buffer.from(kp.publicKey)),
    sign(message: string): string {
      const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
      return bs58.encode(Buffer.from(sig));
    },
  };
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Run init → returns the plaintext code the response handed back + the stored row. */
async function initPairing(device: { pubkey: string }, name = 'Seb MacBook', platform = 'macos') {
  const res = await request(app())
    .post('/v1/pmp/devices/pair/init')
    .send({ device_pubkey: device.pubkey, device_name: name, platform });
  return res;
}

beforeEach(() => {
  resetDb();
  authedWallet = null;
});

// ───────────────────────── POST /v1/pmp/devices/pair/init ─────────────────────────

describe('POST /v1/pmp/devices/pair/init (a new device requests a pairing code)', () => {
  it('stores a PENDING code (hash only, never the plaintext) and returns the short code to read', async () => {
    const device = makeDeviceKey();
    const res = await initPairing(device);

    expect(res.status).toBe(201);
    // The short, human-readable code is returned exactly once for the user to read off the desktop.
    expect(typeof res.body.code).toBe('string');
    expect(res.body.code.length).toBeGreaterThanOrEqual(6);
    expect(res.body.code.length).toBeLessThanOrEqual(12);

    // Exactly one pending pairing-code row was written, keyed by the HASH of the code (never plaintext).
    const ins = insertedRows.find((r) => r.table === 'pmp_pairing_codes');
    expect(ins).toBeTruthy();
    const row = ins!.rows[0];
    expect(row.status).toBe('pending');
    expect(row.device_pubkey).toBe(device.pubkey);
    expect(row.device_name).toBe('Seb MacBook');
    expect(row.platform).toBe('macos');
    // owner is NOT bound yet — only the authenticated claim binds it.
    expect(row.owner_wallet == null).toBe(true);
    // The PK is the sha256 of the returned code; the plaintext code is nowhere in the row.
    expect(row.code_hash).toBe(sha256Hex(res.body.code));
    expect(JSON.stringify(row)).not.toContain(res.body.code);
  });

  it('sets expires_at INSIDE the 2-minute window (anti-phishing: codes expire <2 min)', async () => {
    const device = makeDeviceKey();
    const before = Date.now();
    const res = await initPairing(device);
    const after = Date.now();

    const row = insertedRows.find((r) => r.table === 'pmp_pairing_codes')!.rows[0];
    const expiresMs = Date.parse(row.expires_at);
    expect(Number.isNaN(expiresMs)).toBe(false);
    // Strictly less than 2 minutes out from when the request was served.
    expect(expiresMs).toBeGreaterThan(after);
    expect(expiresMs).toBeLessThanOrEqual(before + 120_000);
    expect(res.body.expires_at).toBe(row.expires_at);
  });

  it('rejects a malformed device pubkey (422) — must be a 32-byte ed25519 key', async () => {
    const res = await request(app())
      .post('/v1/pmp/devices/pair/init')
      .send({ device_pubkey: 'not-a-real-key', device_name: 'x', platform: 'macos' });
    expect(res.status).toBe(422);
    expect(insertedRows.find((r) => r.table === 'pmp_pairing_codes')).toBeFalsy();
  });

  it('does NOT require auth — a fresh device has no account yet', async () => {
    authedWallet = null;
    const device = makeDeviceKey();
    const res = await initPairing(device);
    expect(res.status).toBe(201);
  });
});

// ───────────────────────── POST /v1/pmp/devices/pair/claim ─────────────────────────

describe('POST /v1/pmp/devices/pair/claim (authed owner claims the code)', () => {
  function seedPendingCode(device: { pubkey: string }, code: string, opts: { expired?: boolean } = {}) {
    const expiresAt = opts.expired
      ? new Date(Date.now() - 1_000).toISOString()
      : new Date(Date.now() + 110_000).toISOString();
    seed('pmp_pairing_codes', [
      {
        code_hash: sha256Hex(code),
        device_pubkey: device.pubkey,
        device_name: 'Seb MacBook',
        platform: 'macos',
        owner_wallet: null,
        status: 'pending',
        created_at: new Date().toISOString(),
        expires_at: expiresAt,
      },
    ]);
  }

  it('REQUIRES an authenticated session — an unauthenticated claim is 401 (the anti-phishing binding)', async () => {
    authedWallet = null; // a code read aloud to an attacker is useless without the victim's login
    const device = makeDeviceKey();
    const code = 'ABCD2345';
    seedPendingCode(device, code);

    const res = await request(app()).post('/v1/pmp/devices/pair/claim').send({ code });
    expect(res.status).toBe(401);
    // status was NOT advanced to claimed.
    expect(tables['pmp_pairing_codes'][0].status).toBe('pending');
    expect(tables['pmp_pairing_codes'][0].owner_wallet == null).toBe(true);
  });

  it('BINDS the authenticated owner and surfaces the device name/platform for explicit confirmation', async () => {
    authedWallet = OWNER;
    const device = makeDeviceKey();
    const code = 'WXYZ3456';
    seedPendingCode(device, code);

    const res = await request(app()).post('/v1/pmp/devices/pair/claim').send({ code });
    expect(res.status).toBe(200);
    // The device identity is echoed back so the human can confirm THIS device, not an attacker's.
    expect(res.body.device.device_name).toBe('Seb MacBook');
    expect(res.body.device.platform).toBe('macos');
    expect(res.body.device.device_pubkey).toBe(device.pubkey);
    expect(res.body.status).toBe('claimed');

    // The stored row is now claimed and bound to the AUTHENTICATED owner (never a client field).
    const row = tables['pmp_pairing_codes'][0];
    expect(row.status).toBe('claimed');
    expect(row.owner_wallet).toBe(OWNER);
  });

  it('REJECTS an EXPIRED code (claim past the <2 min window) → 410, no binding', async () => {
    authedWallet = OWNER;
    const device = makeDeviceKey();
    const code = 'EXPD7890';
    seedPendingCode(device, code, { expired: true });

    const res = await request(app()).post('/v1/pmp/devices/pair/claim').send({ code });
    expect(res.status).toBe(410);
    const row = tables['pmp_pairing_codes'][0];
    expect(row.owner_wallet == null).toBe(true);
    expect(row.status).not.toBe('claimed');
  });

  it('404 for an unknown code', async () => {
    authedWallet = OWNER;
    const res = await request(app()).post('/v1/pmp/devices/pair/claim').send({ code: 'NOPE0000' });
    expect(res.status).toBe(404);
  });

  it('emits a pair_claimed notification event scoped to the owner', async () => {
    authedWallet = OWNER;
    const device = makeDeviceKey();
    const code = 'NOTE1234';
    seedPendingCode(device, code);
    await request(app()).post('/v1/pmp/devices/pair/claim').send({ code });
    const ev = insertedRows.find((r) => r.table === 'pmp_device_events');
    expect(ev).toBeTruthy();
    expect(ev!.rows[0].owner_wallet).toBe(OWNER);
    expect(ev!.rows[0].event_type).toBe('pair_claimed');
  });
});

// ───────────────────────── POST /v1/pmp/devices/pair/complete ─────────────────────────

describe('POST /v1/pmp/devices/pair/complete (device proves possession of its key)', () => {
  function seedClaimedCode(device: { pubkey: string }, code: string, owner = OWNER) {
    seed('pmp_pairing_codes', [
      {
        code_hash: sha256Hex(code),
        device_pubkey: device.pubkey,
        device_name: 'Seb MacBook',
        platform: 'macos',
        owner_wallet: owner,
        status: 'claimed',
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 110_000).toISOString(),
      },
    ]);
  }

  function completeBody(device: ReturnType<typeof makeDeviceKey>, ts = Math.floor(Date.now() / 1000)) {
    const message = `pmp-pair-complete:${device.pubkey}:${ts}`;
    return { device_pubkey: device.pubkey, timestamp: ts, signature: device.sign(message) };
  }

  it('creates a pmp_devices row when the device signature is valid (consumes the claimed code)', async () => {
    const device = makeDeviceKey();
    const code = 'GOOD1234';
    seedClaimedCode(device, code);

    const res = await request(app()).post('/v1/pmp/devices/pair/complete').send(completeBody(device));
    expect(res.status).toBe(201);
    expect(res.body.device.device_pubkey).toBe(device.pubkey);
    expect(res.body.device.device_id).toMatch(/^dev-/);

    // A pmp_devices row was created, bound to the owner the claim set, active (no revoked_at).
    const dev = insertedRows.find((r) => r.table === 'pmp_devices');
    expect(dev).toBeTruthy();
    expect(dev!.rows[0].owner_wallet).toBe(OWNER);
    expect(dev!.rows[0].device_pubkey).toBe(device.pubkey);
    expect(dev!.rows[0].revoked_at == null).toBe(true);

    // The code is consumed (single-use).
    expect(tables['pmp_pairing_codes'][0].status).toBe('consumed');

    // A 'paired' notification event was emitted (anti-phishing: notify on a new device pair).
    const ev = insertedRows.find((r) => r.table === 'pmp_device_events' && r.rows[0].event_type === 'paired');
    expect(ev).toBeTruthy();
    expect(ev!.rows[0].owner_wallet).toBe(OWNER);
  });

  it('REJECTS a BAD signature (signed by a different key) → 401, no device created', async () => {
    const device = makeDeviceKey();
    const attacker = makeDeviceKey();
    const code = 'BADS1234';
    seedClaimedCode(device, code);

    // Claim the message for `device.pubkey` but sign it with the attacker's secret key.
    const ts = Math.floor(Date.now() / 1000);
    const message = `pmp-pair-complete:${device.pubkey}:${ts}`;
    const forged = bs58.encode(Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), attacker.secretKey)));

    const res = await request(app())
      .post('/v1/pmp/devices/pair/complete')
      .send({ device_pubkey: device.pubkey, timestamp: ts, signature: forged });
    expect(res.status).toBe(401);
    expect(insertedRows.find((r) => r.table === 'pmp_devices')).toBeFalsy();
    expect(tables['pmp_pairing_codes'][0].status).toBe('claimed'); // not consumed
  });

  it('REJECTS completing a code that is still PENDING (never claimed by an owner) → 409', async () => {
    const device = makeDeviceKey();
    const code = 'PEND1234';
    seed('pmp_pairing_codes', [
      {
        code_hash: sha256Hex(code),
        device_pubkey: device.pubkey,
        device_name: 'Seb MacBook',
        platform: 'macos',
        owner_wallet: null,
        status: 'pending', // not yet claimed → cannot complete
        created_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 110_000).toISOString(),
      },
    ]);
    const res = await request(app()).post('/v1/pmp/devices/pair/complete').send(completeBody(device));
    expect(res.status).toBe(409);
    expect(insertedRows.find((r) => r.table === 'pmp_devices')).toBeFalsy();
  });

  it('REJECTS a stale timestamp (replay outside ±120s) → 401', async () => {
    const device = makeDeviceKey();
    const code = 'STAL1234';
    seedClaimedCode(device, code);
    const staleTs = Math.floor(Date.now() / 1000) - 600; // 10 min ago
    const res = await request(app()).post('/v1/pmp/devices/pair/complete').send(completeBody(device, staleTs));
    expect(res.status).toBe(401);
    expect(insertedRows.find((r) => r.table === 'pmp_devices')).toBeFalsy();
  });
});

// ───────────────────────── GET /v1/pmp/devices  +  /:id/revoke ─────────────────────────

describe('GET /v1/pmp/devices and POST /:id/revoke (owner device management)', () => {
  function seedDevices() {
    seed('pmp_devices', [
      { device_id: 'dev-mine01', owner_wallet: OWNER, device_pubkey: 'Pk1', device_name: 'MacBook', platform: 'macos', paired_at: '2026-02-01T00:00:00Z', revoked_at: null, scopes: ['memories:read', 'pmp:export'] },
      { device_id: 'dev-mine02', owner_wallet: OWNER, device_pubkey: 'Pk2', device_name: 'iMac', platform: 'macos', paired_at: '2026-02-02T00:00:00Z', revoked_at: null, scopes: ['memories:read'] },
      { device_id: 'dev-revoked', owner_wallet: OWNER, device_pubkey: 'Pk3', device_name: 'Old', platform: 'linux', paired_at: '2026-01-01T00:00:00Z', revoked_at: '2026-01-15T00:00:00Z', scopes: ['memories:read'] },
      { device_id: 'dev-theirs', owner_wallet: OTHER, device_pubkey: 'Pk9', device_name: 'Not Yours', platform: 'windows', paired_at: '2026-02-01T00:00:00Z', revoked_at: null, scopes: ['memories:read'] },
    ]);
  }

  it('lists ONLY the caller-owned, non-revoked devices', async () => {
    authedWallet = OWNER;
    seedDevices();
    const res = await request(app()).get('/v1/pmp/devices');
    expect(res.status).toBe(200);
    const ids = res.body.devices.map((d: any) => d.device_id).sort();
    expect(ids).toEqual(['dev-mine01', 'dev-mine02']); // revoked + other-owner excluded
  });

  it('401 when unauthenticated', async () => {
    authedWallet = null;
    const res = await request(app()).get('/v1/pmp/devices');
    expect(res.status).toBe(401);
  });

  it('revoke sets revoked_at on the owner device and emits a revoked event', async () => {
    authedWallet = OWNER;
    seedDevices();
    const res = await request(app()).post('/v1/pmp/devices/dev-mine01/revoke').send({});
    expect(res.status).toBe(200);
    expect(tables['pmp_devices'].find((d) => d.device_id === 'dev-mine01')!.revoked_at).toBeTruthy();
    const ev = insertedRows.find((r) => r.table === 'pmp_device_events' && r.rows[0].event_type === 'revoked');
    expect(ev).toBeTruthy();
  });

  it('cannot revoke another owner device (404, no mutation)', async () => {
    authedWallet = OWNER;
    seedDevices();
    const res = await request(app()).post('/v1/pmp/devices/dev-theirs/revoke').send({});
    expect(res.status).toBe(404);
    expect(tables['pmp_devices'].find((d) => d.device_id === 'dev-theirs')!.revoked_at == null).toBe(true);
  });
});

// ───────────────────────── POST /v1/pmp/desktop/memories ─────────────────────────

describe('POST /v1/pmp/desktop/memories (device-signed, owner-scoped, paginated memory pull)', () => {
  function seedPairedDevice(device: { pubkey: string }, owner = OWNER, opts: { revoked?: boolean } = {}) {
    seed('pmp_devices', [
      {
        device_id: 'dev-pull01',
        owner_wallet: owner,
        device_pubkey: device.pubkey,
        device_name: 'Seb MacBook',
        platform: 'macos',
        paired_at: '2026-02-01T00:00:00Z',
        last_seen_at: null,
        revoked_at: opts.revoked ? '2026-02-10T00:00:00Z' : null,
        scopes: ['memories:read', 'pmp:export'],
      },
    ]);
  }

  function seedOwnerMemories(owner = OWNER, n = 3) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push({
        id: 100 + i,
        hash_id: `clude-pull${i}`,
        memory_type: 'semantic',
        content: `owner memory ${i}`,
        summary: `s${i}`,
        owner_wallet: owner,
        created_at: `2026-01-0${i + 1}T00:00:00.000Z`,
        tags: ['x'],
        source: 'chat',
        content_hash: `lh:pull${i}`,
        importance: 0.5,
      });
    }
    seed('memories', rows);
  }

  function signedHeaders(device: ReturnType<typeof makeDeviceKey>, ts = Math.floor(Date.now() / 1000)) {
    const message = `pmp-pull:${device.pubkey}:${ts}`;
    return {
      'x-pmp-device': device.pubkey,
      'x-pmp-timestamp': String(ts),
      'x-pmp-signature': device.sign(message),
    };
  }

  it('returns the OWNER memories for a validly-signed paired device', async () => {
    const device = makeDeviceKey();
    seedPairedDevice(device);
    seedOwnerMemories(OWNER, 3);
    // A decoy memory belonging to another owner must NEVER leak.
    seed('memories', [{ id: 999, hash_id: 'clude-decoy', memory_type: 'semantic', content: 'SECRET', owner_wallet: OTHER, created_at: '2026-01-01T00:00:00.000Z', tags: [], source: 'chat', content_hash: 'lh:decoy', importance: 0.5 }]);

    const res = await request(app()).post('/v1/pmp/desktop/memories').set(signedHeaders(device)).send({ limit: 50 });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.memories)).toBe(true);
    expect(res.body.memories).toHaveLength(3);
    const owners = new Set(res.body.memories.map((m: any) => m.owner_wallet));
    expect([...owners]).toEqual([OWNER]); // owner-scoped: no cross-tenant rows
    expect(res.body.memories.some((m: any) => m.content === 'SECRET')).toBe(false);
  });

  it('REJECTS an unsigned / signature-less pull → 401, no data', async () => {
    const device = makeDeviceKey();
    seedPairedDevice(device);
    seedOwnerMemories();
    const res = await request(app())
      .post('/v1/pmp/desktop/memories')
      .set({ 'x-pmp-device': device.pubkey, 'x-pmp-timestamp': String(Math.floor(Date.now() / 1000)) })
      .send({ limit: 50 });
    expect(res.status).toBe(401);
    expect(res.body.memories).toBeUndefined();
  });

  it('REJECTS a STALE timestamp (replay outside ±120s) → 401', async () => {
    const device = makeDeviceKey();
    seedPairedDevice(device);
    seedOwnerMemories();
    const staleTs = Math.floor(Date.now() / 1000) - 300; // 5 min ago, outside ±120s
    const res = await request(app()).post('/v1/pmp/desktop/memories').set(signedHeaders(device, staleTs)).send({});
    expect(res.status).toBe(401);
    expect(res.body.memories).toBeUndefined();
  });

  it('REJECTS a REVOKED device even with a valid signature → 403', async () => {
    const device = makeDeviceKey();
    seedPairedDevice(device, OWNER, { revoked: true });
    seedOwnerMemories();
    const res = await request(app()).post('/v1/pmp/desktop/memories').set(signedHeaders(device)).send({});
    expect(res.status).toBe(403);
    expect(res.body.memories).toBeUndefined();
  });

  it('REJECTS a device pubkey that is not paired at all → 403', async () => {
    const device = makeDeviceKey(); // never paired
    seedOwnerMemories();
    const res = await request(app()).post('/v1/pmp/desktop/memories').set(signedHeaders(device)).send({});
    expect(res.status).toBe(403);
  });

  it('REJECTS a signature that does not match the claimed device pubkey → 401', async () => {
    const device = makeDeviceKey();
    const attacker = makeDeviceKey();
    seedPairedDevice(device);
    seedOwnerMemories();
    // Header claims `device.pubkey` but the signature was produced by the attacker's key.
    const ts = Math.floor(Date.now() / 1000);
    const message = `pmp-pull:${device.pubkey}:${ts}`;
    const forged = bs58.encode(Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), attacker.secretKey)));
    const res = await request(app())
      .post('/v1/pmp/desktop/memories')
      .set({ 'x-pmp-device': device.pubkey, 'x-pmp-timestamp': String(ts), 'x-pmp-signature': forged })
      .send({});
    expect(res.status).toBe(401);
  });

  it('paginates: a cursor/offset returns the next page only', async () => {
    const device = makeDeviceKey();
    seedPairedDevice(device);
    seedOwnerMemories(OWNER, 5);
    const page1 = await request(app()).post('/v1/pmp/desktop/memories').set(signedHeaders(device)).send({ limit: 2, offset: 0 });
    expect(page1.status).toBe(200);
    expect(page1.body.memories).toHaveLength(2);
    expect(page1.body.next_offset).toBe(2);
    const page2 = await request(app()).post('/v1/pmp/desktop/memories').set(signedHeaders(device)).send({ limit: 2, offset: 2 });
    expect(page2.body.memories).toHaveLength(2);
    // Pages are disjoint.
    const ids1 = page1.body.memories.map((m: any) => m.id);
    const ids2 = page2.body.memories.map((m: any) => m.id);
    expect(ids1.filter((x: number) => ids2.includes(x))).toHaveLength(0);
  });
});
