import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'crypto';

// Self-contained config + no real DB/logger for the pure-function tests below.
vi.mock('@clude/shared/config', () => ({
  config: {
    oauth: {
      signingSecret: 'test-signing-secret-do-not-use-in-prod',
      issuer: '',
      accessTtlSec: 3600,
      refreshTtlSec: 2592000,
      codeTtlSec: 60,
    },
  },
}));
vi.mock('@clude/shared/core/database', () => ({ getDb: () => ({}) }));
vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info() {}, warn() {}, error() {} }),
}));

import {
  verifyPkce,
  normalizeScope,
  mintAccessToken,
  verifyAccessToken,
  isOAuthEnabled,
  DEFAULT_SCOPE,
} from '../core';

describe('oauth core — PKCE (S256)', () => {
  it('accepts a correct verifier', () => {
    const verifier = 'a-sufficiently-long-pkce-code-verifier-value-123';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it('rejects a wrong verifier', () => {
    const challenge = createHash('sha256').update('the-real-one').digest('base64url');
    expect(verifyPkce('a-different-one', challenge)).toBe(false);
  });

  it('rejects empty input', () => {
    expect(verifyPkce('', '')).toBe(false);
  });
});

describe('oauth core — scope', () => {
  it('falls back to the full default scope when none requested', () => {
    expect(normalizeScope(undefined)).toBe(DEFAULT_SCOPE);
  });
  it('drops unknown scopes', () => {
    expect(normalizeScope('memory:read evil:admin')).toBe('memory:read');
  });
});

describe('oauth core — access tokens', () => {
  it('mints then verifies a token (roundtrip)', async () => {
    const { token, expiresIn } = await mintAccessToken({
      ownerWallet: 'wallet_abc',
      scope: 'memory:read memory:write',
      clientId: 'mcp_test',
      issuer: 'https://clude.io',
      audience: 'https://clude.io/api/mcp',
    });
    expect(expiresIn).toBe(3600);
    const claims = await verifyAccessToken(token);
    expect(claims?.sub).toBe('wallet_abc');
    expect(claims?.scope).toContain('memory:write');
    expect(claims?.clientId).toBe('mcp_test');
  });

  it('rejects a tampered token', async () => {
    const { token } = await mintAccessToken({
      ownerWallet: 'w',
      scope: 'memory:read',
      clientId: 'c',
      issuer: 'i',
      audience: 'https://clude.io/api/mcp',
    });
    expect(await verifyAccessToken(`${token}tampered`)).toBeNull();
  });

  it('binds the token audience to the requested resource (RFC 8707) and still verifies', async () => {
    const { token } = await mintAccessToken({
      ownerWallet: 'w',
      scope: 'memory:read',
      clientId: 'c',
      issuer: 'https://clude.io',
      audience: 'https://clude.io/api/mcp',
    });
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(payload.aud).toBe('https://clude.io/api/mcp'); // not the old "clude:mcp"
    const claims = await verifyAccessToken(token);
    expect(claims?.sub).toBe('w'); // verification no longer pins a fixed audience
  });

  it('reports enabled when a signing secret is set', () => {
    expect(isOAuthEnabled()).toBe(true);
  });
});
