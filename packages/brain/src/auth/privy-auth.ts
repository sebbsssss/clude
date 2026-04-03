/**
 * Privy JWT verification middleware.
 *
 * Validates Privy access tokens using the @privy-io/node SDK.
 * Attaches decoded user info to req.privyUser for downstream handlers.
 */

import type { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, type VerifyAccessTokenResponse } from '@privy-io/node';
// @ts-ignore — jose is ESM-only, works at runtime via Node CJS/ESM interop
import { createRemoteJWKSet } from 'jose';
import { config } from '@clude/shared/config';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('privy-auth');

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks && config.privy.jwksUrl) {
    jwks = createRemoteJWKSet(new URL(config.privy.jwksUrl));
  }
  return jwks;
}

export interface PrivyUser {
  /** Privy user ID (e.g. "did:privy:...") */
  userId: string;
  /** App ID the token was issued for */
  appId: string;
  /** Session ID */
  sessionId?: string;
  /**
   * Solana wallet addresses linked to this Privy account.
   * Populated lazily by requireOwnership middleware.
   * Undefined until wallet resolution is performed.
   */
  wallets?: string[];
}

declare global {
  namespace Express {
    interface Request {
      privyUser?: PrivyUser;
    }
  }
}

function claimsToPrivyUser(claims: VerifyAccessTokenResponse): PrivyUser {
  return {
    userId: claims.user_id,
    appId: claims.app_id,
    sessionId: claims.session_id,
  };
}

/**
 * Express middleware that verifies Privy JWT from Authorization header.
 * Sets req.privyUser on success, returns 401 on failure.
 */
export function requirePrivyAuth(req: Request, res: Response, next: NextFunction): void {
  if (!config.privy.appId || !config.privy.jwksUrl) {
    res.status(503).json({ error: 'Authentication not configured' });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  const keySet = getJWKS();
  if (!keySet) {
    res.status(500).json({ error: 'JWKS not configured' });
    return;
  }

  verifyAccessToken({
    access_token: token,
    app_id: config.privy.appId,
    verification_key: keySet,
  })
    .then((claims) => {
      req.privyUser = claimsToPrivyUser(claims);
      next();
    })
    .catch((err) => {
      log.warn({ err: err.message }, 'Privy JWT verification failed');
      res.status(401).json({ error: 'Invalid or expired token' });
    });
}

/**
 * Optional auth — attaches user if valid token present, but doesn't block.
 * Useful for endpoints that work both authenticated and unauthenticated.
 */
export function optionalPrivyAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!config.privy.appId || !config.privy.jwksUrl) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7);
  const keySet = getJWKS();
  if (!keySet) {
    next();
    return;
  }

  verifyAccessToken({
    access_token: token,
    app_id: config.privy.appId,
    verification_key: keySet,
  })
    .then((claims) => {
      req.privyUser = claimsToPrivyUser(claims);
      next();
    })
    .catch(() => {
      // Token invalid but that's ok — proceed without user
      next();
    });
}
