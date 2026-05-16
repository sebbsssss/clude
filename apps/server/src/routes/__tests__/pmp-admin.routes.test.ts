/**
 * Integration tests for the PMP admin backfill endpoints.
 *
 * The real backfill worker (runPmpBackfill) is mocked with a controllable
 * deferred so we can exercise the running / already-running / finished
 * transitions deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { BackfillStats } from '../../lib/pmp-backfill.js';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Controllable fake of the backfill worker ──
// Each call returns a promise we resolve manually, so we can hold a run
// "in flight" for the already-running test.
let pendingResolve: ((s: BackfillStats) => void) | null = null;
let pendingReject: ((e: Error) => void) | null = null;
let lastOpts: unknown = null;
const runPmpBackfillMock = vi.fn((opts: unknown) => {
  lastOpts = opts;
  return new Promise<BackfillStats>((resolve, reject) => {
    pendingResolve = resolve;
    pendingReject = reject;
  });
});

vi.mock('../../lib/pmp-backfill.js', () => ({
  runPmpBackfill: (opts: unknown) => runPmpBackfillMock(opts),
}));

import { pmpAdminRoutes } from '../pmp-admin.routes.js';
import { _resetBackfillRunner } from '../../lib/pmp-backfill-runner.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use(pmpAdminRoutes());
  return a;
}

const TOKEN = 'test-admin-token-xyz';
const STATS: BackfillStats = { scanned: 10, minted: 9, skipped: 1, failed: 0, durationMs: 1234 };

beforeEach(() => {
  _resetBackfillRunner();
  runPmpBackfillMock.mockClear();
  pendingResolve = null;
  pendingReject = null;
  lastOpts = null;
  process.env.PMP_ADMIN_TOKEN = TOKEN;
});

afterEach(() => {
  delete process.env.PMP_ADMIN_TOKEN;
  vi.clearAllMocks();
});

// ─────────── Auth gate ───────────

describe('admin auth gate', () => {
  it('returns 503 when PMP_ADMIN_TOKEN is not set', async () => {
    delete process.env.PMP_ADMIN_TOKEN;
    const res = await request(app()).get('/v1/admin/backfill');
    expect(res.status).toBe(503);
    expect(res.body.error).toBe('admin_disabled');
  });

  it('returns 401 when the token is missing', async () => {
    const res = await request(app()).get('/v1/admin/backfill');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('unauthorized');
  });

  it('returns 401 when the token is wrong', async () => {
    const res = await request(app())
      .get('/v1/admin/backfill')
      .set('X-Admin-Token', 'wrong-token');
    expect(res.status).toBe(401);
  });

  it('returns 401 when the token is the right value but wrong length (no prefix match)', async () => {
    const res = await request(app())
      .get('/v1/admin/backfill')
      .set('X-Admin-Token', TOKEN + 'extra');
    expect(res.status).toBe(401);
  });
});

// ─────────── POST /v1/admin/backfill ───────────

describe('POST /v1/admin/backfill', () => {
  it('starts a backfill and returns 202', async () => {
    const res = await request(app())
      .post('/v1/admin/backfill')
      .set('X-Admin-Token', TOKEN)
      .send({ batchSize: 25, ratePerMinute: 60 });
    expect(res.status).toBe(202);
    expect(res.body.accepted).toBe(true);
    expect(res.body.status.state).toBe('running');
    expect(runPmpBackfillMock).toHaveBeenCalledTimes(1);
  });

  it('clamps out-of-range params', async () => {
    await request(app())
      .post('/v1/admin/backfill')
      .set('X-Admin-Token', TOKEN)
      .send({ batchSize: 99999, ratePerMinute: 99999 });
    const opts = lastOpts as { batchSize: number; ratePerMinute: number };
    expect(opts.batchSize).toBe(200); // clamped to max
    expect(opts.ratePerMinute).toBe(600); // clamped to max
  });

  it('returns 409 when a backfill is already running', async () => {
    // First start — leaves the run in flight (pendingResolve not called).
    await request(app())
      .post('/v1/admin/backfill')
      .set('X-Admin-Token', TOKEN)
      .send({});
    // Second start while the first is still running.
    const res = await request(app())
      .post('/v1/admin/backfill')
      .set('X-Admin-Token', TOKEN)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('backfill_already_running');
    expect(res.body.status.state).toBe('running');
    // The worker was only ever invoked once.
    expect(runPmpBackfillMock).toHaveBeenCalledTimes(1);
  });

  it('allows a new run after the previous one finishes', async () => {
    await request(app()).post('/v1/admin/backfill').set('X-Admin-Token', TOKEN).send({});
    // Finish the first run.
    pendingResolve!(STATS);
    await new Promise((r) => setTimeout(r, 0)); // let the .then() settle

    const res = await request(app())
      .post('/v1/admin/backfill')
      .set('X-Admin-Token', TOKEN)
      .send({});
    expect(res.status).toBe(202);
    expect(runPmpBackfillMock).toHaveBeenCalledTimes(2);
  });
});

// ─────────── GET /v1/admin/backfill ───────────

describe('GET /v1/admin/backfill', () => {
  it('reports idle before any run', async () => {
    const res = await request(app()).get('/v1/admin/backfill').set('X-Admin-Token', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.status.state).toBe('idle');
    expect(res.body.status.stats).toBeNull();
  });

  it('reports running while a backfill is in flight', async () => {
    await request(app()).post('/v1/admin/backfill').set('X-Admin-Token', TOKEN).send({});
    const res = await request(app()).get('/v1/admin/backfill').set('X-Admin-Token', TOKEN);
    expect(res.body.status.state).toBe('running');
    expect(res.body.status.startedAt).not.toBeNull();
  });

  it('reports final stats after the run completes', async () => {
    await request(app()).post('/v1/admin/backfill').set('X-Admin-Token', TOKEN).send({});
    pendingResolve!(STATS);
    await new Promise((r) => setTimeout(r, 0));

    const res = await request(app()).get('/v1/admin/backfill').set('X-Admin-Token', TOKEN);
    expect(res.body.status.state).toBe('idle');
    expect(res.body.status.stats).toEqual(STATS);
    expect(res.body.status.finishedAt).not.toBeNull();
  });

  it('surfaces lastError when the run throws', async () => {
    await request(app()).post('/v1/admin/backfill').set('X-Admin-Token', TOKEN).send({});
    pendingReject!(new Error('RPC exhausted'));
    await new Promise((r) => setTimeout(r, 0));

    const res = await request(app()).get('/v1/admin/backfill').set('X-Admin-Token', TOKEN);
    expect(res.body.status.state).toBe('idle');
    expect(res.body.status.lastError).toBe('RPC exhausted');
  });
});

// ─────────── POST /v1/admin/backfill/stop ───────────

describe('POST /v1/admin/backfill/stop', () => {
  it('requests a stop on an in-flight run', async () => {
    await request(app()).post('/v1/admin/backfill').set('X-Admin-Token', TOKEN).send({});
    const res = await request(app())
      .post('/v1/admin/backfill/stop')
      .set('X-Admin-Token', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.status.stopRequested).toBe(true);
    // The shouldStop callback passed to the worker now returns true.
    const opts = lastOpts as { shouldStop: () => boolean };
    expect(opts.shouldStop()).toBe(true);
  });

  it('is a no-op when idle', async () => {
    const res = await request(app())
      .post('/v1/admin/backfill/stop')
      .set('X-Admin-Token', TOKEN);
    expect(res.status).toBe(200);
    expect(res.body.message).toContain('no backfill');
  });
});
