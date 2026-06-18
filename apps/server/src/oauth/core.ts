/**
 * OAuth 2.1 core — token minting/validation, PKCE, and the code/refresh stores.
 * Backs the MCP connector's authorization flow (see oauth.routes.ts).
 *
 * Security model:
 *  - Access tokens: stateless HS256 JWTs (jose), short-lived, sub = owner_wallet.
 *  - Authorization codes + refresh tokens: random opaque strings, stored HASHED (sha256).
 *  - Codes are single-use, PKCE-S256-bound, exact-redirect-bound, short TTL.
 *  - Refresh tokens rotate on use; the old hash is revoked and chained (rotated_to) so a
 *    replay of a spent refresh token is rejected.
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
// jose is ESM-only and the server build emits CommonJS (module: node16), so it must be
// loaded with a dynamic import(). Typed loosely (any) to avoid a CJS->ESM *type* import
// (TS1542) at this interop seam; runtime behavior is covered by the oauth core tests.
let josePromise: Promise<any> | null = null;
function loadJose(): Promise<any> {
  return (josePromise ??= import('jose'));
}
import { config } from '@clude/shared/config';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('oauth-core');

export const OAUTH_SCOPES = ['memory:read', 'memory:write'] as const;
export type OAuthScope = (typeof OAUTH_SCOPES)[number];
export const DEFAULT_SCOPE = OAUTH_SCOPES.join(' ');

const AUDIENCE = 'clude:mcp';

export function isOAuthEnabled(): boolean {
  return Boolean(config.oauth.signingSecret);
}

function signingKey(): Uint8Array {
  const secret = config.oauth.signingSecret;
  if (!secret) throw new Error('OAUTH_SIGNING_SECRET not configured');
  return new TextEncoder().encode(secret);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Verify a PKCE code_verifier against a stored S256 challenge (constant-time). */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false;
  const computed = createHash('sha256').update(verifier).digest('base64url');
  const a = Buffer.from(computed);
  const b = Buffer.from(challenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Intersect a requested scope with what's allowed; falls back to the full default scope. */
export function normalizeScope(requested?: string): string {
  if (!requested) return DEFAULT_SCOPE;
  const granted = requested
    .split(/\s+/)
    .filter((s): s is OAuthScope => (OAUTH_SCOPES as readonly string[]).includes(s));
  return granted.length ? granted.join(' ') : DEFAULT_SCOPE;
}

// ── Access tokens (stateless JWT) ───────────────────────────────────────────

export interface AccessTokenClaims {
  sub: string; // owner_wallet
  scope: string;
  clientId: string;
}

export async function mintAccessToken(params: {
  ownerWallet: string;
  scope: string;
  clientId: string;
  issuer: string;
}): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = config.oauth.accessTtlSec;
  const { SignJWT } = await loadJose();
  const token = await new SignJWT({ scope: params.scope, client_id: params.clientId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(params.ownerWallet)
    .setAudience(AUDIENCE)
    .setIssuer(params.issuer || AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(signingKey());
  return { token, expiresIn };
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims | null> {
  try {
    const { jwtVerify } = await loadJose();
    const { payload } = await jwtVerify(token, signingKey(), { audience: AUDIENCE });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      scope: typeof payload.scope === 'string' ? payload.scope : '',
      clientId: typeof payload.client_id === 'string' ? payload.client_id : '',
    };
  } catch {
    return null;
  }
}

// ── Authorization codes (hashed, single-use, PKCE-bound) ─────────────────────

export interface ConsumedCode {
  clientId: string;
  ownerWallet: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}

export async function issueAuthorizationCode(params: {
  clientId: string;
  ownerWallet: string;
  redirectUri: string;
  scope: string;
  codeChallenge: string;
  codeChallengeMethod: string;
}): Promise<string> {
  const code = randomToken(32);
  const expiresAt = new Date(Date.now() + config.oauth.codeTtlSec * 1000).toISOString();
  const { error } = await getDb()
    .from('oauth_authorization_codes')
    .insert({
      code_hash: sha256(code),
      client_id: params.clientId,
      owner_wallet: params.ownerWallet,
      redirect_uri: params.redirectUri,
      scope: params.scope,
      code_challenge: params.codeChallenge,
      code_challenge_method: params.codeChallengeMethod || 'S256',
      expires_at: expiresAt,
    });
  if (error) throw new Error(`failed to persist auth code: ${error.message}`);
  return code;
}

/** Atomically consume an auth code (single-use). Returns null if invalid/expired/already used. */
export async function consumeAuthorizationCode(code: string): Promise<ConsumedCode | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await getDb()
    .from('oauth_authorization_codes')
    .update({ consumed_at: nowIso })
    .eq('code_hash', sha256(code))
    .is('consumed_at', null)
    .gt('expires_at', nowIso)
    .select()
    .maybeSingle();
  if (error) {
    log.error({ err: error }, 'consume auth code failed');
    return null;
  }
  if (!data) return null;
  return {
    clientId: data.client_id,
    ownerWallet: data.owner_wallet,
    redirectUri: data.redirect_uri,
    scope: data.scope ?? '',
    codeChallenge: data.code_challenge,
    codeChallengeMethod: data.code_challenge_method,
  };
}

// ── Refresh tokens (hashed, rotating) ────────────────────────────────────────

export interface RefreshContext {
  clientId: string;
  ownerWallet: string;
  scope: string;
}

export async function issueRefreshToken(ctx: RefreshContext): Promise<string> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.oauth.refreshTtlSec * 1000).toISOString();
  const { error } = await getDb()
    .from('oauth_tokens')
    .insert({
      token_hash: sha256(token),
      token_type: 'refresh',
      client_id: ctx.clientId,
      owner_wallet: ctx.ownerWallet,
      scope: ctx.scope,
      expires_at: expiresAt,
    });
  if (error) throw new Error(`failed to persist refresh token: ${error.message}`);
  return token;
}

/** Validate + rotate a refresh token. Returns the context + a fresh refresh token, or null. */
export async function rotateRefreshToken(
  presented: string,
): Promise<{ ctx: RefreshContext; newRefresh: string } | null> {
  const db = getDb();
  const oldHash = sha256(presented);
  const nowIso = new Date().toISOString();
  // Atomically revoke the old token iff currently valid (single-use rotation).
  const { data, error } = await db
    .from('oauth_tokens')
    .update({ revoked_at: nowIso, last_used_at: nowIso })
    .eq('token_hash', oldHash)
    .eq('token_type', 'refresh')
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .select()
    .maybeSingle();
  if (error) {
    log.error({ err: error }, 'refresh rotation failed');
    return null;
  }
  if (!data) return null; // invalid / expired / already-used (possible replay)
  const ctx: RefreshContext = {
    clientId: data.client_id,
    ownerWallet: data.owner_wallet,
    scope: data.scope ?? '',
  };
  const newRefresh = await issueRefreshToken(ctx);
  await db.from('oauth_tokens').update({ rotated_to: sha256(newRefresh) }).eq('token_hash', oldHash);
  return { ctx, newRefresh };
}

// ── Dynamic Client Registration (RFC 7591) ───────────────────────────────────

export interface RegisteredClient {
  clientId: string;
  redirectUris: string[];
}

export async function registerClient(params: {
  clientName?: string;
  redirectUris: string[];
  scope?: string;
  metadata?: Record<string, unknown>;
}): Promise<RegisteredClient> {
  const clientId = `mcp_${randomToken(16)}`;
  const { error } = await getDb()
    .from('oauth_clients')
    .insert({
      client_id: clientId,
      client_name: params.clientName ?? null,
      redirect_uris: params.redirectUris,
      token_endpoint_auth_method: 'none',
      scope: params.scope ?? DEFAULT_SCOPE,
      metadata: params.metadata ?? {},
    });
  if (error) throw new Error(`failed to register client: ${error.message}`);
  return { clientId, redirectUris: params.redirectUris };
}

export async function getClient(clientId: string): Promise<RegisteredClient | null> {
  const { data, error } = await getDb()
    .from('oauth_clients')
    .select('client_id, redirect_uris')
    .eq('client_id', clientId)
    .maybeSingle();
  if (error || !data) return null;
  return { clientId: data.client_id, redirectUris: data.redirect_uris ?? [] };
}
