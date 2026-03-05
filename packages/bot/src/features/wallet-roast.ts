import { getWalletHistory, getTokenBalances, WalletTransaction, TokenBalance } from '../core/helius-client';
import { postReply } from '../core/x-client';
import { checkRateLimit, markProcessed } from '../core/database';
import { getTierModifier } from '../character/tier-modifiers';
import { HolderTier } from '../character/tier-modifiers';
import { createChildLogger } from '../core/logger';
import { extractWalletAddress, pickRandom } from '../utils/text';
import { buildAndGenerate } from '../services/response.service';
import { replyAndMark } from '../services/social.service';
import { PublicKey } from '@solana/web3.js';
import { loadReplyPool, loadInstruction } from '../utils/env-persona';

const log = createChildLogger('wallet-roast');

const ROAST_COOLDOWN_REPLIES = loadReplyPool('roast_cooldown', [
  'Wallet analysis limit reached. Try again in an hour.',
]);

const EMPTY_WALLET_REPLIES = loadReplyPool('roast_empty', [
  'No transaction history found.',
]);

export { extractWalletAddress };

function analyzeWallet(txs: WalletTransaction[], balances: TokenBalance[]): string {
  const totalTxs = txs.length;
  const swaps = txs.filter(t => t.type === 'SWAP');
  const transfers = txs.filter(t => t.type === 'TRANSFER');
  const uniqueTargets = new Set(txs.flatMap(t => t.nativeTransfers.map(nt => nt.toUserAccount).filter(Boolean))).size;
  const totalFees = txs.reduce((sum, t) => sum + t.fee, 0) / 1e9;

  const lines = [
    `Total transactions (recent): ${totalTxs}`,
    `Swaps: ${swaps.length}`,
    `Transfers: ${transfers.length}`,
    `Unique addresses interacted: ${uniqueTargets}`,
    `Total fees burned: ${totalFees.toFixed(6)} SOL`,
    `Token balances: ${balances.length} different tokens`,
  ];

  if (swaps.length > totalTxs * 0.7) lines.push('PATTERN: Primarily swaps. Active trader.');
  if (uniqueTargets > 15) lines.push('PATTERN: Broad interaction pattern. Diverse portfolio activity.');
  if (totalFees > 0.1) lines.push(`PATTERN: ${totalFees.toFixed(4)} SOL in fees — significant on-chain activity.`);
  if (totalTxs < 5) lines.push('PATTERN: Minimal history. Likely new or secondary wallet.');

  return lines.join('\n');
}

export async function handleWalletRoast(
  tweetId: string,
  tweetText: string,
  authorId: string,
  tier: HolderTier
): Promise<void> {
  const address = extractWalletAddress(tweetText);
  if (!address) return;

  try {
    new PublicKey(address);
  } catch {
    log.debug({ address }, 'Invalid Solana address extracted, skipping');
    return;
  }

  if (!(await checkRateLimit(`roast:${authorId}`, 1, 60))) {
    log.info({ authorId }, 'Rate limited for wallet roast');
    const replyId = await postReply(tweetId, pickRandom(ROAST_COOLDOWN_REPLIES));
    await markProcessed(tweetId, 'wallet-roast-ratelimit', replyId);
    return;
  }

  log.info({ address, tweetId }, 'Processing wallet roast');

  const [txs, balances] = await Promise.all([
    getWalletHistory(address, 50),
    getTokenBalances(address),
  ]);

  if (txs.length === 0 && balances.length === 0) {
    const replyId = await postReply(tweetId, pickRandom(EMPTY_WALLET_REPLIES));
    await markProcessed(tweetId, 'wallet-roast-empty', replyId);
    return;
  }

  const walletAnalysis = analyzeWallet(txs, balances);

  const response = await buildAndGenerate({
    message: `Analyze this Solana wallet: ${address}`,
    context: walletAnalysis,
    tierModifier: getTierModifier(tier),
    forTwitter: true,  // Enforce char limit
    instruction: loadInstruction('roast', 'Analyze this wallet based on its on-chain behavior. Under 270 characters.'),
    memory: {
      relatedUser: authorId,
      query: `wallet analysis ${address}`,
      tags: [tier, 'wallet-roast'],
      memoryTypes: ['episodic', 'semantic'],
      limit: 3,
    },
  });

  await replyAndMark(tweetId, response, 'wallet-roast');
  log.info({ tweetId }, 'Wallet analysis posted');
}
