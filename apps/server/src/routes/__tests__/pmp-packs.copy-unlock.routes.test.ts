/**
 * COPY-license unlock — the §00 B2 gate wired into POST /v1/packs/:id/unlock.
 *
 * Tradeable Memory Packs — Slice 1, Part B (chunk 2), Task 2
 * (spec §00 B2 · §1.2 Flow A step 10 · §3 "/unlock gate sees active entitlement").
 *
 * The binding rule (§00 B2): for sale_mode='copy', unlock authorises off a pack_entitlements
 * row and MUST NOT touch the chain — that fungible-balance check is the title double-spend
 * bug. So this suite pins the copy path specifically (the legacy/title token path is covered
 * by pmp-packs.routes.test.ts and stays untouched):
 *
 *   1. A buyer with an ACTIVE copy entitlement unlocks → 200 + full memories + Merkle proofs.
 *   2. A buyer WITHOUT one → 403 unlock_denied / reason 'not_entitled'.
 *   3. The signature is still required on the copy path (a wallet must prove control) — a stale
 *      message → 401 message_expired, a wrong pack_id → 422, BEFORE any entitlement read.
 *   4. THE CHAIN IS NEVER CONSULTED for a copy pack — holdsPackToken is asserted never-called
 *      across allow + deny.
 *
 * Mocks mirror pmp-packs.routes.test.ts (programmable per-call Supabase stepQueue + injected
 * ownership verifier + auth), plus a spy on hasActiveCopyEntitlement so we can drive + assert
 * the copy gate directly.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { buildPackTree, verifyInclusion } from '@clude/tokenization';
import { createHash } from 'node:crypto';

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// ── Solana client — prevent config load + give a chain stub (must never be hit on copy) ──
vi.mock('@clude/shared/core/solana-client', () => ({
  getConnection: () => ({ getParsedTokenAccountsByOwner: vi.fn() }),
  writeMemo: vi.fn(),
  registerMemoryOnChain: vi.fn(),
  getBotWallet: () => null,
  isRegistryEnabled: () => false,
}));

// ── Owner-context passthrough ──
vi.mock('@clude/shared/core/owner-context', () => ({
  withOwnerWallet: async <T>(_w: string, fn: () => Promise<T>): Promise<T> => fn(),
}));

// ── Auth injection (unlock is unauthenticated; included for parity) ──
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

// ── Supabase mock: programmable per-call (same shape as pmp-packs.routes.test.ts) ──
type Step = { table: string; data: unknown; error?: unknown };
let stepQueue: Step[] = [];

function makeChain(table: string) {
  let pendingIn: { col: string; vals: unknown[] } | null = null;
  const popResult = () => {
    const next = stepQueue.shift();
    if (next && next.table !== table && next.table !== '*') {
      throw new Error(`mock step mismatch: expected table ${next.table}, got ${table}`);
    }
    return Promise.resolve({ data: next?.data ?? null, error: next?.error ?? null });
  };
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    in: (col: string, vals: unknown[]) => {
      pendingIn = { col, vals };
      return chain;
    },
    not: () => chain,
    or: () => chain,
    order: () => chain,
    overlaps: () => chain,
    limit: () => chain,
    maybeSingle: () => popResult(),
    single: () => popResult(),
    then: (resolve: (v: unknown) => unknown) => {
      const r = popResult();
      pendingIn = null;
      return r.then(resolve);
    },
  });
  return chain;
}

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({ from: (table: string) => makeChain(table) }),
}));

// ── PdaMintClient → unused here, but the route module imports it ──
vi.mock('../../lib/pda-mint-client.js', () => ({
  getPdaMintClient: () => ({}),
}));

// ── Ownership verifier — the CHAIN. We assert holdsPackToken is NEVER called for copy. ──
const holdsPackToken = vi.fn(async () => true);
vi.mock('../../lib/pack-gate.js', async () => {
  const real = await vi.importActual<typeof import('../../lib/pack-gate.js')>('../../lib/pack-gate.js');
  return {
    ...real,
    getDefaultPackOwnershipVerifier: () => ({ holdsPackToken }),
  };
});

// ── Copy entitlement gate — the thing under test, spied so we can drive allow/deny. ──
let entitled = true;
const hasActiveCopyEntitlement = vi.fn(async (_packId: string, _holder: string) => entitled);
vi.mock('../../lib/payments/entitlement-gate.js', () => ({
  hasActiveCopyEntitlement: (packId: string, holder: string) => hasActiveCopyEntitlement(packId, holder),
}));

import { pmpPacksRoutes } from '../pmp-packs.routes.js';
import nacl from 'tweetnacl';
// @ts-ignore — bs58 is ESM-only, works at runtime via Node CJS/ESM interop
import * as bs58Module from 'bs58';
const bs58 = (bs58Module as any).default || bs58Module;

function app() {
  const a = express();
  a.use(express.json());
  a.use(pmpPacksRoutes());
  return a;
}

function fakeHash(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

// Pack contents shared across tests.
const leaves = Array.from({ length: 3 }, (_, i) => fakeHash(`cu-${i}`));
const tree = buildPackTree(leaves);

// A real keypair so the unlock signature is genuinely valid.
const kp = nacl.sign.keyPair();
const walletAddress = bs58.encode(Buffer.from(kp.publicKey));

function signedUnlock(packId: string, tsSeconds: number) {
  const message = `unlock:${packId}:${tsSeconds}`;
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  return { wallet: walletAddress, message, signature: bs58.encode(Buffer.from(sig)) };
}

/** Seed a tokenised COPY pack (sale_mode='copy'). */
function seedCopyPack(packId = 'pack-copy') {
  stepQueue.push({
    table: 'memory_packs',
    data: {
      pack_id: packId,
      name: 'Copy Pack',
      version: '1.0.0',
      author_wallet: 'author-wallet',
      memory_count: leaves.length,
      merkle_root: tree.root,
      pack_token_address: 'memo:tx-copy',
      sale_mode: 'copy',
    },
  });
}

function seedContentsAndMemories(packId = 'pack-copy') {
  stepQueue.push({
    table: 'memory_pack_contents',
    data: leaves.map((h, i) => ({ memory_id: 300 + i, leaf_index: i, content_hash: h })),
  });
  stepQueue.push({
    table: 'memories',
    data: leaves.map((_, i) => ({
      id: 300 + i,
      hash_id: `mem-cu${i}`,
      memory_type: 'semantic',
      content: `copy content ${i}`,
      owner_wallet: 'author-wallet',
      created_at: '2026-06-20T00:00:00Z',
      tags: [],
      source: 'desktop',
      related_user: null,
      related_wallet: null,
    })),
  });
}

beforeEach(() => {
  authedWallet = null;
  stepQueue = [];
  entitled = true;
  holdsPackToken.mockClear();
  hasActiveCopyEntitlement.mockClear();
});

describe('POST /v1/packs/:id/unlock — COPY pack gate (§00 B2)', () => {
  it('unlocks (200) for a buyer with an ACTIVE copy entitlement — never touching the chain', async () => {
    seedCopyPack('pack-copy');
    seedContentsAndMemories('pack-copy');
    entitled = true;
    const now = Math.floor(Date.now() / 1000);

    const res = await request(app())
      .post('/v1/packs/pack-copy/unlock')
      .send(signedUnlock('pack-copy', now));

    expect(res.status).toBe(200);
    expect(res.body.pack.id).toBe('pack-copy');
    expect(res.body.unlocked_by).toBe(walletAddress);
    expect(res.body.memories).toHaveLength(3);

    // Proofs verify against the committed root.
    for (const m of res.body.memories) {
      expect(m.memory).not.toBeNull();
      expect(verifyInclusion(tree.root, {
        leaf: m.proof.leaf,
        leafIndex: m.proof.leaf_index,
        siblings: m.proof.siblings,
        algorithm: m.proof.algorithm,
      })).toBe(true);
    }

    // The copy gate was consulted with (pack_id, proven wallet)…
    expect(hasActiveCopyEntitlement).toHaveBeenCalledWith('pack-copy', walletAddress);
    // …and the CHAIN was NEVER consulted (the §00 B2 invariant).
    expect(holdsPackToken).not.toHaveBeenCalled();
  });

  it('denies (403 not_entitled) a buyer WITHOUT an active entitlement — still no chain call', async () => {
    seedCopyPack('pack-copy');
    entitled = false;
    const now = Math.floor(Date.now() / 1000);

    const res = await request(app())
      .post('/v1/packs/pack-copy/unlock')
      .send(signedUnlock('pack-copy', now));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('unlock_denied');
    expect(res.body.reason).toBe('not_entitled');

    expect(hasActiveCopyEntitlement).toHaveBeenCalledWith('pack-copy', walletAddress);
    expect(holdsPackToken).not.toHaveBeenCalled();
  });

  it('still requires a valid signature on the copy path: a stale message → 401, no entitlement read, no chain', async () => {
    seedCopyPack('pack-copy');
    const longAgo = Math.floor(Date.now() / 1000) - 3600;

    const res = await request(app())
      .post('/v1/packs/pack-copy/unlock')
      .send(signedUnlock('pack-copy', longAgo));

    expect(res.status).toBe(401);
    expect(res.body.reason).toBe('message_expired');
    // Authorisation is gated behind proof-of-control: we never even read the entitlement.
    expect(hasActiveCopyEntitlement).not.toHaveBeenCalled();
    expect(holdsPackToken).not.toHaveBeenCalled();
  });

  it('rejects a copy unlock whose signed pack_id mismatches the URL (422), before any entitlement read', async () => {
    seedCopyPack('pack-copy');
    const now = Math.floor(Date.now() / 1000);

    const res = await request(app())
      .post('/v1/packs/pack-copy/unlock')
      .send(signedUnlock('pack-OTHER', now)); // signed for a different pack

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe('pack_id_mismatch');
    expect(hasActiveCopyEntitlement).not.toHaveBeenCalled();
    expect(holdsPackToken).not.toHaveBeenCalled();
  });
});

describe('POST /v1/packs/:id/unlock — title/legacy pack still uses the chain (regression guard)', () => {
  it('a non-copy (sale_mode=null) pack consults the chain, NOT the copy entitlement gate', async () => {
    // Legacy pack: no sale_mode → token-gated path.
    stepQueue.push({
      table: 'memory_packs',
      data: {
        pack_id: 'pack-legacy',
        name: 'Legacy',
        version: '1.0.0',
        author_wallet: 'author-wallet',
        memory_count: leaves.length,
        merkle_root: tree.root,
        pack_token_address: 'token-mint-legacy',
        sale_mode: null,
      },
    });
    stepQueue.push({
      table: 'memory_pack_contents',
      data: leaves.map((h, i) => ({ memory_id: 400 + i, leaf_index: i, content_hash: h })),
    });
    stepQueue.push({
      table: 'memories',
      data: leaves.map((_, i) => ({
        id: 400 + i,
        hash_id: `mem-lg${i}`,
        memory_type: 'semantic',
        content: `legacy ${i}`,
        owner_wallet: 'author-wallet',
        created_at: '2026-06-20T00:00:00Z',
        tags: [],
        source: 'chat',
        related_user: null,
        related_wallet: null,
      })),
    });
    holdsPackToken.mockResolvedValueOnce(true);
    const now = Math.floor(Date.now() / 1000);

    const res = await request(app())
      .post('/v1/packs/pack-legacy/unlock')
      .send(signedUnlock('pack-legacy', now));

    expect(res.status).toBe(200);
    // The legacy path hit the chain and did NOT touch the copy entitlement gate.
    expect(holdsPackToken).toHaveBeenCalledWith(walletAddress, 'token-mint-legacy');
    expect(hasActiveCopyEntitlement).not.toHaveBeenCalled();
  });
});
