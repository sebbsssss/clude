import { getWalletHistory } from '../core/helius-client';
import { checkRateLimit } from '../core/database';
import { config } from '../config';
import { createChildLogger } from '../core/logger';
import { truncateWallet } from '../utils/format';
import { buildAndGenerate } from '../services/response.service';
import { tweet } from '../services/social.service';

const log = createChildLogger('exit-interview');

export async function handleExitInterview(
  walletAddress: string,
  tokenAmount: number,
  solValue: number
): Promise<void> {
  // Rate limit: max 1 exit interview per hour
  if (!(await checkRateLimit('global:exit-interview', 1, 60))) {
    log.info({ walletAddress }, 'Rate limited for exit interview');
    return;
  }

  log.info({ walletAddress, tokenAmount, solValue }, 'Processing exit interview');

  // Look up wallet history for context
  const txs = await getWalletHistory(walletAddress, 30);

  // Find when they first interacted with the token
  // All txs are relevant — this handler is called from token event pipeline
  const cludeTxs = txs;

  const firstBuy = cludeTxs[cludeTxs.length - 1]; // Oldest first
  const holdDuration = firstBuy
    ? Math.round((Date.now() / 1000 - firstBuy.timestamp) / 86400) // days
    : 0;

  const context = [
    `Wallet: ${truncateWallet(walletAddress)}`,
    `Sold: ${tokenAmount.toLocaleString()} $CLUDE`,
    `SOL received: ${solValue.toFixed(6)} SOL`,
    `Hold duration: approximately ${holdDuration} days`,
    `Total token transactions: ${cludeTxs.length}`,
    `Other recent activity: ${txs.length - cludeTxs.length} non-$CLUDE transactions`,
  ].join('\n');

  const response = await buildAndGenerate({
    message: 'A holder just sold all their tokens. Conduct their exit interview.',
    context,
    forTwitter: true,  // Enforce 270 char limit
    instruction:
      'A wallet just sold ALL of their $CLUDE tokens. This is an exit interview. ' +
      'Reference the specific data: how long they held, what they sold for. ' +
      'Write it like HR processing a resignation. Professional. Clinical. ' +
      'With just a hint of "I saw this coming." ' +
      'Start with the truncated wallet address.',
    memory: {
      relatedWallet: walletAddress,
      query: `wallet sold all CLUDE tokens exit`,
      tags: ['exit-interview', 'sell'],
      memoryTypes: ['episodic', 'semantic'],
      limit: 3,
    },
  });

  await tweet(response);
  log.info({ walletAddress }, 'Exit interview posted');
}
