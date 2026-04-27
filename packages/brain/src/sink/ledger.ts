// sink_ledger reads + writes. Database-thin wrapper. Uses the existing
// Supabase client wiring; no new connection.

import { getDb } from '@clude/shared/core/database';
import type { SinkLedgerEntry, SinkSource, SinkStatus } from './types.js';

export interface InsertOptions {
  source: SinkSource;
  source_ref?: string | null;
  usdc_in_micro: bigint;
}

/**
 * Record an inflow. Status starts as 'pending' and the cron picks it
 * up later. source_ref is a free-form external id (Stripe sub id, USDC
 * tx sig, etc.) used for idempotency-style queries from billing routes.
 */
export async function insertPending(opts: InsertOptions): Promise<number> {
  const db = getDb();
  const { data, error } = await db
    .from('sink_ledger')
    .insert({
      status: 'pending',
      source: opts.source,
      source_ref: opts.source_ref ?? null,
      usdc_in_micro: String(opts.usdc_in_micro),
      usdc_swapped_micro: null,
      clude_out_lamports: null,
      jupiter_route: null,
      realised_slippage_bps: null,
      swap_tx_sig: null,
      treasury_transfer_tx_sig: null,
      error: null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`sink_ledger insert failed: ${error.message}`);
  return Number(data.id);
}

export async function findBySourceRef(
  source: SinkSource,
  source_ref: string,
): Promise<SinkLedgerEntry | null> {
  const db = getDb();
  const { data, error } = await db
    .from('sink_ledger')
    .select('*')
    .eq('source', source)
    .eq('source_ref', source_ref)
    .maybeSingle();
  if (error) return null;
  return data as unknown as SinkLedgerEntry | null;
}

export async function listPending(limit = 100): Promise<SinkLedgerEntry[]> {
  const db = getDb();
  const { data } = await db
    .from('sink_ledger')
    .select('*')
    .in('status', ['pending', 'failed', 'skipped'])
    .order('created_at', { ascending: true })
    .limit(limit);
  return (data ?? []) as unknown as SinkLedgerEntry[];
}

export interface UpdateSwap {
  status: SinkStatus;
  usdc_swapped_micro?: bigint | null;
  clude_out_lamports?: bigint | null;
  jupiter_route?: unknown | null;
  realised_slippage_bps?: number | null;
  swap_tx_sig?: string | null;
  treasury_transfer_tx_sig?: string | null;
  error?: string | null;
}

export async function updateLedger(id: number, patch: UpdateSwap): Promise<void> {
  const db = getDb();
  const set: Record<string, unknown> = { status: patch.status };
  if (patch.usdc_swapped_micro != null) set.usdc_swapped_micro = String(patch.usdc_swapped_micro);
  if (patch.clude_out_lamports != null) set.clude_out_lamports = String(patch.clude_out_lamports);
  if (patch.jupiter_route !== undefined) set.jupiter_route = patch.jupiter_route;
  if (patch.realised_slippage_bps != null) set.realised_slippage_bps = patch.realised_slippage_bps;
  if (patch.swap_tx_sig !== undefined) set.swap_tx_sig = patch.swap_tx_sig;
  if (patch.treasury_transfer_tx_sig !== undefined) {
    set.treasury_transfer_tx_sig = patch.treasury_transfer_tx_sig;
  }
  if (patch.error !== undefined) set.error = patch.error;
  if (patch.status === 'completed') set.swapped_at = new Date().toISOString();
  const { error } = await db.from('sink_ledger').update(set).eq('id', id);
  if (error) throw new Error(`sink_ledger update failed: ${error.message}`);
}

export interface TreasuryStats {
  total_usdc_collected_micro: bigint;
  total_clude_purchased_lamports: bigint;
  swap_count: number;
  last_swap_at: string | null;
  recent: Array<{
    id: number;
    swapped_at: string | null;
    usdc_in_micro: bigint;
    clude_out_lamports: bigint | null;
    realised_slippage_bps: number | null;
    swap_tx_sig: string | null;
    source: string;
  }>;
}

/** Read aggregate stats for the public dashboard. */
export async function getTreasuryStats(recentLimit = 20): Promise<TreasuryStats> {
  const db = getDb();
  // Aggregate sums + count via a single fetch — simpler than RPC for
  // the volume we're at. Revisit if the table grows past ~100k rows.
  const { data: completed } = await db
    .from('sink_ledger')
    .select('id, swapped_at, usdc_swapped_micro, clude_out_lamports, realised_slippage_bps, swap_tx_sig, source')
    .eq('status', 'completed')
    .order('swapped_at', { ascending: false });

  let total_usdc = 0n;
  let total_clude = 0n;
  for (const row of completed ?? []) {
    total_usdc += BigInt(row.usdc_swapped_micro ?? 0);
    total_clude += BigInt(row.clude_out_lamports ?? 0);
  }

  const recent = (completed ?? []).slice(0, recentLimit).map((r) => ({
    id: Number(r.id),
    swapped_at: r.swapped_at,
    usdc_in_micro: BigInt(r.usdc_swapped_micro ?? 0),
    clude_out_lamports: r.clude_out_lamports ? BigInt(r.clude_out_lamports) : null,
    realised_slippage_bps: r.realised_slippage_bps ?? null,
    swap_tx_sig: r.swap_tx_sig ?? null,
    source: r.source,
  }));

  return {
    total_usdc_collected_micro: total_usdc,
    total_clude_purchased_lamports: total_clude,
    swap_count: (completed ?? []).length,
    last_swap_at: completed?.[0]?.swapped_at ?? null,
    recent,
  };
}
