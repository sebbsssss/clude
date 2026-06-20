/**
 * PMP encryption control plane — revoke endpoints (encryption §7).
 *   POST /v1/memories/:id/revoke  — owner destroys the provider's access to one memory
 *   POST /v1/keys/revoke-all      — owner revokes all their delegated memories (paced)
 *
 * Revoke is owner-scoped: the caller must own the memory. Inert until encryption
 * is activated (revoke only acts on encrypted + delegated rows).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { requirePrivyAuth } from '@clude/brain/auth/privy-auth';
import { requireOwnership } from '@clude/brain/auth/require-ownership';
import { revokeMemory, redelegateMemory } from '@clude/brain/memory';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('encryption-routes');

export function encryptionRoutes(): Router {
  const router = Router();

  router.use((req, res, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Revoke the provider's access to a single memory (owner-only).
  router.post('/v1/memories/:id/revoke', requirePrivyAuth, requireOwnership, async (req: Request, res: Response) => {
    const wallet = req.verifiedWallet;
    if (!wallet) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const hashId = String(req.params.id ?? '');
    if (!hashId || hashId.length > 64) {
      res.status(422).json({ error: 'invalid_id' });
      return;
    }
    try {
      const db = getDb();
      const { data: mem, error } = await db
        .from('memories')
        .select('id, owner_wallet')
        .eq('hash_id', hashId)
        .maybeSingle();
      if (error) {
        res.status(500).json({ error: 'lookup_failed' });
        return;
      }
      if (!mem) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (mem.owner_wallet !== wallet) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      const result = await revokeMemory(db, mem.id as number);
      res.json({ id: hashId, ...result });
    } catch (err) {
      log.error({ err, hashId }, 'revoke failed');
      res.status(500).json({ error: 'revoke_failed' });
    }
  });

  // Restore the provider's access to a single revoked memory (owner-only). The client posts a
  // provider re-wrap of the DEK; redelegateMemory validates it by decrypting the stored ciphertext.
  router.post('/v1/memories/:id/redelegate', requirePrivyAuth, requireOwnership, async (req: Request, res: Response) => {
    const wallet = req.verifiedWallet;
    if (!wallet) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const hashId = String(req.params.id ?? '');
    if (!hashId || hashId.length > 64) {
      res.status(422).json({ error: 'invalid_id' });
      return;
    }
    const wrappedDek = typeof req.body?.wrapped_dek === 'string' ? req.body.wrapped_dek : '';
    const wrapPubkey = typeof req.body?.wrap_pubkey === 'string' ? req.body.wrap_pubkey : '';
    if (!wrappedDek || !wrapPubkey || wrappedDek.length > 1024 || wrapPubkey.length > 1024) {
      res.status(422).json({ error: 'invalid_wrap' });
      return;
    }
    try {
      const db = getDb();
      const { data: mem, error } = await db
        .from('memories')
        .select('id, owner_wallet')
        .eq('hash_id', hashId)
        .maybeSingle();
      if (error) {
        res.status(500).json({ error: 'lookup_failed' });
        return;
      }
      if (!mem) {
        res.status(404).json({ error: 'not_found' });
        return;
      }
      if (mem.owner_wallet !== wallet) {
        res.status(403).json({ error: 'forbidden' });
        return;
      }
      const result = await redelegateMemory(db, mem.id as number, {
        wrapped_dek: wrappedDek,
        wrap_pubkey: wrapPubkey,
      });
      // A rejected wrap is a client error (the posted re-wrap didn't yield the memory's DEK).
      if (!result.redelegated && result.reason === 'invalid_wrap') {
        res.status(422).json({ id: hashId, ...result });
        return;
      }
      res.json({ id: hashId, ...result });
    } catch (err) {
      log.error({ err, hashId }, 'redelegate failed');
      res.status(500).json({ error: 'redelegate_failed' });
    }
  });

  // Revoke every delegated memory the caller owns (paced sequential loop).
  router.post('/v1/keys/revoke-all', requirePrivyAuth, requireOwnership, async (req: Request, res: Response) => {
    const wallet = req.verifiedWallet;
    if (!wallet) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    try {
      const db = getDb();
      const { data: rows, error } = await db
        .from('memories')
        .select('id')
        .eq('owner_wallet', wallet)
        .eq('encrypted', true)
        .not('provider_delegated', 'is', false);
      if (error) {
        res.status(500).json({ error: 'lookup_failed' });
        return;
      }
      const ids = (rows || []).map((r) => (r as { id: number }).id);
      let revoked = 0;
      for (const id of ids) {
        const r = await revokeMemory(db, id);
        if (r.revoked) revoked++;
        await new Promise((done) => setTimeout(done, 10)); // pace to avoid hammering the DB
      }
      res.json({ revoked_count: revoked, total: ids.length });
    } catch (err) {
      log.error({ err }, 'revoke-all failed');
      res.status(500).json({ error: 'revoke_all_failed' });
    }
  });

  return router;
}
