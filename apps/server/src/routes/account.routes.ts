/**
 * Account routes — currently just account deletion.
 *
 * `DELETE /api/account` wipes all owner-scoped rows then removes the Privy user
 * record. Required for App Store guideline 5.1.1(v) (in-app account deletion).
 *
 * Failure semantics:
 *  - DB error mid-cascade → 500, Privy is NOT called. Already-deleted rows
 *    stay deleted; client can safely retry (deletes are idempotent).
 *  - Privy 404 → 204 (handled inside `deletePrivyUser`).
 *  - Privy non-404 → 500. App data is already gone; admin-side cleanup of the
 *    Privy account may be needed.
 *
 * Table list mirrors `migrateOwnerWallet` in
 * `packages/brain/src/features/agent-tier.ts` — those are the canonical
 * owner-scoped tables. Dashboard tables are shared tooling, not user data.
 */
import { Router, Request, Response } from 'express';
import { optionalPrivyAuth } from '@clude/brain/auth/privy-auth';
import { requireOwnership } from '@clude/brain/auth/require-ownership';
import { deletePrivyUser } from '@clude/brain/auth/privy-admin-client';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('account');

interface OwnerScopedTable {
  name: string;
  column: 'owner_wallet' | 'wallet_address';
}

const OWNER_TABLES: OwnerScopedTable[] = [
  { name: 'memories', column: 'owner_wallet' },
  { name: 'llm_outputs', column: 'owner_wallet' },
  { name: 'chat_conversations', column: 'owner_wallet' },
  { name: 'chat_usage', column: 'wallet_address' },
  { name: 'chat_topups', column: 'wallet_address' },
  { name: 'chat_balances', column: 'wallet_address' },
  { name: 'agent_keys', column: 'owner_wallet' },
];

export function accountRoutes(): Router {
  const router = Router();

  router.delete(
    '/',
    optionalPrivyAuth,
    requireOwnership,
    async (req: Request, res: Response) => {
      const ownerWallet = req.verifiedWallet;

      if (!ownerWallet) {
        res.status(401).json({ error: 'Could not resolve owner wallet' });
        return;
      }

      const db = getDb();

      // Resolve Privy DID before wiping. Prefer the JWT (free) and fall back
      // to agent_keys.privy_did, which the cortex-key auth path doesn't surface.
      // Must happen BEFORE the cascade deletes agent_keys.
      let privyUserId: string | null = req.privyUser?.userId ?? null;
      if (!privyUserId) {
        // No is_active filter: even a deactivated row can carry the DID we
        // need to wipe from Privy.
        const { data: agent, error: lookupErr } = await db
          .from('agent_keys')
          .select('privy_did')
          .eq('owner_wallet', ownerWallet)
          .limit(1)
          .maybeSingle();
        if (lookupErr) {
          log.warn(
            { err: lookupErr, ownerWallet },
            'Account-delete: privy_did lookup failed; will skip Privy delete',
          );
        }
        privyUserId = (agent?.privy_did as string | null) ?? null;
      }

      const wiped: { table: string; deletedCount: number }[] = [];

      for (const t of OWNER_TABLES) {
        const { error, count } = await db
          .from(t.name)
          .delete({ count: 'exact' })
          .eq(t.column, ownerWallet);

        if (error) {
          log.error(
            { err: error, table: t.name, ownerWallet, privyUserId, wiped },
            'Account-delete: cascade failed',
          );
          res.status(500).json({
            error: `Account deletion partially failed at ${t.name}; please retry or contact support`,
            failedTable: t.name,
          });
          return;
        }
        wiped.push({ table: t.name, deletedCount: count ?? 0 });
      }

      log.info(
        { ownerWallet, privyUserId, wiped },
        'Account data wiped — calling Privy delete',
      );

      if (privyUserId) {
        try {
          await deletePrivyUser(privyUserId);
        } catch (err) {
          log.error(
            { err, ownerWallet, privyUserId },
            'Account-delete: app data wiped but Privy delete failed',
          );
          res.status(500).json({
            error:
              'Account data deleted but Privy account removal failed; contact support',
          });
          return;
        }
      }

      log.info({ ownerWallet, privyUserId }, 'Account fully deleted');
      res.status(204).end();
    },
  );

  return router;
}
