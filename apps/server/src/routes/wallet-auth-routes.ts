import { Router, Request, Response } from 'express';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { verifySignature } from '../core/solana-client';
import { findOrCreateAgentForWallet } from '../features/agent-tier';
import { createChildLogger } from '../core/logger';

const log = createChildLogger('wallet-auth');

const MESSAGE_PREFIX = 'Sign in to Clude: ';
const MAX_MESSAGE_AGE_SECONDS = 5 * 60; // 5 minutes

export function walletAuthRoutes(): Router {
  const router = Router();

  /**
   * POST /api/wallet-auth/verify
   *
   * Verifies a signed message from a Solana wallet and returns an API key.
   * Used by the mobile app for direct wallet authentication (Phantom deep links).
   *
   * Body: { wallet: string, signature: string (base58), message: string }
   * Returns: { api_key: string, agent_id: string, wallet: string, created: boolean }
   */
  router.post('/verify', async (req: Request, res: Response) => {
    try {
      const { wallet, signature, message } = req.body;

      // Validate required fields
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

      // Validate message format and timestamp (replay protection)
      if (!message.startsWith(MESSAGE_PREFIX)) {
        return res.status(400).json({ error: 'Invalid message format' });
      }
      const timestampStr = message.slice(MESSAGE_PREFIX.length);
      const timestamp = parseInt(timestampStr, 10);
      if (isNaN(timestamp)) {
        return res.status(400).json({ error: 'Invalid timestamp in message' });
      }
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > MAX_MESSAGE_AGE_SECONDS) {
        return res.status(400).json({ error: 'Message expired. Please try again.' });
      }

      // Decode signature and public key
      let signatureBytes: Uint8Array;
      let publicKeyBytes: Uint8Array;
      try {
        signatureBytes = bs58.decode(signature);
        publicKeyBytes = new PublicKey(wallet).toBytes();
      } catch {
        return res.status(400).json({ error: 'Invalid signature or wallet encoding' });
      }

      // Verify Ed25519 signature
      const isValid = verifySignature(message, signatureBytes, publicKeyBytes);
      if (!isValid) {
        log.warn({ wallet }, 'Wallet auth signature verification failed');
        return res.status(401).json({ error: 'Signature verification failed' });
      }

      // Find or create agent for this wallet
      const { apiKey, agentId, isNew } = await findOrCreateAgentForWallet(wallet);

      log.info({ wallet, agentId, isNew }, 'Wallet auth successful');

      res.json({
        api_key: apiKey,
        agent_id: agentId,
        wallet,
        created: isNew,
      });
    } catch (err) {
      log.error({ err }, 'Wallet auth verification failed');
      res.status(500).json({ error: 'Wallet authentication failed' });
    }
  });

  return router;
}
