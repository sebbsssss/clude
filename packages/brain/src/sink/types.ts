// Token sink — types shared across the sink subsystem.
//
// $CLUDE token mint on Solana mainnet (pump.fun, 6 decimals).
// USDC mainnet mint, 6 decimals.
//
// All amounts in this module are stored as integers in the smallest
// unit (micro-USDC, $CLUDE lamports). Avoid floats anywhere they touch
// money — they will eventually be wrong.

import { CLUDE_CA } from '../knowledge/tokenomics.js';

export const CLUDE_MINT = CLUDE_CA;
export const CLUDE_DECIMALS = 6;
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const USDC_DECIMALS = 6;

export type SinkSource =
  | 'stripe'
  | 'direct_usdc'
  | 'overflow'
  | 'anchor'
  | 'marketplace';

export type SinkStatus =
  | 'pending'   // recorded, USDC not yet in hot wallet (or accumulating)
  | 'swapping'  // cron picked it up, in flight
  | 'completed' // swap + treasury transfer confirmed
  | 'failed'    // failed; retried automatically
  | 'skipped';  // gated out by slippage / size, will retry

export type Tier = 'free' | 'personal' | 'pro' | 'agent';

export const TIER_RANK: Record<Tier, number> = {
  free: 0,
  personal: 1,
  pro: 2,
  agent: 3,
};

/**
 * Pricing in micro-USDC (6 dec). Below industry standard:
 *   personal $5 / pro $19 / agent $59
 * Marginal cost per Personal user with local embeddings is sub-dollar,
 * so this leaves margin and a meaningful $CLUDE buy-pressure stream.
 */
export const TIER_PRICE_MICRO_USDC: Record<Exclude<Tier, 'free'>, bigint> = {
  personal: 5_000_000n,    // $5
  pro: 19_000_000n,        // $19
  agent: 59_000_000n,      // $59
};

/**
 * Quotas (memories per day). Chosen to comfortably accommodate honest
 * use without obvious abuse vectors. Above-quota usage is soft-throttled
 * (slower writes), not hard-blocked.
 */
export const TIER_DAILY_MEMORY_QUOTA: Record<Tier, number> = {
  free: 200,           // local-only mode anyway; quota is for cloud
  personal: 5_000,
  pro: 50_000,
  agent: 1_000_000,
};

export interface SinkLedgerEntry {
  id?: number;
  status: SinkStatus;
  source: SinkSource;
  source_ref: string | null;
  usdc_in_micro: bigint;
  usdc_swapped_micro: bigint | null;
  clude_out_lamports: bigint | null;
  jupiter_route: unknown | null;
  realised_slippage_bps: number | null;
  swap_tx_sig: string | null;
  treasury_transfer_tx_sig: string | null;
  error: string | null;
  created_at?: string;
  swapped_at?: string | null;
}

export interface JupiterQuote {
  inAmount: string;             // micro-USDC, decimal string
  outAmount: string;            // CLUDE lamports, decimal string
  priceImpactPct: string;       // decimal string, e.g. "0.0123"
  routePlan: unknown;
  // Full opaque quote response — passes back to swap call as-is.
  raw: unknown;
}
