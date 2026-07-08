/**
 * Verify a Privy access token (sent by the browser consent page) and extract the DID.
 * Mirrors the verification in packages/brain/src/auth/privy-auth.ts, but as a standalone
 * helper callable from a route handler (the middleware there only attaches to req).
 */
import { verifyAccessToken } from '@privy-io/node';
import { config } from '@clude/shared/config';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('oauth-privy-verify');

// jose is ESM-only; load it dynamically (the server build emits CommonJS). Typed loosely
// (any) to avoid a CJS->ESM type import (TS1542) at this interop seam.
let josePromise: Promise<any> | null = null;
let jwks: any = null;

async function getJwks(): Promise<any> {
  if (!config.privy.jwksUrl) return null;
  if (!jwks) {
    const { createRemoteJWKSet } = await (josePromise ??= import('jose'));
    jwks = createRemoteJWKSet(new URL(config.privy.jwksUrl));
  }
  return jwks;
}

/** Returns the Privy DID (user_id) for a valid access token, else null. */
export async function verifyPrivyTokenToDid(accessToken: string): Promise<string | null> {
  if (!accessToken) return null;
  const keySet = await getJwks();
  if (!keySet || !config.privy.appId) {
    log.error('Privy not configured (appId / jwksUrl missing)');
    return null;
  }
  try {
    const claims = await verifyAccessToken({
      access_token: accessToken,
      app_id: config.privy.appId,
      verification_key: keySet,
    });
    return claims.user_id ?? null;
  } catch (err: any) {
    log.warn({ err: err?.message }, 'Privy token verification failed');
    return null;
  }
}
