/**
 * Integration tests for the PMP Pack endpoints.
 *
 * Covers:
 *   POST /v1/packs           create + tokenise
 *   GET  /v1/packs/:id       retrieve
 *   GET  /v1/packs/:id/preview     selective disclosure
 *   GET  /v1/packs/:id/verify      public verifier
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import {
  FakeMintClient,
  buildPackTree,
  verifyInclusion,
  type MerkleProof,
} from '@clude/tokenization';
import { createHash } from 'node:crypto';

// ── Logger ──
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Owner-context passthrough ──
vi.mock('@clude/shared/core/owner-context', () => ({
  withOwnerWallet: async <T>(_w: string, fn: () => Promise<T>): Promise<T> => fn(),
}));

// ── Auth injection ──
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

// ── Supabase mock: programmable per-call ──
type Step = { table: string; data: unknown; error?: unknown };
let stepQueue: Step[] = [];
let insertCalls: Array<{ table: string; rows: unknown }> = [];
let lastRowsRequested: Array<{ table: string; method: string }> = [];

function makeChain(table: string) {
  let pendingIn: { col: string; vals: unknown[] } | null = null;
  let pendingInsert: unknown = null;
  const popResult = (method: string) => {
    lastRowsRequested.push({ table, method });
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
    maybeSingle: () => popResult('maybeSingle'),
    single: () => popResult('single'),
    insert: (rows: unknown) => {
      pendingInsert = rows;
      insertCalls.push({ table, rows });
      return chain;
    },
    update: () => chain,
    then: (resolve: (v: unknown) => unknown) => {
      // Awaiting the chain after .in() or .insert() resolves to the next step
      // (so we can stub the result of .in() or .insert() too).
      const r = popResult(pendingIn ? 'in' : pendingInsert !== null ? 'insert' : 'awaited');
      pendingIn = null;
      pendingInsert = null;
      return r.then(resolve);
    },
  });
  return chain;
}

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({
    from: (table: string) => makeChain(table),
  }),
}));

// ── PdaMintClient → FakeMintClient ──
const fakeMint = new FakeMintClient();
vi.mock('../../lib/pda-mint-client.js', () => ({
  getPdaMintClient: () => fakeMint,
}));

import { pmpPacksRoutes } from '../pmp-packs.routes.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use(pmpPacksRoutes());
  return a;
}

function fakeHash(seed: string): string {
  return createHash('sha256').update(seed, 'utf8').digest('hex');
}

beforeEach(() => {
  authedWallet = null;
  stepQueue = [];
  insertCalls = [];
  lastRowsRequested = [];
  fakeMint.reset();
});

// ─────────── POST /v1/packs ───────────

describe('POST /v1/packs', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app())
      .post('/v1/packs')
      .send({ name: 'Test', memory_hash_ids: ['mem-a'] });
    expect(res.status).toBe(401);
  });

  it('returns 422 when name missing', async () => {
    authedWallet = 'wallet-1';
    const res = await request(app())
      .post('/v1/packs')
      .send({ memory_hash_ids: ['mem-a'] });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_body');
  });

  it('returns 422 when memory_hash_ids empty', async () => {
    authedWallet = 'wallet-1';
    const res = await request(app())
      .post('/v1/packs')
      .send({ name: 'Test', memory_hash_ids: [] });
    expect(res.status).toBe(422);
  });

  it('returns 404 when a memory_hash_id is missing', async () => {
    authedWallet = 'wallet-1';
    // The first step (memories .in(hash_id)) returns no rows for one requested id.
    stepQueue.push({
      table: 'memories',
      data: [
        {
          id: 1,
          hash_id: 'mem-a',
          content_hash: fakeHash('a'),
          owner_wallet: 'wallet-1',
          tokenization_status: 'minted',
        },
      ],
    });
    const res = await request(app())
      .post('/v1/packs')
      .send({ name: 'Test', memory_hash_ids: ['mem-a', 'mem-missing'] });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('memories_not_found');
  });

  it('returns 403 when caller does not own a memory', async () => {
    authedWallet = 'wallet-1';
    stepQueue.push({
      table: 'memories',
      data: [
        { id: 1, hash_id: 'mem-a', content_hash: fakeHash('a'), owner_wallet: 'wallet-1', tokenization_status: 'minted' },
        { id: 2, hash_id: 'mem-b', content_hash: fakeHash('b'), owner_wallet: 'wallet-OTHER', tokenization_status: 'minted' },
      ],
    });
    const res = await request(app())
      .post('/v1/packs')
      .send({ name: 'Test', memory_hash_ids: ['mem-a', 'mem-b'] });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('not_owner');
  });

  it('returns 409 when a memory is not yet tokenised', async () => {
    authedWallet = 'wallet-1';
    stepQueue.push({
      table: 'memories',
      data: [
        { id: 1, hash_id: 'mem-a', content_hash: fakeHash('a'), owner_wallet: 'wallet-1', tokenization_status: 'minted' },
        { id: 2, hash_id: 'mem-b', content_hash: null, owner_wallet: 'wallet-1', tokenization_status: 'pending' },
      ],
    });
    const res = await request(app())
      .post('/v1/packs')
      .send({ name: 'Test', memory_hash_ids: ['mem-a', 'mem-b'] });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('memories_not_tokenised');
  });

  it('returns 201 with attestation on happy path', async () => {
    authedWallet = 'wallet-1';
    // Step 1: memories lookup
    stepQueue.push({
      table: 'memories',
      data: [
        { id: 10, hash_id: 'mem-a', content_hash: fakeHash('a'), owner_wallet: 'wallet-1', tokenization_status: 'minted' },
        { id: 11, hash_id: 'mem-b', content_hash: fakeHash('b'), owner_wallet: 'wallet-1', tokenization_status: 'minted' },
        { id: 12, hash_id: 'mem-c', content_hash: fakeHash('c'), owner_wallet: 'wallet-1', tokenization_status: 'minted' },
      ],
    });
    // Step 2: insert into memory_packs
    stepQueue.push({ table: 'memory_packs', data: null });
    // Step 3: insert into memory_pack_contents
    stepQueue.push({ table: 'memory_pack_contents', data: null });

    const res = await request(app())
      .post('/v1/packs')
      .send({
        name: 'Test Pack',
        description: 'desc',
        version: '0.1.0',
        memory_hash_ids: ['mem-a', 'mem-b', 'mem-c'],
        gate_uri: 'https://gate.example/p',
      });
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^pack-[a-f0-9]{8}$/);
    expect(res.body.memory_count).toBe(3);
    expect(res.body.attestation).not.toBeNull();
    expect(res.body.attestation.chain_id).toBe('fake');
    expect(res.body.attestation.merkle_root).toMatch(/^[a-f0-9]{64}$/);
    expect(insertCalls.map((c) => c.table)).toEqual(['memory_packs', 'memory_pack_contents']);
  });
});

// ─────────── GET /v1/packs/:id ───────────

describe('GET /v1/packs/:id', () => {
  it('returns 200 + pack metadata for a known pack', async () => {
    stepQueue.push({
      table: 'memory_packs',
      data: {
        pack_id: 'pack-abc',
        manifest_id: null,
        author_wallet: 'wallet-1',
        name: 'Test',
        description: null,
        version: '1.0.0',
        memory_count: 3,
        created_at: '2026-05-13T00:00:00Z',
        published_at: '2026-05-13T00:00:01Z',
        merkle_root: fakeHash('root'),
        pack_token_address: 'memo:tx-1',
        pack_token_tx_sig: 'tx-1',
        pack_schema_version: 1,
        gate_uri: null,
        tokenized_at: '2026-05-13T00:00:01Z',
      },
    });
    const res = await request(app()).get('/v1/packs/pack-abc');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('pack-abc');
    expect(res.body.attestation).not.toBeNull();
    expect(res.body.attestation.verifier_url).toContain('/v1/packs/pack-abc/verify');
  });

  it('returns 404 when not found', async () => {
    stepQueue.push({ table: 'memory_packs', data: null });
    const res = await request(app()).get('/v1/packs/pack-unknown');
    expect(res.status).toBe(404);
  });

  it('returns 422 on invalid id', async () => {
    const longId = 'x'.repeat(100);
    const res = await request(app()).get(`/v1/packs/${longId}`);
    expect(res.status).toBe(422);
  });
});

// ─────────── GET /v1/packs/:id/preview ───────────

describe('GET /v1/packs/:id/preview', () => {
  const leafHashes = Array.from({ length: 4 }, (_, i) => fakeHash(`leaf-${i}`));
  const tree = buildPackTree(leafHashes);

  function seedPreviewQueries() {
    // Step 1: memory_packs row
    stepQueue.push({
      table: 'memory_packs',
      data: {
        pack_id: 'pack-p',
        name: 'P',
        version: '1.0.0',
        author_wallet: 'wallet-1',
        memory_count: 4,
        merkle_root: tree.root,
        pack_token_address: 'memo:tx-p',
      },
    });
    // Step 2: memory_pack_contents (all 4)
    stepQueue.push({
      table: 'memory_pack_contents',
      data: leafHashes.map((h, i) => ({ memory_id: 100 + i, leaf_index: i, content_hash: h })),
    });
    // Step 3: memories .in(...) — return 1 memory (count=1 default)
    stepQueue.push({
      table: 'memories',
      data: [
        {
          id: 100,
          hash_id: 'mem-0',
          memory_type: 'episodic',
          content: 'content of 0',
          owner_wallet: 'wallet-1',
          created_at: '2026-05-13T12:00:00Z',
          tags: ['t'],
          source: 'chat',
          related_user: null,
          related_wallet: null,
        },
      ],
    });
  }

  it('returns revealed memories + valid inclusion proofs', async () => {
    seedPreviewQueries();
    const res = await request(app()).get('/v1/packs/pack-p/preview?count=1');
    expect(res.status).toBe(200);
    expect(res.body.pack.id).toBe('pack-p');
    expect(res.body.pack.merkle_root).toBe(tree.root);
    expect(res.body.revealed_count).toBe(1);
    expect(res.body.unrevealed_count).toBe(3);
    expect(res.body.revealed).toHaveLength(1);

    const r = res.body.revealed[0];
    expect(r.content_hash).toBe(leafHashes[0]);
    expect(r.leaf_index).toBe(0);

    // Verify the returned proof against the on-chain root
    const proof: MerkleProof = {
      leaf: r.proof.leaf,
      leafIndex: r.proof.leaf_index,
      siblings: r.proof.siblings,
      algorithm: r.proof.algorithm,
    };
    expect(verifyInclusion(tree.root, proof)).toBe(true);
  });

  it('caps count at 10', async () => {
    seedPreviewQueries();
    stepQueue.push({ table: 'memories', data: [] }); // additional in() lookup
    const res = await request(app()).get('/v1/packs/pack-p/preview?count=99999');
    expect(res.status).toBe(200);
    // 4 leaves total, requested clamped to 10 but only 4 exist → 4 revealed
    // (the memories step returns empty in this stub so memory bodies are null,
    // but the proofs + content_hashes are present)
    expect(res.body.revealed_count).toBeLessThanOrEqual(4);
  });

  it('returns 404 for unknown pack', async () => {
    stepQueue.push({ table: 'memory_packs', data: null });
    const res = await request(app()).get('/v1/packs/pack-unknown/preview?count=1');
    expect(res.status).toBe(404);
  });

  it('returns 409 if pack is not tokenised', async () => {
    stepQueue.push({
      table: 'memory_packs',
      data: {
        pack_id: 'pack-draft',
        name: 'd',
        version: '1.0.0',
        author_wallet: 'wallet-1',
        memory_count: 0,
        merkle_root: null,
        pack_token_address: null,
      },
    });
    const res = await request(app()).get('/v1/packs/pack-draft/preview');
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_tokenised');
  });
});

// ─────────── GET /v1/packs/:id/verify ───────────

describe('GET /v1/packs/:id/verify', () => {
  const leaves = Array.from({ length: 5 }, (_, i) => fakeHash(`v-${i}`));
  const tree = buildPackTree(leaves);

  it('returns verified=true when the rebuilt root matches committed root', async () => {
    stepQueue.push({
      table: 'memory_packs',
      data: {
        pack_id: 'pack-v',
        merkle_root: tree.root,
        pack_token_address: 'memo:tx-v',
        pack_token_tx_sig: 'tx-v',
        memory_count: 5,
        tokenized_at: '2026-05-13T00:00:00Z',
      },
    });
    stepQueue.push({
      table: 'memory_pack_contents',
      data: leaves.map((h, i) => ({ content_hash: h, leaf_index: i })),
    });
    const res = await request(app()).get('/v1/packs/pack-v/verify');
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.reason).toBe('verified');
    expect(res.body.commitment.asset_id).toBe('memo:tx-v');
  });

  it('returns drift_detected when leaves have changed', async () => {
    stepQueue.push({
      table: 'memory_packs',
      data: {
        pack_id: 'pack-v2',
        merkle_root: tree.root,
        pack_token_address: 'memo:tx-v2',
        pack_token_tx_sig: 'tx-v2',
        memory_count: 5,
        tokenized_at: '',
      },
    });
    // Return DIFFERENT leaves than what was committed
    stepQueue.push({
      table: 'memory_pack_contents',
      data: leaves.map((_, i) => ({ content_hash: fakeHash(`tampered-${i}`), leaf_index: i })),
    });
    const res = await request(app()).get('/v1/packs/pack-v2/verify');
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.reason).toBe('drift_detected');
  });

  it('returns not_tokenised for a draft pack', async () => {
    stepQueue.push({
      table: 'memory_packs',
      data: {
        pack_id: 'pack-draft',
        merkle_root: null,
        pack_token_address: null,
        pack_token_tx_sig: null,
        memory_count: 0,
        tokenized_at: null,
      },
    });
    const res = await request(app()).get('/v1/packs/pack-draft/verify');
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.reason).toBe('not_tokenised');
  });

  it('returns 404 when pack not found', async () => {
    stepQueue.push({ table: 'memory_packs', data: null });
    const res = await request(app()).get('/v1/packs/pack-nope/verify');
    expect(res.status).toBe(404);
  });
});
