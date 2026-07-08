import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

/**
 * Owner-trust regression for the PMP encryption control plane
 * (revoke / redelegate / revoke-all).
 *
 * Before the fix these routes read `req.verifiedWallet` but only mounted
 * `requirePrivyAuth` (which sets req.privyUser, NOT verifiedWallet) — so they
 * were silently dead (always 401). The fix mounts `requireOwnership`, which is
 * the ONLY middleware that sets verifiedWallet, and only ever to a wallet the
 * caller PROVABLY owns.
 *
 * These tests faithfully SIMULATE that contract (mirroring dashboard.routes.test):
 *   - requirePrivyAuth sets ONLY req.privyUser (a 401 when no session).
 *   - requireOwnership sets verifiedWallet ONLY to the caller's proven wallet;
 *     a CLIENT-SUPPLIED ?wallet=/body.wallet the caller does NOT own is rejected
 *     with 403; no session is 401. It does NOT trust the claimed value.
 *
 * Two independent things are proven:
 *   1. The forged-wallet attack (?wallet=<victim>) is blocked at the
 *      requireOwnership boundary, before any DB read or revoke.
 *   2. The route genuinely DEPENDS on requireOwnership: verifiedWallet has no
 *      other source, so if requireOwnership yields no wallet the handler 401s
 *      and never revokes. (If the fix were reverted and requireOwnership dropped
 *      from the chain, verifiedWallet would be undefined and every call 401s —
 *      these tests would fail, which is the point.)
 */

const H = vi.hoisted(() => ({
  // Mutable auth state the mocks read; reset in beforeEach.
  state: {
    loggedIn: true,
    // The wallet the caller PROVABLY owns (Privy-linked / clk_ owner), or null.
    callerOwnedWallet: 'WALLET_A' as string | null,
    // When true, requireOwnership behaves as if it is NOT mounted at all
    // (next() without ever setting verifiedWallet) — used to prove the route
    // has no other source of verifiedWallet and depends on this middleware.
    ownershipSetsWallet: true,
  },
}));

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// requirePrivyAuth: FAITHFUL — sets ONLY req.privyUser, never verifiedWallet.
// 401 when there is no session.
// optionalPrivyAuth: FAITHFUL — attaches privyUser IF a Privy session exists, but NEVER 401s;
// it always calls next() so a clk_ (no-JWT) caller reaches requireOwnership. The owner-key route
// uses this (not requirePrivyAuth) so the dashboard's clk_ session can register on-demand.
vi.mock('@clude/brain/auth/privy-auth', () => ({
  requirePrivyAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!H.state.loggedIn) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    (req as Request & { privyUser?: unknown }).privyUser = { userId: 'did:test', appId: 'test-app' };
    next();
  },
  optionalPrivyAuth: (req: Request, _res: Response, next: NextFunction) => {
    if (H.state.loggedIn) {
      (req as Request & { privyUser?: unknown }).privyUser = { userId: 'did:test', appId: 'test-app' };
    }
    next();
  },
}));

// requireOwnership: FAITHFUL to the real contract. Only sets verifiedWallet to a
// wallet the caller PROVABLY owns. A claimed ?wallet=/body.wallet the caller does
// not own is rejected (403); no proven wallet at all is 401. It NEVER trusts the
// client-supplied value as the verified wallet.
vi.mock('@clude/brain/auth/require-ownership', () => ({
  requireOwnership: (req: Request, res: Response, next: NextFunction) => {
    // Escape hatch to model "requireOwnership not in the chain": pass through
    // without ever setting verifiedWallet. Proves the route depends on it.
    if (!H.state.ownershipSetsWallet) {
      next();
      return;
    }
    const claimed =
      (req.query.wallet as string | undefined) ||
      (req.body && typeof req.body.wallet === 'string' ? req.body.wallet : undefined);
    if (!H.state.callerOwnedWallet) {
      res.status(401).json({ error: 'Authentication required for wallet-scoped access' });
      return;
    }
    if (claimed && claimed !== H.state.callerOwnedWallet) {
      // Forged claim — caller does not own the wallet they passed.
      res.status(403).json({ error: 'Wallet not linked to your account' });
      return;
    }
    (req as Request & { verifiedWallet?: string }).verifiedWallet = H.state.callerOwnedWallet;
    next();
  },
}));

// revokeMemory + redelegateMemory mocks (the route imports them from @clude/brain/memory)
const revokeMemoryMock = vi.fn(); // default impl set in beforeEach
const redelegateMemoryMock = vi.fn();
vi.mock('@clude/brain/memory', () => ({
  revokeMemory: (...a: unknown[]) => revokeMemoryMock(...a),
  redelegateMemory: (...a: unknown[]) => redelegateMemoryMock(...a),
}));

// Programmable DB.
//  - single-revoke / redelegate use select().eq('hash_id', …).maybeSingle() → memLookup
//  - revoke-all uses select().eq('owner_wallet', w).eq('encrypted', true).not(…) and is
//    awaited. The mock HONOURS the owner_wallet filter so we can prove revoke-all is
//    scoped to the verified wallet (a forged wallet could never enumerate the victim).
//  - owner-key registration reads encryption_keys via select().eq('owner_wallet', w).maybeSingle()
//    and writes via upsert(...). The mock keys both off the table name so encryption_keys
//    state is independent of the `memories` lookups. encKeysByOwner holds the EXISTING row
//    (overwrite-guard fixture); upsertCalls records every write so tests can assert no-stomp.
let memLookup: unknown;
// rows keyed by owner_wallet → what revoke-all returns for that wallet.
let revokeAllRowsByOwner: Record<string, unknown[]>;
// encryption_keys: existing row per owner_wallet (null/absent = unregistered).
let encKeysByOwner: Record<string, unknown>;
// Every encryption_keys upsert payload, in order (for no-overwrite assertions).
let upsertCalls: Array<{ table: string; payload: unknown; options: unknown }>;
vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        },
        not: () =>
          Promise.resolve({
            data: revokeAllRowsByOwner[filters['owner_wallet'] as string] ?? [],
            error: null,
          }),
        maybeSingle: async () => {
          if (table === 'encryption_keys') {
            const owner = filters['owner_wallet'] as string;
            return { data: encKeysByOwner[owner] ?? null, error: null };
          }
          return { data: memLookup, error: null };
        },
        upsert: async (payload: unknown, options: unknown) => {
          upsertCalls.push({ table, payload, options });
          // Reflect the write into the in-memory store so a later read sees it.
          const row = payload as { owner_wallet?: string };
          if (table === 'encryption_keys' && row?.owner_wallet) {
            encKeysByOwner[row.owner_wallet] = payload;
          }
          return { data: payload, error: null };
        },
      });
      return chain;
    },
  }),
}));

import { encryptionRoutes } from '../encryption.routes.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use(encryptionRoutes());
  return a;
}

beforeEach(() => {
  H.state.loggedIn = true;
  H.state.callerOwnedWallet = 'WALLET_A';
  H.state.ownershipSetsWallet = true;
  memLookup = { id: 7, owner_wallet: 'WALLET_A' };
  revokeAllRowsByOwner = {
    WALLET_A: [{ id: 1 }, { id: 2 }],
    VICTIM_WALLET: [{ id: 91 }, { id: 92 }, { id: 93 }], // never reachable by WALLET_A
  };
  encKeysByOwner = {}; // unregistered by default
  upsertCalls = [];
  revokeMemoryMock.mockReset();
  revokeMemoryMock.mockResolvedValue({ revoked: true });
  redelegateMemoryMock.mockReset();
  redelegateMemoryMock.mockResolvedValue({ redelegated: true });
});

describe('POST /v1/memories/:id/revoke', () => {
  it('revokes for the proven owner', async () => {
    const res = await request(app()).post('/v1/memories/mem-x/revoke');
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(true);
    expect(revokeMemoryMock).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it('CRITICAL: a forged ?wallet=<victim> is blocked at requireOwnership — never reads or revokes', async () => {
    // Caller is logged in but owns WALLET_A; they forge the victim's wallet.
    // The owner-data row would otherwise match (mem.owner_wallet === claimed),
    // so the ONLY thing standing between attacker and victim is requireOwnership.
    memLookup = { id: 7, owner_wallet: 'VICTIM_WALLET' };
    const res = await request(app()).post('/v1/memories/mem-x/revoke?wallet=VICTIM_WALLET');
    expect(res.status).toBe(403);
    expect(revokeMemoryMock).not.toHaveBeenCalled();
  });

  it('CRITICAL: forged victim wallet in body.wallet is also blocked', async () => {
    memLookup = { id: 7, owner_wallet: 'VICTIM_WALLET' };
    const res = await request(app())
      .post('/v1/memories/mem-x/revoke')
      .send({ wallet: 'VICTIM_WALLET' });
    expect(res.status).toBe(403);
    expect(revokeMemoryMock).not.toHaveBeenCalled();
  });

  it('depends on requireOwnership: with no verifiedWallet set, the handler 401s and never revokes', async () => {
    // Model requireOwnership being absent from the chain (or yielding no wallet).
    // The handler has no other source of verifiedWallet, so it must 401.
    H.state.ownershipSetsWallet = false;
    const res = await request(app()).post('/v1/memories/mem-x/revoke');
    expect(res.status).toBe(401);
    expect(revokeMemoryMock).not.toHaveBeenCalled();
  });

  it('403 for a non-owner memory (handler defense-in-depth: mem.owner_wallet mismatch)', async () => {
    // Caller proves ownership of WALLET_A (no forged claim) but the target memory
    // belongs to someone else — the route's own ownership check rejects it.
    memLookup = { id: 7, owner_wallet: 'SOMEONE_ELSE' };
    const res = await request(app()).post('/v1/memories/mem-x/revoke');
    expect(res.status).toBe(403);
    expect(revokeMemoryMock).not.toHaveBeenCalled();
  });

  it('404 when the memory does not exist', async () => {
    memLookup = null;
    const res = await request(app()).post('/v1/memories/nope/revoke');
    expect(res.status).toBe(404);
  });

  it('401 when unauthenticated', async () => {
    H.state.loggedIn = false;
    const res = await request(app()).post('/v1/memories/mem-x/revoke');
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/memories/:id/redelegate', () => {
  const wrap = { wrapped_dek: 'WRAP', wrap_pubkey: 'PUB' };

  it('re-delegates for the proven owner', async () => {
    const res = await request(app()).post('/v1/memories/mem-x/redelegate').send(wrap);
    expect(res.status).toBe(200);
    expect(res.body.redelegated).toBe(true);
    expect(redelegateMemoryMock).toHaveBeenCalledWith(expect.anything(), 7, wrap);
  });

  it('CRITICAL: a forged ?wallet=<victim> is blocked at requireOwnership — never re-delegates', async () => {
    memLookup = { id: 7, owner_wallet: 'VICTIM_WALLET' };
    const res = await request(app())
      .post('/v1/memories/mem-x/redelegate?wallet=VICTIM_WALLET')
      .send(wrap);
    expect(res.status).toBe(403);
    expect(redelegateMemoryMock).not.toHaveBeenCalled();
  });

  it('403 for a non-owner memory (handler defense-in-depth)', async () => {
    memLookup = { id: 7, owner_wallet: 'SOMEONE_ELSE' };
    const res = await request(app()).post('/v1/memories/mem-x/redelegate').send(wrap);
    expect(res.status).toBe(403);
    expect(redelegateMemoryMock).not.toHaveBeenCalled();
  });

  it('422 when the posted wrap is rejected (invalid_wrap)', async () => {
    redelegateMemoryMock.mockResolvedValue({ redelegated: false, reason: 'invalid_wrap' });
    const res = await request(app()).post('/v1/memories/mem-x/redelegate').send(wrap);
    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('invalid_wrap');
  });

  it('422 when the wrap fields are missing', async () => {
    const res = await request(app()).post('/v1/memories/mem-x/redelegate').send({});
    expect(res.status).toBe(422);
    expect(redelegateMemoryMock).not.toHaveBeenCalled();
  });

  it('depends on requireOwnership: with no verifiedWallet set, the handler 401s', async () => {
    H.state.ownershipSetsWallet = false;
    const res = await request(app()).post('/v1/memories/mem-x/redelegate').send(wrap);
    expect(res.status).toBe(401);
    expect(redelegateMemoryMock).not.toHaveBeenCalled();
  });

  it('401 when unauthenticated', async () => {
    H.state.loggedIn = false;
    const res = await request(app()).post('/v1/memories/mem-x/redelegate').send(wrap);
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/keys/revoke-all', () => {
  it('revokes all the proven owner’s delegated memories', async () => {
    const res = await request(app()).post('/v1/keys/revoke-all');
    expect(res.status).toBe(200);
    expect(res.body.revoked_count).toBe(2);
    expect(res.body.total).toBe(2);
    expect(revokeMemoryMock).toHaveBeenCalledTimes(2);
  });

  it('CRITICAL: forged ?wallet=<victim> is blocked — cannot mass-revoke another tenant', async () => {
    // WALLET_A forges VICTIM_WALLET. If requireOwnership trusted it, the route's
    // .eq('owner_wallet', VICTIM_WALLET) would enumerate and revoke 3 victim rows.
    const res = await request(app()).post('/v1/keys/revoke-all?wallet=VICTIM_WALLET');
    expect(res.status).toBe(403);
    expect(revokeMemoryMock).not.toHaveBeenCalled();
  });

  it('is scoped to the verified wallet — never enumerates another tenant’s rows', async () => {
    // Proven owner of WALLET_A: revoke-all only touches WALLET_A's 2 rows, never
    // VICTIM_WALLET's 3 rows, because the query is scoped to req.verifiedWallet.
    const res = await request(app()).post('/v1/keys/revoke-all');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(revokeMemoryMock).toHaveBeenCalledTimes(2);
  });

  it('depends on requireOwnership: with no verifiedWallet set, the handler 401s and revokes nothing', async () => {
    H.state.ownershipSetsWallet = false;
    const res = await request(app()).post('/v1/keys/revoke-all');
    expect(res.status).toBe(401);
    expect(revokeMemoryMock).not.toHaveBeenCalled();
  });

  it('401 when unauthenticated', async () => {
    H.state.loggedIn = false;
    const res = await request(app()).post('/v1/keys/revoke-all');
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/encryption/owner-key (M1: binding + overwrite guard)', () => {
  const body = { x25519_pubkey: 'PUBKEY_A', verifier_ct: 'VERIFIER_A' };

  it('rejects an unauthenticated caller (no proven wallet) — never writes a key', async () => {
    // The route uses optionalPrivyAuth (NOT requirePrivyAuth), so "no Privy JWT" alone no longer
    // rejects — a clk_ session is allowed through. "Unauthenticated" now means requireOwnership
    // resolves NO proven wallet at all, which it rejects before the handler runs.
    H.state.loggedIn = false;
    H.state.callerOwnedWallet = null;
    const res = await request(app()).post('/v1/encryption/owner-key').send(body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(upsertCalls).toHaveLength(0);
  });

  it('REGRESSION (clk_): a session with NO Privy JWT but a proven wallet CAN register', async () => {
    // The bug this fixes: the route was requirePrivyAuth, which 401s a clk_ Cortex key. The dashboard
    // runs entirely on clk_ after chat/auto-register swaps the Privy JWT, so first-time encrypted
    // export (which registers the owner key on-demand) dead-ended at "Session expired" for EVERY
    // email/wallet user. optionalPrivyAuth lets the clk_ caller reach requireOwnership, which binds
    // the row to the agent's PROVEN owner wallet.
    H.state.loggedIn = false; // no Privy JWT — a pure clk_ session
    H.state.callerOwnedWallet = 'WALLET_A'; // requireOwnership proved the clk_ agent's owner
    const res = await request(app()).post('/v1/encryption/owner-key').send(body);
    expect([200, 204]).toContain(res.status);
    expect(upsertCalls).toHaveLength(1);
    expect((upsertCalls[0].payload as Record<string, unknown>).owner_wallet).toBe('WALLET_A');
  });

  it('depends on requireOwnership: no verifiedWallet → rejected, no write', async () => {
    H.state.ownershipSetsWallet = false;
    const res = await request(app()).post('/v1/encryption/owner-key').send(body);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(upsertCalls).toHaveLength(0);
  });

  it('authed: upserts encryption_keys KEYED ON THE VERIFIED WALLET (first registration)', async () => {
    const res = await request(app()).post('/v1/encryption/owner-key').send(body);
    expect([200, 204]).toContain(res.status);
    expect(upsertCalls).toHaveLength(1);
    expect(upsertCalls[0].table).toBe('encryption_keys');
    const payload = upsertCalls[0].payload as Record<string, unknown>;
    expect(payload.owner_wallet).toBe('WALLET_A'); // the proven wallet, period
    expect(payload.x25519_pubkey).toBe('PUBKEY_A');
    expect(payload.verifier_ct).toBe('VERIFIER_A');
  });

  it('CRITICAL (M1 binding): a body-supplied owner/wallet is IGNORED — binding is the verified wallet', async () => {
    // The attacker posts owner/wallet=VICTIM alongside their own self-consistent keypair.
    // requireOwnership leaves verifiedWallet === WALLET_A (the claim matches nothing it owns),
    // and the route must bind to WALLET_A, never the payload. NB: a body.wallet that DIFFERS
    // from the proven wallet is rejected at requireOwnership (403) — proven separately below —
    // so here we forge `owner` (a field requireOwnership does not police) to prove the route
    // itself never reads an owner from the body.
    const res = await request(app())
      .post('/v1/encryption/owner-key')
      .send({ ...body, owner: 'VICTIM_WALLET' });
    expect([200, 204]).toContain(res.status);
    expect(upsertCalls).toHaveLength(1);
    const payload = upsertCalls[0].payload as Record<string, unknown>;
    expect(payload.owner_wallet).toBe('WALLET_A'); // NOT VICTIM_WALLET
    // The victim's row was never touched.
    expect(encKeysByOwner['VICTIM_WALLET']).toBeUndefined();
  });

  it('CRITICAL (M1 binding): a forged body.wallet=<victim> is blocked at requireOwnership (403), no write', async () => {
    const res = await request(app())
      .post('/v1/encryption/owner-key')
      .send({ ...body, wallet: 'VICTIM_WALLET' });
    expect(res.status).toBe(403);
    expect(upsertCalls).toHaveLength(0);
  });

  it('idempotent: re-POST of the SAME {pubkey, verifier_ct} succeeds, no error', async () => {
    encKeysByOwner['WALLET_A'] = { owner_wallet: 'WALLET_A', x25519_pubkey: 'PUBKEY_A', verifier_ct: 'VERIFIER_A' };
    const res = await request(app()).post('/v1/encryption/owner-key').send(body);
    expect([200, 204]).toContain(res.status);
    expect(res.body.error).toBeUndefined();
  });

  it('CRITICAL (M1 overwrite guard): re-POST with a DIFFERENT verifier_ct → 409 owner_key_exists, row NOT overwritten', async () => {
    encKeysByOwner['WALLET_A'] = { owner_wallet: 'WALLET_A', x25519_pubkey: 'PUBKEY_A', verifier_ct: 'VERIFIER_A' };
    const res = await request(app())
      .post('/v1/encryption/owner-key')
      .send({ x25519_pubkey: 'PUBKEY_A', verifier_ct: 'VERIFIER_DIFFERENT' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('owner_key_exists');
    // The existing row is untouched — no DEK-escrow lockout.
    expect(upsertCalls).toHaveLength(0);
    expect((encKeysByOwner['WALLET_A'] as Record<string, unknown>).verifier_ct).toBe('VERIFIER_A');
  });

  it('M1 overwrite guard: re-POST with a DIFFERENT x25519_pubkey → 409 owner_key_exists', async () => {
    encKeysByOwner['WALLET_A'] = { owner_wallet: 'WALLET_A', x25519_pubkey: 'PUBKEY_A', verifier_ct: 'VERIFIER_A' };
    const res = await request(app())
      .post('/v1/encryption/owner-key')
      .send({ x25519_pubkey: 'PUBKEY_DIFFERENT', verifier_ct: 'VERIFIER_A' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('owner_key_exists');
    expect(upsertCalls).toHaveLength(0);
  });

  it('422/400 when x25519_pubkey is missing', async () => {
    const res = await request(app()).post('/v1/encryption/owner-key').send({ verifier_ct: 'VERIFIER_A' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(upsertCalls).toHaveLength(0);
  });

  it('422/400 when verifier_ct is missing', async () => {
    const res = await request(app()).post('/v1/encryption/owner-key').send({ x25519_pubkey: 'PUBKEY_A' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(upsertCalls).toHaveLength(0);
  });

  it('422/400 when fields are empty strings', async () => {
    const res = await request(app())
      .post('/v1/encryption/owner-key')
      .send({ x25519_pubkey: '', verifier_ct: '' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(upsertCalls).toHaveLength(0);
  });
});
