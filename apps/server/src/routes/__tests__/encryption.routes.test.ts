import { beforeEach, describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

// Auth injection
let authedWallet: string | null = null;
vi.mock('@clude/brain/auth/privy-auth', () => ({
  requirePrivyAuth: (req: Request, res: Response, next: NextFunction) => {
    if (!authedWallet) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    (req as Request & { verifiedWallet?: string }).verifiedWallet = authedWallet;
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

// Programmable DB: single-revoke uses select().eq().maybeSingle(); revoke-all uses
// select().eq().eq().not() (awaited). memLookup feeds maybeSingle; revokeAllRows feeds not().
let memLookup: unknown;
let revokeAllRows: unknown[];
vi.mock('@clude/shared/core/database', () => ({
  getDb: () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: () => chain,
        not: () => Promise.resolve({ data: revokeAllRows, error: null }),
        maybeSingle: async () => ({ data: memLookup, error: null }),
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
  authedWallet = 'WALLET_A';
  memLookup = { id: 7, owner_wallet: 'WALLET_A' };
  revokeAllRows = [{ id: 1 }, { id: 2 }];
  revokeMemoryMock.mockReset();
  revokeMemoryMock.mockResolvedValue({ revoked: true });
  redelegateMemoryMock.mockReset();
  redelegateMemoryMock.mockResolvedValue({ redelegated: true });
});

describe('POST /v1/memories/:id/revoke', () => {
  it('revokes for the owner', async () => {
    const res = await request(app()).post('/v1/memories/mem-x/revoke');
    expect(res.status).toBe(200);
    expect(res.body.revoked).toBe(true);
    expect(revokeMemoryMock).toHaveBeenCalledWith(expect.anything(), 7);
  });

  it('403 for a non-owner', async () => {
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
    authedWallet = null;
    const res = await request(app()).post('/v1/memories/mem-x/revoke');
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/memories/:id/redelegate', () => {
  const wrap = { wrapped_dek: 'WRAP', wrap_pubkey: 'PUB' };

  it('re-delegates for the owner', async () => {
    const res = await request(app()).post('/v1/memories/mem-x/redelegate').send(wrap);
    expect(res.status).toBe(200);
    expect(res.body.redelegated).toBe(true);
    expect(redelegateMemoryMock).toHaveBeenCalledWith(expect.anything(), 7, wrap);
  });

  it('403 for a non-owner', async () => {
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

  it('401 when unauthenticated', async () => {
    authedWallet = null;
    const res = await request(app()).post('/v1/memories/mem-x/redelegate').send(wrap);
    expect(res.status).toBe(401);
  });
});

describe('POST /v1/keys/revoke-all', () => {
  it('revokes all the owner’s delegated memories', async () => {
    const res = await request(app()).post('/v1/keys/revoke-all');
    expect(res.status).toBe(200);
    expect(res.body.revoked_count).toBe(2);
    expect(res.body.total).toBe(2);
    expect(revokeMemoryMock).toHaveBeenCalledTimes(2);
  });
});
