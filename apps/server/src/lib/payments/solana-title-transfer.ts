/**
 * solana-title-transfer — the NON-CUSTODIAL 1-of-1 title transfer primitives (Phase 3, the sale).
 *
 * On Base the server custodies the title and signs the transfer itself. Solana-native titles live in the
 * SELLER'S OWN wallet, so the server CANNOT sign. The transfer is a two-phase, non-custodial handshake:
 *
 *   1. buildTitleTransferTransaction — the server builds an UNSIGNED SPL transfer (seller ATA → buyer
 *      ATA, amount 1) with the SELLER as fee payer. Returned to the seller's client to sign.
 *   2. (seller signs in their wallet, client-side — the server never sees their key)
 *   3. verifyTitleTransferTx — defence in depth: before submitting, decode the signed tx and assert it
 *      really moves THIS 1-of-1 from seller → buyer and NOTHING else (a malicious seller must not be able
 *      to swap in a different transaction).
 *   4. submitSignedTitleTransfer — broadcast + confirm.
 *
 * The authoritative safety net is still the on-chain owner check the saga runs after submit (ownerOf ==
 * buyer); this module makes the BUILD deterministic and the SUBMIT verified so the saga can trust it.
 *
 * MONEY / IRREVERSIBLE-ASSET CODE. connection is injected → unit-tested with mocks, no live chain.
 */

import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
} from '@solana/spl-token';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('solana-title-transfer');

export interface UnsignedTitleTransfer {
  /** Base64 of the unsigned transaction the seller's wallet signs. */
  unsignedTxBase64: string;
  /** The seller's associated token account for the mint (transfer source). */
  fromAta: string;
  /** The buyer's associated token account (transfer destination; created in-tx if missing). */
  toAta: string;
}

/**
 * Build the UNSIGNED 1-of-1 transfer for the seller to sign. The SELLER is the fee payer + the only
 * required signer (non-custodial). The buyer's ATA is created idempotently in the same tx, rent paid by
 * the seller. Returns the serialized unsigned tx (requireAllSignatures:false) for the client to sign.
 */
export async function buildTitleTransferTransaction(
  connection: Connection,
  mintAddress: string,
  fromWallet: string,
  toWallet: string,
): Promise<UnsignedTitleTransfer> {
  const mint = new PublicKey(mintAddress);
  const from = new PublicKey(fromWallet);
  const to = new PublicKey(toWallet);
  const fromAta = getAssociatedTokenAddressSync(mint, from);
  const toAta = getAssociatedTokenAddressSync(mint, to);

  const tx = new Transaction();
  // Create the buyer's ATA if it does not exist yet (idempotent — no-op if present). Seller pays rent.
  tx.add(createAssociatedTokenAccountIdempotentInstruction(from, toAta, to, mint));
  // Move the single unit. decimals 0 — a 1-of-1.
  tx.add(createTransferCheckedInstruction(fromAta, mint, toAta, from, 1, 0));

  tx.feePayer = from;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;

  const unsignedTxBase64 = tx.serialize({ requireAllSignatures: false }).toString('base64');
  return { unsignedTxBase64, fromAta: fromAta.toBase58(), toAta: toAta.toBase58() };
}

/**
 * Decode a (seller-signed) transfer tx and assert it ONLY moves the expected 1-of-1 from seller → buyer.
 * Defence in depth: a seller must not be able to submit a different signed transaction through the sale
 * path. Checks every instruction targets the token program and the transfer matches (source = seller ATA,
 * dest = buyer ATA, owner = seller, amount 1). Returns true iff the tx is exactly the expected transfer.
 */
export function verifyTitleTransferTx(
  signedTxBase64: string,
  expected: { mintAddress: string; fromWallet: string; toWallet: string },
): boolean {
  let tx: Transaction;
  try {
    tx = Transaction.from(Buffer.from(signedTxBase64, 'base64'));
  } catch (err) {
    log.warn({ err }, 'verifyTitleTransferTx: undecodable transaction');
    return false;
  }
  const mint = new PublicKey(expected.mintAddress);
  const from = new PublicKey(expected.fromWallet);
  const to = new PublicKey(expected.toWallet);
  const fromAta = getAssociatedTokenAddressSync(mint, from);
  const toAta = getAssociatedTokenAddressSync(mint, to);

  // The tx must be EXACTLY a buyer-ATA create (idempotent, associated-token program) plus the ONE
  // transferChecked — and NOTHING else. Any other instruction (a legacy Transfer of a different token,
  // an Approve, a CloseAccount, a SOL move, a second transfer) is rejected outright: a seller must not be
  // able to smuggle extra operations through the sale path. Counting transferCheckeds is not enough —
  // we whitelist each instruction explicitly.
  let sawTransfer = false;
  for (const ix of tx.instructions) {
    if (ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) continue; // the buyer-ATA create — allowed
    if (ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data[0] === TRANSFER_CHECKED_DISCRIMINATOR) {
      if (sawTransfer) {
        log.warn('verifyTitleTransferTx: more than one transferChecked');
        return false;
      }
      sawTransfer = true;
      // transferChecked keys: [source, mint, destination, owner(signer), …]. amount u64 LE @1, decimals @9.
      const k = ix.keys;
      const accountsOk =
        k[0]?.pubkey.equals(fromAta) &&
        k[1]?.pubkey.equals(mint) &&
        k[2]?.pubkey.equals(toAta) &&
        k[3]?.pubkey.equals(from) &&
        k[3]?.isSigner === true;
      if (!accountsOk || ix.data.readBigUInt64LE(1) !== 1n || ix.data[9] !== 0) {
        log.warn('verifyTitleTransferTx: transfer is not a signed 1-of-1 seller→buyer');
        return false;
      }
      continue;
    }
    log.warn({ programId: ix.programId.toBase58() }, 'verifyTitleTransferTx: unexpected instruction');
    return false;
  }
  if (!sawTransfer) {
    log.warn('verifyTitleTransferTx: no transferChecked present');
    return false;
  }
  // The seller must be the fee payer — the non-custodial contract is the SELLER pays + signs, not us.
  if (!tx.feePayer?.equals(from)) {
    log.warn('verifyTitleTransferTx: fee payer is not the seller');
    return false;
  }
  return true;
}

/**
 * Broadcast a verified, seller-signed transfer and wait for confirmation. Returns the tx signature.
 * The caller (the saga) verifies it FIRST with verifyTitleTransferTx and re-checks ownerOf after.
 */
export async function submitSignedTitleTransfer(connection: Connection, signedTxBase64: string): Promise<string> {
  const raw = Buffer.from(signedTxBase64, 'base64');
  const sig = await connection.sendRawTransaction(raw, { skipPreflight: false, preflightCommitment: 'confirmed' });
  const conf = await connection.confirmTransaction(sig, 'confirmed');
  // A tx can be CONFIRMED (landed in a block) yet have FAILED execution — never treat that as a transfer.
  if (conf?.value?.err) {
    log.warn({ sig, err: conf.value.err }, 'submitSignedTitleTransfer: transfer landed but execution failed');
    throw new Error('submitSignedTitleTransfer: the transfer landed in a block but failed on-chain');
  }
  log.info({ sig }, 'submitSignedTitleTransfer: title transfer confirmed on-chain');
  return sig;
}

// SPL token program transferChecked instruction discriminator (12) + the Associated Token Program id.
const TRANSFER_CHECKED_DISCRIMINATOR = 12;
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
