/**
 * Ownership verification middleware.
 *
 * Ensures the wallet address in the request (?wallet= query param or
 * body.wallet) actually belongs to the authenticated caller — either
 * a Privy user (DID → wallet lookup) or a Cortex API-key holder
 * (owner_wallet on the agent_keys row).
 *
 * Must be placed AFTER an auth middleware that sets req.privyUser or
 * after code that sets (req as any).agent / (req as any).ownerWallet.
 */

import type { Request, Response, NextFunction } from 'express';
import { resolveWalletsForDid } from './privy-wallet-resolver';
import { authenticateAgent } from '../features/agent-tier';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('require-ownership');

const SOLANA_ADDR_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

declare global {
  namespace Express {
    interface Request {
      /** Set by requireOwnership after successful verification. */
      verifiedWallet?: string;
    }
  }
}

/**
 * Extract the wallet the caller claims to own from the request.
 * Checks query param first, then body field.
 */
function extractClaimedWallet(req: Request): string | undefined {
  const fromQuery = req.query.wallet as string | undefined;
  if (fromQuery) return fromQuery;
  if (req.body && typeof req.body.wallet === 'string') return req.body.wallet;
  return undefined;
}

/**
 * Middleware that verifies wallet ownership.
 *
 * Supports two auth paths:
 *  1. Privy JWT (req.privyUser) → resolves linked wallets via Privy Server SDK
 *  2. Cortex API key (Bearer clk_*) → checks owner_wallet on agent_keys row
 *
 * On success: sets req.verifiedWallet and calls next().
 * On failure: returns 400/401/403.
 */
export async function requireOwnership(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const wallet = extractClaimedWallet(req);

  if (!wallet || !SOLANA_ADDR_RE.test(wallet)) {
    res.status(400).json({ error: 'Valid Solana wallet address required (?wallet= or body.wallet)' });
    return;
  }

  // ── Path 1: Privy JWT ── //
  if (req.privyUser) {
    try {
      // TODO: pass identity token when frontend sends X-Privy-Id-Token header
      // to use the non-rate-limited getUser({ idToken }) path.
      const idToken = req.headers['x-privy-id-token'] as string | undefined;
      const wallets = await resolveWalletsForDid(req.privyUser.userId, idToken);
      req.privyUser.wallets = wallets;

      if (wallets.includes(wallet)) {
        req.verifiedWallet = wallet;
        next();
        return;
      }

      log.warn(
        { did: req.privyUser.userId, claimed: wallet, linked: wallets },
        'Wallet ownership check failed — wallet not linked to Privy account',
      );
      res.status(403).json({ error: 'Wallet not linked to your account' });
      return;
    } catch (err: any) {
      log.error({ err: err.message }, 'Wallet resolution failed');
      res.status(500).json({ error: 'Could not verify wallet ownership' });
      return;
    }
  }

  // ── Path 2: Cortex API key (clk_*) ── //
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer clk_')) {
    const apiKey = authHeader.slice(7);
    const agent = await authenticateAgent(apiKey);

    if (!agent) {
      res.status(401).json({ error: 'Invalid or inactive API key' });
      return;
    }

    if (agent.owner_wallet === wallet) {
      req.verifiedWallet = wallet;
      next();
      return;
    }

    log.warn(
      { agentId: agent.agent_id, claimed: wallet, actual: agent.owner_wallet },
      'API key wallet ownership check failed',
    );
    res.status(403).json({ error: 'Wallet does not match API key owner' });
    return;
  }

  // ── No valid auth ── //
  res.status(401).json({ error: 'Authentication required for wallet-scoped access' });
}

/**
 * Lighter variant: skips ownership check if no wallet param is present
 * (falls through to next middleware).  Useful for endpoints that work
 * both with and without a wallet scope, but should verify ownership
 * when a wallet IS provided.
 */
export async function optionalOwnership(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const wallet = extractClaimedWallet(req);
  if (!wallet) {
    next();
    return;
  }
  return requireOwnership(req, res, next);
}
