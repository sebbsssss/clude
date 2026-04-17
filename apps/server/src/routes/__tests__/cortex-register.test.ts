import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import http from 'http';
import type { AddressInfo } from 'net';

// --- Mocks ---
const mockFindOrCreatePrivyUserByEmail = vi.fn();
const mockFindOrCreateAgentForDid = vi.fn();
const mockRegisterAgent = vi.fn();
const mockCheckRateLimit = vi.fn();

vi.mock('@clude/brain/auth/privy-wallet-resolver', () => ({
  findOrCreatePrivyUserByEmail: (...args: any[]) => mockFindOrCreatePrivyUserByEmail(...args),
}));

vi.mock('@clude/brain/features/agent-tier', () => ({
  findOrCreateAgentForDid: (...args: any[]) => mockFindOrCreateAgentForDid(...args),
  registerAgent: (...args: any[]) => mockRegisterAgent(...args),
  authenticateAgent: vi.fn(),
  recordAgentInteraction: vi.fn(),
}));

vi.mock('@clude/shared/utils/rate-limit', () => ({
  checkRateLimit: (...args: any[]) => mockCheckRateLimit(...args),
}));

vi.mock('@clude/shared/core/database', () => ({
  getDb: vi.fn(() => ({
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: [], error: null }),
    update: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
  })),
}));

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  }),
}));

async function request(
  server: http.Server,
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: Record<string, any>; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const port = (server.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}${path}`;
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...opts.headers },
  };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  const res = await fetch(url, init);
  let body: any;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

describe('POST /api/cortex/register', () => {
  let server: http.Server;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const { cortexRoutes } = await import('../cortex.routes.js');
    app.use('/api/cortex', cortexRoutes());
    server = app.listen(0);
  });

  afterAll(() => { server.close(); });

  beforeEach(() => {
    mockFindOrCreatePrivyUserByEmail.mockReset();
    mockFindOrCreateAgentForDid.mockReset();
    mockRegisterAgent.mockReset();
    mockCheckRateLimit.mockReset().mockResolvedValue(true);
  });

  describe('email-based registration', () => {
    it('registers with email only', async () => {
      mockFindOrCreatePrivyUserByEmail.mockResolvedValue('did:privy:abc123');
      mockFindOrCreateAgentForDid.mockResolvedValue({
        agentId: 'agent_xyz',
        apiKey: 'clk_test123',
        isNew: true,
        ownerWallet: 'synthetic-wallet-hash',
      });

      const res = await request(server, 'POST', '/api/cortex/register', {
        body: { name: 'cli-test', email: 'alice@example.com' },
      });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        apiKey: 'clk_test123',
        agentId: 'agent_xyz',
        wallet: 'synthetic-wallet-hash',
        email: 'alice@example.com',
        did: 'did:privy:abc123',
      });
      expect(mockFindOrCreatePrivyUserByEmail).toHaveBeenCalledWith('alice@example.com');
      expect(mockFindOrCreateAgentForDid).toHaveBeenCalledWith('did:privy:abc123', undefined);
    });

    it('registers with email and wallet', async () => {
      mockFindOrCreatePrivyUserByEmail.mockResolvedValue('did:privy:def456');
      mockFindOrCreateAgentForDid.mockResolvedValue({
        agentId: 'agent_abc',
        apiKey: 'clk_test456',
        isNew: false,
        ownerWallet: '7xyz1234567890123456789012345678901234567',
      });

      const res = await request(server, 'POST', '/api/cortex/register', {
        body: {
          name: 'cli-test',
          email: 'bob@example.com',
          wallet: '7xyz1234567890123456789012345678901234567',
        },
      });

      expect(res.status).toBe(200);
      expect(mockFindOrCreateAgentForDid).toHaveBeenCalledWith(
        'did:privy:def456',
        '7xyz1234567890123456789012345678901234567',
      );
    });

    it('rejects invalid email format', async () => {
      const res = await request(server, 'POST', '/api/cortex/register', {
        body: { name: 'cli-test', email: 'not-an-email' },
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/email/i);
      expect(mockFindOrCreatePrivyUserByEmail).not.toHaveBeenCalled();
    });

    it('returns 500 with fallback hint when Privy fails', async () => {
      mockFindOrCreatePrivyUserByEmail.mockRejectedValue(new Error('Privy API down'));

      const res = await request(server, 'POST', '/api/cortex/register', {
        body: { name: 'cli-test', email: 'carol@example.com' },
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toMatch(/Privy API down/);
    });
  });

  describe('backward compatibility (no email)', () => {
    it('still registers with name + wallet (legacy flow)', async () => {
      mockRegisterAgent.mockResolvedValue({
        agentId: 'agent_legacy',
        apiKey: 'clk_legacy',
      });

      const res = await request(server, 'POST', '/api/cortex/register', {
        body: {
          name: 'legacy-agent',
          wallet: '7xyz1234567890123456789012345678901234567',
        },
      });

      expect(res.status).toBe(200);
      expect(res.body.apiKey).toBe('clk_legacy');
      expect(mockRegisterAgent).toHaveBeenCalled();
      expect(mockFindOrCreatePrivyUserByEmail).not.toHaveBeenCalled();
    });

    it('rejects short name', async () => {
      const res = await request(server, 'POST', '/api/cortex/register', {
        body: { name: 'a' },
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name/i);
    });
  });

  describe('rate limiting', () => {
    it('returns 429 when rate limited', async () => {
      mockCheckRateLimit.mockResolvedValue(false);

      const res = await request(server, 'POST', '/api/cortex/register', {
        body: { name: 'spammer', email: 'spam@example.com' },
      });

      expect(res.status).toBe(429);
      expect(res.body.error).toMatch(/Too many/i);
    });
  });
});
