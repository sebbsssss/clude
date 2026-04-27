// Jupiter aggregator wrapper for USDC → $CLUDE swaps.
//
// Uses the public quote-api / swap-api endpoints. No SDK dependency.
//
// Slippage is enforced on two layers:
//  1. Jupiter's slippageBps parameter (hard cap on quoted route).
//  2. Our own pre-execution check on priceImpactPct before signing.
//
// Both are tunable via env. Defaults err conservative: a thin pool
// produces high impact and we'd rather skip a tick than rug ourselves.

import {
  Connection,
  Keypair,
  VersionedTransaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import { CLUDE_MINT, USDC_MINT, JupiterQuote } from './types.js';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('sink:jupiter');

const QUOTE_API = 'https://quote-api.jup.ag/v6/quote';
const SWAP_API = 'https://quote-api.jup.ag/v6/swap';

export interface QuoteOptions {
  inputMicroUsdc: bigint;
  slippageBps?: number;       // default 200 = 2%
  onlyDirectRoutes?: boolean;  // false = let Jupiter find multi-hop
}

export async function getQuote(opts: QuoteOptions): Promise<JupiterQuote> {
  const params = new URLSearchParams({
    inputMint: USDC_MINT,
    outputMint: CLUDE_MINT,
    amount: String(opts.inputMicroUsdc),
    slippageBps: String(opts.slippageBps ?? 200),
    onlyDirectRoutes: String(opts.onlyDirectRoutes ?? false),
    swapMode: 'ExactIn',
  });
  const res = await fetch(`${QUOTE_API}?${params}`);
  if (!res.ok) {
    throw new Error(`Jupiter quote failed: ${res.status} ${await res.text()}`);
  }
  const data = await res.json() as Record<string, unknown>;
  return {
    inAmount: String(data.inAmount),
    outAmount: String(data.outAmount),
    priceImpactPct: String(data.priceImpactPct),
    routePlan: data.routePlan,
    raw: data,
  };
}

export interface SwapOptions {
  quote: JupiterQuote;
  hotWallet: Keypair;
  connection: Connection;
  // Reject if execution-time price impact exceeds this. Distinct from
  // the slippage cap baked into the quote — this is our defence against
  // accepting any quote returned with bad numbers we missed locally.
  maxPriceImpactPct?: number;  // default 5 (= 5%)
}

export interface SwapResult {
  txSig: string;
  inAmount: bigint;
  outAmount: bigint;
  priceImpactPct: number;
}

/**
 * Execute a swap returned by getQuote(). Will throw on slippage gate
 * violations or transaction errors. Caller decides whether to retry.
 */
export async function executeSwap(opts: SwapOptions): Promise<SwapResult> {
  const impact = parseFloat(opts.quote.priceImpactPct) * 100; // priceImpactPct is fractional
  const cap = opts.maxPriceImpactPct ?? 5;
  if (impact > cap) {
    throw new Error(
      `priceImpactPct ${impact.toFixed(2)}% exceeds cap ${cap}% — refusing to swap`,
    );
  }

  // Step 1: ask Jupiter to build the unsigned VersionedTransaction
  const swapRes = await fetch(SWAP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse: opts.quote.raw,
      userPublicKey: opts.hotWallet.publicKey.toBase58(),
      wrapAndUnwrapSol: false,
      // Use dynamic compute unit limit for safety on congested epochs.
      dynamicComputeUnitLimit: true,
      // Priority fee — small but non-zero so we land in a reasonable slot.
      prioritizationFeeLamports: 50_000,
    }),
  });
  if (!swapRes.ok) {
    throw new Error(`Jupiter swap build failed: ${swapRes.status} ${await swapRes.text()}`);
  }
  const swapJson = await swapRes.json() as { swapTransaction: string };

  // Step 2: deserialise, sign, send
  const swapTxBuf = Buffer.from(swapJson.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(swapTxBuf);
  tx.sign([opts.hotWallet]);

  const rawTx = tx.serialize();
  const sig = await opts.connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    maxRetries: 3,
  });

  // Step 3: confirm using the latest blockhash bundle Jupiter included.
  const conf = await opts.connection.confirmTransaction(sig, 'confirmed');
  if (conf.value.err) {
    throw new Error(`Swap tx failed on-chain: ${JSON.stringify(conf.value.err)}`);
  }

  log.info({ sig, impact, in: opts.quote.inAmount, out: opts.quote.outAmount }, 'Swap confirmed');

  return {
    txSig: sig,
    inAmount: BigInt(opts.quote.inAmount),
    outAmount: BigInt(opts.quote.outAmount),
    priceImpactPct: impact,
  };
}
