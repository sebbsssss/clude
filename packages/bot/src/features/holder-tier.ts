import { getCludeBalance } from '../core/helius-client';
import { getDb } from '../core/database';
import { config } from '../config';
import { HolderTier } from '../character/tier-modifiers';
import { createChildLogger } from '../core/logger';

const log = createChildLogger('holder-tier');

interface WalletLink {
  wallet_address: string;
  x_handle: string;
}

export async function getLinkedWallet(xUserId: string): Promise<WalletLink | null> {
  const db = getDb();
  const { data } = await db
    .from('wallet_links')
    .select('wallet_address, x_handle')
    .eq('x_user_id', xUserId)
    .single();
  return data || null;
}

export async function determineHolderTier(xUserId: string): Promise<HolderTier> {
  const link = await getLinkedWallet(xUserId);
  if (!link) return 'UNKNOWN';

  const balance = await getCludeBalance(link.wallet_address);

  if (balance === 0) {
    // Check if they previously held tokens (seller detection)
    const db = getDb();
    const { data: prevHeld } = await db
      .from('token_events')
      .select('id')
      .eq('wallet_address', link.wallet_address)
      .eq('event_type', 'swap_buy')
      .limit(1)
      .single();

    if (prevHeld) {
      log.debug({ xUserId, wallet: link.wallet_address }, 'Detected seller');
      return 'SELLER';
    }
    return 'ZERO';
  }

  if (balance >= config.tiers.whaleThreshold) return 'WHALE';
  if (balance >= config.tiers.smallThreshold) return 'SMALL';
  return 'ZERO';
}

export async function linkWallet(xUserId: string, xHandle: string, walletAddress: string): Promise<void> {
  const db = getDb();
  await db
    .from('wallet_links')
    .upsert({
      x_user_id: xUserId,
      x_handle: xHandle,
      wallet_address: walletAddress,
      verified_at: new Date().toISOString(),
    });
  log.info({ xUserId, xHandle, walletAddress }, 'Wallet linked');
}
