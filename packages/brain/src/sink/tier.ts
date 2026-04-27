// user_tiers reads + writes. Tier semantics live here.

import { getDb } from '@clude/shared/core/database';
import { TIER_RANK, type Tier } from './types.js';

export type IdentityKind = 'email' | 'wallet';

export interface Identity {
  kind: IdentityKind;
  value: string;
}

function normaliseIdentityValue(id: Identity): string {
  return id.kind === 'email' ? id.value.toLowerCase().trim() : id.value;
}

export interface UpsertTierOptions {
  identity: Identity;
  tier: Tier;
  source: 'stripe' | 'direct_usdc' | 'comped';
  external_id?: string | null;
  active_until?: Date | null;
  metadata?: Record<string, unknown>;
}

/**
 * Upsert a tier for an identity. Used by billing routes after a
 * successful payment. Idempotent on (identity_kind, identity_value).
 */
export async function upsertTier(opts: UpsertTierOptions): Promise<void> {
  const db = getDb();
  const { error } = await db
    .from('user_tiers')
    .upsert({
      identity_kind: opts.identity.kind,
      identity_value: normaliseIdentityValue(opts.identity),
      tier: opts.tier,
      source: opts.source,
      external_id: opts.external_id ?? null,
      active_until: opts.active_until ? opts.active_until.toISOString() : null,
      metadata: opts.metadata ?? {},
      updated_at: new Date().toISOString(),
    }, { onConflict: 'identity_kind,identity_value' });
  if (error) throw new Error(`user_tiers upsert failed: ${error.message}`);
}

export async function getTier(id: Identity): Promise<Tier> {
  const db = getDb();
  const { data } = await db
    .from('user_tiers')
    .select('tier, active_until')
    .eq('identity_kind', id.kind)
    .eq('identity_value', normaliseIdentityValue(id))
    .maybeSingle();
  if (!data) return 'free';
  if (data.active_until) {
    const ts = new Date(data.active_until).getTime();
    if (!isNaN(ts) && ts < Date.now()) return 'free';
  }
  return data.tier as Tier;
}

export function meetsTier(actual: Tier, required: Tier): boolean {
  return TIER_RANK[actual] >= TIER_RANK[required];
}
