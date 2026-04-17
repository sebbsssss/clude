import { Router, Request, Response } from 'express';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('growth-routes');

export function growthRoutes(): Router {
  const router = Router();

  router.get('/snapshots', async (req: Request, res: Response) => {
    const limitRaw = parseInt(String(req.query.limit || '12'), 10);
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 12, 1), 52);

    try {
      const db = getDb();
      const { data, error } = await db
        .from('growth_kpi_snapshots')
        .select('window_start, window_end, sdk_installs_total, sdk_installs_unique_wallets, recall_calls, store_calls, returning_7d, per_channel, attribution_confidence, notes, created_at')
        .order('window_end', { ascending: false })
        .limit(limit);

      if (error) {
        log.error({ err: error }, 'Failed to read snapshots');
        res.status(500).json({ error: 'Failed to load snapshots' });
        return;
      }

      res.json({ snapshots: data || [] });
    } catch (err) {
      log.error({ err }, 'Unexpected error reading snapshots');
      res.status(500).json({ error: 'Internal error' });
    }
  });

  return router;
}
