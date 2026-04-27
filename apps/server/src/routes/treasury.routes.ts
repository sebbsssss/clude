// Public treasury stats. Reads from sink_ledger; serves the
// /treasury dashboard. No auth — transparency is the point.

import { Router, Request, Response } from 'express';
import { getTreasuryStats } from '@clude/brain/sink';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('treasury');

export function treasuryRoutes(): Router {
  const router = Router();

  router.get('/stats', async (_req: Request, res: Response) => {
    try {
      const stats = await getTreasuryStats(20);
      // BigInts → strings for JSON safety.
      res.json({
        treasury_pubkey: process.env.SINK_TREASURY_PUBKEY ?? null,
        hot_wallet_pubkey: process.env.SINK_HOT_PUBKEY ?? null,
        total_usdc_collected_micro: String(stats.total_usdc_collected_micro),
        total_clude_purchased_lamports: String(stats.total_clude_purchased_lamports),
        swap_count: stats.swap_count,
        last_swap_at: stats.last_swap_at,
        recent: stats.recent.map((r) => ({
          id: r.id,
          swapped_at: r.swapped_at,
          usdc_in_micro: String(r.usdc_in_micro),
          clude_out_lamports: r.clude_out_lamports != null ? String(r.clude_out_lamports) : null,
          realised_slippage_bps: r.realised_slippage_bps,
          swap_tx_sig: r.swap_tx_sig,
          source: r.source,
        })),
      });
    } catch (err) {
      log.error({ err }, 'Failed to read treasury stats');
      res.status(500).json({ error: 'stats unavailable' });
    }
  });

  return router;
}
