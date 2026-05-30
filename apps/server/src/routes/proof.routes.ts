import { Router, Request, Response } from 'express';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('proof-routes');

// Hybrid baseline (§7.3): legacy rows (pre-migration, tokens_saved IS NULL) have no
// reconstructable savings, so we disclose an estimate = historical prompt tokens × ratio.
const BASELINE_RATIO = Number(process.env.PROOF_BASELINE_RATIO || '0.82');
const CACHE_TTL_MS = Number(process.env.PROOF_CACHE_TTL_MS ?? '10000');

interface TokensSavedPayload {
  totalSaved: number;
  savedToday: number;
  avgSavingsPct: number;
  ratePerMin: number;
  baselineEstimated: number;
  updatedAt: string;
}

let cache: { payload: TokensSavedPayload; at: number } | null = null;
let lastSample: { total: number; at: number } | null = null;

async function computePayload(): Promise<TokensSavedPayload> {
  const db = getDb();
  const { data, error } = await db.rpc('proof_tokens_saved_totals');
  const row = Array.isArray(data) ? data[0] : data;
  const now = Date.now();
  if (error || !row) {
    log.warn({ error }, 'proof totals RPC failed; serving last-known/zero');
    return {
      totalSaved: cache?.payload.totalSaved ?? 0,
      savedToday: 0,
      avgSavingsPct: 82,
      ratePerMin: 0,
      baselineEstimated: cache?.payload.baselineEstimated ?? 0,
      updatedAt: new Date(now).toISOString(),
    };
  }
  const measuredSaved = Number(row.measured_saved || 0);
  const measuredToday = Number(row.measured_today || 0);
  const measuredFrontier = Number(row.measured_frontier || 0);
  const historicalPromptSum = Number(row.historical_prompt_sum || 0);

  const baselineEstimated = Math.round(historicalPromptSum * BASELINE_RATIO);
  const totalSaved = measuredSaved + baselineEstimated;
  const avgSavingsPct = measuredFrontier > 0
    ? Math.round((measuredSaved / measuredFrontier) * 100)
    : 82;

  let ratePerMin = 0;
  if (lastSample && now > lastSample.at) {
    const deltaTokens = totalSaved - lastSample.total;
    const deltaMin = (now - lastSample.at) / 60_000;
    ratePerMin = deltaMin > 0 ? Math.max(0, Math.round(deltaTokens / deltaMin)) : 0;
  }
  lastSample = { total: totalSaved, at: now };

  return { totalSaved, savedToday: measuredToday, avgSavingsPct, ratePerMin, baselineEstimated, updatedAt: new Date(now).toISOString() };
}

export function proofRoutes(): Router {
  const router = Router();

  router.get('/tokens-saved', async (_req: Request, res: Response) => {
    try {
      const now = Date.now();
      if (!cache || now - cache.at > CACHE_TTL_MS) {
        cache = { payload: await computePayload(), at: now };
      }
      res.json(cache.payload);
    } catch (err) {
      log.error({ err }, 'tokens-saved endpoint error');
      res.json({ totalSaved: cache?.payload.totalSaved ?? 0, savedToday: 0, avgSavingsPct: 82, ratePerMin: 0, baselineEstimated: cache?.payload.baselineEstimated ?? 0, updatedAt: new Date().toISOString() });
    }
  });

  return router;
}
