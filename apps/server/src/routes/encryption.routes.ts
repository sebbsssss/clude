/**
 * PMP encryption control plane — revoke + owner-key registration (encryption §7).
 *   POST /v1/memories/:id/revoke   — owner destroys the provider's access to one memory
 *   POST /v1/keys/revoke-all       — owner revokes all their delegated memories (paced)
 *   POST /v1/encryption/owner-key  — owner registers their X25519 PUBLIC key + verifier
 *
 * Revoke is owner-scoped: the caller must own the memory. Inert until encryption
 * is activated (revoke only acts on encrypted + delegated rows).
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requirePrivyAuth } from '@clude/brain/auth/privy-auth';
import { requireOwnership } from '@clude/brain/auth/require-ownership';
import { revokeMemory, redelegateMemory } from '@clude/brain/memory';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('encryption-routes');

// Body for owner-key registration. Both fields are PUBLIC material:
//  - x25519_pubkey: the holder's X25519 public key (DEKs get sealed to it).
//  - verifier_ct: secretbox("clude-key-verifier-v1") under the derived key (proves, at decrypt
//    time, that a candidate key matches this registration). NB: a self-consistent {pubkey,
//    verifier_ct} proves nothing about WHO posted it, so the owner binding comes from the proven
//    wallet only — never from this body. (See M1 reasoning below.)
const ownerKeyBodySchema = z.object({
  x25519_pubkey: z.string().min(1),
  verifier_ct: z.string().min(1),
});

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

  // Register the caller's X25519 PUBLIC key + verifier (owner-only). This is how a holder creates
  // the encryption_keys row that encryptRecordsForHolder seals each pack's DEK to. NO private key
  // is ever read, stored, derived, or logged here.
  //
  // M1 BINDING: owner_wallet comes from req.verifiedWallet (proven by requireOwnership) ONLY — never
  // from the body/query. A posted {pubkey, verifier_ct} is self-consistent for ANY keypair the caller
  // generated, so it does NOT prove control of the matching wallet; trusting a body owner would let an
  // attacker register a key under a victim's wallet. requireOwnership already 403s a forged ?wallet=.
  //
  // M1 OVERWRITE GUARD: if a row already exists for this wallet, allow an IDEMPOTENT re-register
  // (identical pubkey + verifier → no-op) but REFUSE (409) to replace it with a DIFFERENT key —
  // silently rotating the holder's key would lock them out of every pack already sealed to the old one.
  // Mirrors ensureCustodialTitleIdentity's read-first no-stomp guard.
  router.post('/v1/encryption/owner-key', requirePrivyAuth, requireOwnership, async (req: Request, res: Response) => {
    const wallet = req.verifiedWallet;
    if (!wallet) {
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }
    const parsed = ownerKeyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: 'invalid_owner_key' });
      return;
    }
    const { x25519_pubkey, verifier_ct } = parsed.data;
    try {
      const db = getDb();
      const { data: existing, error: selErr } = await db
        .from('encryption_keys')
        .select('owner_wallet, x25519_pubkey, verifier_ct')
        .eq('owner_wallet', wallet)
        .maybeSingle();
      if (selErr) {
        res.status(500).json({ error: 'lookup_failed' });
        return;
      }
      const row = existing as { x25519_pubkey?: string; verifier_ct?: string } | null;
      if (row) {
        // Idempotent re-register: identical material → no-op success.
        if (row.x25519_pubkey === x25519_pubkey && row.verifier_ct === verifier_ct) {
          res.json({ ok: true, owner_wallet: wallet, x25519_pubkey, verifier_ct });
          return;
        }
        // Different key/verifier → refuse. Replacing it would orphan every pack sealed to the old key.
        log.warn({ owner: wallet.slice(0, 10) }, 'owner-key: refusing to overwrite an existing key');
        res.status(409).json({ error: 'owner_key_exists' });
        return;
      }

      const { error: upErr } = await db.from('encryption_keys').upsert(
        {
          owner_wallet: wallet,
          x25519_pubkey,
          verifier_ct,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'owner_wallet' },
      );
      if (upErr) {
        res.status(500).json({ error: 'register_failed' });
        return;
      }
      log.info({ owner: wallet.slice(0, 10) }, 'owner-key: registered');
      res.json({ ok: true, owner_wallet: wallet, x25519_pubkey, verifier_ct });
    } catch (err) {
      log.error({ err }, 'owner-key registration failed');
      res.status(500).json({ error: 'register_failed' });
    }
  });

  return router;
}
