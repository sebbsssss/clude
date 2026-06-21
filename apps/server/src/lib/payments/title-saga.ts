/**
 * title-saga — the forward-only Base pack-title transfer saga (Tradeable Memory Packs, Slice 2).
 *
 * MONEY / IRREVERSIBLE-ASSET CODE. A pack title is a 1-of-1 ERC-721 on Base (CludePackTitle):
 * `ownerOf(tokenId)` is the single source of truth for "who owns this pack," and the token binds
 * the pack's content commitment (merkle_root + manifest_hash). Selling a title means moving that
 * NFT seller → buyer on-chain — an operation that **cannot be undone** once mined.
 *
 * This module owns the two title operations the marketplace needs:
 *
 *   1. mintTitleForPack — create the 1-of-1 title bound to the pack's content commitment and
 *      mirror it into `pack_titles`. Idempotent: a title that already exists (on-chain OR a
 *      'minted' mirror row) is a no-op — never a second mint (the contract's _safeMint would
 *      revert anyway; we never even broadcast).
 *
 *   2. executeTitleSale — the forward-only, RESUMABLE transfer saga. The binding correction §00 M4
 *      is LAW: order the steps so the IRREVERSIBLE on-chain move is LAST, and never remove a
 *      capability before its replacement is in place:
 *
 *        created       → dek_rewrapped : ADDITIVELY seal the pack DEK to the BUYER as a new
 *                                        `title_holder` wrap (per member memory). The seller's wrap
 *                                        is UNTOUCHED — there is never a window where neither party
 *                                        can decrypt (RT7). Mirrors grant-copy.ts's unwrap→wrap move.
 *        dek_rewrapped → paid          : confirm payment. On testnet this gates on the reused order
 *                                        DAG: order.status must be 'paid' (money captured BEFORE the
 *                                        irreversible move — M4 step 2 before step 3).
 *        paid          → transferred   : THE IRREVERSIBLE ON-CHAIN MOVE, LAST. transferTitle(seller,
 *                                        buyer). Idempotent via an ownerOf==buyer pre-check (a
 *                                        crash-after-broadcast resume never re-broadcasts — RT1).
 *                                        Records transfer_tx + a `title_transfers` audit row +
 *                                        pack_titles.current_owner=buyer. AFTER THIS A REFUND IS
 *                                        IMPOSSIBLE (RT3) — the buyer holds the NFT.
 *        transferred   → revoked       : the only step that REMOVES capability, so it is last.
 *                                        Delete the SELLER's `title_holder` wrap, flip the seller's
 *                                        `title_owner` entitlement → 'revoked', grant the buyer
 *                                        `title_owner`. Never a window where BOTH can decrypt after
 *                                        finality.
 *
 *      Each step is idempotent and resumable: re-running from any persisted `step` checks the
 *      on-chain / DB state before acting (no double-mint, no double-transfer, no duplicate wraps).
 *      The step + last_error are persisted on `title_sale_sagas` after every hop.
 *
 *   3. refundTitleSale — the refund boundary (RT3). A refund is allowed ONLY while the saga has
 *      not yet transferred (step < 'transferred'); once the title moved on-chain the sale is FINAL
 *      and this throws TITLE_FINAL. (There is no token claw-back — you cannot un-transfer an NFT.)
 *
 * The on-chain transfer is the COMMIT POINT of the whole sale.
 *
 * Reuses (does not reinvent): EvmTitleClient (evm-title-client.ts) for the chain; the DEK re-wrap
 * pattern from grant-copy.ts; the title_holder DEK wrap schema from migration 034; the order DAG
 * from order-orchestrator.ts. EvmTitleClient + getDb + the payment + the title DEK are all
 * injected/mocked in tests — no live network there.
 */

import { createChildLogger } from '@clude/shared/core/logger';
import { wrapDek, unwrapDek } from '@clude/shared/core/memory-envelope';
import { loadProviderKeypair } from '@clude/shared/core/encryption-keys';
import type { EvmTitleClient, TitleBinding } from '../evm-title-client.js';
import type { Hex, Address } from 'viem';

const log = createChildLogger('title-saga');

/**
 * A minimal Supabase-shaped handle. The saga only ever uses from(table).select/insert/update/
 * delete with .eq/.in/.contains/.maybeSingle/.single — the same surface grant-copy.ts uses — so
 * we type it structurally to stay decoupled from the concrete client (and trivially mockable).
 */
export interface DbLike {
  from(table: string): any;
}

// ─────────── The forward-only saga step machine (M4) ───────────

/** The saga steps, in their forward-only order. The irreversible transfer is 4th of 5. */
export const TITLE_SAGA_STEPS = ['created', 'dek_rewrapped', 'paid', 'transferred', 'revoked'] as const;
export type TitleSagaStep = (typeof TITLE_SAGA_STEPS)[number];

const STEP_INDEX: Readonly<Record<TitleSagaStep, number>> = Object.freeze(
  TITLE_SAGA_STEPS.reduce((acc, s, i) => ({ ...acc, [s]: i }), {} as Record<TitleSagaStep, number>),
);

/** Strict total order over the steps: true iff `a` strictly precedes `b`. */
export function isStepBefore(a: TitleSagaStep, b: TitleSagaStep): boolean {
  return STEP_INDEX[a] < STEP_INDEX[b];
}

/** The point of no return — at/after this step the on-chain transfer has happened (RT3). */
const TRANSFER_STEP: TitleSagaStep = 'transferred';

/** Thrown by refundTitleSale once the title has irreversibly moved on-chain (RT3). */
export class TitleFinalError extends Error {
  readonly code = 'TITLE_FINAL';
  constructor(message = 'TITLE_FINAL: the title has transferred on-chain; the sale is final and cannot be refunded') {
    super(message);
    this.name = 'TitleFinalError';
  }
}

// ─────────── Result shapes ───────────

export interface MintTitleResult {
  tokenId: bigint;
  /** True when the title already existed (on-chain or mirror) and this call was a no-op. */
  alreadyMinted: boolean;
  mintTx: Hex | null;
}

export interface TitleSaleResult {
  step: TitleSagaStep;
  /** True once the saga reached the terminal 'revoked' step. */
  done: boolean;
}

export interface RefundTitleResult {
  refundable: true;
  step: TitleSagaStep | 'refunded';
}

// ─────────── Row shapes (off-chain mirror; migration 034 deferred — typed here) ───────────

interface PmpArtifactRow {
  merkle_root: string | null;
  manifest_hash: string;
  record_count: number;
  creator_pubkey: string | null;
}

interface PackTitleRow {
  pack_id: string;
  token_id: string | null;
  current_owner: string | null;
  status: string;
  mint_tx: string | null;
  merkle_root: string;
  manifest_hash: string;
  contract_address: string;
}

interface SagaRow {
  order_id: string;
  pack_id: string;
  token_id: string;
  from_wallet: string;
  to_wallet: string;
  step: TitleSagaStep;
  last_error: string | null;
}

interface TitleOrderRow {
  order_id: string;
  pack_id: string;
  buyer_wallet: string | null;
  seller_wallet: string;
  status: string;
  payment_rail?: string | null;
  rail?: string;
}

// ════════════════════════════════════════════════════════════════════════════
// mintTitleForPack
// ════════════════════════════════════════════════════════════════════════════

/**
 * Mint the 1-of-1 title for a pack and mirror it into `pack_titles`. Idempotent.
 *
 *   - If the title already exists ON-CHAIN (titleOwner(tokenId) != null) OR a 'minted' mirror row
 *     is present → NO-OP: return the existing title. We never broadcast a second mint (the
 *     contract's _safeMint reverts on a duplicate id anyway; we don't even try).
 *   - Otherwise mint to `toWallet`, bound to the pack's merkle_root + manifest_hash from
 *     pmp_artifacts, and upsert the mirror (status='minted', current_owner=toWallet, token_id,
 *     mint_tx).
 *
 * Throws if the pack has no pmp_artifacts binding (we refuse to bind a phantom commitment on-chain).
 */
export async function mintTitleForPack(
  db: DbLike,
  evm: EvmTitleClient,
  packId: string,
  toWallet: string,
): Promise<MintTitleResult> {
  const tokenId = evm.tokenIdFor(packId);

  // 1) IDEMPOTENCY — a 'minted' mirror row means a prior mint already completed; no chain read.
  const { data: mirror } = await db
    .from('pack_titles')
    .select('pack_id, token_id, current_owner, status, mint_tx')
    .eq('pack_id', packId)
    .maybeSingle();
  if (mirror && (mirror as PackTitleRow).status === 'minted') {
    log.info({ packId, tokenId: tokenId.toString() }, 'mintTitleForPack: mirror already minted — idempotent no-op');
    return { tokenId, alreadyMinted: true, mintTx: ((mirror as PackTitleRow).mint_tx as Hex) ?? null };
  }

  // 2) IDEMPOTENCY — the token may already be LIVE on-chain (mirror lost / a prior crash after the
  //    mint mined but before the mirror write). Re-read ownerOf; if it exists, do not re-mint.
  const onChainOwner = await evm.titleOwner(tokenId);
  if (onChainOwner != null) {
    log.info({ packId, tokenId: tokenId.toString(), owner: onChainOwner }, 'mintTitleForPack: title already exists on-chain — reconciling mirror, no re-mint');
    await upsertTitleMirror(db, {
      packId,
      tokenId,
      owner: onChainOwner,
      mintTx: (mirror as PackTitleRow | null)?.mint_tx ?? null,
      binding: await loadBinding(db, packId, toWallet),
      contractAddress: evm.contractAddress,
    });
    return { tokenId, alreadyMinted: true, mintTx: ((mirror as PackTitleRow | null)?.mint_tx as Hex) ?? null };
  }

  // 3) MINT. Bind to the pack's content commitment (refuse if it's missing).
  const binding = await loadBinding(db, packId, toWallet);
  const { txHash } = await evm.mintTitle(toWallet as Address, packId, binding);

  await upsertTitleMirror(db, {
    packId,
    tokenId,
    owner: toWallet,
    mintTx: txHash,
    binding,
    contractAddress: evm.contractAddress,
  });

  log.info({ packId, tokenId: tokenId.toString(), to: toWallet, mintTx: txHash }, 'mintTitleForPack: title minted');
  return { tokenId, alreadyMinted: false, mintTx: txHash };
}

/** Load + validate the on-chain binding inputs for a pack from pmp_artifacts. */
async function loadBinding(db: DbLike, packId: string, creator: string): Promise<TitleBinding> {
  const { data: art, error } = await db
    .from('pmp_artifacts')
    .select('merkle_root, manifest_hash, record_count, creator_pubkey')
    .eq('pack_id', packId)
    .maybeSingle();
  if (error) {
    log.error({ err: error, packId }, 'mintTitleForPack: artifact lookup failed');
    throw new Error('mintTitleForPack: failed to load pack binding');
  }
  const a = art as PmpArtifactRow | null;
  if (!a || !a.merkle_root || !a.manifest_hash) {
    throw new Error(`mintTitleForPack: pack ${packId} has no pmp_artifacts binding (merkle_root/manifest_hash) — cannot mint a title`);
  }
  return {
    merkleRoot: a.merkle_root as Hex,
    manifestHash: a.manifest_hash as Hex,
    memoryCount: a.record_count,
    creator: creator as Address,
  };
}

/** Upsert the pack_titles mirror row to a minted state owned by `owner`. */
async function upsertTitleMirror(
  db: DbLike,
  args: { packId: string; tokenId: bigint; owner: string; mintTx: Hex | string | null; binding: TitleBinding; contractAddress: Address },
): Promise<void> {
  const { data: existing } = await db
    .from('pack_titles')
    .select('pack_id')
    .eq('pack_id', args.packId)
    .maybeSingle();

  const row = {
    pack_id: args.packId,
    chain: 'base',
    token_id: args.tokenId.toString(),
    contract_address: args.contractAddress,
    merkle_root: args.binding.merkleRoot,
    manifest_hash: args.binding.manifestHash,
    current_owner: args.owner,
    status: 'minted',
    mint_tx: args.mintTx,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await db.from('pack_titles').update(row).eq('pack_id', args.packId);
    if (error) throw new Error('mintTitleForPack: failed to update title mirror');
  } else {
    const { error } = await db.from('pack_titles').insert({ ...row, created_at: new Date().toISOString() });
    if (error) throw new Error('mintTitleForPack: failed to insert title mirror');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// executeTitleSale — the forward-only, resumable saga (M4)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Execute / resume the title transfer saga for an order. Forward-only, idempotent, resumable.
 * Drives one stage per call up to completion; safe to re-run from any persisted step.
 */
export async function executeTitleSale(
  db: DbLike,
  evm: EvmTitleClient,
  orderId: string,
): Promise<TitleSaleResult> {
  const order = await loadOrder(db, orderId);
  const buyer = order.buyer_wallet;
  if (!buyer) {
    throw new Error(`executeTitleSale: order ${orderId} has no buyer_wallet — a title must land in a named Base address`);
  }
  const seller = order.seller_wallet;
  const packId = order.pack_id;
  const tokenId = evm.tokenIdFor(packId);

  // UPFRONT PAYMENT GATE (testnet, M4 step 2 before everything irreversible): the saga must not do
  // ANY work — not even the reversible DEK re-wrap — until the order is actually paid. The reused
  // order DAG is the gate (the delivery driver only dispatches paid orders). An unpaid order leaves
  // the chain and crypto completely untouched. Per-step confirmPayment below still guards the
  // dek_rewrapped → paid hop for an in-flight resume.
  await confirmPayment(order);

  // Load-or-create the saga row (idempotent: one per order).
  let saga = await loadOrCreateSaga(db, { orderId, packId, tokenId, seller, buyer });

  // Drive each stage forward. Each branch is idempotent (checks state before acting) and persists
  // the step on success; a throw is recorded as last_error and leaves the step where it was.
  try {
    if (saga.step === 'created') {
      await rewrapPackDekToTitleHolder(db, packId, buyer);
      saga = await advance(db, orderId, 'dek_rewrapped');
    }

    if (saga.step === 'dek_rewrapped') {
      await confirmPayment(order); // testnet: gate on order.status === 'paid'
      saga = await advance(db, orderId, 'paid');
    }

    if (saga.step === 'paid') {
      // THE IRREVERSIBLE STEP — LAST meaningful mutation before revoke. Idempotent via the
      // ownerOf==buyer pre-check: a crash after broadcast but before this persist must NOT
      // re-broadcast (RT1). After this, refunds are impossible (RT3).
      await transferTitleOnce(db, evm, { orderId, tokenId, seller, buyer, packId });
      saga = await advance(db, orderId, 'transferred');
    }

    if (saga.step === 'transferred') {
      // The ONLY step that removes capability → last (M4). Additive-first/revoke-last is preserved:
      // the buyer wrap (step 1) is already in place, so removing the seller wrap never leaves a gap.
      await revokeSeller(db, { packId, seller, buyer, orderId, rail: order.payment_rail ?? order.rail ?? null });
      saga = await advance(db, orderId, 'revoked');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordError(db, orderId, message);
    throw err;
  }

  return { step: saga.step, done: saga.step === 'revoked' };
}

// ─────────── step 1: additive DEK re-wrap to the buyer (title_holder) ───────────

/**
 * Seal the pack's DEK to the BUYER as a NEW `title_holder` wrap, per member memory. ADDITIVE — the
 * seller's existing wrap is untouched (RT7). Idempotent: a member that already has a buyer
 * title_holder wrap is skipped (no duplicate). Mirrors grant-copy.ts's unwrap(provider)→wrap(buyer).
 *
 * For a plaintext pack (no provider wraps) there is nothing to seal — a no-op.
 */
async function rewrapPackDekToTitleHolder(db: DbLike, packId: string, buyer: string): Promise<void> {
  // Resolve the pack's member memory ids (pack-scoped).
  const { data: contentsRaw, error: cErr } = await db
    .from('memory_pack_contents')
    .select('memory_id, leaf_index')
    .eq('pack_id', packId)
    .order('leaf_index', { ascending: true });
  if (cErr) throw new Error('executeTitleSale: failed to load pack contents');
  const memberIds = ((contentsRaw ?? []) as Array<{ memory_id: number }>).map((c) => c.memory_id);
  if (memberIds.length === 0) {
    throw new Error(`executeTitleSale: pack ${packId} has no member memories — nothing to re-wrap`);
  }

  // Provider wraps carry the per-memory DEK; their presence is what makes the pack encrypted.
  const { data: provRaw, error: pErr } = await db
    .from('memory_dek_wraps')
    .select('memory_id, wrapped_dek, wrap_pubkey, recipient')
    .in('memory_id', memberIds)
    .eq('recipient', 'provider');
  if (pErr) throw new Error('executeTitleSale: failed to load provider DEK wraps');
  const providerWrap = new Map<number, { wrapped_dek: string; wrap_pubkey: string }>();
  for (const w of (provRaw ?? []) as Array<{ memory_id: number; wrapped_dek: string; wrap_pubkey: string }>) {
    providerWrap.set(w.memory_id, { wrapped_dek: w.wrapped_dek, wrap_pubkey: w.wrap_pubkey });
  }
  if (providerWrap.size === 0) {
    log.info({ packId }, 'rewrapPackDekToTitleHolder: plaintext pack (no provider wraps) — no DEK to seal');
    return;
  }

  // Which members already have the BUYER title_holder wrap (idempotent re-entry guard)?
  const { data: existingRaw } = await db
    .from('memory_dek_wraps')
    .select('memory_id, holder_wallet, recipient')
    .in('memory_id', memberIds)
    .eq('recipient', 'title_holder')
    .eq('holder_wallet', buyer);
  const alreadyWrapped = new Set(
    ((existingRaw ?? []) as Array<{ memory_id: number }>).map((w) => w.memory_id),
  );

  // The buyer's published encryption key — required to seal the wrap (fail closed otherwise).
  const { data: keyRow, error: kErr } = await db
    .from('encryption_keys')
    .select('x25519_pubkey')
    .eq('owner_wallet', buyer)
    .maybeSingle();
  if (kErr) throw new Error('executeTitleSale: failed to load buyer encryption key');
  const pub = (keyRow as { x25519_pubkey?: string } | null)?.x25519_pubkey;
  if (!pub) {
    throw new Error(`executeTitleSale: buyer ${buyer.slice(0, 10)} has no published encryption key — cannot seal the title to them`);
  }
  const buyerPubkey = new Uint8Array(Buffer.from(pub, 'base64'));

  let providerSecret: Uint8Array;
  try {
    providerSecret = loadProviderKeypair().secretKey;
  } catch (err) {
    log.error({ err, packId }, 'rewrapPackDekToTitleHolder: provider keypair unavailable');
    throw new Error('executeTitleSale: provider encryption key unavailable');
  }

  for (const memberId of memberIds) {
    if (alreadyWrapped.has(memberId)) continue; // additive + idempotent
    const pw = providerWrap.get(memberId);
    if (!pw) {
      throw new Error(`executeTitleSale: encrypted member ${memberId} missing provider wrap — cannot seal title to buyer`);
    }
    const dek = unwrapDek(pw.wrapped_dek, pw.wrap_pubkey, providerSecret);
    if (!dek) {
      throw new Error(`executeTitleSale: failed to recover DEK for member ${memberId}`);
    }
    const buyerWrap = wrapDek(dek, buyerPubkey);
    const { error: insErr } = await db.from('memory_dek_wraps').insert({
      memory_id: memberId,
      recipient: 'title_holder',
      wrapped_dek: buyerWrap.wrapped,
      wrap_pubkey: buyerWrap.wrapPubkey,
      holder_wallet: buyer,
      created_at: new Date().toISOString(),
    });
    if (insErr) {
      // A concurrent sweep may have sealed it first; a unique-collision is the idempotent no-op.
      if ((insErr as { code?: string }).code === '23505') continue;
      throw new Error('executeTitleSale: failed to insert buyer title_holder DEK wrap');
    }
  }
}

// ─────────── step 2: payment confirmation (testnet gate) ───────────

/** Testnet payment gate: the reused order DAG must already read 'paid' (money captured, M4 step 2). */
async function confirmPayment(order: TitleOrderRow): Promise<void> {
  if (order.status !== 'paid' && order.status !== 'delivering' && order.status !== 'delivered' && order.status !== 'settled') {
    throw new Error(`executeTitleSale: order ${order.order_id} is '${order.status}', not paid — cannot proceed to the irreversible transfer before payment is captured`);
  }
}

// ─────────── step 3: the irreversible on-chain transfer (LAST) ───────────

/**
 * Transfer the title seller→buyer ON-CHAIN, exactly once. Idempotent via an ownerOf==buyer
 * pre-check (RT1): if the chain already shows the buyer as owner (a crash after broadcast resumed),
 * skip the broadcast and just reconcile the mirror/audit. Records transfer_tx, a title_transfers
 * audit row, and pack_titles.current_owner=buyer. THE COMMIT POINT — refunds impossible after (RT3).
 */
async function transferTitleOnce(
  db: DbLike,
  evm: EvmTitleClient,
  args: { orderId: string; tokenId: bigint; seller: string; buyer: string; packId: string },
): Promise<void> {
  const { orderId, tokenId, seller, buyer, packId } = args;

  // PRE-CHECK: never re-broadcast an already-mined transfer.
  const currentOwner = await evm.titleOwner(tokenId);
  let transferTx: Hex | null = null;
  if (currentOwner != null && currentOwner.toLowerCase() === buyer.toLowerCase()) {
    log.info({ orderId, tokenId: tokenId.toString() }, 'transferTitleOnce: chain already shows buyer as owner — skipping re-broadcast (idempotent)');
  } else {
    const { txHash } = await evm.transferTitle(seller as Address, buyer as Address, tokenId);
    transferTx = txHash;
    log.info({ orderId, tokenId: tokenId.toString(), from: seller, to: buyer, transferTx }, 'transferTitleOnce: irreversible on-chain transfer broadcast');
  }

  // Record the audit row (idempotent: skip if one already exists for this order).
  const { data: priorXfer } = await db
    .from('title_transfers')
    .select('order_id')
    .eq('order_id', orderId)
    .maybeSingle();
  if (!priorXfer) {
    const { error: xErr } = await db.from('title_transfers').insert({
      order_id: orderId,
      pack_id: packId,
      token_id: tokenId.toString(),
      from_wallet: seller,
      to_wallet: buyer,
      transfer_tx: transferTx,
      mode: 'operator',
      observed_at: new Date().toISOString(),
    });
    if (xErr) throw new Error('executeTitleSale: failed to record title_transfers audit row');
  }

  // Reconcile the mirror to the buyer.
  const { error: mErr } = await db
    .from('pack_titles')
    .update({ current_owner: buyer, last_transfer_tx: transferTx, updated_at: new Date().toISOString() })
    .eq('pack_id', packId);
  if (mErr) throw new Error('executeTitleSale: failed to update title mirror to buyer');
}

// ─────────── step 4: revoke the seller (LAST — additive-first/revoke-last) ───────────

/**
 * Remove the seller's serving capability and grant the buyer's. Last step (M4): the buyer wrap is
 * already in place (step 1), so deleting the seller's `title_holder` wrap never opens a gap. Also
 * flips the seller's `title_owner` entitlement → 'revoked' and grants the buyer `title_owner`.
 * Idempotent throughout.
 */
async function revokeSeller(
  db: DbLike,
  args: { packId: string; seller: string; buyer: string; orderId: string; rail: string | null },
): Promise<void> {
  const { packId, seller, buyer, orderId, rail } = args;

  // 1) Delete the seller's title_holder wrap(s) — scoped to the seller, so the buyer's wrap (and
  //    the provider wrap) survive. Idempotent: a re-run matches zero rows.
  const { error: dErr } = await db
    .from('memory_dek_wraps')
    .delete()
    .eq('recipient', 'title_holder')
    .eq('holder_wallet', seller);
  if (dErr) throw new Error('executeTitleSale: failed to revoke seller title_holder wrap');

  // 2) Flip the seller's title_owner entitlement → 'revoked' (no-op if none / already revoked).
  const { error: rErr } = await db
    .from('pack_entitlements')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('pack_id', packId)
    .eq('holder_wallet', seller)
    .eq('grant_kind', 'title_owner');
  if (rErr) throw new Error('executeTitleSale: failed to revoke seller title_owner entitlement');

  // 3) Grant the buyer a title_owner entitlement (a derived access cache; ownerOf stays authority).
  //    Idempotent: skip if an active grant already exists; a UNIQUE(pack,holder,grant_kind) race is
  //    the idempotent no-op.
  const { data: existing } = await db
    .from('pack_entitlements')
    .select('id, status')
    .eq('pack_id', packId)
    .eq('holder_wallet', buyer)
    .eq('grant_kind', 'title_owner')
    .maybeSingle();
  const paymentRail = rail === 'stripe' ? 'stripe' : rail === 'solana' ? 'clude_solana' : 'clude_base';
  if (!existing) {
    const { error: gErr } = await db.from('pack_entitlements').insert({
      pack_id: packId,
      holder_wallet: buyer,
      grant_kind: 'title_owner',
      order_id: orderId,
      payment_rail: paymentRail,
      status: 'active',
      granted_at: new Date().toISOString(),
    });
    if (gErr && (gErr as { code?: string }).code !== '23505') {
      throw new Error('executeTitleSale: failed to grant buyer title_owner entitlement');
    }
  } else if ((existing as { status: string }).status !== 'active') {
    const { error: uErr } = await db
      .from('pack_entitlements')
      .update({ status: 'active', revoked_at: null, order_id: orderId })
      .eq('pack_id', packId)
      .eq('holder_wallet', buyer)
      .eq('grant_kind', 'title_owner');
    if (uErr) throw new Error('executeTitleSale: failed to re-activate buyer title_owner entitlement');
  }
}

// ════════════════════════════════════════════════════════════════════════════
// refundTitleSale — RT3 refund boundary
// ════════════════════════════════════════════════════════════════════════════

/**
 * Refund a title sale. Allowed ONLY before the irreversible on-chain transfer (step < 'transferred').
 * Once the title has moved on-chain the sale is FINAL — there is no token claw-back — and this throws
 * TitleFinalError (code TITLE_FINAL). On success the saga is marked 'refunded' so it can never resume
 * forward into a transfer.
 *
 * Defence in depth: if the saga row is missing but a title_transfers audit row exists for the order,
 * the transfer already happened → throw TITLE_FINAL.
 */
export async function refundTitleSale(db: DbLike, orderId: string): Promise<RefundTitleResult> {
  const { data: sagaRaw } = await db
    .from('title_sale_sagas')
    .select('order_id, step')
    .eq('order_id', orderId)
    .maybeSingle();
  const saga = sagaRaw as Pick<SagaRow, 'order_id' | 'step'> | null;

  // No saga row: only safe to call a refund "fine" if the title definitely hasn't moved. If an audit
  // row proves a transfer, fail closed with TITLE_FINAL.
  if (!saga) {
    const { data: xfer } = await db
      .from('title_transfers')
      .select('order_id')
      .eq('order_id', orderId)
      .maybeSingle();
    if (xfer) {
      throw new TitleFinalError();
    }
    throw new Error(`refundTitleSale: no title saga for order ${orderId}`);
  }

  // Already refunded → idempotent success.
  if ((saga.step as string) === 'refunded') {
    return { refundable: true, step: 'refunded' };
  }

  // The boundary (RT3): at/after the transfer step, the move is irreversible.
  if (!isStepBefore(saga.step, TRANSFER_STEP)) {
    throw new TitleFinalError();
  }

  // Mark the saga refunded so a later sweep can never drive it into a transfer.
  const { error } = await db
    .from('title_sale_sagas')
    .update({ step: 'refunded', last_error: null })
    .eq('order_id', orderId);
  if (error) throw new Error('refundTitleSale: failed to mark saga refunded');

  log.info({ orderId, fromStep: saga.step }, 'refundTitleSale: refunded (pre-transfer) — saga aborted');
  return { refundable: true, step: 'refunded' };
}

// ════════════════════════════════════════════════════════════════════════════
// persistence helpers
// ════════════════════════════════════════════════════════════════════════════

async function loadOrder(db: DbLike, orderId: string): Promise<TitleOrderRow> {
  const { data, error } = await db
    .from('marketplace_orders')
    .select('order_id, pack_id, buyer_wallet, seller_wallet, status, rail')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw new Error('executeTitleSale: failed to load order');
  if (!data) throw new Error(`executeTitleSale: order ${orderId} not found`);
  return data as TitleOrderRow;
}

async function loadOrCreateSaga(
  db: DbLike,
  args: { orderId: string; packId: string; tokenId: bigint; seller: string; buyer: string },
): Promise<SagaRow> {
  const { data: existing } = await db
    .from('title_sale_sagas')
    .select('order_id, pack_id, token_id, from_wallet, to_wallet, step, last_error')
    .eq('order_id', args.orderId)
    .maybeSingle();
  if (existing) return existing as SagaRow;

  const row: SagaRow = {
    order_id: args.orderId,
    pack_id: args.packId,
    token_id: args.tokenId.toString(),
    from_wallet: args.seller,
    to_wallet: args.buyer,
    step: 'created',
    last_error: null,
  };
  const { error } = await db.from('title_sale_sagas').insert({ ...row, created_at: new Date().toISOString() });
  if (error && (error as { code?: string }).code !== '23505') {
    throw new Error('executeTitleSale: failed to create saga row');
  }
  // On a 23505 race, re-read the winner.
  if (error) {
    const { data: won } = await db
      .from('title_sale_sagas')
      .select('order_id, pack_id, token_id, from_wallet, to_wallet, step, last_error')
      .eq('order_id', args.orderId)
      .maybeSingle();
    if (won) return won as SagaRow;
  }
  return row;
}

/** Persist a forward step and clear last_error; return the updated saga shape. */
async function advance(db: DbLike, orderId: string, step: TitleSagaStep): Promise<SagaRow> {
  const { error } = await db
    .from('title_sale_sagas')
    .update({ step, last_error: null, updated_at: new Date().toISOString() })
    .eq('order_id', orderId);
  if (error) throw new Error(`executeTitleSale: failed to persist step '${step}'`);
  // Return a lightweight view; only `.step` is read by the caller loop.
  return { order_id: orderId, step } as SagaRow;
}

async function recordError(db: DbLike, orderId: string, message: string): Promise<void> {
  try {
    await db
      .from('title_sale_sagas')
      .update({ last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
      .eq('order_id', orderId);
  } catch (err) {
    log.error({ err, orderId }, 'executeTitleSale: failed to record saga last_error');
  }
}
