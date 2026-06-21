/**
 * title-dek — TITLE-license DEK re-wrap + unlock-by-owner gate (the Base pack-title saga).
 *
 * The Base pack-TITLE trading saga, Phase 1 — rewrap-and-gate (binding corrections M4 / RT7 /
 * RT9 / B2; migration 034 schema). Reuses the grant-copy.ts DEK pattern, EvmTitleClient, and
 * memory_dek_wraps (021 + 034).
 *
 * MONEY/ACCESS/DATA CODE. A COPY sale CLONES the pack and wraps each clone's DEK to the buyer as
 * a fresh 'owner' (grant-copy.ts). A TITLE sale does NOT clone: the SAME 1-of-1 Base NFT and the
 * SAME encrypted memories change hands. So the CURRENT title holder needs a DEK wrap on the
 * ORIGINAL memories, and that wrap must ROTATE to the new holder when the title transfers. Two
 * primitives carry that, plus a revoke:
 *
 *   1. rewrapPackDekToTitleHolder — for EACH member memory, recover the per-memory DEK from the
 *      provider wrap (unwrapDek) and seal it to the NEW holder's key (wrapDek), UPSERTing a
 *      memory_dek_wraps row recipient='title_holder', holder_wallet=<holder>. The PK
 *      (memory_id, recipient) means exactly one title_holder wrap per memory; the UPSERT ROTATES
 *      it. ADDITIVE (RT7): it NEVER deletes the prior holder's wrap — there must never be a window
 *      where neither party can decrypt. (The prior holder is removed LAST, by revokeTitleHolder.)
 *
 *   2. assertTitleUnlock — the unlock gate (B2 / RT9). Compute the tokenId, read ownerOf(tokenId)
 *      on Base, and serve the title_holder DEK only if ownerOf === the verified caller address
 *      (case-insensitive EVM compare) AND a title_holder wrap exists for that caller. NEVER a
 *      token-balance check (the balance path is the title double-spend bug). FAIL CLOSED on an RPC
 *      error or a missing token: deny, never fall back to a cache.
 *
 *   3. revokeTitleHolder — the saga's LAST step: remove ONLY the named FORMER holder's
 *      title_holder wraps. Additive-first / revoke-last (RT7) means this runs after the new
 *      holder's wraps are already in place and the on-chain transfer has settled — so there is
 *      never a window where BOTH parties can decrypt after finality.
 *
 * `db` is passed in (so the saga orchestrator can thread one client / future transaction through
 * all steps), unlike grant-copy which calls getDb() internally. The provider secret comes from
 * loadProviderKeypair() (same move grantCopy / revokeMemory make). Owner-scoping: every query is
 * pack-scoped via memory_pack_contents and (for the unlock gate) holder-scoped by the verified
 * on-chain owner — the gate can only ever serve the DEK to the wallet the chain says holds the title.
 */

import type { getDb } from '@clude/shared/core/database';
import { createChildLogger } from '@clude/shared/core/logger';
import { wrapDek, unwrapDek } from '@clude/shared/core/memory-envelope';
import { loadProviderKeypair } from '@clude/shared/core/encryption-keys';
import type { EvmTitleClient } from '../evm-title-client.js';

const log = createChildLogger('title-dek');

/** The Supabase client shape, as returned by getDb(). Threaded in by the saga orchestrator. */
type Db = ReturnType<typeof getDb>;

const TITLE_HOLDER = 'title_holder' as const;
const PROVIDER = 'provider' as const;

/** Lower-case an EVM address for a case-insensitive compare (checksums vary; the bytes do not). */
function evmEq(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/** Resolve a pack's member memory ids, in tree order. Throws (recoverable) on a DB error or empty pack. */
async function loadMemberIds(db: Db, packId: string): Promise<number[]> {
  const { data, error } = await db
    .from('memory_pack_contents')
    .select('memory_id, leaf_index')
    .eq('pack_id', packId)
    .order('leaf_index', { ascending: true });
  if (error) {
    log.error({ err: error, packId }, 'title-dek: pack contents lookup failed');
    throw new Error('title-dek: failed to load pack contents');
  }
  const rows = (data ?? []) as Array<{ memory_id: number; leaf_index: number }>;
  if (rows.length === 0) {
    throw new Error(`title-dek: pack ${packId} has no member memories`);
  }
  return rows.map((r) => r.memory_id);
}

/**
 * Additively re-wrap a pack's per-memory DEKs to a NEW title holder (RT7).
 *
 * For each member memory: recover the DEK from its provider wrap, seal a fresh wrap to
 * `holderPubkey`, and UPSERT it as the memory's single `title_holder` wrap (rotating any prior
 * holder's wrap on (memory_id, recipient)). Does NOT delete the prior holder's wrap — call
 * `revokeTitleHolder` for that, LAST, once the buyer's wraps are in place and the transfer settled.
 *
 * Idempotent + resumable: a re-run rotates each wrap to the same holder (a harmless overwrite).
 * Throws (recoverable) on any DB/crypto failure so the saga leaves the step retryable rather than
 * half-rotating — never silently skips a member.
 *
 * @param db           Supabase client (threaded in by the saga).
 * @param packId       the pack changing hands (server-trusted).
 * @param holderWallet the NEW title holder's Base address (stamped into holder_wallet).
 * @param holderPubkey the NEW holder's X25519 public key (the DEK is sealed to this).
 */
export async function rewrapPackDekToTitleHolder(
  db: Db,
  packId: string,
  holderWallet: string,
  holderPubkey: Uint8Array,
): Promise<void> {
  if (!packId) throw new Error('title-dek: packId is required');
  if (!holderWallet) throw new Error('title-dek: holderWallet is required');

  const memberIds = await loadMemberIds(db, packId);

  // Provider secret recovers each per-memory DEK from its provider wrap. Resolve up front; fail
  // closed (recoverable) if the provider keypair is unavailable rather than half-rotating.
  let providerSecret: Uint8Array;
  try {
    providerSecret = loadProviderKeypair().secretKey;
  } catch (err) {
    log.error({ err, packId }, 'title-dek: provider keypair unavailable for re-wrap');
    throw new Error('title-dek: provider encryption key unavailable');
  }

  // Load the provider wraps for all members (pack-scoped via memberIds).
  const { data: wrapsRaw, error: wrapsErr } = await db
    .from('memory_dek_wraps')
    .select('memory_id, recipient, wrapped_dek, wrap_pubkey')
    .in('memory_id', memberIds)
    .eq('recipient', PROVIDER);
  if (wrapsErr) {
    log.error({ err: wrapsErr, packId }, 'title-dek: provider wrap lookup failed');
    throw new Error('title-dek: failed to load provider DEK wraps');
  }
  const providerWrapByMemory = new Map<number, { wrapped_dek: string; wrap_pubkey: string }>();
  for (const w of (wrapsRaw ?? []) as Array<{ memory_id: number; wrapped_dek: string; wrap_pubkey: string }>) {
    providerWrapByMemory.set(w.memory_id, { wrapped_dek: w.wrapped_dek, wrap_pubkey: w.wrap_pubkey });
  }

  // Re-seal + upsert one title_holder wrap per member. One upsert per memory so a single failed
  // member surfaces loudly (recoverable) and a retry re-rotates the rest harmlessly.
  for (const memoryId of memberIds) {
    const providerWrap = providerWrapByMemory.get(memoryId);
    if (!providerWrap) {
      // An encrypted member with no provider wrap cannot have its DEK recovered to re-seal. Refuse
      // rather than leave the new holder unable to decrypt part of the pack.
      throw new Error(`title-dek: member ${memoryId} missing provider wrap — cannot re-wrap to title holder`);
    }
    const dek = unwrapDek(providerWrap.wrapped_dek, providerWrap.wrap_pubkey, providerSecret);
    if (!dek) {
      throw new Error(`title-dek: failed to recover DEK for member ${memoryId} — cannot re-wrap to title holder`);
    }
    const sealed = wrapDek(dek, holderPubkey);
    const { error: upErr } = await db.from('memory_dek_wraps').upsert(
      {
        memory_id: memoryId,
        recipient: TITLE_HOLDER,
        wrapped_dek: sealed.wrapped,
        wrap_pubkey: sealed.wrapPubkey,
        holder_wallet: holderWallet,
      },
      { onConflict: 'memory_id,recipient' },
    );
    if (upErr) {
      log.error({ err: upErr, packId, memoryId }, 'title-dek: title_holder wrap upsert failed');
      throw new Error('title-dek: failed to upsert title_holder DEK wrap');
    }
  }

  log.info(
    { packId, holder: holderWallet.slice(0, 10), members: memberIds.length },
    'title-dek: re-wrapped pack DEKs to new title holder (additive)',
  );
}

/** The decision returned by the unlock gate. */
export interface TitleUnlockDecision {
  allowed: boolean;
  /** Human-readable cause; present on a denial (and on an allow, for symmetry/logging). */
  reason: string;
}

/**
 * The TITLE-license unlock gate (B2 / RT9). Decide whether `callerBaseAddress` may unlock `packId`.
 *
 * Allows ONLY when BOTH hold:
 *   (a) ownerOf(tokenId) on Base === callerBaseAddress (case-insensitive EVM compare), AND
 *   (b) a `title_holder` DEK wrap exists for that caller on this pack's memories.
 *
 * FAILS CLOSED (denies) on: an RPC error reading ownerOf, a missing/burned token (ownerOf null),
 * a mismatched owner, a missing title_holder wrap, or a wrap-table DB error. It NEVER consults a
 * token balance (the balance path is the title double-spend bug, B2) and NEVER falls back to a
 * cache on an RPC error (RT9) — a chain read that cannot be made is a denial, not an assumption.
 *
 * @param db                Supabase client.
 * @param evmTitleClient    the Base title client (ownerOf / tokenIdFor).
 * @param packId            the pack being unlocked (server-trusted, from the URL).
 * @param callerBaseAddress the Base address the caller has PROVEN they control upstream (this
 *                          function does NOT verify the signature; it trusts the verified address).
 */
export async function assertTitleUnlock(
  db: Db,
  evmTitleClient: EvmTitleClient,
  packId: string,
  callerBaseAddress: string,
): Promise<TitleUnlockDecision> {
  if (!packId || !callerBaseAddress) {
    return { allowed: false, reason: 'missing pack or caller address' };
  }

  const tokenId = evmTitleClient.tokenIdFor(packId);

  // (a) Read the on-chain owner. FAIL CLOSED on an RPC error — a chain read we cannot make is a
  //     denial, never a cache fallback (RT9). A null owner means the token does not exist (not
  //     minted / burned) — also a denial.
  let owner: string | null;
  try {
    owner = await evmTitleClient.titleOwner(tokenId);
  } catch (err) {
    log.error(
      { err, packId, caller: callerBaseAddress.slice(0, 10) },
      'assertTitleUnlock: ownerOf RPC read failed — denying (fail-closed, RT9)',
    );
    return { allowed: false, reason: 'chain owner read failed — denied (fail-closed)' };
  }
  if (!owner) {
    return { allowed: false, reason: 'title does not exist on-chain' };
  }
  if (!evmEq(owner, callerBaseAddress)) {
    return { allowed: false, reason: 'caller does not hold the title on-chain' };
  }

  // (b) A title_holder DEK wrap must exist for this caller on this pack (else there is no key to
  //     serve even though the caller holds the title — e.g. the re-wrap has not run yet). Pack-
  //     scoped via member ids; holder matched case-insensitively. FAIL CLOSED on a read error.
  let memberIds: number[];
  try {
    memberIds = await loadMemberIds(db, packId);
  } catch (err) {
    log.error(
      { err, packId, caller: callerBaseAddress.slice(0, 10) },
      'assertTitleUnlock: member lookup failed — denying (fail-closed)',
    );
    return { allowed: false, reason: 'member lookup failed — denied (fail-closed)' };
  }

  const { data: thRaw, error: thErr } = await db
    .from('memory_dek_wraps')
    .select('memory_id, holder_wallet')
    .in('memory_id', memberIds)
    .eq('recipient', TITLE_HOLDER);
  if (thErr) {
    log.error(
      { err: thErr, packId, caller: callerBaseAddress.slice(0, 10) },
      'assertTitleUnlock: title_holder wrap read failed — denying (fail-closed)',
    );
    return { allowed: false, reason: 'wrap read failed — denied (fail-closed)' };
  }
  const hasWrap = ((thRaw ?? []) as Array<{ holder_wallet: string | null }>).some((w) =>
    evmEq(w.holder_wallet, callerBaseAddress),
  );
  if (!hasWrap) {
    return { allowed: false, reason: 'no title_holder DEK wrap for caller' };
  }

  return { allowed: true, reason: 'owns title on-chain and holds a title_holder DEK wrap' };
}

/**
 * Remove ONLY the named FORMER holder's title_holder wraps for a pack — the saga's LAST step.
 *
 * Called after the new holder's wraps are in place (rewrapPackDekToTitleHolder) AND the on-chain
 * transfer has settled, so additive-first / revoke-last (RT7) holds: there is never a window where
 * neither party can decrypt, and after finality the FORMER holder loses their wrap so BOTH parties
 * never retain access. Scoped to (this pack's members) ∩ (recipient='title_holder') ∩ (holder =
 * formerWallet, case-insensitive) — a different holder's wrap is never touched.
 *
 * Idempotent: a re-run after the wraps are gone deletes zero rows and is a clean no-op. Throws
 * (recoverable) on a genuine DB failure rather than reporting a false success.
 */
export async function revokeTitleHolder(db: Db, packId: string, formerWallet: string): Promise<void> {
  if (!packId) throw new Error('title-dek: packId is required');
  if (!formerWallet) throw new Error('title-dek: formerWallet is required');

  const memberIds = await loadMemberIds(db, packId);

  // We cannot rely on a DB-level case-insensitive predicate (holder_wallet stores the checksummed
  // address; a caller may pass any case), so resolve the matching wraps in app code first. Read the
  // pack's title_holder wraps and keep those whose holder matches the former wallet (case-insensitive),
  // capturing each row's STORED holder_wallet so the delete guards on the exact value (race-safe:
  // if a concurrent rotation re-points a row to the new holder between this read and the delete, the
  // stored-value guard means we never delete the fresh wrap).
  const { data: thRaw, error: readErr } = await db
    .from('memory_dek_wraps')
    .select('memory_id, holder_wallet')
    .in('memory_id', memberIds)
    .eq('recipient', TITLE_HOLDER);
  if (readErr) {
    log.error({ err: readErr, packId }, 'revokeTitleHolder: title_holder wrap read failed');
    throw new Error('revokeTitleHolder: failed to read title_holder wraps');
  }
  const targets = ((thRaw ?? []) as Array<{ memory_id: number; holder_wallet: string | null }>).filter(
    (w) => evmEq(w.holder_wallet, formerWallet),
  );

  if (targets.length === 0) {
    // Already revoked (or never held) — idempotent no-op.
    log.info({ packId, former: formerWallet.slice(0, 10) }, 'revokeTitleHolder: no former-holder wraps — no-op');
    return;
  }

  // Delete each target row by its FULL identity — (memory_id, recipient='title_holder',
  // holder_wallet=<stored exact value>). The PK is (memory_id, recipient), so each delete touches
  // at most one row; the stored-holder guard makes it a no-op if that row was already rotated away.
  let deletedCount = 0;
  for (const t of targets) {
    const { data: deleted, error: delErr } = await db
      .from('memory_dek_wraps')
      .delete()
      .eq('memory_id', t.memory_id)
      .eq('recipient', TITLE_HOLDER)
      .eq('holder_wallet', t.holder_wallet as string)
      .select('memory_id');
    if (delErr) {
      log.error({ err: delErr, packId, memoryId: t.memory_id }, 'revokeTitleHolder: title_holder wrap delete failed');
      throw new Error('revokeTitleHolder: failed to delete title_holder wraps');
    }
    deletedCount += Array.isArray(deleted) ? deleted.length : 0;
  }

  log.info(
    { packId, former: formerWallet.slice(0, 10), deletedCount },
    'revokeTitleHolder: former title_holder wraps removed (saga revoke step)',
  );
}
