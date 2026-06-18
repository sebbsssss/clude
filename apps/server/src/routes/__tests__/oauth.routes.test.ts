import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createHash, randomBytes } from 'crypto';

// Hoisted mock handles (vi.mock factories are hoisted above imports — see vitest docs).
const { mockCore, mockVerifyPrivy, mockFindAgent } = vi.hoisted(() => ({
  mockCore: {
    registerClient: vi.fn(),
    getClient: vi.fn(),
    issueAuthorizationCode: vi.fn(),
    consumeAuthorizationCode: vi.fn(),
    issueRefreshToken: vi.fn(),
    rotateRefreshToken: vi.fn(),
    isOAuthEnabled: vi.fn(() => true),
  },
  mockVerifyPrivy: vi.fn(),
  mockFindAgent: vi.fn(),
}));

vi.mock('@clude/shared/config', () => ({
  config: {
    oauth: { signingSecret: 'test-secret', issuer: '', accessTtlSec: 3600, refreshTtlSec: 2592000, codeTtlSec: 60 },
    privy: { appId: 'app', jwksUrl: 'https://example.test/jwks' },
  },
}));
vi.mock('@clude/shared/core/database', () => ({ getDb: () => ({}) }));
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info() {}, warn() {}, error() {} }),
}));
vi.mock('@clude/brain/features/agent-tier', () => ({ findOrCreateAgentForDid: mockFindAgent }));
vi.mock('../../oauth/privy-verify.js', () => ({ verifyPrivyTokenToDid: mockVerifyPrivy }));
// Keep the real crypto (verifyPkce, mintAccessToken, normalizeScope); mock only DB-backed fns.
vi.mock('../../oauth/core.js', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, ...mockCore };
});

import { oauthRoutes } from '../oauth.routes.js';

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/oauth', oauthRoutes());
  return app;
}

function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

const REDIRECT = 'https://claude.ai/api/mcp/oauth/callback';

describe('oauth routes', () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    mockCore.isOAuthEnabled.mockReturnValue(true);
    app = makeApp();
  });

  it('DCR registers a public client', async () => {
    mockCore.registerClient.mockResolvedValue({ clientId: 'mcp_x', redirectUris: [REDIRECT] });
    const res = await request(app).post('/api/oauth/register').send({ redirect_uris: [REDIRECT], client_name: 'Claude' });
    expect(res.status).toBe(201);
    expect(res.body.client_id).toBe('mcp_x');
    expect(res.body.token_endpoint_auth_method).toBe('none');
  });

  it('authorize rejects an unregistered redirect_uri', async () => {
    mockCore.getClient.mockResolvedValue({ clientId: 'mcp_x', redirectUris: [REDIRECT] });
    const { challenge } = pkcePair();
    const res = await request(app).get('/api/oauth/authorize').query({
      response_type: 'code', client_id: 'mcp_x', redirect_uri: 'https://evil.example/cb',
      code_challenge: challenge, code_challenge_method: 'S256',
    });
    expect(res.status).toBe(400);
  });

  it('authorize redirects to the consent UI when valid', async () => {
    mockCore.getClient.mockResolvedValue({ clientId: 'mcp_x', redirectUris: [REDIRECT] });
    const { challenge } = pkcePair();
    const res = await request(app).get('/api/oauth/authorize').query({
      response_type: 'code', client_id: 'mcp_x', redirect_uri: REDIRECT,
      code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/chat/authorize');
    expect(res.headers.location).toContain('state=xyz');
  });

  it('authorize/complete rejects an invalid Privy token', async () => {
    mockCore.getClient.mockResolvedValue({ clientId: 'mcp_x', redirectUris: [REDIRECT] });
    mockVerifyPrivy.mockResolvedValue(null);
    const { challenge } = pkcePair();
    const res = await request(app).post('/api/oauth/authorize/complete').send({
      privy_token: 'bad', client_id: 'mcp_x', redirect_uri: REDIRECT,
      code_challenge: challenge, code_challenge_method: 'S256',
    });
    expect(res.status).toBe(401);
  });

  it('authorize/complete issues a code for a verified login', async () => {
    mockCore.getClient.mockResolvedValue({ clientId: 'mcp_x', redirectUris: [REDIRECT] });
    mockVerifyPrivy.mockResolvedValue('did:privy:abc');
    mockFindAgent.mockResolvedValue({ ownerWallet: 'wallet_1', apiKey: 'clk_x', agentId: 'agent_x', isNew: false });
    mockCore.issueAuthorizationCode.mockResolvedValue('the_code');
    const { challenge } = pkcePair();
    const res = await request(app).post('/api/oauth/authorize/complete').send({
      privy_token: 'good', client_id: 'mcp_x', redirect_uri: REDIRECT,
      code_challenge: challenge, code_challenge_method: 'S256', state: 's1',
    });
    expect(res.status).toBe(200);
    expect(res.body.redirect_to).toContain('code=the_code');
    expect(res.body.redirect_to).toContain('state=s1');
    expect(mockFindAgent).toHaveBeenCalledWith('did:privy:abc');
  });

  it('token: authorization_code grant fails on PKCE mismatch', async () => {
    const { challenge } = pkcePair();
    mockCore.consumeAuthorizationCode.mockResolvedValue({
      clientId: 'mcp_x', ownerWallet: 'wallet_1', redirectUri: REDIRECT,
      scope: 'memory:read memory:write', codeChallenge: challenge, codeChallengeMethod: 'S256',
    });
    const res = await request(app).post('/api/oauth/token').send({
      grant_type: 'authorization_code', code: 'the_code', redirect_uri: REDIRECT,
      client_id: 'mcp_x', code_verifier: 'a-wrong-verifier-that-will-not-hash-to-the-challenge',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('token: authorization_code grant returns tokens on valid PKCE', async () => {
    const { verifier, challenge } = pkcePair();
    mockCore.consumeAuthorizationCode.mockResolvedValue({
      clientId: 'mcp_x', ownerWallet: 'wallet_1', redirectUri: REDIRECT,
      scope: 'memory:read memory:write', codeChallenge: challenge, codeChallengeMethod: 'S256',
    });
    mockCore.issueRefreshToken.mockResolvedValue('refresh_1');
    const res = await request(app).post('/api/oauth/token').send({
      grant_type: 'authorization_code', code: 'the_code', redirect_uri: REDIRECT,
      client_id: 'mcp_x', code_verifier: verifier,
    });
    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe('Bearer');
    expect(typeof res.body.access_token).toBe('string');
    expect(res.body.access_token.split('.')).toHaveLength(3); // JWT
    expect(res.body.refresh_token).toBe('refresh_1');
    expect(res.body.expires_in).toBe(3600);
  });

  it('token: rejects a code whose redirect_uri does not match', async () => {
    const { verifier, challenge } = pkcePair();
    mockCore.consumeAuthorizationCode.mockResolvedValue({
      clientId: 'mcp_x', ownerWallet: 'w', redirectUri: REDIRECT,
      scope: 'memory:read', codeChallenge: challenge, codeChallengeMethod: 'S256',
    });
    const res = await request(app).post('/api/oauth/token').send({
      grant_type: 'authorization_code', code: 'c', redirect_uri: 'https://other.example/cb',
      client_id: 'mcp_x', code_verifier: verifier,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('token: invalid/expired/used code is rejected', async () => {
    mockCore.consumeAuthorizationCode.mockResolvedValue(null);
    const res = await request(app).post('/api/oauth/token').send({
      grant_type: 'authorization_code', code: 'spent', redirect_uri: REDIRECT,
      client_id: 'mcp_x', code_verifier: 'whatever',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('token: refresh_token grant rotates and returns new tokens', async () => {
    mockCore.rotateRefreshToken.mockResolvedValue({
      ctx: { clientId: 'mcp_x', ownerWallet: 'wallet_1', scope: 'memory:read memory:write' },
      newRefresh: 'refresh_2',
    });
    const res = await request(app).post('/api/oauth/token').send({
      grant_type: 'refresh_token', refresh_token: 'refresh_1', client_id: 'mcp_x',
    });
    expect(res.status).toBe(200);
    expect(res.body.refresh_token).toBe('refresh_2');
    expect(typeof res.body.access_token).toBe('string');
  });

  it('token: rejects unsupported grant types', async () => {
    const res = await request(app).post('/api/oauth/token').send({ grant_type: 'password' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });

  it('returns 404 on every endpoint when OAuth is disabled', async () => {
    mockCore.isOAuthEnabled.mockReturnValue(false);
    const res = await request(app).post('/api/oauth/register').send({ redirect_uris: [REDIRECT] });
    expect(res.status).toBe(404);
  });
});
