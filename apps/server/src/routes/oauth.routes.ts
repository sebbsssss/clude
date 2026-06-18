/**
 * OAuth 2.1 Authorization Server for the MCP connector.
 *
 * Endpoints (mounted at /api/oauth):
 *   POST /register            RFC 7591 Dynamic Client Registration (public PKCE clients)
 *   GET  /authorize           Validates the request, redirects the browser to the Privy
 *                             consent UI (the chat SPA's /authorize route)
 *   POST /authorize/complete  Called by the consent UI after Privy login: verifies the Privy
 *                             token -> DID -> owner_wallet, issues a single-use auth code
 *   POST /token               authorization_code + refresh_token grants (PKCE-verified)
 *
 * The human never handles an API key — identity flows Privy DID -> findOrCreateAgentForDid ->
 * owner_wallet, the same tenancy unit the rest of the system already scopes to.
 */
import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '@clude/shared/config';
import { createChildLogger } from '@clude/shared/core/logger';
import { findOrCreateAgentForDid } from '@clude/brain/features/agent-tier';
import {
  isOAuthEnabled,
  registerClient,
  getClient,
  issueAuthorizationCode,
  consumeAuthorizationCode,
  verifyPkce,
  normalizeScope,
  mintAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
  DEFAULT_SCOPE,
} from '../oauth/core.js';
import { verifyPrivyTokenToDid } from '../oauth/privy-verify.js';

const log = createChildLogger('oauth-routes');

/** Privy-powered consent UI — a route inside the chat SPA (served at /chat/authorize). */
const CONSENT_PATH = '/chat/authorize';

function originOf(req: Request): string {
  return `${req.protocol}://${req.get('host')}`;
}

function oauthError(res: Response, status: number, error: string, description?: string): void {
  res.status(status).json({ error, error_description: description });
}

const registerSchema = z
  .object({
    redirect_uris: z.array(z.string().url()).min(1),
    client_name: z.string().max(200).optional(),
    scope: z.string().max(200).optional(),
  })
  .passthrough();

const authorizeSchema = z.object({
  response_type: z.literal('code'),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(1),
  code_challenge_method: z.literal('S256'),
  scope: z.string().optional(),
  state: z.string().optional(),
});

const completeSchema = z.object({
  privy_token: z.string().min(1),
  client_id: z.string().min(1),
  redirect_uri: z.string().url(),
  code_challenge: z.string().min(1),
  code_challenge_method: z.literal('S256'),
  scope: z.string().optional(),
  state: z.string().optional(),
});

const codeGrantSchema = z.object({
  grant_type: z.literal('authorization_code'),
  code: z.string().min(1),
  redirect_uri: z.string().url(),
  client_id: z.string().min(1),
  code_verifier: z.string().min(1),
});

const refreshGrantSchema = z.object({
  grant_type: z.literal('refresh_token'),
  refresh_token: z.string().min(1),
  client_id: z.string().min(1),
});

async function handleAuthCodeGrant(req: Request, res: Response): Promise<void> {
  const parsed = codeGrantSchema.safeParse(req.body);
  if (!parsed.success) return oauthError(res, 400, 'invalid_request', parsed.error.message);
  const b = parsed.data;

  const consumed = await consumeAuthorizationCode(b.code);
  if (!consumed) return oauthError(res, 400, 'invalid_grant', 'code invalid, expired, or already used');
  if (consumed.clientId !== b.client_id) return oauthError(res, 400, 'invalid_grant', 'client mismatch');
  if (consumed.redirectUri !== b.redirect_uri) return oauthError(res, 400, 'invalid_grant', 'redirect_uri mismatch');
  if (!verifyPkce(b.code_verifier, consumed.codeChallenge)) {
    return oauthError(res, 400, 'invalid_grant', 'PKCE verification failed');
  }

  const issuer = config.oauth.issuer || originOf(req);
  const { token, expiresIn } = await mintAccessToken({
    ownerWallet: consumed.ownerWallet,
    scope: consumed.scope,
    clientId: consumed.clientId,
    issuer,
  });
  const refresh = await issueRefreshToken({
    clientId: consumed.clientId,
    ownerWallet: consumed.ownerWallet,
    scope: consumed.scope,
  });
  res.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: expiresIn,
    refresh_token: refresh,
    scope: consumed.scope,
  });
}

async function handleRefreshGrant(req: Request, res: Response): Promise<void> {
  const parsed = refreshGrantSchema.safeParse(req.body);
  if (!parsed.success) return oauthError(res, 400, 'invalid_request', parsed.error.message);
  const b = parsed.data;

  const rotated = await rotateRefreshToken(b.refresh_token);
  if (!rotated) return oauthError(res, 400, 'invalid_grant', 'refresh token invalid or expired');
  if (rotated.ctx.clientId !== b.client_id) return oauthError(res, 400, 'invalid_grant', 'client mismatch');

  const issuer = config.oauth.issuer || originOf(req);
  const { token, expiresIn } = await mintAccessToken({
    ownerWallet: rotated.ctx.ownerWallet,
    scope: rotated.ctx.scope,
    clientId: rotated.ctx.clientId,
    issuer,
  });
  res.json({
    access_token: token,
    token_type: 'Bearer',
    expires_in: expiresIn,
    refresh_token: rotated.newRefresh,
    scope: rotated.ctx.scope,
  });
}

export function oauthRoutes(): Router {
  const router = Router();

  // Disable the whole AS cleanly when no signing secret is configured (e.g. local dev),
  // so we never advertise endpoints that then 500.
  router.use((_req: Request, res: Response, next) => {
    if (!isOAuthEnabled()) return oauthError(res, 404, 'not_found', 'OAuth is not enabled on this server');
    next();
  });

  // ── Dynamic Client Registration (RFC 7591) ────────────────────────────────
  router.post('/register', async (req: Request, res: Response) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) return oauthError(res, 400, 'invalid_client_metadata', parsed.error.message);
    try {
      const client = await registerClient({
        clientName: parsed.data.client_name,
        redirectUris: parsed.data.redirect_uris,
        scope: parsed.data.scope,
        metadata: { ua: req.get('user-agent') ?? '' },
      });
      res.status(201).json({
        client_id: client.clientId,
        redirect_uris: client.redirectUris,
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: parsed.data.scope ?? DEFAULT_SCOPE,
      });
    } catch (err: any) {
      log.error({ err }, 'DCR failed');
      oauthError(res, 500, 'server_error');
    }
  });

  // ── Authorization endpoint: validate, then hand off to the Privy consent UI ─
  router.get('/authorize', async (req: Request, res: Response) => {
    const parsed = authorizeSchema.safeParse(req.query);
    if (!parsed.success) return oauthError(res, 400, 'invalid_request', parsed.error.message);
    const q = parsed.data;

    const client = await getClient(q.client_id);
    if (!client) return oauthError(res, 400, 'invalid_client', 'unknown client_id');
    if (!client.redirectUris.includes(q.redirect_uri)) {
      return oauthError(res, 400, 'invalid_request', 'redirect_uri not registered for this client');
    }

    // Only ever redirect to our own consent path (relative) — no open-redirect surface.
    const params = new URLSearchParams({
      client_id: q.client_id,
      redirect_uri: q.redirect_uri,
      code_challenge: q.code_challenge,
      code_challenge_method: q.code_challenge_method,
      scope: normalizeScope(q.scope),
    });
    if (q.state) params.set('state', q.state);
    res.redirect(302, `${CONSENT_PATH}?${params.toString()}`);
  });

  // ── Consent completion: called by the consent UI after Privy login ─────────
  router.post('/authorize/complete', async (req: Request, res: Response) => {
    const parsed = completeSchema.safeParse(req.body);
    if (!parsed.success) return oauthError(res, 400, 'invalid_request', parsed.error.message);
    const b = parsed.data;

    const client = await getClient(b.client_id);
    if (!client || !client.redirectUris.includes(b.redirect_uri)) {
      return oauthError(res, 400, 'invalid_request', 'redirect_uri not registered for this client');
    }

    const did = await verifyPrivyTokenToDid(b.privy_token);
    if (!did) return oauthError(res, 401, 'access_denied', 'Privy verification failed');

    let ownerWallet: string;
    try {
      const agent = await findOrCreateAgentForDid(did);
      ownerWallet = agent.ownerWallet;
    } catch (err: any) {
      log.error({ err }, 'findOrCreateAgentForDid failed');
      return oauthError(res, 500, 'server_error');
    }

    const scope = normalizeScope(b.scope);
    let code: string;
    try {
      code = await issueAuthorizationCode({
        clientId: b.client_id,
        ownerWallet,
        redirectUri: b.redirect_uri,
        scope,
        codeChallenge: b.code_challenge,
        codeChallengeMethod: b.code_challenge_method,
      });
    } catch (err: any) {
      log.error({ err }, 'issue auth code failed');
      return oauthError(res, 500, 'server_error');
    }

    const redirectTo = new URL(b.redirect_uri);
    redirectTo.searchParams.set('code', code);
    if (b.state) redirectTo.searchParams.set('state', b.state);
    res.json({ redirect_to: redirectTo.toString() });
  });

  // ── Token endpoint ─────────────────────────────────────────────────────────
  router.post('/token', async (req: Request, res: Response) => {
    const grant = (req.body && req.body.grant_type) as string | undefined;
    if (grant === 'authorization_code') return handleAuthCodeGrant(req, res);
    if (grant === 'refresh_token') return handleRefreshGrant(req, res);
    return oauthError(res, 400, 'unsupported_grant_type');
  });

  return router;
}
