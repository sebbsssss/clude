/**
 * Privy JWT verification middleware.
 *
 * Validates Privy access tokens using JWKS endpoint.
 * Attaches decoded user info to req.privyUser for downstream handlers.
 */

import type { Request, Response, NextFunction } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { config } from '../config';
import { createChildLogger } from '../core/logger';

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
}

declare global {
  namespace Express {
    interface Request {
      privyUser?: PrivyUser;
    }
  }
}

/**
 * Express middleware that verifies Privy JWT from Authorization header.
 * Sets req.privyUser on success, returns 401 on failure.
 *
 * If Privy is not configured (no PRIVY_APP_ID), passes through without auth.
 */
export function requirePrivyAuth(req: Request, res: Response, next: NextFunction): void {
  // Skip auth if Privy is not configured
  if (!config.privy.appId || !config.privy.jwksUrl) {
    next();
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

  jwtVerify(token, keySet, {
    issuer: 'privy.io',
    audience: config.privy.appId,
  })
    .then(({ payload }) => {
      req.privyUser = {
        userId: payload.sub || '',
        appId: (payload.aud as string) || config.privy.appId,
        sessionId: payload.sid as string | undefined,
      };
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

  jwtVerify(token, keySet, {
    issuer: 'privy.io',
    audience: config.privy.appId,
  })
    .then(({ payload }) => {
      req.privyUser = {
        userId: payload.sub || '',
        appId: (payload.aud as string) || config.privy.appId,
        sessionId: payload.sid as string | undefined,
      };
      next();
    })
    .catch(() => {
      // Token invalid but that's ok — proceed without user
      next();
    });
}
