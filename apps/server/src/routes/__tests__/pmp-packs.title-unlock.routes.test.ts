/**
 * SOLANA TITLE unlock — the assertSolanaTitleUnlock gate wired into POST /v1/packs/:id/unlock.
 *
 * Locks the ROUTE-LEVEL contract that the gate's unit tests cannot (flagged by the wiring backtest): a
 * future refactor that reorders the title check below the copy/legacy fork, or branches the fallback on
 * `.ok`, would reopen the holdsPackToken balance>=1 double-spend hole with every other test still green.
 * So this suite pins the AUTHORITATIVE ORDERING directly:
 *
 *   1. titled & ok           → 200, and NEITHER the copy gate NOR the chain is consulted (title wins).
 *   2. titled & !ok (denied) → 403 not_title_owner, and it NEVER falls through to copy/legacy (the guard).
 *   3. title outranks COPY   → a sale_mode='copy' pack with a Solana title is gated by the TITLE, not the
 *                              copy entitlement (hasActiveCopyEntitlement never called).
 *   4. rpc_unavailable       → 503 (a transient title-lookup failure fails closed, retriable).
 *   5. snapshot reachability → a titled pack with NO pack_token_address still unlocks (the 409 relax fix).
 *
 * Harness mirrors pmp-packs.copy-unlock.routes.test.ts (programmable Supabase stepQueue + injected
 * ownership verifier + auth), plus spies on assertSolanaTitleUnlock + getSolanaTitleMintClient so we drive
 * the title verdict. Default verdict is {titled:false} so a non-title pack falls through unchanged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { buildPackTree } from '@clude/tokenization';
import { createHash } from 'node:crypto';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('@clude/shared/core/solana-client', () => ({
  getConnection: () => ({ getParsedTokenAccountsByOwner: vi.fn() }),
  writeMemo: vi.fn(),
  registerMemoryOnChain: vi.fn(),
  getBotWallet: () => null,
  isRegistryEnabled: () => false,
}));
vi.mock('@clude/shared/core/owner-context', () => ({
  withOwnerWallet: async <T>(_w: string, fn: () => Promise<T>): Promise<T> => fn(),
}));
vi.mock('@clude/brain/auth/privy-auth', () => ({
  optionalPrivyAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requirePrivyAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

type Step = { table: string; data: unknown; error?: unknown };
let stepQueue: Step[] = [];
function makeChain(table: string) {
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
    in: () => chain,
    not: () => chain,
    or: () => chain,
    order: () => chain,
    overlaps: () => chain,
    limit: () => chain,
    maybeSingle: () => popResult(),
    single: () => popResult(),
    then: (resolve: (v: unknown) => unknown) => popResult().then(resolve),
  });
  return chain;
}
vi.mock('@clude/shared/core/database', () => ({ getDb: () => ({ from: (table: string) => makeChain(table) }) }));
vi.mock('../../lib/pda-mint-client.js', () => ({ getPdaMintClient: () => ({}) }));

// The CHAIN (legacy gate) — asserted NEVER called when a title is authoritative.
const holdsPackToken = vi.fn(async () => true);
vi.mock('../../lib/pack-gate.js', async () => {
  const real = await vi.importActual<typeof import('../../lib/pack-gate.js')>('../../lib/pack-gate.js');
  return { ...real, getDefaultPackOwnershipVerifier: () => ({ holdsPackToken }) };
});

// The COPY gate — asserted NEVER called when a title is authoritative.
const hasActiveCopyEntitlement = vi.fn(async (_packId: string, _holder: string) => true);
vi.mock('../../lib/payments/entitlement-gate.js', () => ({
  hasActiveCopyEntitlement: (packId: string, holder: string) => hasActiveCopyEntitlement(packId, holder),
}));

// The SOLANA TITLE gate — driven per test. Default {titled:false} so non-title packs fall through.
let solanaUnlock: unknown = { titled: false };
const assertSolanaTitleUnlock = vi.fn(async (_db: unknown, _client: unknown, _packId: string, _wallet: string) => solanaUnlock);
vi.mock('../../lib/payments/solana-title-gate.js', () => ({
  assertSolanaTitleUnlock: (db: unknown, client: unknown, packId: string, wallet: string) =>
    assertSolanaTitleUnlock(db, client, packId, wallet),
}));
// A non-null client so the route runs the title check (env-missing-skip is covered by the copy-unlock suite).
vi.mock('../../lib/solana-title-mint.js', () => ({
  getSolanaTitleMintClient: () => ({ network: 'devnet', titleOwner: vi.fn(), mintTitle: vi.fn() }),
}));

import { pmpPacksRoutes } from '../pmp-packs.routes.js';
import nacl from 'tweetnacl';
// @ts-ignore — bs58 ESM/CJS interop
import * as bs58Module from 'bs58';
const bs58 = (bs58Module as any).default || bs58Module;

function app() {
  const a = express();
  a.use(express.json());
  a.use(pmpPacksRoutes());
  return a;
}
const fakeHash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const leaves = Array.from({ length: 3 }, (_, i) => fakeHash(`ti-${i}`));
const tree = buildPackTree(leaves);
const kp = nacl.sign.keyPair();
const walletAddress = bs58.encode(Buffer.from(kp.publicKey));
function signedUnlock(packId: string, ts: number) {
  const message = `unlock:${packId}:${ts}`;
  const sig = nacl.sign.detached(new TextEncoder().encode(message), kp.secretKey);
  return { wallet: walletAddress, message, signature: bs58.encode(Buffer.from(sig)) };
}
/** Seed a titled pack. tokenAddr=null models a Solana title SNAPSHOT (no legacy pack token). */
function seedTitlePack(packId: string, saleMode: string | null, tokenAddr: string | null) {
  stepQueue.push({
    table: 'memory_packs',
    data: { pack_id: packId, name: 'T', version: '1.0.0', author_wallet: 'author', memory_count: leaves.length, merkle_root: tree.root, pack_token_address: tokenAddr, sale_mode: saleMode },
  });
}
function seedContents(packId: string) {
  stepQueue.push({ table: 'memory_pack_contents', data: leaves.map((h, i) => ({ memory_id: 500 + i, leaf_index: i, content_hash: h })) });
  stepQueue.push({ table: 'memories', data: leaves.map((_, i) => ({ id: 500 + i, hash_id: `m${i}`, memory_type: 'semantic', content: `c${i}`, owner_wallet: 'author', created_at: '2026-06-20T00:00:00Z', tags: [], source: 'chat', related_user: null, related_wallet: null })) });
}

beforeEach(() => {
  stepQueue = [];
  solanaUnlock = { titled: false };
  holdsPackToken.mockClear();
  hasActiveCopyEntitlement.mockClear();
  assertSolanaTitleUnlock.mockClear();
});

describe('POST /v1/packs/:id/unlock — Solana title gate (authoritative ordering)', () => {
  it('titled & ok → 200; neither the copy gate nor the chain is consulted (title wins)', async () => {
    seedTitlePack('pack-t', 'title', 'tok'); // even with a legacy token present, the title is authoritative
    seedContents('pack-t');
    solanaUnlock = { titled: true, ok: true, mintAddress: 'Mint1' };
    const res = await request(app()).post('/v1/packs/pack-t/unlock').send(signedUnlock('pack-t', Math.floor(Date.now() / 1000)));
    expect(res.status).toBe(200);
    expect(res.body.unlocked_by).toBe(walletAddress);
    expect(assertSolanaTitleUnlock).toHaveBeenCalled();
    expect(hasActiveCopyEntitlement).not.toHaveBeenCalled();
    expect(holdsPackToken).not.toHaveBeenCalled();
  });

  it('titled & !ok (not_title_owner) → 403, and NEVER falls through to copy/legacy (the double-spend guard)', async () => {
    seedTitlePack('pack-t', 'copy', 'tok'); // copy + legacy token both present — must NOT be reachable
    solanaUnlock = { titled: true, ok: false, reason: 'not_title_owner' };
    const res = await request(app()).post('/v1/packs/pack-t/unlock').send(signedUnlock('pack-t', Math.floor(Date.now() / 1000)));
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('not_title_owner');
    expect(hasActiveCopyEntitlement).not.toHaveBeenCalled();
    expect(holdsPackToken).not.toHaveBeenCalled();
  });

  it('rpc_unavailable → 503 (a transient title-lookup failure fails closed, never a downgrade)', async () => {
    seedTitlePack('pack-t', 'copy', 'tok');
    solanaUnlock = { titled: true, ok: false, reason: 'rpc_unavailable' };
    const res = await request(app()).post('/v1/packs/pack-t/unlock').send(signedUnlock('pack-t', Math.floor(Date.now() / 1000)));
    expect(res.status).toBe(503);
    expect(hasActiveCopyEntitlement).not.toHaveBeenCalled();
    expect(holdsPackToken).not.toHaveBeenCalled();
  });

  it('a titled SNAPSHOT pack with NO pack_token_address still unlocks (the 409 reachability fix)', async () => {
    seedTitlePack('pack-snap', 'title', null); // snapshot: no legacy token
    seedContents('pack-snap');
    solanaUnlock = { titled: true, ok: true, mintAddress: 'Mint2' };
    const res = await request(app()).post('/v1/packs/pack-snap/unlock').send(signedUnlock('pack-snap', Math.floor(Date.now() / 1000)));
    expect(res.status).toBe(200); // would have been 409 not_tokenised before the fix
    expect(res.body.unlocked_by).toBe(walletAddress);
  });

  it('not titled → falls through to the copy gate unchanged (no regression)', async () => {
    seedTitlePack('pack-c', 'copy', 'tok');
    seedContents('pack-c'); // copy gate allows (default), so the route serves the pack
    solanaUnlock = { titled: false };
    const res = await request(app()).post('/v1/packs/pack-c/unlock').send(signedUnlock('pack-c', Math.floor(Date.now() / 1000)));
    // copy gate consulted (hasActiveCopyEntitlement default true → 200), chain not touched
    expect(hasActiveCopyEntitlement).toHaveBeenCalledWith('pack-c', walletAddress);
    expect(holdsPackToken).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });
});
