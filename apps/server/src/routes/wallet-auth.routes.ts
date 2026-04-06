import { Router, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { findOrCreateAgentForWallet } from '@clude/brain/features/agent-tier';
import { createChildLogger } from '@clude/shared/core/logger';
import { getDb } from '@clude/shared/core/database';
import { config } from '@clude/shared/config';

const log = createChildLogger('wallet-auth');

const MESSAGE_PREFIX = 'Sign in to Clude: ';
const MAX_MESSAGE_AGE_SECONDS = 5 * 60;

export function walletAuthRoutes(): Router {
  const router = Router();

  router.post('/verify', async (req: Request, res: Response) => {
    try {
      const { wallet, signature, message } = req.body;

      if (!wallet || typeof wallet !== 'string') {
        return res.status(400).json({ error: 'wallet is required' });
      }
      if (!signature || typeof signature !== 'string') {
        return res.status(400).json({ error: 'signature is required' });
      }
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message is required' });
      }

      // Validate Solana address format
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
        return res.status(400).json({ error: 'Invalid Solana wallet address' });
      }

      // Validate message format and expiry
      if (!message.startsWith(MESSAGE_PREFIX)) {
        return res.status(400).json({ error: 'Invalid message format' });
      }

      const timestampStr = message.slice(MESSAGE_PREFIX.length);
      const timestamp = parseInt(timestampStr, 10);
      if (isNaN(timestamp)) {
        return res.status(400).json({ error: 'Invalid message timestamp' });
      }

      const ageSeconds = (Date.now() - timestamp) / 1000;
      if (ageSeconds > MAX_MESSAGE_AGE_SECONDS || ageSeconds < -60) {
        return res.status(400).json({ error: 'Message expired' });
      }

      // Verify signature
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = Uint8Array.from(Buffer.from(signature, 'base64'));
      const publicKeyBytes = new PublicKey(wallet).toBytes();

      const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
      if (!valid) {
        log.warn({ wallet }, 'Invalid signature for wallet auth');
        return res.status(401).json({ error: 'Invalid signature' });
      }

      // Get or create agent for this wallet
      const { apiKey, agentId, isNew } = await findOrCreateAgentForWallet(wallet);

      // Auto-credit promo balance for new users (same as auto-register)
      if (isNew) {
        const promoExpiry = config.features.freePromoExpiry;
        const promoActive = config.features.freePromoEnabled &&
          (!promoExpiry || new Date() < new Date(promoExpiry));
        if (promoActive) {
          const promoCredit = config.features.freePromoCreditUsdc;
          const db = getDb();
          await db
            .from('chat_balances')
            .upsert({
              wallet_address: wallet,
              balance_usdc: promoCredit,
              total_deposited: promoCredit,
              total_spent: 0,
            }, { onConflict: 'wallet_address' });
          log.info({ wallet, promoCredit }, 'Promo credit applied for new wallet-auth user');
        }
      }

      log.info({ wallet, agentId, isNew }, 'Wallet auth successful');

      return res.json({
        api_key: apiKey,
        agent_id: agentId,
        wallet,
        created: isNew,
      });
    } catch (err) {
      log.error({ err }, 'Wallet auth error');
      return res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
}
