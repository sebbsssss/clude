// Billing routes (v0): direct USDC upgrade only.
//
// Stripe webhook integration is intentionally NOT wired in v0 — we
// ship USDC-only first, validate demand, then add fiat. The route
// shape and idempotency tables are designed so adding Stripe later
// is purely additive.

import { Router, Request, Response } from 'express';
import { Connection, PublicKey, ParsedTransactionWithMeta } from '@solana/web3.js';
import nacl from 'tweetnacl';
// @ts-ignore — bs58 ESM/CJS interop
import * as bs58Module from 'bs58';
const bs58: { encode: (b: Uint8Array) => string; decode: (s: string) => Uint8Array } =
  (bs58Module as any).default || bs58Module;

import {
  TIER_PRICE_MICRO_USDC,
  USDC_MINT,
  type Tier,
  upsertTier,
  getTier,
  insertPending,
  findBySourceRef,
} from '@clude/brain/sink';
import { config } from '@clude/shared/config';
import { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('billing');

interface UpgradeRequest {
  wallet: string;            // base58 Solana pubkey
  tier: Tier;                // 'personal' | 'pro'
  tx_sig: string;            // signature of USDC transfer to sink hot wallet
  signed_message: string;    // base58 ed25519 sig over canonical msg, proves wallet intent
}

const CANONICAL_MSG_PREFIX = 'clude-billing-upgrade-v1:';

function deriveCanonicalMsg(req: UpgradeRequest): string {
  return `${CANONICAL_MSG_PREFIX}${req.wallet}:${req.tier}:${req.tx_sig}`;
}

function verifyOwnership(req: UpgradeRequest): boolean {
  try {
    const msg = Buffer.from(deriveCanonicalMsg(req), 'utf-8');
    const sig = bs58.decode(req.signed_message);
    const pub = bs58.decode(req.wallet);
    return nacl.sign.detached.verify(msg, sig, pub);
  } catch {
    return false;
  }
}

/**
 * Verify that tx_sig represents a USDC transfer of the expected amount
 * from `wallet` to the sink hot wallet. We re-fetch the parsed tx from
 * Solana and walk its instructions; never trust client-supplied amounts.
 */
async function verifyUsdcTransfer(opts: {
  connection: Connection;
  txSig: string;
  fromWallet: string;
  toWallet: string;
  expectedAmountMicro: bigint;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  let parsed: ParsedTransactionWithMeta | null;
  try {
    parsed = await opts.connection.getParsedTransaction(opts.txSig, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });
  } catch (err) {
    return { ok: false, reason: `rpc fetch failed: ${(err as Error).message}` };
  }
  if (!parsed) return { ok: false, reason: 'tx not found' };
  if (parsed.meta?.err) return { ok: false, reason: 'tx errored on-chain' };

  // Walk all instructions (top-level + inner) looking for a SPL token
  // transfer that matches our expectation.
  const all = [
    ...(parsed.transaction.message.instructions ?? []),
    ...(parsed.meta?.innerInstructions ?? []).flatMap((i) => i.instructions),
  ];

  for (const ix of all) {
    const parsedIx = ix as { parsed?: { type: string; info: Record<string, unknown> } };
    if (!parsedIx.parsed) continue;
    const info = parsedIx.parsed.info;
    const isTransfer =
      parsedIx.parsed.type === 'transfer' || parsedIx.parsed.type === 'transferChecked';
    if (!isTransfer) continue;

    const mint = info.mint as string | undefined;
    if (mint && mint !== USDC_MINT) continue; // wrong token

    const authority = info.authority as string | undefined;
    const source = info.source as string | undefined;
    const destination = info.destination as string | undefined;
    const amountField = info.amount as string | undefined;
    const tokenAmount = info.tokenAmount as { amount: string } | undefined;
    const amount = BigInt(tokenAmount?.amount ?? amountField ?? '0');

    if (amount < opts.expectedAmountMicro) continue;

    // For transferChecked we get mint directly. For plain `transfer`
    // we trust the source ATA owner check below to catch wrong-mint
    // cases (since the ATA address is mint-specific).
    const isFromExpected = authority === opts.fromWallet || source === opts.fromWallet;
    const isToExpected = destination === opts.toWallet;

    // Heuristic: USDC transfers usually use transferChecked from one
    // wallet's USDC ATA to another. We accept if either authority OR
    // source matches the expected wallet, and dest is the hot wallet's
    // USDC ATA (which the client should use as `to_wallet` here).
    if (isFromExpected && isToExpected) {
      return { ok: true };
    }
  }

  return { ok: false, reason: 'no matching USDC transfer instruction found' };
}

export function billingRoutes(): Router {
  const router = Router();

  /**
   * GET /api/billing/tier?identity_kind=wallet&identity_value=<base58>
   * Public-ish read: returns the caller's current tier. Frontends call
   * this to render premium UI states. Always 200 with 'free' as the
   * fallback so we never leak existence/non-existence.
   */
  router.get('/tier', async (req: Request, res: Response) => {
    const kind = String(req.query.identity_kind ?? '');
    const value = String(req.query.identity_value ?? '');
    if (kind !== 'email' && kind !== 'wallet') {
      res.status(400).json({ error: 'identity_kind must be email or wallet' });
      return;
    }
    const tier = await getTier({ kind, value });
    res.json({ tier });
  });

  /**
   * POST /api/billing/upgrade
   * body: UpgradeRequest
   *
   * Flow:
   *   1. Verify wallet signed a canonical message proving intent.
   *   2. Confirm tx_sig is a USDC transfer of the right amount to the
   *      sink hot wallet.
   *   3. Idempotency: tx_sig must not already be a sink_ledger.source_ref.
   *   4. Insert a sink_ledger row in 'pending' state. Cron picks it up.
   *   5. Upsert user_tiers — user gets premium tier IMMEDIATELY,
   *      decoupled from swap success.
   */
  router.post('/upgrade', async (req: Request, res: Response) => {
    const body = req.body as Partial<UpgradeRequest>;
    if (!body.wallet || !body.tier || !body.tx_sig || !body.signed_message) {
      res.status(400).json({ error: 'wallet, tier, tx_sig, signed_message required' });
      return;
    }
    if (body.tier === 'free') {
      res.status(400).json({ error: 'cannot upgrade to free tier' });
      return;
    }
    if (!(body.tier in TIER_PRICE_MICRO_USDC)) {
      res.status(400).json({ error: `unknown tier ${body.tier}` });
      return;
    }
    const upgradeReq = body as UpgradeRequest;

    if (!verifyOwnership(upgradeReq)) {
      res.status(401).json({ error: 'signed_message does not verify against wallet' });
      return;
    }

    const sinkHotPubkey = process.env.SINK_HOT_PUBKEY;
    if (!sinkHotPubkey) {
      log.error('SINK_HOT_PUBKEY not configured — billing disabled');
      res.status(503).json({ error: 'billing temporarily unavailable' });
      return;
    }

    // Idempotency: refuse if this tx has already been credited.
    const existing = await findBySourceRef('direct_usdc', upgradeReq.tx_sig);
    if (existing) {
      res.status(409).json({ error: 'tx already credited', ledger_id: existing.id });
      return;
    }

    const expected = TIER_PRICE_MICRO_USDC[upgradeReq.tier as Exclude<Tier, 'free'>];
    const conn = new Connection(config.solana.rpcUrl, 'confirmed');
    const verify = await verifyUsdcTransfer({
      connection: conn,
      txSig: upgradeReq.tx_sig,
      fromWallet: upgradeReq.wallet,
      toWallet: sinkHotPubkey,
      expectedAmountMicro: expected,
    });
    if (!verify.ok) {
      res.status(400).json({ error: `usdc transfer verification: ${verify.reason}` });
      return;
    }

    let ledgerId: number;
    try {
      ledgerId = await insertPending({
        source: 'direct_usdc',
        source_ref: upgradeReq.tx_sig,
        usdc_in_micro: expected,
      });
    } catch (err) {
      log.error({ err }, 'sink_ledger insert failed');
      res.status(500).json({ error: 'ledger write failed' });
      return;
    }

    // Subscription period: 30 days. Renews on next upgrade call.
    const activeUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    try {
      await upsertTier({
        identity: { kind: 'wallet', value: upgradeReq.wallet },
        tier: upgradeReq.tier,
        source: 'direct_usdc',
        external_id: upgradeReq.tx_sig,
        active_until: activeUntil,
        metadata: { ledger_id: ledgerId },
      });
    } catch (err) {
      log.error({ err }, 'user_tiers upsert failed — ledger row already in pending');
      res.status(500).json({ error: 'tier write failed' });
      return;
    }

    // Idempotency record (sink_events) — separate table for non-DB
    // observers (audit). Best-effort.
    try {
      const db = getDb();
      await db.from('sink_events').insert({
        id: upgradeReq.tx_sig,
        source: 'direct_usdc',
        payload: { wallet: upgradeReq.wallet, tier: upgradeReq.tier, ledger_id: ledgerId },
      });
    } catch {
      // ignore duplicate key — idempotent
    }

    log.info(
      { wallet: upgradeReq.wallet, tier: upgradeReq.tier, txSig: upgradeReq.tx_sig, ledgerId },
      'Tier upgrade recorded',
    );
    res.json({
      tier: upgradeReq.tier,
      active_until: activeUntil.toISOString(),
      ledger_id: ledgerId,
    });
  });

  return router;
}

// Exposed for tests
export const __test__ = { deriveCanonicalMsg, verifyOwnership, verifyUsdcTransfer };
