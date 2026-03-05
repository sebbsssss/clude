import { getDb } from '../core/database';
import { config } from '../config';
import { getCludeBalance } from '../core/helius-client';
import { createChildLogger } from '../core/logger';
import { eventBus } from '../events/event-bus';
import { lamportsToSol } from '../utils/format';
import type { HeliusWebhookPayload } from '../types/api';

const log = createChildLogger('helius-handler');

export async function handleHeliusWebhook(payload: HeliusWebhookPayload[]): Promise<void> {
  for (const tx of payload) {
    try {
      await processTransaction(tx);
    } catch (err) {
      log.error({ signature: tx.signature, err }, 'Failed to process webhook transaction');
    }
  }
}

async function processTransaction(tx: HeliusWebhookPayload): Promise<void> {
  const cludeMint = config.solana.cludeTokenMint;
  if (!cludeMint) return;

  // Filter for $CLUDE token transfers
  const cludeTransfers = tx.tokenTransfers.filter(tt => tt.mint === cludeMint);
  if (cludeTransfers.length === 0) return;

  log.debug({ signature: tx.signature, transfers: cludeTransfers.length }, 'Processing CLUDE transfer');

  const db = getDb();

  for (const transfer of cludeTransfers) {
    const isSell = transfer.fromUserAccount && transfer.tokenAmount > 0;

    // Determine event type
    let eventType: string;
    if (tx.type === 'SWAP') {
      eventType = isSell ? 'swap_sell' : 'swap_buy';
    } else {
      eventType = 'transfer';
    }

    // Calculate SOL value from native transfers
    const solValue = tx.nativeTransfers.reduce((sum, nt) => {
      if (nt.fromUserAccount === transfer.fromUserAccount || nt.toUserAccount === transfer.toUserAccount) {
        return sum + lamportsToSol(nt.amount);
      }
      return sum;
    }, 0);

    // Store event (upsert to handle duplicates)
    await db
      .from('token_events')
      .upsert({
        signature: tx.signature,
        event_type: eventType,
        wallet_address: transfer.fromUserAccount || transfer.toUserAccount,
        amount: transfer.tokenAmount,
        sol_value: solValue,
        timestamp: new Date(tx.timestamp * 1000).toISOString(),
        metadata: { type: tx.type, description: tx.description },
      }, { onConflict: 'signature' });

    const wallet = transfer.fromUserAccount;

    // Check for whale sell (arbitrary: > 10 SOL value)
    if (eventType === 'swap_sell' && solValue > 10) {
      log.info({ wallet, solValue }, 'Whale sell detected');
      eventBus.emit('whale:sell', { wallet, solValue, signature: tx.signature });
    }

    // Check for full exit (balance → 0)
    if (eventType === 'swap_sell' && wallet) {
      const remainingBalance = await getCludeBalance(wallet);
      if (remainingBalance === 0) {
        log.info({ wallet }, 'Full exit detected');
        eventBus.emit('holder:exit', { wallet, tokenAmount: transfer.tokenAmount, solValue });
      }
    }
  }
}
