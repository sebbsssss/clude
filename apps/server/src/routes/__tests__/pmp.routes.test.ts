/**
 * Integration tests for PMP routes.
 *
 * Mocks the data layer (Supabase, brain.memory, MintClient) and exercises the
 * four verbs end-to-end through supertest. Covers happy paths plus the most
 * common failure modes for each verb.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { FakeMintClient, memoryContentHash } from '@clude/tokenization';

// ── Logger noise ──
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

// ── Auth: per-test injection ──
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

// ── Brain memory ──
const storeMemoryMock = vi.fn();
const recallMemoriesMock = vi.fn();
vi.mock('@clude/brain/memory', () => ({
  storeMemory: (...args: unknown[]) => storeMemoryMock(...args),
  recallMemories: (...args: unknown[]) => recallMemoriesMock(...args),
}));

// ── Supabase: chainable query mock ──
//
// We build a query stub per call site. Each .from() returns a new chain whose
// terminal (.single, .maybeSingle, .limit, .update without await) resolves to
// whatever the test set up.
type QueryResult = { data: unknown; error: unknown };
let queryQueue: QueryResult[] = [];
let updateCalls: Array<{ table: string; patch: unknown; where: unknown }> = [];

function makeQueryChain(table: string): unknown {
  const result = (): Promise<QueryResult> => {
    const next = queryQueue.shift();
    return Promise.resolve(next ?? { data: null, error: null });
  };
  let pendingPatch: unknown = null;
  let pendingWhere: Record<string, unknown> = {};
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      pendingWhere[col] = val;
      return chain;
    },
    not: () => chain,
    or: () => chain,
    order: () => chain,
    overlaps: () => chain,
    limit: () => chain,
    maybeSingle: () => result(),
    single: () => result(),
    update: (patch: unknown) => {
      pendingPatch = patch;
      return chain;
    },
    insert: () => result(),
    // `await db.from('x').update({...}).eq('id', n)` resolves the chain
    then: (resolve: (v: QueryResult) => unknown) => {
      if (pendingPatch !== null) {
        updateCalls.push({ table, patch: pendingPatch, where: { ...pendingWhere } });
        pendingPatch = null;
      }
      return Promise.resolve({ data: null, error: null } as QueryResult).then(resolve);
    },
  };
  return chain;
}

vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({
    from: (table: string) => makeQueryChain(table),
  }),
}));

// ── PdaMintClient: replace with FakeMintClient for tests ──
const fakeMint = new FakeMintClient();
vi.mock('../../lib/pda-mint-client.js', () => ({
  getPdaMintClient: () => fakeMint,
}));

// Import the routes AFTER all mocks are set up.
import { pmpRoutes } from '../pmp.routes.js';

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(pmpRoutes());
  return app;
}

beforeEach(() => {
  authedWallet = null;
  queryQueue = [];
  updateCalls = [];
  storeMemoryMock.mockReset();
  recallMemoriesMock.mockReset();
  fakeMint.reset();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────── DISCOVER ───────────

describe('DISCOVER — GET /v1/memories', () => {
  it('returns 200 and an empty list when no memories match', async () => {
    recallMemoriesMock.mockResolvedValue([]);
    const res = await request(buildApp()).get('/v1/memories');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 0, memories: [] });
  });

  it('maps brain Memory → PMP wire format', async () => {
    recallMemoriesMock.mockResolvedValue([
      {
        id: 1,
        hash_id: 'mem-aaa',
        memory_type: 'episodic',
        content: 'hello',
        owner_wallet: 'wallet-1',
        created_at: '2026-05-13T12:00:00.000Z',
        tags: ['demo'],
        source: 'chat',
        related_user: null,
        related_wallet: null,
        content_hash: 'h',
        cnft_address: 'pda-1',
        cnft_tree: null,
        cnft_leaf_index: null,
        cnft_tx_sig: 'tx-1',
        tokenization_status: 'minted',
      },
    ]);
    const res = await request(buildApp()).get('/v1/memories?limit=10');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.memories[0]).toMatchObject({
      id: 'mem-aaa',
      type: 'episodic',
      content: 'hello',
      owner: 'wallet-1',
      tags: ['demo'],
      attestation: {
        chain_id: 'solana',
        asset_id: 'pda-1',
        content_hash: 'h',
        tx_sig: 'tx-1',
      },
    });
    expect(res.body.memories[0].attestation.verifier_url).toContain('/v1/memories/mem-aaa/verify');
  });

  it('forwards limit + tags + memory_types params to recallMemories', async () => {
    recallMemoriesMock.mockResolvedValue([]);
    await request(buildApp()).get(
      '/v1/memories?query=foo&limit=7&tags=a&tags=b&memory_types=episodic',
    );
    expect(recallMemoriesMock).toHaveBeenCalledTimes(1);
    const args = recallMemoriesMock.mock.calls[0]![0];
    expect(args.query).toBe('foo');
    expect(args.limit).toBe(7);
    expect(args.tags).toEqual(['a', 'b']);
    expect(args.memoryTypes).toEqual(['episodic']);
  });

  it('caps limit at 100', async () => {
    recallMemoriesMock.mockResolvedValue([]);
    await request(buildApp()).get('/v1/memories?limit=500');
    expect(recallMemoriesMock.mock.calls[0]![0].limit).toBe(100);
  });
});

// ─────────── RETRIEVE ───────────

describe('RETRIEVE — GET /v1/memories/:id', () => {
  it('returns 200 + PMP wire format for a known memory', async () => {
    queryQueue.push({
      data: {
        id: 1,
        hash_id: 'mem-aaa',
        memory_type: 'semantic',
        content: 'fact',
        owner_wallet: 'wallet-1',
        created_at: '2026-05-13T12:00:00.000Z',
        tags: ['compliance'],
        source: 'chat',
        related_user: null,
        related_wallet: null,
        content_hash: 'h',
        cnft_address: 'pda-1',
        cnft_tree: null,
        cnft_leaf_index: null,
        cnft_tx_sig: 'tx-1',
        tokenization_status: 'minted',
        summary: '',
        concepts: [],
        emotional_valence: 0,
        importance: 0.5,
        access_count: 0,
        last_accessed: '2026-05-13T12:00:00.000Z',
        decay_factor: 1,
        evidence_ids: [],
        solana_signature: null,
        compacted: false,
        compacted_into: null,
        encrypted: false,
        encryption_pubkey: null,
        metadata: {},
        source_id: null,
      },
      error: null,
    });
    const res = await request(buildApp()).get('/v1/memories/mem-aaa');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('mem-aaa');
    expect(res.body.attestation).not.toBeNull();
  });

  it('returns 404 for an unknown id', async () => {
    queryQueue.push({ data: null, error: null });
    const res = await request(buildApp()).get('/v1/memories/mem-unknown');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('not_found');
  });

  it('returns 410 with successor hint for a compacted memory', async () => {
    queryQueue.push({
      data: {
        hash_id: 'mem-old',
        compacted: true,
        compacted_into: 'mem-new',
      },
      error: null,
    });
    const res = await request(buildApp()).get('/v1/memories/mem-old');
    expect(res.status).toBe(410);
    expect(res.body.error).toBe('revoked');
    expect(res.body.hint).toBe('superseded_by:mem-new');
  });
});

// ─────────── VERIFY ───────────

describe('VERIFY — GET /v1/memories/:id/verify', () => {
  const baseRow = {
    hash_id: 'mem-v1',
    content: 'remember: ship PMP',
    memory_type: 'episodic',
    owner_wallet: null,
    created_at: '2026-05-13T12:00:00.000Z',
    tags: ['pmp'],
    source: 'chat',
    related_user: null,
    related_wallet: null,
    cnft_address: null,
    cnft_tree: null,
    cnft_leaf_index: null,
    cnft_tx_sig: null,
    tokenization_status: null,
    compacted: false,
    compacted_into: null,
    content_hash: null as string | null,
  };

  it('returns verified=true when content matches stored hash and chain has the commitment', async () => {
    const canonical = {
      content: baseRow.content,
      memory_type: 'episodic' as const,
      owner_wallet: null,
      created_at: baseRow.created_at,
      tags: baseRow.tags,
      source: baseRow.source,
      related_user: null,
      related_wallet: null,
    };
    const expectedHash = memoryContentHash(canonical);
    // Seed the fake mint client so verifyMemory finds the commitment.
    await fakeMint.commitMemoryHash({
      contentHash: expectedHash,
      memoryHashId: 'mem-v1',
      ownerWallet: null,
    });
    queryQueue.push({
      data: { ...baseRow, content_hash: expectedHash },
      error: null,
    });
    const res = await request(buildApp()).get('/v1/memories/mem-v1/verify');
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.reason).toBe('verified');
    expect(res.body.recomputed_hash).toBe(expectedHash);
    expect(res.body.stored_hash).toBe(expectedHash);
    expect(res.body.commitment).not.toBeNull();
  });

  it('returns verified=false / not_committed when chain has no commitment', async () => {
    queryQueue.push({ data: { ...baseRow }, error: null });
    const res = await request(buildApp()).get('/v1/memories/mem-v1/verify');
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.reason).toBe('not_committed');
    expect(res.body.commitment).toBeNull();
    expect(res.body.solscan_url).toBeNull();
  });

  it('returns verified_legacy when only a pre-PMP solana_signature exists', async () => {
    // Memory has no cNFT commitment but DOES have a legacy memo signature —
    // committed on-chain before PMP. VERIFY should surface it as verified.
    const legacySig = '5xLegacyMemoTxSig1111111111111111111111111111111111111111111111111111111111111111111111';
    queryQueue.push({
      data: { ...baseRow, solana_signature: legacySig },
      error: null,
    });
    const res = await request(buildApp()).get('/v1/memories/mem-v1/verify');
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
    expect(res.body.reason).toBe('verified_legacy');
    expect(res.body.commitment).not.toBeNull();
    expect(res.body.commitment.chain).toBe('solana');
    expect(res.body.commitment.txSig).toBe(legacySig);
    expect(res.body.solscan_url).toBe(`https://solscan.io/tx/${legacySig}`);
  });

  it('does NOT use the legacy fallback when content has drifted', async () => {
    // A stale stored_hash means the content changed since it was committed.
    // Even with a legacy signature, drift wins — we don't claim verified.
    queryQueue.push({
      data: {
        ...baseRow,
        content_hash: 'stale-hash',
        solana_signature: '5xSomeLegacySig',
      },
      error: null,
    });
    const res = await request(buildApp()).get('/v1/memories/mem-v1/verify');
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.reason).toBe('drift_detected');
  });

  it('returns drift_detected when stored hash differs from recomputed', async () => {
    queryQueue.push({
      data: { ...baseRow, content_hash: 'stale-hash-from-a-prior-version' },
      error: null,
    });
    const res = await request(buildApp()).get('/v1/memories/mem-v1/verify');
    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(false);
    expect(res.body.reason).toBe('drift_detected');
    expect(res.body.stored_hash).toBe('stale-hash-from-a-prior-version');
    expect(res.body.recomputed_hash).not.toBe(res.body.stored_hash);
  });

  it('returns 404 for an unknown id', async () => {
    queryQueue.push({ data: null, error: null });
    const res = await request(buildApp()).get('/v1/memories/mem-unknown/verify');
    expect(res.status).toBe(404);
  });

  it('returns 410 for a compacted memory', async () => {
    queryQueue.push({
      data: { ...baseRow, compacted: true, compacted_into: 'mem-new' },
      error: null,
    });
    const res = await request(buildApp()).get('/v1/memories/mem-v1/verify');
    expect(res.status).toBe(410);
  });
});

// ─────────── CONTRIBUTE ───────────

describe('CONTRIBUTE — POST /v1/memories', () => {
  it('returns 401 when unauthenticated', async () => {
    authedWallet = null;
    const res = await request(buildApp())
      .post('/v1/memories')
      .send({ content: 'x', type: 'episodic' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthenticated');
  });

  it('returns 422 when content or type missing', async () => {
    authedWallet = 'wallet-1';
    const res = await request(buildApp())
      .post('/v1/memories')
      .send({ content: 'x' });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('invalid_body');
  });

  it('returns 201 + attestation on happy path', async () => {
    authedWallet = 'wallet-1';
    storeMemoryMock.mockResolvedValue(42);
    // After storeMemory, route fetches the row by id.
    queryQueue.push({
      data: {
        hash_id: 'mem-new',
        memory_type: 'episodic',
        content: 'fresh memory',
        owner_wallet: 'wallet-1',
        created_at: '2026-05-13T12:00:00.000Z',
        tags: ['pmp'],
        source: 'pmp-contribute',
        related_user: null,
        related_wallet: null,
      },
      error: null,
    });
    const res = await request(buildApp())
      .post('/v1/memories')
      .send({ content: 'fresh memory', type: 'episodic', tags: ['pmp'] });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('mem-new');
    expect(res.body.type).toBe('episodic');
    expect(res.body.owner).toBe('wallet-1');
    expect(res.body.attestation).not.toBeNull();
    expect(res.body.attestation.chain_id).toBe('fake');
    // The patch was written back to the DB.
    expect(updateCalls.some((u) => u.table === 'memories')).toBe(true);
  });

  it('returns 201 with attestation=null when minting fails (memory still stored)', async () => {
    authedWallet = 'wallet-1';
    storeMemoryMock.mockResolvedValue(42);
    queryQueue.push({
      data: {
        hash_id: 'mem-flaky',
        memory_type: 'episodic',
        content: 'flaky',
        owner_wallet: 'wallet-1',
        created_at: '2026-05-13T12:00:00.000Z',
        tags: [],
        source: 'pmp-contribute',
        related_user: null,
        related_wallet: null,
      },
      error: null,
    });
    // Force the mint to throw on this call.
    const original = fakeMint.commitMemoryHash.bind(fakeMint);
    fakeMint.commitMemoryHash = vi.fn().mockRejectedValue(new Error('RPC down'));
    const res = await request(buildApp())
      .post('/v1/memories')
      .send({ content: 'flaky', type: 'episodic' });
    expect(res.status).toBe(201);
    expect(res.body.attestation).toBeNull();
    // The row was marked failed.
    const failedUpdate = updateCalls.find(
      (u) => (u.patch as Record<string, unknown>).tokenization_status === 'failed',
    );
    expect(failedUpdate).toBeTruthy();
    // Restore for other tests
    fakeMint.commitMemoryHash = original;
  });

  it('returns 500 when storeMemory fails', async () => {
    authedWallet = 'wallet-1';
    storeMemoryMock.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/v1/memories')
      .send({ content: 'x', type: 'episodic' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('store_failed');
  });
});
