/**
 * Privy admin client — thin wrapper around `PrivyClient` for server-side
 * operations that require the app secret (e.g. deleting users).
 *
 * Kept separate from `privy-wallet-resolver.ts` so account-deletion can be
 * mocked in isolation and so callers don't accidentally pull in the resolver's
 * caching layer.
 */

import { PrivyClient, NotFoundError } from '@privy-io/node';
import { config } from '@clude/shared/config';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('privy-admin-client');

let client: PrivyClient | null = null;

function getClient(): PrivyClient {
  if (client) return client;
  if (!config.privy.appId) {
    throw new Error('PRIVY_APP_ID is required for admin operations');
  }
  if (!config.privy.appSecret) {
    throw new Error('PRIVY_APP_SECRET is required for admin operations');
  }
  client = new PrivyClient({
    appId: config.privy.appId,
    appSecret: config.privy.appSecret,
  });
  return client;
}

/**
 * Delete a Privy user by DID. Treats `NotFoundError` as success so callers
 * can retry safely after a partial failure.
 */
export async function deletePrivyUser(userId: string): Promise<void> {
  try {
    await getClient().users().delete(userId);
    log.info({ userId }, 'Deleted Privy user');
  } catch (err) {
    if (err instanceof NotFoundError) {
      log.info({ userId }, 'Privy user already gone (404) — treating as success');
      return;
    }
    log.error({ err, userId }, 'Privy user deletion failed');
    throw err;
  }
}
