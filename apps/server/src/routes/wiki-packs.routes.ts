import { Router, Request, Response } from 'express';
import { createChildLogger } from '@clude/shared/core/logger';
import { getDb } from '@clude/shared/core/database';
import { requirePrivyAuth } from '@clude/brain/auth/privy-auth';
import { optionalOwnership } from '@clude/brain/auth/require-ownership';
import { invalidateInstalledPacksCache } from '@clude/brain/memory';

const log = createChildLogger('wiki-packs-routes');

// Default pack — every wallet implicitly has Workspace Essentials installed.
// Manifests live client-side in `apps/dashboard/src/pages/Wiki/wiki-packs.ts`;
// the server only persists which packs each owner_wallet has opted into.
const DEFAULT_PACK = 'workspace';

export function wikiPacksRoutes(): Router {
  const router = Router();

  router.use(requirePrivyAuth);
  router.use(optionalOwnership);

  function ownerOf(req: Request): string | null {
    return req.verifiedWallet
      || (typeof req.query.wallet === 'string' ? req.query.wallet : null)
      || (req.body && typeof req.body.wallet === 'string' ? req.body.wallet : null);
  }

  // GET /api/wiki-packs — list installed packs for the current owner.
  router.get('/', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      if (!owner) {
        res.status(400).json({ error: 'wallet required' });
        return;
      }
      const db = getDb();
      const { data, error } = await db
        .from('wiki_pack_installations')
        .select('pack_id, installed_at')
        .eq('owner_wallet', owner)
        .order('installed_at', { ascending: true });
      if (error) {
        log.error({ err: error.message }, 'Failed to list installed packs');
        res.status(500).json({ error: 'Failed to list packs' });
        return;
      }
      const installed = (data ?? []).map((r) => r.pack_id);
      // Workspace pack is implicit; surface it so clients don't have to special-case.
      const set = new Set([DEFAULT_PACK, ...installed]);
      res.json({
        installed: Array.from(set),
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      log.error({ err }, 'List packs error');
      res.status(500).json({ error: 'Failed to list packs' });
    }
  });

  // PUT /api/wiki-packs/:packId — install a pack (idempotent).
  router.put('/:packId', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      if (!owner) {
        res.status(400).json({ error: 'wallet required' });
        return;
      }
      const packId = req.params.packId;
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(packId)) {
        res.status(400).json({ error: 'Invalid pack id' });
        return;
      }
      const db = getDb();
      const { error } = await db
        .from('wiki_pack_installations')
        .upsert(
          { owner_wallet: owner, pack_id: packId },
          { onConflict: 'owner_wallet,pack_id' },
        );
      if (error) {
        log.error({ err: error.message, packId }, 'Failed to install pack');
        res.status(500).json({ error: 'Failed to install pack' });
        return;
      }
      // Invalidate the per-wallet installed-packs cache in storeMemory so the
      // new pack's keyword rules take effect on the very next memory write
      // (otherwise we'd wait up to 60s for the TTL to expire).
      invalidateInstalledPacksCache(owner);
      res.json({ packId, installed: true, timestamp: new Date().toISOString() });
    } catch (err) {
      log.error({ err }, 'Install pack error');
      res.status(500).json({ error: 'Failed to install pack' });
    }
  });

  // DELETE /api/wiki-packs/:packId — uninstall a pack.
  // The default workspace pack cannot be uninstalled.
  router.delete('/:packId', async (req: Request, res: Response) => {
    try {
      const owner = ownerOf(req);
      if (!owner) {
        res.status(400).json({ error: 'wallet required' });
        return;
      }
      const packId = req.params.packId;
      if (packId === DEFAULT_PACK) {
        res.status(409).json({ error: 'Cannot uninstall the default pack' });
        return;
      }
      const db = getDb();
      const { error } = await db
        .from('wiki_pack_installations')
        .delete()
        .eq('owner_wallet', owner)
        .eq('pack_id', packId);
      if (error) {
        log.error({ err: error.message, packId }, 'Failed to uninstall pack');
        res.status(500).json({ error: 'Failed to uninstall pack' });
        return;
      }
      invalidateInstalledPacksCache(owner);
      res.json({ packId, installed: false, timestamp: new Date().toISOString() });
    } catch (err) {
      log.error({ err }, 'Uninstall pack error');
      res.status(500).json({ error: 'Failed to uninstall pack' });
    }
  });

  return router;
}
