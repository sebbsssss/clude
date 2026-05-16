/**
 * PMP admin routes — operational endpoints for running the tokenisation
 * backfill against existing memories.
 *
 *   POST /v1/admin/backfill        Start a backfill in the background
 *   GET  /v1/admin/backfill        Status of the current / last run
 *   POST /v1/admin/backfill/stop   Request the in-flight backfill to stop
 *
 * Auth: a static admin token. The caller passes it in the `X-Admin-Token`
 * header; it must match the `PMP_ADMIN_TOKEN` environment variable. If that
 * env var is not set, every endpoint here returns 503 — the surface is
 * disabled by default and fails closed.
 *
 * Why a static token rather than Privy/wallet auth: this is an internal ops
 * surface, triggered by a maintainer with a curl, not by end users. A shared
 * secret in the deploy environment is the least-moving-parts way to gate it.
 * The token is compared in constant time to avoid leaking length/prefix.
 */

import { Router, type Request, type Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { createChildLogger } from '@clude/shared/core/logger';
import {
  startBackfill,
  requestBackfillStop,
  getBackfillStatus,
} from '../lib/pmp-backfill-runner.js';

const log = createChildLogger('pmp-admin-routes');

interface AdminErrorBody {
  error: string;
  reason?: string;
  hint?: string;
}

/** Constant-time string compare. Returns false on length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Gate: returns true if the request carries a valid admin token.
 * Writes the appropriate error response and returns false otherwise.
 */
function adminGate(req: Request, res: Response): boolean {
  const configured = process.env.PMP_ADMIN_TOKEN;
  if (!configured || configured.length === 0) {
    res.status(503).json({
      error: 'admin_disabled',
      hint: 'set PMP_ADMIN_TOKEN in the environment to enable admin endpoints',
    } satisfies AdminErrorBody);
    return false;
  }
  const provided = req.headers['x-admin-token'];
  if (typeof provided !== 'string' || !safeEqual(provided, configured)) {
    res.status(401).json({
      error: 'unauthorized',
      hint: 'provide a valid X-Admin-Token header',
    } satisfies AdminErrorBody);
    return false;
  }
  return true;
}

/** Clamp a numeric param into [min, max], or undefined if not a finite number. */
function clampParam(v: unknown, min: number, max: number): number | undefined {
  if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
  return Math.max(min, Math.min(v, max));
}

export function pmpAdminRoutes(): Router {
  const router = Router();

  /**
   * POST /v1/admin/backfill
   * Body (all optional):
   *   { batchSize, ratePerMinute, maxMemories, maxDurationMs }
   */
  router.post('/v1/admin/backfill', (req: Request, res: Response) => {
    if (!adminGate(req, res)) return;

    const body = req.body ?? {};
    const opts = {
      batchSize: clampParam(body.batchSize, 1, 200),
      ratePerMinute: clampParam(body.ratePerMinute, 1, 600),
      maxMemories: clampParam(body.maxMemories, 1, 10_000_000),
      maxDurationMs: clampParam(body.maxDurationMs, 1_000, 24 * 60 * 60 * 1000),
    };

    const result = startBackfill(opts);
    if (!result.started) {
      // Already running — 409 with the live status so the caller can poll.
      res.status(409).json({
        error: 'backfill_already_running',
        reason: result.reason,
        status: result.status,
      });
      return;
    }

    log.info({ opts }, 'admin: backfill started');
    res.status(202).json({
      accepted: true,
      message: 'backfill started in the background; poll GET /v1/admin/backfill for progress',
      status: result.status,
    });
  });

  /** GET /v1/admin/backfill — current status. */
  router.get('/v1/admin/backfill', (req: Request, res: Response) => {
    if (!adminGate(req, res)) return;
    res.json({ status: getBackfillStatus() });
  });

  /** POST /v1/admin/backfill/stop — request the in-flight run to stop. */
  router.post('/v1/admin/backfill/stop', (req: Request, res: Response) => {
    if (!adminGate(req, res)) return;
    const status = requestBackfillStop();
    log.info({ state: status.state }, 'admin: backfill stop requested');
    res.json({
      message:
        status.state === 'running'
          ? 'stop requested; the run will halt after the current memory'
          : 'no backfill is currently running',
      status,
    });
  });

  return router;
}
