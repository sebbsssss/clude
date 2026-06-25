/**
 * solana-title-sale — the forward-only, resumable NON-CUSTODIAL Solana title sale (Phase 3).
 *
 * The Solana analog of title-saga.ts's executeTitleSale. A title is a 1-of-1 SPL NFT in the SELLER'S OWN
 * wallet, so the server cannot move it — the seller signs the transfer client-side. The saga therefore
 * splits into two entry points around a pause at the 'paid' step:
 *
 *   executeSolanaTitleSale(orderId)            drives, forward-only + idempotent:
 *     created       → dek_rewrapped : ADDITIVELY seal the pack DEK to the BUYER (a new title_holder wrap,
 *                                     per member). The seller's wrap is untouched — no gap (RT7).
 *     dek_rewrapped → paid          : confirm payment ($CLUDE/stripe via the reused order DAG).
 *   …then STOPS at 'paid'. 'paid' is the non-custodial PAUSE: the route hands the seller the unsigned
 *   transfer (getSolanaTitleTransferForSeller) to sign in their wallet.
 *
 *   submitSolanaTitleTransfer(orderId, signedTx)  resumes from 'paid':
 *     paid          → transferred   : VERIFY the seller-signed tx is exactly this 1-of-1 seller→buyer,
 *                                     submit it (idempotent via an ownerOf==buyer pre-check), then assert
 *                                     ownerOf==buyer AFTER. This is the irreversible commit point (RT3).
 *     transferred   → revoked       : remove the seller's title_holder wrap + flip entitlements (last, so
 *                                     the buyer's wrap is already in place — no decryption gap).
 *
 * Reuses the title_sale_sagas table (035) and the DEK re-wrap pattern verbatim — only the holder
 * addresses are the users' OWN Solana wallets (no custodial Base indirection). db + sol injected → unit-
 * tested with mocks, no live chain. MONEY / IRREVERSIBLE-ASSET CODE.
 */

import { createHash } from 'node:crypto';
import { createChildLogger } from '@clude/shared/core/logger';
import { wrapDek, unwrapDek } from '@clude/shared/core/memory-envelope';
import { loadProviderKeypair } from '@clude/shared/core/encryption-keys';
import type { SolanaTitleMintClient } from '../solana-title-mint.js';
import { buildTitleTransferTransaction, verifyTitleTransferTx, submitSignedTitleTransfer, type UnsignedTitleTransfer } from './solana-title-transfer.js';

const log = createChildLogger('solana-title-sale');

export interface DbLike {
  from(table: string): any;
}

export const SOLANA_SALE_STEPS = ['created', 'dek_rewrapped', 'paid', 'transferred', 'revoked'] as const;
export type SolanaSaleStep = (typeof SOLANA_SALE_STEPS)[number];

function sagaIdFor(orderId: string): string {
  return 'stsaga-' + createHash('sha256').update(orderId).digest('hex').slice(0, 12);
}

export interface SolanaSaleResult {
  step: SolanaSaleStep;
  /** True once the saga reached the 'paid' pause and is waiting for the seller's signed transfer. */
  awaitingTransfer: boolean;
}

interface OrderRow {
  order_id: string;
  pack_id: string;
  buyer_wallet: string | null;
  seller_wallet: string;
  status: string;
  rail?: string | null;
  payment_rail?: string | null;
}
interface SagaRow {
  saga_id: string;
  order_id: string;
  pack_id: string;
  seller_wallet: string;
  buyer_wallet: string;
  step: SolanaSaleStep;
  transfer_tx: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// executeSolanaTitleSale — drive created → dek_rewrapped → paid (then pause)
// ════════════════════════════════════════════════════════════════════════════

export async function executeSolanaTitleSale(db: DbLike, orderId: string): Promise<SolanaSaleResult> {
  const order = await loadOrder(db, orderId);
  const buyer = order.buyer_wallet;
  if (!buyer) throw new Error(`executeSolanaTitleSale: order ${orderId} has no buyer_wallet`);
  const seller = order.seller_wallet;
  const packId = order.pack_id;

  // Upfront payment gate: do NO work (not even the reversible DEK re-wrap) until the order is paid.
  await confirmPayment(order);

  let saga = await loadOrCreateSaga(db, { orderId, packId, seller, buyer });

  try {
    if (saga.step === 'created') {
      await rewrapPackDekToBuyer(db, packId, buyer);
      saga = await advance(db, orderId, 'dek_rewrapped');
    }
    if (saga.step === 'dek_rewrapped') {
      await confirmPayment(order); // re-confirm for an in-flight resume
      saga = await advance(db, orderId, 'paid');
    }
  } catch (err) {
    await recordError(db, orderId, err instanceof Error ? err.message : String(err));
    throw err;
  }

  // 'paid' is the non-custodial pause — the seller must sign the transfer before we can advance.
  return { step: saga.step, awaitingTransfer: saga.step === 'paid' };
}

// ─────────── the unsigned transfer the seller signs (built at the 'paid' pause) ───────────

/**
 * Build the unsigned 1-of-1 transfer (seller → buyer) for the order's title. The route returns this to
 * the seller's client to sign. Requires the saga to be at 'paid' (payment captured) — never hand out a
 * transfer before the buyer has paid.
 */
export async function getSolanaTitleTransferForSeller(
  db: DbLike,
  sol: SolanaTitleMintClient,
  orderId: string,
): Promise<UnsignedTitleTransfer> {
  const order = await loadOrder(db, orderId);
  if (!order.buyer_wallet) throw new Error(`getSolanaTitleTransferForSeller: order ${orderId} has no buyer`);
  const saga = await loadSaga(db, orderId);
  if (!saga || saga.step !== 'paid') {
    throw new Error(`getSolanaTitleTransferForSeller: order ${orderId} is not at the paid step (no transfer before payment)`);
  }
  const mintAddress = await loadTitleMint(db, order.pack_id);
  return buildTitleTransferTransaction(sol.connection, mintAddress, order.seller_wallet, order.buyer_wallet);
}

// ════════════════════════════════════════════════════════════════════════════
// submitSolanaTitleTransfer — verify + submit the seller-signed transfer (the commit), then revoke
// ════════════════════════════════════════════════════════════════════════════

export async function submitSolanaTitleTransfer(
  db: DbLike,
  sol: SolanaTitleMintClient,
  orderId: string,
  signedTxBase64: string,
): Promise<SolanaSaleResult> {
  const order = await loadOrder(db, orderId);
  if (!order.buyer_wallet) throw new Error(`submitSolanaTitleTransfer: order ${orderId} has no buyer`);
  const buyer = order.buyer_wallet;
  const seller = order.seller_wallet;
  let saga = await loadSaga(db, orderId);
  if (!saga) throw new Error(`submitSolanaTitleTransfer: no saga for order ${orderId}`);
  const mintAddress = await loadTitleMint(db, order.pack_id);

  try {
    if (saga.step === 'paid') {
      // IDEMPOTENCY: if the chain already shows the buyer as owner (a crash-after-broadcast resume), do
      // not re-submit — just reconcile forward. Otherwise verify the signed tx + broadcast.
      const currentOwner = await sol.titleOwner(mintAddress);
      let transferTx: string | null = null;
      if (currentOwner === buyer) {
        log.info({ orderId, mintAddress }, 'submitSolanaTitleTransfer: chain already shows buyer as owner — skipping re-broadcast');
      } else {
        if (!verifyTitleTransferTx(signedTxBase64, { mintAddress, fromWallet: seller, toWallet: buyer })) {
          throw new Error('submitSolanaTitleTransfer: signed tx is not exactly this 1-of-1 seller→buyer — refusing to submit');
        }
        transferTx = await submitSignedTitleTransfer(sol.connection, signedTxBase64);
        // Authoritative post-check: the transfer must have landed the title with the buyer.
        const after = await sol.titleOwner(mintAddress);
        if (after !== buyer) {
          throw new Error('submitSolanaTitleTransfer: post-transfer ownerOf is not the buyer — transfer did not land');
        }
      }
      await recordTransfer(db, { packId: order.pack_id, mintAddress, seller, buyer, transferTx });
      saga = await advance(db, orderId, 'transferred', transferTx);
    }

    if (saga.step === 'transferred') {
      await revokeSeller(db, { packId: order.pack_id, seller, buyer, orderId, rail: order.payment_rail ?? order.rail ?? null });
      saga = await advance(db, orderId, 'revoked');
    }
  } catch (err) {
    await recordError(db, orderId, err instanceof Error ? err.message : String(err));
    throw err;
  }

  return { step: saga.step, awaitingTransfer: false };
}

// ─────────── step 1: additive DEK re-wrap to the buyer (title_holder) ───────────

async function rewrapPackDekToBuyer(db: DbLike, packId: string, buyer: string): Promise<void> {
  const { data: contentsRaw, error: cErr } = await db
    .from('memory_pack_contents')
    .select('memory_id')
    .eq('pack_id', packId);
  if (cErr) throw new Error('executeSolanaTitleSale: failed to load pack contents');
  const memberIds = ((contentsRaw ?? []) as Array<{ memory_id: number }>).map((c) => c.memory_id);
  if (memberIds.length === 0) throw new Error(`executeSolanaTitleSale: pack ${packId} has no members`);

  const { data: provRaw, error: pErr } = await db
    .from('memory_dek_wraps')
    .select('memory_id, wrapped_dek, wrap_pubkey, recipient')
    .in('memory_id', memberIds)
    .eq('recipient', 'provider');
  if (pErr) throw new Error('executeSolanaTitleSale: failed to load provider DEK wraps');
  const providerWrap = new Map<number, { wrapped_dek: string; wrap_pubkey: string }>();
  for (const w of (provRaw ?? []) as Array<{ memory_id: number; wrapped_dek: string; wrap_pubkey: string }>) {
    providerWrap.set(w.memory_id, { wrapped_dek: w.wrapped_dek, wrap_pubkey: w.wrap_pubkey });
  }
  if (providerWrap.size === 0) {
    log.info({ packId }, 'rewrapPackDekToBuyer: plaintext pack — nothing to seal');
    return;
  }

  const { data: existingRaw } = await db
    .from('memory_dek_wraps')
    .select('memory_id')
    .in('memory_id', memberIds)
    .eq('recipient', 'title_holder')
    .eq('holder_wallet', buyer);
  const alreadyWrapped = new Set(((existingRaw ?? []) as Array<{ memory_id: number }>).map((w) => w.memory_id));

  const { data: keyRow, error: kErr } = await db
    .from('encryption_keys')
    .select('x25519_pubkey')
    .eq('owner_wallet', buyer)
    .maybeSingle();
  if (kErr) throw new Error('executeSolanaTitleSale: failed to load buyer encryption key');
  const pub = (keyRow as { x25519_pubkey?: string } | null)?.x25519_pubkey;
  if (!pub) throw new Error(`executeSolanaTitleSale: buyer ${buyer.slice(0, 10)} has no published encryption key`);
  const buyerPubkey = new Uint8Array(Buffer.from(pub, 'base64'));

  let providerSecret: Uint8Array;
  try {
    providerSecret = loadProviderKeypair().secretKey;
  } catch (err) {
    log.error({ err, packId }, 'rewrapPackDekToBuyer: provider keypair unavailable');
    throw new Error('executeSolanaTitleSale: provider encryption key unavailable');
  }

  for (const memberId of memberIds) {
    if (alreadyWrapped.has(memberId)) continue;
    const pw = providerWrap.get(memberId);
    if (!pw) throw new Error(`executeSolanaTitleSale: encrypted member ${memberId} missing provider wrap`);
    const dek = unwrapDek(pw.wrapped_dek, pw.wrap_pubkey, providerSecret);
    if (!dek) throw new Error(`executeSolanaTitleSale: failed to recover DEK for member ${memberId}`);
    const buyerWrap = wrapDek(dek, buyerPubkey);
    const { error: insErr } = await db.from('memory_dek_wraps').insert({
      memory_id: memberId,
      recipient: 'title_holder',
      wrapped_dek: buyerWrap.wrapped,
      wrap_pubkey: buyerWrap.wrapPubkey,
      holder_wallet: buyer,
      created_at: new Date().toISOString(),
    });
    if (insErr && (insErr as { code?: string }).code !== '23505') {
      throw new Error('executeSolanaTitleSale: failed to insert buyer title_holder DEK wrap');
    }
  }
}

// ─────────── step 4: revoke the seller (last — additive-first/revoke-last) ───────────

async function revokeSeller(
  db: DbLike,
  args: { packId: string; seller: string; buyer: string; orderId: string; rail: string | null },
): Promise<void> {
  const { packId, seller, buyer, orderId, rail } = args;

  const { data: memRows, error: mErr } = await db.from('memory_pack_contents').select('memory_id').eq('pack_id', packId);
  if (mErr) throw new Error('submitSolanaTitleTransfer: failed to load pack contents for seller revoke');
  const memberIds = ((memRows ?? []) as Array<{ memory_id: number }>).map((m) => m.memory_id);
  if (memberIds.length > 0) {
    const { error: dErr } = await db
      .from('memory_dek_wraps')
      .delete()
      .in('memory_id', memberIds)
      .eq('recipient', 'title_holder')
      .eq('holder_wallet', seller);
    if (dErr) throw new Error('submitSolanaTitleTransfer: failed to revoke seller title_holder wrap');
  }

  const { error: rErr } = await db
    .from('pack_entitlements')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('pack_id', packId)
    .eq('holder_wallet', seller)
    .eq('grant_kind', 'title_owner');
  if (rErr) throw new Error('submitSolanaTitleTransfer: failed to revoke seller title_owner entitlement');

  const { data: existing } = await db
    .from('pack_entitlements')
    .select('id, status')
    .eq('pack_id', packId)
    .eq('holder_wallet', buyer)
    .eq('grant_kind', 'title_owner')
    .maybeSingle();
  if (!existing) {
    const { error: gErr } = await db.from('pack_entitlements').insert({
      pack_id: packId,
      holder_wallet: buyer,
      grant_kind: 'title_owner',
      order_id: orderId,
      payment_rail: rail === 'stripe' ? 'stripe' : 'clude_solana',
      status: 'active',
      granted_at: new Date().toISOString(),
    });
    if (gErr && (gErr as { code?: string }).code !== '23505') {
      throw new Error('submitSolanaTitleTransfer: failed to grant buyer title_owner entitlement');
    }
  } else if ((existing as { status: string }).status !== 'active') {
    const { error: uErr } = await db
      .from('pack_entitlements')
      .update({ status: 'active', revoked_at: null, order_id: orderId })
      .eq('pack_id', packId)
      .eq('holder_wallet', buyer)
      .eq('grant_kind', 'title_owner');
    if (uErr) throw new Error('submitSolanaTitleTransfer: failed to re-activate buyer title_owner entitlement');
  }
}

// ─────────── persistence + helpers ───────────

async function confirmPayment(order: OrderRow): Promise<void> {
  const s = order.status;
  if (s !== 'paid' && s !== 'delivering' && s !== 'delivered' && s !== 'settled') {
    throw new Error(`solana title sale: order ${order.order_id} is '${s}', not paid — cannot proceed`);
  }
}

/** Read the title mint for a pack from the chain-polymorphic pack_titles mirror; refuse a non-Solana row. */
async function loadTitleMint(db: DbLike, packId: string): Promise<string> {
  const { data, error } = await db
    .from('pack_titles')
    .select('chain, mint_address')
    .eq('pack_id', packId)
    .maybeSingle();
  if (error) throw new Error('solana title sale: failed to load pack_titles');
  const row = data as { chain?: string; mint_address?: string | null } | null;
  if (!row || !row.mint_address || !(row.chain === 'solana' || row.chain === 'solana-devnet')) {
    throw new Error(`solana title sale: pack ${packId} has no Solana title to sell`);
  }
  return row.mint_address;
}

async function recordTransfer(
  db: DbLike,
  args: { packId: string; mintAddress: string; seller: string; buyer: string; transferTx: string | null },
): Promise<void> {
  const { data: prior } = await db
    .from('title_transfers')
    .select('transfer_id')
    .eq('pack_id', args.packId)
    .eq('to_wallet', args.buyer)
    .maybeSingle();
  if (prior) return;
  const { error } = await db.from('title_transfers').insert({
    pack_id: args.packId,
    token_id: args.mintAddress,
    from_wallet: args.seller,
    to_wallet: args.buyer,
    tx: args.transferTx ?? '(reconciled)',
  });
  if (error && (error as { code?: string }).code !== '23505') {
    throw new Error('submitSolanaTitleTransfer: failed to record title_transfers audit row');
  }
  // Reconcile the mirror's cached owner to the buyer.
  await db.from('pack_titles').update({ current_owner: args.buyer, status: 'transferred', updated_at: new Date().toISOString() }).eq('pack_id', args.packId);
}

async function loadOrder(db: DbLike, orderId: string): Promise<OrderRow> {
  const { data, error } = await db
    .from('marketplace_orders')
    .select('order_id, pack_id, buyer_wallet, seller_wallet, status, rail, payment_rail')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw new Error('solana title sale: failed to load order');
  if (!data) throw new Error(`solana title sale: order ${orderId} not found`);
  return data as OrderRow;
}

async function loadSaga(db: DbLike, orderId: string): Promise<SagaRow | null> {
  const { data } = await db
    .from('title_sale_sagas')
    .select('saga_id, order_id, pack_id, seller_wallet, buyer_wallet, step, transfer_tx')
    .eq('order_id', orderId)
    .maybeSingle();
  return (data as SagaRow | null) ?? null;
}

async function loadOrCreateSaga(
  db: DbLike,
  args: { orderId: string; packId: string; seller: string; buyer: string },
): Promise<SagaRow> {
  const existing = await loadSaga(db, args.orderId);
  if (existing) return existing;
  const row: SagaRow = {
    saga_id: sagaIdFor(args.orderId),
    order_id: args.orderId,
    pack_id: args.packId,
    seller_wallet: args.seller,
    buyer_wallet: args.buyer,
    step: 'created',
    transfer_tx: null,
  };
  const { error } = await db.from('title_sale_sagas').insert({ ...row, created_at: new Date().toISOString() });
  if (error && (error as { code?: string }).code !== '23505') {
    throw new Error('solana title sale: failed to create saga row');
  }
  if (error) {
    const won = await loadSaga(db, args.orderId);
    if (won) return won;
  }
  return row;
}

async function advance(db: DbLike, orderId: string, step: SolanaSaleStep, transferTx?: string | null): Promise<SagaRow> {
  const patch: Record<string, unknown> = { step, last_error: null, updated_at: new Date().toISOString() };
  if (transferTx !== undefined) patch.transfer_tx = transferTx;
  const { error } = await db.from('title_sale_sagas').update(patch).eq('order_id', orderId);
  if (error) throw new Error(`solana title sale: failed to persist step '${step}'`);
  return { order_id: orderId, step } as SagaRow;
}

async function recordError(db: DbLike, orderId: string, message: string): Promise<void> {
  try {
    await db.from('title_sale_sagas').update({ last_error: message.slice(0, 500), updated_at: new Date().toISOString() }).eq('order_id', orderId);
  } catch (err) {
    log.error({ err, orderId }, 'solana title sale: failed to record saga last_error');
  }
}
