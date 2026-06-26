/**
 * solana-title-gate — the chain-aware unlock ownership check for Solana-titled packs.
 *
 * The Solana-native replacement for the v0.1 `holdsPackToken` balance>=1 gate (pack-gate.ts:92): a pack
 * TITLE is a 1-of-1 SPL NFT, so "who may unlock this pack" = whoever holds that single token. We read it
 * LIVE on-chain (assertTitleOwner → getTokenLargestAccounts) and FAIL CLOSED on any RPC error. The
 * pack_titles.current_owner column is a cache only and is NEVER consulted as the authority — exactly the
 * B2/RT9 invariant the Base unlock gate follows (035 header).
 *
 * Why this fixes the double-spend: the old gate granted unlock to ANY wallet holding >=1 of a pack token
 * (a fungible-ish mint — many holders possible). A 1-of-1 title has exactly one holder, so ownership is
 * unambiguous and unforgeable.
 *
 * For a pack with no Solana title row (legacy token-gated or Base-titled), this returns { titled: false }
 * so the unlock route falls back to its existing path UNCHANGED. A DB lookup error THROWS (the route maps
 * it to a transient 503) — an infra failure must never be read as "not titled" and silently downgraded.
 *
 * ROUTE INTEGRATION CONTRACT (this is an ownership ORACLE only — the wiring MUST honor these; they are the
 * CRITICALs an adversarial review flagged, and getting them wrong reopens the double-spend hole):
 *   1. VERIFY THE SIGNATURE FIRST. This does NO signature/replay check — it trusts that `walletAddress` is
 *      already proven. The route MUST call verifyUnlockSignature() first and pass sig.walletAddress, or
 *      anyone could unlock by simply naming the current holder's address.
 *   2. FALL BACK ⟺ titled === false. A `titled: true` result is the title gate's FINAL word: ALLOW only on
 *      ok:true, DENY on ok:false. NEVER let a denied title (ok:false) fall through to the legacy balance>=1
 *      or copy-entitlement path — that downgrade is the exact bug this gate exists to kill. Authorize ⟺
 *      `result.titled && result.ok`; never branch the fallback on `.ok`.
 *   3. TITLE IS AUTHORITATIVE. Run this BEFORE the sale_mode switch — a Solana title outranks both the
 *      legacy token gate and any copy-entitlement on the same pack.
 *   4. STATUS MAP: not_title_owner → 403, rpc_unavailable → 503 (add 'not_title_owner' to
 *      UnlockFailureReason / unlockFailureStatus, or map it at the call site — it is not there yet).
 *
 * Injected db + SolanaTitleMintClient → unit-tested with mocks, no live chain.
 */

import { createChildLogger } from '@clude/shared/core/logger';
import { assertTitleOwner, type SolanaTitleMintClient } from '../solana-title-mint.js';

const log = createChildLogger('solana-title-gate');

/** A minimal Supabase-shaped handle (same structural type the other title helpers use). */
export interface DbLike {
  from(table: string): any;
}

export type SolanaUnlockResult =
  /** Not a Solana-titled pack — the caller should use the legacy token-gate / copy-entitlement path. */
  | { titled: false }
  /** A Solana title exists and `walletAddress` holds the 1-of-1 on-chain. */
  | { titled: true; ok: true; mintAddress: string }
  /** A Solana title exists but the wallet does not hold it (or the chain read failed → fail closed). */
  | { titled: true; ok: false; reason: 'not_title_owner' | 'rpc_unavailable' };

interface SolanaTitleRow {
  chain: string;
  mint_address: string | null;
  status: string;
}

const SOLANA_CHAINS = new Set(['solana-devnet', 'solana']);

/**
 * Decide whether `walletAddress` may unlock `packId` via its Solana title. Returns { titled:false } if the
 * pack has no Solana title (caller falls back); otherwise a live, fail-closed on-chain ownership verdict.
 * Throws on a DB lookup error (transient — the route maps it to 503).
 */
export async function assertSolanaTitleUnlock(
  db: DbLike,
  sol: SolanaTitleMintClient,
  packId: string,
  walletAddress: string,
): Promise<SolanaUnlockResult> {
  const { data, error } = await db
    .from('pack_titles')
    .select('chain, mint_address, status')
    .eq('pack_id', packId)
    .maybeSingle();
  if (error) {
    log.warn({ err: error, packId }, 'assertSolanaTitleUnlock: pack_titles lookup failed');
    throw new Error('assertSolanaTitleUnlock: failed to read pack_titles');
  }

  const row = data as SolanaTitleRow | null;
  if (!row || !SOLANA_CHAINS.has(row.chain) || !row.mint_address) {
    return { titled: false }; // not a Solana title — fall back to the legacy / copy-entitlement gate
  }

  // LIVE on-chain 1-of-1 holder check — never trusts the current_owner cache; fails closed on RPC error.
  let holds: boolean;
  try {
    holds = await assertTitleOwner(sol, row.mint_address, walletAddress);
  } catch (err) {
    log.warn({ err, packId, mint: row.mint_address }, 'assertSolanaTitleUnlock: on-chain owner read failed — failing closed');
    return { titled: true, ok: false, reason: 'rpc_unavailable' };
  }

  return holds
    ? { titled: true, ok: true, mintAddress: row.mint_address }
    : { titled: true, ok: false, reason: 'not_title_owner' };
}
