/**
 * Tests for USDC top-up routes (Helius webhook + client RPC verify).
 * Covers: CLU-167 — QA: Full USDC top-up wallet integration testing before deploy.
 *
 * Routes tested:
 *   POST /webhook/helius/usdc          — Helius enhanced transaction webhook
 *   POST /api/chat/topup/confirm       — Client tx hash RPC verification (topup-routes version)
 *   GET  /api/chat/balance             — Authenticated user balance
 *   GET  /api/chat/topup/history       — Top-up transaction history
 *
 * Security regression (CLU-166):
 *   Documents the unverified /topup/confirm endpoint still present in chat-routes.ts
 *   and demonstrates the route-ordering issue in server.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import http from 'http';

// ---- Mocks (hoisted before imports) ----

vi.mock('../../core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockAuthenticateAgent = vi.fn();
vi.mock('../../features/agent-tier', () => ({
  authenticateAgent: (...args: any[]) => mockAuthenticateAgent(...args),
}));

vi.mock('../../config', () => ({
  config: {
    helius: { webhookSecret: 'test-webhook-secret' },
    usdc: {
      mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      treasuryAddress: 'TREASURY111111111111111111111111111111111111',
    },
    privy: { appId: null, jwksUrl: null },
    features: { freePromoEnabled: false, freePromoCreditUsdc: 1, freePromoExpiry: '' },
  },
}));

const mockGetParsedTransaction = vi.fn();
const mockGetSignaturesForAddress = vi.fn().mockResolvedValue([]);
vi.mock('../../core/solana-client', () => ({
  getConnection: () => ({
    getParsedTransaction: (...args: any[]) => mockGetParsedTransaction(...args),
    getSignaturesForAddress: (...args: any[]) => mockGetSignaturesForAddress(...args),
  }),
}));

// ---- Flexible DB mock ----
// Tests push { data, error } items onto mockDbQueue in the order the queries will fire.
const mockDbQueue: Array<{ data: any; error?: any; count?: number }> = [];

function dequeue() {
  const item = mockDbQueue.shift();
  return Promise.resolve(item ?? { data: null, error: null });
}

function chainBuilder(): any {
  const terminal = {
    single: () => dequeue(),
    then: (onFulfilled: any, onRejected: any) => dequeue().then(onFulfilled, onRejected),
  };
  return new Proxy(terminal, {
    get(target, prop: string) {
      if (prop in target) return (target as any)[prop];
      return (..._args: any[]) => chainBuilder();
    },
  });
}

const mockCheckRateLimit = vi.fn().mockResolvedValue(true);
vi.mock('../../core/database', () => ({
  getDb: () => ({ from: () => chainBuilder() }),
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
}));

import { topupWebhookRoutes, topupApiRoutes } from '../topup.routes.js';
import { config as _mockConfig } from '@clude/shared/config';

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
const mockConfig = _mockConfig as Mutable<typeof _mockConfig>;

// ---- Test infrastructure ----

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TREASURY = 'TREASURY111111111111111111111111111111111111';
const WEBHOOK_SECRET = 'test-webhook-secret';

const AGENT_MOCK = {
  id: 1,
  agent_id: 'agent-1',
  owner_wallet: 'walletABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890AB',
};
const CORTEX_AUTH = { Authorization: 'Bearer clk_validtopupkey' };

// Valid 88-char Solana tx signature (base58 alphabet: no 0, O, I, l)
const VALID_TX_HASH = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789ABCDEFGHJKLMNPQRSTUVW';
const VALID_TX_HASH_2 = '223456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789ABCDEFGHJKLMNPQRSTUVW';

function createWebhookApp() {
  const app = express();
  app.use(express.json());
  app.use('/webhook', topupWebhookRoutes());
  return app;
}

// Simulates req.privyUser for Privy auth path tests
function privyMiddleware(wallet: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    (req as any).privyUser = { userId: 'did:privy:testuser' };
    next();
  };
}

function createApiApp(withPrivy?: { wallet: string }) {
  const app = express();
  app.use(express.json());
  if (withPrivy) {
    app.use(privyMiddleware(withPrivy.wallet));
  }
  app.use('/api/chat', topupApiRoutes());
  return app;
}

async function req(
  server: http.Server,
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: any; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...(opts.headers ?? {}) },
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(url, init);
  let body: any;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

function startServer(app: express.Express): Promise<http.Server> {
  return new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
}
function stopServer(s: http.Server): Promise<void> {
  return new Promise((resolve) => s.close(() => resolve()));
}

// ---- Helius Webhook Tests ----

describe('POST /webhook/helius/usdc — Helius webhook', () => {
  let server: http.Server;
  beforeAll(async () => { server = await startServer(createWebhookApp()); });
  afterAll(async () => stopServer(server));
  beforeEach(() => { mockDbQueue.length = 0; });

  it('rejects missing Authorization header → 401', async () => {
    const r = await req(server, 'POST', '/webhook/helius/usdc', {
      body: [],
    });
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/signature/i);
  });

  it('rejects wrong webhook secret → 401', async () => {
    const r = await req(server, 'POST', '/webhook/helius/usdc', {
      headers: { Authorization: 'Bearer wrong-secret' },
      body: [],
    });
    expect(r.status).toBe(401);
  });

  it('rejects non-array body → 400', async () => {
    const r = await req(server, 'POST', '/webhook/helius/usdc', {
      headers: { Authorization: WEBHOOK_SECRET },
      body: { not: 'an array' },
    });
    expect(r.status).toBe(400);
  });

  it('accepts valid secret with correct length comparison (timing-safe)', async () => {
    // Correct secret — should proceed to process (empty array)
    const r = await req(server, 'POST', '/webhook/helius/usdc', {
      headers: { Authorization: WEBHOOK_SECRET },
      body: [],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, credited: 0, skipped: 0 });
  });

  it('credits balance for valid USDC transfer to treasury', async () => {
    // creditBalance calls: insert chat_topups, select chat_balances, insert chat_balances
    mockDbQueue.push({ data: null, error: null });             // insert topup — success
    mockDbQueue.push({ data: null, error: null });             // select balance — not found
    mockDbQueue.push({ data: null, error: null });             // insert balance — success

    const txPayload = [
      {
        signature: VALID_TX_HASH,
        timestamp: Date.now(),
        slot: 1000,
        type: 'TRANSFER',
        fee: 5000,
        feePayer: 'SenderWallet111111111111111111111111111111111',
        tokenTransfers: [
          {
            fromUserAccount: 'SenderWallet111111111111111111111111111111111',
            toUserAccount: TREASURY,
            fromTokenAccount: 'tokenAccFrom',
            toTokenAccount: 'tokenAccTo',
            mint: USDC_MINT,
            tokenAmount: 10.0,
            tokenStandard: 'Fungible',
          },
        ],
        nativeTransfers: [],
        transactionError: null,
      },
    ];

    const r = await req(server, 'POST', '/webhook/helius/usdc', {
      headers: { Authorization: WEBHOOK_SECRET },
      body: txPayload,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, credited: 1, skipped: 0 });
  });

  it('skips transaction with transactionError (failed tx)', async () => {
    const r = await req(server, 'POST', '/webhook/helius/usdc', {
      headers: { Authorization: WEBHOOK_SECRET },
      body: [
        {
          signature: VALID_TX_HASH,
          tokenTransfers: [{ fromUserAccount: 'Sender', toUserAccount: TREASURY, mint: USDC_MINT, tokenAmount: 5 }],
          transactionError: { err: 'InstructionError' },
        },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, credited: 0, skipped: 1 });
  });

  it('skips transfer to wrong address (not treasury)', async () => {
    const r = await req(server, 'POST', '/webhook/helius/usdc', {
      headers: { Authorization: WEBHOOK_SECRET },
      body: [
        {
          signature: VALID_TX_HASH,
          tokenTransfers: [{ fromUserAccount: 'Sender', toUserAccount: 'SomeOtherWallet111111', mint: USDC_MINT, tokenAmount: 5 }],
          transactionError: null,
        },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, credited: 0, skipped: 1 });
  });

  it('skips transfer with wrong USDC mint (rejects non-native USDC)', async () => {
    const r = await req(server, 'POST', '/webhook/helius/usdc', {
      headers: { Authorization: WEBHOOK_SECRET },
      body: [
        {
          signature: VALID_TX_HASH,
          tokenTransfers: [{ fromUserAccount: 'Sender', toUserAccount: TREASURY, mint: 'FakeMint111111111111111111111111111111111111', tokenAmount: 5 }],
          transactionError: null,
        },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, credited: 0, skipped: 1 });
  });

  it('rejects duplicate tx_hash (idempotency — no double credit)', async () => {
    // First insert returns unique violation (code 23505)
    mockDbQueue.push({ data: null, error: { code: '23505', message: 'duplicate key' } });

    const r = await req(server, 'POST', '/webhook/helius/usdc', {
      headers: { Authorization: WEBHOOK_SECRET },
      body: [
        {
          signature: VALID_TX_HASH,
          tokenTransfers: [{ fromUserAccount: 'Sender', toUserAccount: TREASURY, mint: USDC_MINT, tokenAmount: 10 }],
          transactionError: null,
        },
      ],
    });
    expect(r.status).toBe(200);
    // Credited 0 because duplicate was skipped
    expect(r.body).toMatchObject({ ok: true, credited: 0, skipped: 1 });
  });

  it('processes multiple transactions in a single batch', async () => {
    // Two valid transfers, each needs 3 DB calls
    // Transfer 1: insert topup, select balance (found), update balance
    mockDbQueue.push({ data: null, error: null });
    mockDbQueue.push({ data: { balance_usdc: '5.00', total_deposited: '5.00' }, error: null });
    mockDbQueue.push({ data: null, error: null });
    // Transfer 2: insert topup, select balance (found), update balance
    mockDbQueue.push({ data: null, error: null });
    mockDbQueue.push({ data: { balance_usdc: '15.00', total_deposited: '15.00' }, error: null });
    mockDbQueue.push({ data: null, error: null });

    const r = await req(server, 'POST', '/webhook/helius/usdc', {
      headers: { Authorization: WEBHOOK_SECRET },
      body: [
        {
          signature: VALID_TX_HASH,
          tokenTransfers: [{ fromUserAccount: 'SenderA', toUserAccount: TREASURY, mint: USDC_MINT, tokenAmount: 10 }],
          transactionError: null,
        },
        {
          signature: VALID_TX_HASH_2,
          tokenTransfers: [{ fromUserAccount: 'SenderB', toUserAccount: TREASURY, mint: USDC_MINT, tokenAmount: 5 }],
          transactionError: null,
        },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, credited: 2, skipped: 0 });
  });
});

// ---- API Routes — Balance ----

describe('GET /api/chat/balance — user balance', () => {
  let server: http.Server;
  beforeAll(async () => { server = await startServer(createApiApp()); });
  afterAll(async () => stopServer(server));
  beforeEach(() => { mockDbQueue.length = 0; mockAuthenticateAgent.mockReset(); });

  it('returns 401 for missing auth header', async () => {
    const r = await req(server, 'GET', '/api/chat/balance');
    expect(r.status).toBe(401);
  });

  it('returns 401 for invalid Cortex API key', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(null);
    const r = await req(server, 'GET', '/api/chat/balance', { headers: CORTEX_AUTH });
    expect(r.status).toBe(401);
  });

  it('returns 0 balance for new wallet with no record', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({ data: null, error: null }); // SELECT — no record
    const r = await req(server, 'GET', '/api/chat/balance', { headers: CORTEX_AUTH });
    expect(r.status).toBe(200);
    expect(r.body.balance_usdc).toBe(0);
    expect(r.body.total_deposited).toBe(0);
    expect(r.body.wallet).toBe(AGENT_MOCK.owner_wallet);
  });

  it('returns correct balance for existing wallet', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({
      data: { balance_usdc: '12.50', total_deposited: '20.00', total_spent: '7.50', updated_at: '2026-03-24T00:00:00Z' },
      error: null,
    });
    const r = await req(server, 'GET', '/api/chat/balance', { headers: CORTEX_AUTH });
    expect(r.status).toBe(200);
    expect(r.body.balance_usdc).toBe(12.5);
    expect(r.body.total_deposited).toBe(20.0);
    expect(r.body.total_spent).toBe(7.5);
  });

  it('returns promo fields when FREE_PROMO_ENABLED=true', async () => {
    mockConfig.features.freePromoEnabled = true;
    try {
      mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
      mockDbQueue.push({ data: null, error: null }); // SELECT — no record
      const r = await req(server, 'GET', '/api/chat/balance', { headers: CORTEX_AUTH });
      expect(r.status).toBe(200);
      expect(r.body.promo).toBe(true);
      expect(r.body.promoLabel).toBe('Free - Limited Time');
      expect(r.body.promo_credit_usdc).toBe(1);
    } finally {
      mockConfig.features.freePromoEnabled = false;
    }
  });

  it('omits promo fields when FREE_PROMO_ENABLED=false', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({ data: null, error: null }); // SELECT — no record
    const r = await req(server, 'GET', '/api/chat/balance', { headers: CORTEX_AUTH });
    expect(r.status).toBe(200);
    expect(r.body.promo).toBeUndefined();
    expect(r.body.promoLabel).toBeUndefined();
    expect(r.body.promo_credit_usdc).toBeUndefined();
  });

  it('omits promo fields when enabled but expired', async () => {
    mockConfig.features.freePromoEnabled = true;
    mockConfig.features.freePromoExpiry = '2020-01-01T00:00:00Z'; // past date
    try {
      mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
      mockDbQueue.push({ data: null, error: null });
      const r = await req(server, 'GET', '/api/chat/balance', { headers: CORTEX_AUTH });
      expect(r.status).toBe(200);
      expect(r.body.promo).toBeUndefined();
    } finally {
      mockConfig.features.freePromoEnabled = false;
      mockConfig.features.freePromoExpiry = '';
    }
  });

  it('returns promo fields when enabled and not yet expired', async () => {
    mockConfig.features.freePromoEnabled = true;
    mockConfig.features.freePromoExpiry = '2099-12-31T23:59:59Z'; // far future
    try {
      mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
      mockDbQueue.push({ data: null, error: null });
      const r = await req(server, 'GET', '/api/chat/balance', { headers: CORTEX_AUTH });
      expect(r.status).toBe(200);
      expect(r.body.promo).toBe(true);
      expect(r.body.promo_credit_usdc).toBe(1);
    } finally {
      mockConfig.features.freePromoEnabled = false;
      mockConfig.features.freePromoExpiry = '';
    }
  });

  it('returns promo fields when enabled and no expiry set (never expires)', async () => {
    mockConfig.features.freePromoEnabled = true;
    mockConfig.features.freePromoExpiry = '';
    try {
      mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
      mockDbQueue.push({ data: null, error: null });
      const r = await req(server, 'GET', '/api/chat/balance', { headers: CORTEX_AUTH });
      expect(r.status).toBe(200);
      expect(r.body.promo).toBe(true);
    } finally {
      mockConfig.features.freePromoEnabled = false;
    }
  });
});

// ---- API Routes — Topup History ----

describe('GET /api/chat/topup/history — transaction history', () => {
  let server: http.Server;
  beforeAll(async () => { server = await startServer(createApiApp()); });
  afterAll(async () => stopServer(server));
  beforeEach(() => { mockDbQueue.length = 0; mockAuthenticateAgent.mockReset(); });

  it('returns 401 for unauthenticated request', async () => {
    const r = await req(server, 'GET', '/api/chat/topup/history');
    expect(r.status).toBe(401);
  });

  it('returns empty history for new user', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({ data: [], error: null });
    const r = await req(server, 'GET', '/api/chat/topup/history', { headers: CORTEX_AUTH });
    expect(r.status).toBe(200);
    expect(r.body.topups).toEqual([]);
    expect(r.body.count).toBe(0);
  });

  it('returns list of topup transactions with numeric amounts', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({
      data: [
        { id: 'abc', amount_usdc: '10.00', chain: 'solana', tx_hash: VALID_TX_HASH, status: 'confirmed', created_at: '2026-03-24T01:00:00Z', confirmed_at: '2026-03-24T01:00:30Z' },
        { id: 'def', amount_usdc: '5.50', chain: 'solana', tx_hash: VALID_TX_HASH_2, status: 'confirmed', created_at: '2026-03-23T12:00:00Z', confirmed_at: '2026-03-23T12:00:10Z' },
      ],
      error: null,
    });
    const r = await req(server, 'GET', '/api/chat/topup/history', { headers: CORTEX_AUTH });
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(2);
    expect(r.body.topups[0].amount_usdc).toBe(10.0);
    expect(r.body.topups[1].amount_usdc).toBe(5.5);
    expect(typeof r.body.topups[0].amount_usdc).toBe('number');
  });

  it('returns 500 on DB error', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({ data: null, error: { message: 'DB error' } });
    const r = await req(server, 'GET', '/api/chat/topup/history', { headers: CORTEX_AUTH });
    expect(r.status).toBe(500);
  });
});

// ---- API Routes — /topup/confirm (verified path in topup-routes.ts) ----

describe('POST /api/chat/topup/confirm — RPC-verified top-up', () => {
  let server: http.Server;
  beforeAll(async () => { server = await startServer(createApiApp()); });
  afterAll(async () => stopServer(server));
  beforeEach(() => {
    mockDbQueue.length = 0;
    mockAuthenticateAgent.mockReset();
    mockGetParsedTransaction.mockReset();
  });

  it('returns 401 for unauthenticated request', async () => {
    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      body: { tx_hash: VALID_TX_HASH },
    });
    expect(r.status).toBe(401);
  });

  it('returns 400 when tx_hash is missing', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: {},
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/tx_hash/i);
  });

  it('returns 400 for invalid Solana tx signature format (too short)', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: 'fakehash123' },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/format/i);
  });

  it('returns 400 for invalid Solana tx signature format (contains invalid chars)', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    const invalidHash = '0'.repeat(88); // '0' is not valid base58
    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: invalidHash },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/format/i);
  });

  it('returns already_confirmed for a duplicate tx_hash', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({ data: { id: 'existing-id', status: 'confirmed', amount_usdc: '10.00' }, error: null });
    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: VALID_TX_HASH },
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('already_confirmed');
    expect(r.body.amount_usdc).toBe(10.0);
  });

  it('returns 400 when RPC cannot find the transaction', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({ data: null, error: null }); // SELECT — not found (no duplicate)
    // Must return null for all retry attempts (3 total)
    mockGetParsedTransaction.mockResolvedValue(null);
    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: VALID_TX_HASH },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not found|retries/i);
    mockGetParsedTransaction.mockReset();
  }, 15_000);

  it('returns 400 when on-chain tx has an error', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({ data: null, error: null });
    mockGetParsedTransaction.mockResolvedValueOnce({ meta: { err: { err: 'InstructionError' } } });
    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: VALID_TX_HASH },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/failed/i);
  });

  it('returns 400 when tx has no USDC transfer to treasury', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({ data: null, error: null });
    mockGetParsedTransaction.mockResolvedValueOnce({
      meta: {
        err: null,
        preTokenBalances: [],
        postTokenBalances: [], // no treasury balance
      },
      transaction: { message: { accountKeys: [{ pubkey: { toString: () => 'SenderWallet' } }] } },
    });
    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: VALID_TX_HASH },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/treasury|transfer/i);
  });

  it('credits balance for valid verified transaction', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    // 1. SELECT existing topup — not found
    mockDbQueue.push({ data: null, error: null });
    // 2. INSERT chat_topups — success
    mockDbQueue.push({ data: null, error: null });
    // 3. SELECT chat_balances — not found (new user)
    mockDbQueue.push({ data: null, error: null });
    // 4. INSERT chat_balances — success
    mockDbQueue.push({ data: null, error: null });

    const senderWallet = 'SenderWallet111111111111111111111111111111111';
    mockGetParsedTransaction.mockResolvedValueOnce({
      meta: {
        err: null,
        preTokenBalances: [],
        postTokenBalances: [
          {
            owner: TREASURY,
            mint: USDC_MINT,
            uiTokenAmount: { uiAmount: 10.0 },
          },
        ],
      },
      transaction: { message: { accountKeys: [{ pubkey: { toString: () => senderWallet } }] } },
    });

    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: VALID_TX_HASH },
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('confirmed');
    expect(r.body.amount_usdc).toBe(10.0);
    expect(r.body.sender).toBe(senderWallet);
  });

  it('credits correct delta amount when treasury already had a balance', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({ data: null, error: null }); // SELECT topup — not found
    mockDbQueue.push({ data: null, error: null }); // INSERT topup
    mockDbQueue.push({ data: { balance_usdc: '100.00', total_deposited: '100.00' }, error: null }); // SELECT balance
    mockDbQueue.push({ data: null, error: null }); // UPDATE balance

    mockGetParsedTransaction.mockResolvedValueOnce({
      meta: {
        err: null,
        preTokenBalances: [{ owner: TREASURY, mint: USDC_MINT, uiTokenAmount: { uiAmount: 100.0 } }],
        postTokenBalances: [{ owner: TREASURY, mint: USDC_MINT, uiTokenAmount: { uiAmount: 105.0 } }],
      },
      transaction: { message: { accountKeys: [{ pubkey: { toString: () => 'SenderWallet' } }] } },
    });

    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: VALID_TX_HASH },
    });
    expect(r.status).toBe(200);
    expect(r.body.amount_usdc).toBe(5.0); // pre=100, post=105, delta=5
  });
});

// ---- Security Regression: CLU-166 Route Ordering Issue ----

describe('CLU-166 Security regression: unverified /topup/confirm endpoint', () => {
  /**
   * CRITICAL: server.ts mounts chatRoutes() at line 485 BEFORE topupApiRoutes() at line 488.
   * Both register POST /topup/confirm under /api/chat.
   * Express first-match wins, so the UNVERIFIED endpoint in chat-routes.ts takes precedence.
   *
   * The unverified endpoint (chat-routes.ts:1097) accepts amount_usdc from the client body
   * and credits the balance without any on-chain verification.
   *
   * These tests demonstrate that the topup-routes verified endpoint works correctly IN ISOLATION,
   * but also document the server.ts mounting order issue that must be fixed by CLU-166.
   *
   * FIX REQUIRED: Remove the /topup/confirm handler from chat-routes.ts (lines ~1097-1191).
   */

  it('topup-routes /topup/confirm rejects request with missing tx_hash (verified path works)', async () => {
    const app = createApiApp();
    const s = await startServer(app);
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    const r = await req(s, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { amount_usdc: 999 }, // no tx_hash — attacker-style request
    });
    await stopServer(s);
    // Verified endpoint correctly rejects missing tx_hash
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/tx_hash/i);
  });

  it('verified confirm does NOT accept amount_usdc from client body (RPC determines amount)', async () => {
    /**
     * The VERIFIED endpoint in topup-routes.ts ignores amount_usdc in the request body.
     * It only accepts the tx_hash and derives the amount from on-chain data via RPC.
     * Contrast with the UNVERIFIED endpoint in chat-routes.ts which reads amount_usdc directly
     * from req.body and credits it without verification.
     */
    const app = createApiApp();
    const s = await startServer(app);
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.length = 0;
    mockDbQueue.push({ data: null, error: null }); // SELECT — not found

    // RPC returns a verified $1 transfer
    mockGetParsedTransaction.mockResolvedValueOnce({
      meta: {
        err: null,
        preTokenBalances: [],
        postTokenBalances: [{ owner: TREASURY, mint: USDC_MINT, uiTokenAmount: { uiAmount: 1.0 } }],
      },
      transaction: { message: { accountKeys: [{ pubkey: { toString: () => 'SenderWallet' } }] } },
    });
    mockDbQueue.push({ data: null, error: null }); // INSERT topup
    mockDbQueue.push({ data: null, error: null }); // SELECT balance — not found
    mockDbQueue.push({ data: null, error: null }); // INSERT balance

    // Attacker sends amount_usdc: 999 but the RPC only verifies $1
    const r = await req(s, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: VALID_TX_HASH, amount_usdc: 999 },
    });
    await stopServer(s);
    expect(r.status).toBe(200);
    // The verified path uses RPC-determined amount (1.0), not the client-supplied 999
    expect(r.body.amount_usdc).toBe(1.0);
  });
});

// ---- Solana Pay Intent Creation ----

describe('POST /api/chat/topup/intent — Solana Pay intent', () => {
  let server: http.Server;
  beforeAll(async () => { server = await startServer(createApiApp()); });
  afterAll(async () => stopServer(server));
  beforeEach(() => {
    mockDbQueue.length = 0;
    mockAuthenticateAgent.mockReset();
    mockCheckRateLimit.mockResolvedValue(true);
  });

  it('returns 401 for unauthenticated request', async () => {
    const r = await req(server, 'POST', '/api/chat/topup/intent', { body: { amount_usdc: 10 } });
    expect(r.status).toBe(401);
  });

  it('returns 400 when amount_usdc is missing', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    const r = await req(server, 'POST', '/api/chat/topup/intent', {
      headers: CORTEX_AUTH,
      body: {},
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/amount_usdc/i);
  });

  it('returns 400 when amount_usdc < 1 (minimum enforcement)', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    const r = await req(server, 'POST', '/api/chat/topup/intent', {
      headers: CORTEX_AUTH,
      body: { amount_usdc: 0.5 },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/minimum/i);
  });

  it('returns 400 when amount_usdc is 0', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    const r = await req(server, 'POST', '/api/chat/topup/intent', {
      headers: CORTEX_AUTH,
      body: { amount_usdc: 0 },
    });
    expect(r.status).toBe(400);
  });

  it('returns 429 when rate limit exceeded', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockCheckRateLimit.mockResolvedValueOnce(false);
    const r = await req(server, 'POST', '/api/chat/topup/intent', {
      headers: CORTEX_AUTH,
      body: { amount_usdc: 10 },
    });
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/too many/i);
  });

  it('returns 500 on DB insert error', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({ data: null, error: { message: 'insert error' } });
    const r = await req(server, 'POST', '/api/chat/topup/intent', {
      headers: CORTEX_AUTH,
      body: { amount_usdc: 5 },
    });
    expect(r.status).toBe(500);
  });

  it('creates intent and returns Solana Pay URL with correct format', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    const fakeReference = '9Mbn3wJrNxFfJvM2PiHGKMTnqQF3nVvUHF1PPKJxYa5m';
    mockDbQueue.push({
      data: {
        id: 'intent-uuid-123',
        wallet_address: AGENT_MOCK.owner_wallet,
        amount_usdc: '10',
        chain: 'solana',
        reference: fakeReference,
      },
      error: null,
    });
    const r = await req(server, 'POST', '/api/chat/topup/intent', {
      headers: CORTEX_AUTH,
      body: { amount_usdc: 10 },
    });
    expect(r.status).toBe(200);
    expect(r.body.id).toBe('intent-uuid-123');
    expect(r.body.amount_usdc).toBe(10);
    expect(r.body.dest_address).toBe(TREASURY);
    expect(r.body.chain).toBe('solana');
    // Solana Pay URL format: solana:<treasury>?amount=<n>&spl-token=<mint>&reference=<ref>&memo=<wallet>
    expect(r.body.solana_pay_url).toMatch(/^solana:/);
    expect(r.body.solana_pay_url).toContain(TREASURY);
    expect(r.body.solana_pay_url).toContain(`amount=10`);
    expect(r.body.solana_pay_url).toContain(`spl-token=${USDC_MINT}`);
    expect(r.body.reference).toBeTruthy();
  });

  it('defaults chain to solana when not specified', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({
      data: { id: 'intent-2', wallet_address: AGENT_MOCK.owner_wallet, amount_usdc: '5', chain: 'solana', reference: 'ref123' },
      error: null,
    });
    const r = await req(server, 'POST', '/api/chat/topup/intent', {
      headers: CORTEX_AUTH,
      body: { amount_usdc: 5 },
    });
    expect(r.status).toBe(200);
    expect(r.body.chain).toBe('solana');
  });
});

// ---- /topup/confirm with intent_id (reference-based path) ----

describe('POST /api/chat/topup/confirm — intent_id path', () => {
  let server: http.Server;
  beforeAll(async () => { server = await startServer(createApiApp()); });
  afterAll(async () => stopServer(server));
  beforeEach(() => {
    mockDbQueue.length = 0;
    mockAuthenticateAgent.mockReset();
    mockGetParsedTransaction.mockReset();
    mockCheckRateLimit.mockResolvedValue(true);
  });

  it('returns 404 when intent_id not found', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({ data: null, error: null }); // SELECT intent — not found
    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: VALID_TX_HASH, intent_id: 'nonexistent-intent' },
    });
    expect(r.status).toBe(404);
    expect(r.body.error).toMatch(/intent not found/i);
  });

  it('returns already_confirmed when intent already confirmed', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({
      data: { id: 'intent-1', status: 'confirmed', amount_usdc: '10.00', reference: 'ref123', wallet_address: AGENT_MOCK.owner_wallet, chain: 'solana' },
      error: null,
    });
    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: VALID_TX_HASH, intent_id: 'intent-1' },
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('already_confirmed');
    expect(r.body.amount_usdc).toBe(10.0);
  });

  it('returns 400 when RPC verification fails for intent path', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockDbQueue.push({
      data: { id: 'intent-1', status: 'pending', amount_usdc: '10.00', reference: 'ref123', wallet_address: AGENT_MOCK.owner_wallet, chain: 'solana' },
      error: null,
    });
    // Must return null for all retry attempts (3 total)
    mockGetParsedTransaction.mockResolvedValue(null);
    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: VALID_TX_HASH, intent_id: 'intent-1' },
    });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not found|retries/i);
    mockGetParsedTransaction.mockReset();
  }, 15_000);

  it('returns 500 on DB update error for intent', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    // SELECT intent — found pending
    mockDbQueue.push({
      data: { id: 'intent-1', status: 'pending', amount_usdc: '5.00', reference: 'ref123', wallet_address: AGENT_MOCK.owner_wallet, chain: 'solana' },
      error: null,
    });
    // RPC valid
    mockGetParsedTransaction.mockResolvedValueOnce({
      meta: {
        err: null,
        preTokenBalances: [],
        postTokenBalances: [{ owner: TREASURY, mint: USDC_MINT, uiTokenAmount: { uiAmount: 5.0 } }],
      },
      transaction: { message: { accountKeys: [{ pubkey: { toString: () => 'Sender' } }] } },
    });
    // UPDATE intent — fails
    mockDbQueue.push({ data: null, error: { message: 'update failed' } });
    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: VALID_TX_HASH, intent_id: 'intent-1' },
    });
    expect(r.status).toBe(500);
  });

  it('confirms intent and credits balance via intent_id path', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    // SELECT intent — found pending
    mockDbQueue.push({
      data: { id: 'intent-1', status: 'pending', amount_usdc: '10.00', reference: 'ref123', wallet_address: AGENT_MOCK.owner_wallet, chain: 'solana' },
      error: null,
    });
    // RPC verification returns $10
    mockGetParsedTransaction.mockResolvedValueOnce({
      meta: {
        err: null,
        preTokenBalances: [],
        postTokenBalances: [{ owner: TREASURY, mint: USDC_MINT, uiTokenAmount: { uiAmount: 10.0 } }],
      },
      transaction: { message: { accountKeys: [{ pubkey: { toString: () => 'SenderWallet' } }] } },
    });
    // UPDATE intent — success
    mockDbQueue.push({ data: null, error: null });
    // creditBalanceOnly: SELECT balance — not found
    mockDbQueue.push({ data: null, error: null });
    // creditBalanceOnly: INSERT balance — success
    mockDbQueue.push({ data: null, error: null });

    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: VALID_TX_HASH, intent_id: 'intent-1' },
    });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('confirmed');
    expect(r.body.amount_usdc).toBe(10.0);
    expect(r.body.credited_to).toBe(AGENT_MOCK.owner_wallet);
    expect(r.body.balance_usdc).toBe(10.0);
  });
});

// ---- Rate limiting on /topup/confirm ----

describe('POST /api/chat/topup/confirm — rate limiting', () => {
  let server: http.Server;
  beforeAll(async () => { server = await startServer(createApiApp()); });
  afterAll(async () => stopServer(server));
  beforeEach(() => {
    mockDbQueue.length = 0;
    mockAuthenticateAgent.mockReset();
    mockCheckRateLimit.mockResolvedValue(true);
  });

  it('returns 429 when rate limit exceeded on confirm', async () => {
    mockAuthenticateAgent.mockResolvedValueOnce(AGENT_MOCK);
    mockCheckRateLimit.mockResolvedValueOnce(false);
    const r = await req(server, 'POST', '/api/chat/topup/confirm', {
      headers: CORTEX_AUTH,
      body: { tx_hash: VALID_TX_HASH },
    });
    expect(r.status).toBe(429);
    expect(r.body.error).toMatch(/too many/i);
  });
});

// ---- Reference-based Helius webhook matching ----

describe('POST /webhook/helius/usdc — reference-based intent matching', () => {
  let server: http.Server;
  beforeAll(async () => { server = await startServer(createWebhookApp()); });
  afterAll(async () => stopServer(server));
  beforeEach(() => { mockDbQueue.length = 0; });

  const REFERENCE_KEY = '9Mbn3wJrNxFfJvM2PiHGKMTnqQF3nVvUHF1PPKJxYa5m';

  it('credits via reference match when accountData contains the reference key', async () => {
    // Reference-based path DB calls:
    // 1. SELECT pending intents
    // 2. UPDATE intent to confirmed
    // 3. creditBalanceOnly: SELECT balance — not found
    // 4. creditBalanceOnly: INSERT balance
    mockDbQueue.push({
      data: [{ id: 'intent-1', wallet_address: 'UserWalletABC', reference: REFERENCE_KEY }],
      error: null,
    });
    mockDbQueue.push({ data: null, error: null }); // UPDATE intent
    mockDbQueue.push({ data: null, error: null }); // SELECT balance — not found
    mockDbQueue.push({ data: null, error: null }); // INSERT balance

    const r = await req(server, 'POST', '/webhook/helius/usdc', {
      headers: { Authorization: WEBHOOK_SECRET },
      body: [
        {
          signature: VALID_TX_HASH,
          tokenTransfers: [{ fromUserAccount: 'SomeFeePayer', toUserAccount: TREASURY, mint: USDC_MINT, tokenAmount: 10 }],
          transactionError: null,
          accountData: [
            { account: 'someOtherAccount' },
            { account: REFERENCE_KEY }, // reference key in accountData
          ],
        },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, credited: 1, skipped: 0 });
  });

  it('falls back to fee-payer credit when no matching reference found', async () => {
    // accountData has accounts, but none match a pending intent
    // 1. SELECT pending intents — returns intents with different references
    mockDbQueue.push({
      data: [{ id: 'intent-99', wallet_address: 'OtherWallet', reference: 'DifferentReference11111111111111111111111111' }],
      error: null,
    });
    // Fallback: creditBalance for fee-payer
    // 2. INSERT topup — success
    mockDbQueue.push({ data: null, error: null });
    // 3. SELECT balance — not found
    mockDbQueue.push({ data: null, error: null });
    // 4. INSERT balance
    mockDbQueue.push({ data: null, error: null });

    const r = await req(server, 'POST', '/webhook/helius/usdc', {
      headers: { Authorization: WEBHOOK_SECRET },
      body: [
        {
          signature: VALID_TX_HASH,
          tokenTransfers: [{ fromUserAccount: 'FeePayer', toUserAccount: TREASURY, mint: USDC_MINT, tokenAmount: 5 }],
          transactionError: null,
          accountData: [{ account: 'NotMatchingRef1111111111111111111111111111' }],
        },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, credited: 1, skipped: 0 });
  });

  it('uses fee-payer fallback when no accountData present', async () => {
    // No accountData → skip reference lookup, go straight to fee-payer creditBalance
    mockDbQueue.push({ data: null, error: null }); // INSERT topup
    mockDbQueue.push({ data: null, error: null }); // SELECT balance — not found
    mockDbQueue.push({ data: null, error: null }); // INSERT balance

    const r = await req(server, 'POST', '/webhook/helius/usdc', {
      headers: { Authorization: WEBHOOK_SECRET },
      body: [
        {
          signature: VALID_TX_HASH,
          tokenTransfers: [{ fromUserAccount: 'FeePayer', toUserAccount: TREASURY, mint: USDC_MINT, tokenAmount: 7 }],
          transactionError: null,
          // no accountData field
        },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, credited: 1, skipped: 0 });
  });
});
