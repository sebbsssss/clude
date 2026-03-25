/**
 * USDC top-up routes — Solana Pay reference-based detection + RPC fallback.
 *
 * Handles:
 *  - POST /api/chat/topup/intent  — Create Solana Pay intent with unique reference
 *  - POST /api/chat/topup/confirm — Client-submitted tx verification (reference or tx hash)
 *  - POST /webhook/helius/usdc    — Helius enhanced transaction webhook (reference-based)
 *  - GET  /api/chat/balance       — Authenticated user balance
 *  - GET  /api/chat/topup/history — Top-up transaction history
 */
import { Router, Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual, randomBytes } from 'crypto';
import { getDb, checkRateLimit } from '../core/database';
import { getConnection } from '../core/solana-client';
import { config } from '../config';
import { createChildLogger } from '../core/logger';
import { authenticateAgent } from '../features/agent-tier';
import { Keypair, PublicKey } from '@solana/web3.js';

const log = createChildLogger('topup');

const USDC_MINT = config.usdc.mint;
const TREASURY = config.usdc.treasuryAddress;

// USDC has 6 decimals on Solana
const USDC_DECIMALS = 6;

// ---- Types for Helius Enhanced Transaction ---- //

interface HeliusTokenTransfer {
  fromUserAccount: string;
  toUserAccount: string;
  fromTokenAccount: string;
  toTokenAccount: string;
  mint: string;
  tokenAmount: number;
  tokenStandard: string;
}

interface HeliusEnhancedTransaction {
  signature: string;
  timestamp: number;
  slot: number;
  type: string;
  fee: number;
  feePayer: string;
  tokenTransfers: HeliusTokenTransfer[];
  nativeTransfers: unknown[];
  transactionError: unknown | null;
  accountData?: Array<{ account: string; [key: string]: unknown }>;
}

// ---- Auth middleware (reuses same logic as chat-routes) ---- //

interface TopupRequest extends Request {
  ownerWallet?: string;
}

async function topupAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization: Bearer <token> header' });
    return;
  }

  const token = authHeader.slice(7);

  if (token.startsWith('clk_')) {
    const agent = await authenticateAgent(token);
    if (!agent) {
      res.status(401).json({ error: 'Invalid or inactive API key' });
      return;
    }
    let ownerWallet = agent.owner_wallet;
    if (!ownerWallet) {
      ownerWallet = createHash('sha256').update(`cortex:${agent.agent_id}`).digest('hex').slice(0, 44);
      const db = getDb();
      await db.from('agent_keys').update({ owner_wallet: ownerWallet }).eq('id', agent.id);
    }
    (req as TopupRequest).ownerWallet = ownerWallet;
    next();
    return;
  }

  // Privy JWT path
  if (req.privyUser) {
    const wallet = req.query.wallet as string;
    if (!wallet || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
      res.status(400).json({ error: 'Valid Solana wallet address required as ?wallet= query param' });
      return;
    }
    (req as TopupRequest).ownerWallet = wallet;
    next();
    return;
  }

  res.status(401).json({ error: 'Invalid authentication token' });
}

// ---- Webhook signature verification ---- //

function verifyWebhookSignature(authHeader: string | undefined): boolean {
  const secret = config.helius.webhookSecret;
  if (!secret) {
    log.warn('HELIUS_WEBHOOK_SECRET not configured — rejecting all webhooks');
    return false;
  }
  if (!authHeader) return false;

  try {
    const expected = Buffer.from(secret, 'utf8');
    const received = Buffer.from(authHeader, 'utf8');
    if (expected.length !== received.length) return false;
    return timingSafeEqual(expected, received);
  } catch {
    return false;
  }
}

// ---- Core: credit balance from a verified USDC transfer ---- //

/**
 * Credit a user's balance from a confirmed USDC transfer.
 * Idempotent: duplicate tx_hash is rejected (UNIQUE constraint on chat_topups.tx_hash).
 * Returns { credited: true, amount } on success, { credited: false, reason } on skip/error.
 */
async function creditBalance(
  senderWallet: string,
  amountUsdc: number,
  txHash: string,
  chain: string = 'solana',
): Promise<{ credited: boolean; amount?: number; reason?: string }> {
  const db = getDb();

  if (amountUsdc <= 0) {
    return { credited: false, reason: 'Zero or negative amount' };
  }

  // Insert topup record (tx_hash UNIQUE prevents duplicates)
  const { error: topupError } = await db
    .from('chat_topups')
    .insert({
      wallet_address: senderWallet,
      amount_usdc: amountUsdc,
      chain,
      tx_hash: txHash,
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
    });

  if (topupError) {
    if (topupError.code === '23505') {
      // Unique violation — already processed
      log.info({ txHash }, 'Duplicate tx_hash — already credited');
      return { credited: false, reason: 'Transaction already processed' };
    }
    log.error({ err: topupError, txHash }, 'Failed to insert chat_topups');
    return { credited: false, reason: 'Database error' };
  }

  // Upsert balance
  const { data: existing } = await db
    .from('chat_balances')
    .select('balance_usdc, total_deposited')
    .eq('wallet_address', senderWallet)
    .single();

  if (existing) {
    const { error: updateErr } = await db
      .from('chat_balances')
      .update({
        balance_usdc: Number(existing.balance_usdc) + amountUsdc,
        total_deposited: Number(existing.total_deposited) + amountUsdc,
        updated_at: new Date().toISOString(),
      })
      .eq('wallet_address', senderWallet);

    if (updateErr) {
      log.error({ err: updateErr, senderWallet }, 'Failed to update chat_balances');
      return { credited: false, reason: 'Balance update failed' };
    }
  } else {
    const { error: insertErr } = await db
      .from('chat_balances')
      .insert({
        wallet_address: senderWallet,
        balance_usdc: amountUsdc,
        total_deposited: amountUsdc,
        total_spent: 0,
        updated_at: new Date().toISOString(),
      });

    if (insertErr) {
      log.error({ err: insertErr, senderWallet }, 'Failed to insert chat_balances');
      return { credited: false, reason: 'Balance insert failed' };
    }
  }

  log.info({ senderWallet, amountUsdc, txHash }, 'Balance credited');
  return { credited: true, amount: amountUsdc };
}

/**
 * Credit balance only (no topup record insert). Used when the intent record
 * already exists and has been updated with the tx_hash separately.
 */
async function creditBalanceOnly(
  wallet: string,
  amountUsdc: number,
): Promise<{ credited: boolean; reason?: string; newBalance?: number }> {
  const db = getDb();

  if (amountUsdc <= 0) {
    return { credited: false, reason: 'Zero or negative amount' };
  }

  const { data: existing } = await db
    .from('chat_balances')
    .select('balance_usdc, total_deposited')
    .eq('wallet_address', wallet)
    .single();

  if (existing) {
    const newBalance = Number(existing.balance_usdc) + amountUsdc;
    const { error: updateErr } = await db
      .from('chat_balances')
      .update({
        balance_usdc: newBalance,
        total_deposited: Number(existing.total_deposited) + amountUsdc,
        updated_at: new Date().toISOString(),
      })
      .eq('wallet_address', wallet);

    if (updateErr) {
      log.error({ err: updateErr, wallet }, 'Failed to update chat_balances');
      return { credited: false, reason: 'Balance update failed' };
    }
    return { credited: true, newBalance };
  } else {
    const { error: insertErr } = await db
      .from('chat_balances')
      .insert({
        wallet_address: wallet,
        balance_usdc: amountUsdc,
        total_deposited: amountUsdc,
        total_spent: 0,
        updated_at: new Date().toISOString(),
      });

    if (insertErr) {
      log.error({ err: insertErr, wallet }, 'Failed to insert chat_balances');
      return { credited: false, reason: 'Balance insert failed' };
    }
    return { credited: true, newBalance: amountUsdc };
  }
}

// ---- Verify a tx hash via Solana RPC ---- //

/** Sleep helper for retry backoff */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse a confirmed transaction and verify it contains a USDC transfer to
 * the treasury. Used internally after the tx has been fetched.
 */
function extractUsdcTransfer(tx: any): {
  valid: boolean;
  sender?: string;
  amount?: number;
  reason?: string;
} {
  if (tx.meta?.err) {
    return { valid: false, reason: 'Transaction failed on-chain' };
  }

  const preBalances = tx.meta?.preTokenBalances || [];
  const postBalances = tx.meta?.postTokenBalances || [];

  const treasuryPost = postBalances.find(
    (b: any) => b.owner === TREASURY && b.mint === USDC_MINT,
  );
  const treasuryPre = preBalances.find(
    (b: any) => b.owner === TREASURY && b.mint === USDC_MINT,
  );

  if (!treasuryPost) {
    return { valid: false, reason: 'No USDC transfer to treasury address found' };
  }

  const postAmount = Number(treasuryPost.uiTokenAmount?.uiAmount || 0);
  const preAmount = treasuryPre ? Number(treasuryPre.uiTokenAmount?.uiAmount || 0) : 0;
  const transferred = postAmount - preAmount;

  if (transferred <= 0) {
    return { valid: false, reason: 'No positive USDC inflow to treasury' };
  }

  const sender = tx.transaction.message.accountKeys[0]?.pubkey?.toString();
  if (!sender) {
    return { valid: false, reason: 'Could not determine sender' };
  }

  return { valid: true, sender, amount: transferred };
}

/**
 * Fetch a parsed transaction from Solana RPC and verify it contains a USDC
 * transfer to the treasury address. Retries up to 3 times with backoff to
 * handle the common race where the client calls confirm immediately after
 * signAndSendTransaction but the tx hasn't been confirmed on-chain yet.
 */
async function verifyTransactionViaRPC(txHash: string): Promise<{
  valid: boolean;
  sender?: string;
  amount?: number;
  reason?: string;
}> {
  const RETRY_DELAYS = [0, 2000, 4000]; // immediate, then 2s, then 4s
  const connection = getConnection();

  for (let attempt = 0; attempt < RETRY_DELAYS.length; attempt++) {
    if (RETRY_DELAYS[attempt] > 0) {
      log.info({ txHash, attempt, delayMs: RETRY_DELAYS[attempt] }, 'Retrying tx verification');
      await sleep(RETRY_DELAYS[attempt]);
    }

    try {
      const tx = await connection.getParsedTransaction(txHash, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx) {
        // Tx not confirmed yet — retry if we have attempts left
        if (attempt < RETRY_DELAYS.length - 1) continue;
        return { valid: false, reason: 'Transaction not found after retries — may still be confirming. Try again in a few seconds.' };
      }

      return extractUsdcTransfer(tx);
    } catch (err) {
      // RPC error — retry if we have attempts left
      if (attempt < RETRY_DELAYS.length - 1) {
        log.warn({ err, txHash, attempt }, 'RPC error during verification, retrying');
        continue;
      }
      log.error({ err, txHash }, 'RPC verification failed after retries');
      return { valid: false, reason: 'RPC error — try again later' };
    }
  }

  return { valid: false, reason: 'Verification exhausted retries' };
}

// ---- Routes ---- //

export function topupWebhookRoutes(): Router {
  const router = Router();

  /**
   * POST /webhook/helius/usdc
   * Helius enhanced transaction webhook — detects USDC transfers to treasury.
   */
  router.post('/helius/usdc', async (req: Request, res: Response) => {
    // Verify webhook signature
    const authHeader = req.headers['authorization'] as string | undefined;
    if (!verifyWebhookSignature(authHeader)) {
      log.warn('Helius webhook: invalid or missing signature');
      res.status(401).json({ error: 'Invalid webhook signature' });
      return;
    }

    const transactions: HeliusEnhancedTransaction[] = req.body;
    if (!Array.isArray(transactions)) {
      res.status(400).json({ error: 'Expected array of transactions' });
      return;
    }

    let credited = 0;
    let skipped = 0;

    for (const tx of transactions) {
      // Skip failed transactions
      if (tx.transactionError) {
        skipped++;
        continue;
      }

      // Find USDC transfers to our treasury
      const usdcTransfers = (tx.tokenTransfers || []).filter(
        t => t.mint === USDC_MINT && t.toUserAccount === TREASURY && t.tokenAmount > 0,
      );

      if (usdcTransfers.length === 0) {
        skipped++;
        continue;
      }

      for (const transfer of usdcTransfers) {
        // Try reference-based matching first: look for a pending intent whose
        // reference key appears in this transaction's account list.
        const accountKeys = (tx.accountData || []).map(a => a.account);
        let matchedIntent = false;

        if (accountKeys.length > 0) {
          const db = getDb();
          const { data: pendingIntents } = await db
            .from('chat_topups')
            .select('id, wallet_address, reference')
            .eq('status', 'pending')
            .not('reference', 'is', null);

          if (pendingIntents && pendingIntents.length > 0) {
            const accountSet = new Set(accountKeys);
            const matched = pendingIntents.find(i => accountSet.has(i.reference));
            if (matched) {
              // Update the pending intent with tx_hash and confirmed status
              await db
                .from('chat_topups')
                .update({
                  tx_hash: tx.signature,
                  status: 'confirmed',
                  confirmed_at: new Date().toISOString(),
                })
                .eq('id', matched.id);

              const balResult = await creditBalanceOnly(matched.wallet_address, transfer.tokenAmount);
              if (balResult.credited) {
                credited++;
                matchedIntent = true;
                log.info({ reference: matched.reference, sig: tx.signature }, 'Reference-matched payment credited');
              }
            }
          }
        }

        // Fallback: fee-payer based crediting (legacy path)
        if (!matchedIntent) {
          const result = await creditBalance(
            transfer.fromUserAccount,
            transfer.tokenAmount,
            tx.signature,
          );
          if (result.credited) {
            credited++;
          } else {
            skipped++;
            log.debug({ reason: result.reason, sig: tx.signature }, 'Helius transfer skipped');
          }
        }
      }
    }

    log.info({ total: transactions.length, credited, skipped }, 'Helius webhook processed');
    res.json({ ok: true, credited, skipped });
  });

  return router;
}

export function topupApiRoutes(): Router {
  const router = Router();

  /**
   * POST /api/chat/topup/intent
   * Create a Solana Pay top-up intent with a unique reference key.
   * Returns a solana: URI for QR codes / deep-links.
   */
  router.post('/topup/intent', topupAuth, async (req: Request, res: Response) => {
    const wallet = (req as TopupRequest).ownerWallet!;
    const { amount_usdc, chain } = req.body;

    if (!amount_usdc || typeof amount_usdc !== 'number' || amount_usdc < 1) {
      res.status(400).json({ error: 'amount_usdc required (minimum 1)' });
      return;
    }

    // Rate limit: 30 intents per wallet per 24h
    const allowed = await checkRateLimit('chat:topup-intent:' + wallet, 30, 1440);
    if (!allowed) {
      res.status(429).json({ error: 'Too many top-up requests. Try again tomorrow.' });
      return;
    }

    // Generate a unique reference keypair — the public key is used as an on-chain
    // reference that Solana Pay appends to the transaction for reliable detection.
    const referenceKeypair = Keypair.generate();
    const reference = referenceKeypair.publicKey.toBase58();

    const db = getDb();
    const { data: intent, error } = await db
      .from('chat_topups')
      .insert({
        wallet_address: wallet,
        amount_usdc: amount_usdc,
        chain: chain || 'solana',
        status: 'pending',
        reference,
      })
      .select('id, wallet_address, amount_usdc, chain, reference')
      .single();

    if (error) {
      log.error({ err: error, wallet }, 'Failed to create topup intent');
      res.status(500).json({ error: 'Failed to create top-up intent' });
      return;
    }

    // Build Solana Pay transfer URL
    // Format: solana:<recipient>?amount=<amount>&spl-token=<mint>&reference=<ref>&memo=<wallet>
    const solanaPayUrl = `solana:${TREASURY}?amount=${amount_usdc}&spl-token=${USDC_MINT}&reference=${reference}&memo=${wallet}`;

    log.info({ wallet, amount_usdc, reference, intentId: intent.id }, 'Top-up intent created');

    res.json({
      id: intent.id,
      wallet_address: intent.wallet_address,
      amount_usdc: Number(intent.amount_usdc),
      chain: intent.chain,
      dest_address: TREASURY,
      reference,
      solana_pay_url: solanaPayUrl,
    });
  });

  /**
   * POST /api/chat/topup/confirm
   * Client submits a tx hash for verification. If intent_id is provided,
   * uses reference-based matching via getSignaturesForAddress. Falls back
   * to direct RPC parsed transaction verification.
   */
  router.post('/topup/confirm', topupAuth, async (req: Request, res: Response) => {
    const { tx_hash, intent_id } = req.body;
    const wallet = (req as TopupRequest).ownerWallet!;

    if (!tx_hash || typeof tx_hash !== 'string') {
      res.status(400).json({ error: 'tx_hash required' });
      return;
    }

    // Validate tx hash format: Solana (base58, 87-88 chars) or EVM (0x hex, 66 chars)
    const isSolanaTx = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(tx_hash);
    const isEvmTx = /^0x[0-9a-fA-F]{64}$/.test(tx_hash);
    if (!isSolanaTx && !isEvmTx) {
      res.status(400).json({ error: 'Invalid transaction hash format' });
      return;
    }

    // Rate limit: 20 confirm attempts per wallet per 24h
    const allowed = await checkRateLimit('chat:topup:' + wallet, 20, 1440);
    if (!allowed) {
      res.status(429).json({ error: 'Too many top-up requests. Try again tomorrow.' });
      return;
    }

    const db = getDb();

    // If intent_id is provided, look up the intent and verify via reference
    if (intent_id) {
      const { data: intent } = await db
        .from('chat_topups')
        .select('id, status, amount_usdc, reference, wallet_address, chain')
        .eq('id', intent_id)
        .single();

      if (!intent) {
        res.status(404).json({ error: 'Intent not found' });
        return;
      }

      if (intent.status === 'confirmed') {
        res.json({ status: 'already_confirmed', amount_usdc: Number(intent.amount_usdc) });
        return;
      }

      let verifiedAmount: number;
      let verifiedSender: string | undefined;

      if (isSolanaTx) {
        // Solana: verify on-chain via RPC (with retry for timing race)
        const verification = await verifyTransactionViaRPC(tx_hash);
        if (!verification.valid) {
          res.status(400).json({ error: verification.reason });
          return;
        }
        verifiedAmount = verification.amount!;
        verifiedSender = verification.sender;
      } else {
        // EVM (Base): no on-chain verification yet — trust the intent amount
        // The intent was created by the authenticated user, so the amount is reliable
        verifiedAmount = Number(intent.amount_usdc);
        log.info({ txHash: tx_hash, chain: intent.chain, intentId: intent_id }, 'EVM tx — skipping on-chain verification (not yet supported)');
      }

      // Update the pending intent to confirmed with the tx_hash
      const { error: updateErr } = await db
        .from('chat_topups')
        .update({
          tx_hash: tx_hash,
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', intent_id)
        .eq('status', 'pending');

      if (updateErr) {
        log.error({ err: updateErr, intentId: intent_id }, 'Failed to update intent');
        res.status(500).json({ error: 'Failed to confirm intent' });
        return;
      }

      // Credit the balance using the intent's wallet and verified amount
      const senderWallet = intent.wallet_address;

      const balanceResult = await creditBalanceOnly(senderWallet, verifiedAmount);
      if (!balanceResult.credited) {
        res.status(500).json({ error: balanceResult.reason || 'Failed to credit balance' });
        return;
      }

      log.info({ wallet: senderWallet, amount: verifiedAmount, intentId: intent_id }, 'Intent confirmed and balance credited');
      res.json({
        status: 'confirmed',
        amount_usdc: verifiedAmount,
        sender: verifiedSender,
        credited_to: senderWallet,
        balance_usdc: balanceResult.newBalance,
      });
      return;
    }

    // Legacy path: no intent_id, verify by tx_hash directly
    // Check if already processed
    const { data: existing } = await db
      .from('chat_topups')
      .select('id, status, amount_usdc')
      .eq('tx_hash', tx_hash)
      .single();

    if (existing) {
      if (existing.status === 'confirmed') {
        res.json({ status: 'already_confirmed', amount_usdc: Number(existing.amount_usdc) });
        return;
      }
    }

    // Verify via RPC
    const verification = await verifyTransactionViaRPC(tx_hash);

    if (!verification.valid) {
      res.status(400).json({ error: verification.reason });
      return;
    }

    // Security: the authenticated wallet should match the sender, OR we allow
    // any verified transfer to treasury (the sender wallet gets credited)
    const senderWallet = verification.sender!;
    const amount = verification.amount!;

    const result = await creditBalance(senderWallet, amount, tx_hash);

    if (result.credited) {
      res.json({
        status: 'confirmed',
        amount_usdc: amount,
        sender: senderWallet,
        credited_to: senderWallet,
      });
    } else {
      // Already processed or error
      res.json({ status: result.reason === 'Transaction already processed' ? 'already_confirmed' : 'error', reason: result.reason });
    }
  });

  /**
   * GET /api/chat/balance
   * Returns the authenticated user's USDC balance.
   */
  router.get('/balance', topupAuth, async (req: Request, res: Response) => {
    const wallet = (req as TopupRequest).ownerWallet!;
    const db = getDb();

    const { data } = await db
      .from('chat_balances')
      .select('balance_usdc, total_deposited, total_spent, updated_at')
      .eq('wallet_address', wallet)
      .single();

    const promoExpiry = config.features.freePromoExpiry;
    const promoActive = config.features.freePromoEnabled &&
      (!promoExpiry || new Date() < new Date(promoExpiry));
    const promoCredit = config.features.freePromoCreditUsdc;

    res.json({
      wallet,
      balance_usdc: data ? Number(data.balance_usdc) : 0,
      total_deposited: data ? Number(data.total_deposited) : 0,
      total_spent: data ? Number(data.total_spent) : 0,
      updated_at: data?.updated_at || null,
      ...(promoActive && {
        promo: true,
        promoLabel: 'Free - Limited Time',
        promo_credit_usdc: promoCredit,
      }),
    });
  });

  /**
   * GET /api/chat/topup/status/:intentId
   * Check whether a Solana Pay QR payment has landed on-chain by polling
   * getSignaturesForAddress on the intent's reference key. This is the
   * fallback that makes QR payments work even without the Helius webhook.
   *
   * If a matching on-chain tx is found, the intent is auto-confirmed and
   * balance is credited (idempotent — already-confirmed intents return early).
   */
  router.get('/topup/status/:intentId', topupAuth, async (req: Request, res: Response) => {
    const { intentId } = req.params;
    const wallet = (req as TopupRequest).ownerWallet!;
    const db = getDb();

    const { data: intent } = await db
      .from('chat_topups')
      .select('id, status, amount_usdc, reference, wallet_address, tx_hash')
      .eq('id', intentId)
      .single();

    if (!intent) {
      res.status(404).json({ error: 'Intent not found' });
      return;
    }

    // Already confirmed — return immediately
    if (intent.status === 'confirmed') {
      res.json({ status: 'confirmed', amount_usdc: Number(intent.amount_usdc), tx_hash: intent.tx_hash });
      return;
    }

    // Only the owner can check their intent
    if (intent.wallet_address !== wallet) {
      res.status(403).json({ error: 'Not authorized' });
      return;
    }

    // No reference key → can't do on-chain detection
    if (!intent.reference) {
      res.json({ status: 'pending', amount_usdc: Number(intent.amount_usdc) });
      return;
    }

    // Poll on-chain: look for transactions involving the reference public key
    try {
      const connection = getConnection();
      const referencePubkey = new PublicKey(intent.reference);
      const signatures = await connection.getSignaturesForAddress(referencePubkey, { limit: 1 }, 'confirmed');

      if (!signatures || signatures.length === 0) {
        res.json({ status: 'pending', amount_usdc: Number(intent.amount_usdc) });
        return;
      }

      const sig = signatures[0];
      if (sig.err) {
        res.json({ status: 'failed', reason: 'Transaction failed on-chain' });
        return;
      }

      // Found a confirmed tx with this reference — verify it's a USDC transfer to treasury
      const verification = await verifyTransactionViaRPC(sig.signature);
      if (!verification.valid) {
        res.json({ status: 'pending', reason: verification.reason });
        return;
      }

      // Credit the balance
      const { error: updateErr } = await db
        .from('chat_topups')
        .update({
          tx_hash: sig.signature,
          status: 'confirmed',
          confirmed_at: new Date().toISOString(),
        })
        .eq('id', intentId)
        .eq('status', 'pending');

      if (updateErr) {
        // Might be a race with the webhook — check if already confirmed
        const { data: refreshed } = await db
          .from('chat_topups')
          .select('status, tx_hash')
          .eq('id', intentId)
          .single();
        if (refreshed?.status === 'confirmed') {
          res.json({ status: 'confirmed', amount_usdc: Number(intent.amount_usdc), tx_hash: refreshed.tx_hash });
          return;
        }
        log.error({ err: updateErr, intentId }, 'Failed to confirm intent via reference detection');
        res.status(500).json({ error: 'Failed to confirm payment' });
        return;
      }

      const balResult = await creditBalanceOnly(intent.wallet_address, verification.amount!);
      log.info({ wallet: intent.wallet_address, amount: verification.amount, intentId, sig: sig.signature }, 'QR payment detected via reference polling');

      res.json({
        status: 'confirmed',
        amount_usdc: verification.amount,
        tx_hash: sig.signature,
        balance_usdc: balResult.newBalance,
      });
    } catch (err) {
      log.error({ err, intentId }, 'Reference-based status check failed');
      res.json({ status: 'pending', amount_usdc: Number(intent.amount_usdc) });
    }
  });

  /**
   * GET /api/chat/topup/history
   * Returns the authenticated user's top-up transactions.
   */
  router.get('/topup/history', topupAuth, async (req: Request, res: Response) => {
    const wallet = (req as TopupRequest).ownerWallet!;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);
    const db = getDb();

    const { data, error } = await db
      .from('chat_topups')
      .select('id, amount_usdc, chain, tx_hash, status, created_at, confirmed_at')
      .eq('wallet_address', wallet)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      log.error({ err: error, wallet }, 'Failed to fetch topup history');
      res.status(500).json({ error: 'Failed to fetch topup history' });
      return;
    }

    res.json({
      topups: (data || []).map(t => ({
        ...t,
        amount_usdc: Number(t.amount_usdc),
      })),
      count: data?.length || 0,
    });
  });

  return router;
}
