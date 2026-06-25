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

  // Every instruction must belong to the SPL token program (the ATA-create + the transfer) — no hidden
  // instruction (e.g. draining SOL, an extra transfer) may ride along.
  for (const ix of tx.instructions) {
    if (!ix.programId.equals(TOKEN_PROGRAM_ID) && !ix.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      log.warn({ programId: ix.programId.toBase58() }, 'verifyTitleTransferTx: unexpected instruction program');
      return false;
    }
  }

  // Exactly one transferChecked: source=sellerATA, dest=buyerATA, owner=seller, amount 1.
  const transfers = tx.instructions.filter((ix) => ix.programId.equals(TOKEN_PROGRAM_ID) && ix.data[0] === TRANSFER_CHECKED_DISCRIMINATOR);
  if (transfers.length !== 1) {
    log.warn({ count: transfers.length }, 'verifyTitleTransferTx: expected exactly one transferChecked');
    return false;
  }
  const t = transfers[0];
  // transferChecked keys: [source, mint, destination, owner, ...signers]
  const keys = t.keys;
  const ok =
    keys[0]?.pubkey.equals(fromAta) &&
    keys[1]?.pubkey.equals(mint) &&
    keys[2]?.pubkey.equals(toAta) &&
    keys[3]?.pubkey.equals(from);
  if (!ok) {
    log.warn('verifyTitleTransferTx: transfer accounts do not match seller→buyer for this mint');
    return false;
  }
  // amount: u64 LE at data[1..9], decimals at data[9]; must be 1 unit of a 0-decimal mint.
  const amount = t.data.readBigUInt64LE(1);
  const decimals = t.data[9];
  if (amount !== 1n || decimals !== 0) {
    log.warn({ amount: amount.toString(), decimals }, 'verifyTitleTransferTx: amount/decimals not a 1-of-1');
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
  await connection.confirmTransaction(sig, 'confirmed');
  log.info({ sig }, 'submitSignedTitleTransfer: title transfer confirmed on-chain');
  return sig;
}

// SPL token program transferChecked instruction discriminator (12) + the Associated Token Program id.
const TRANSFER_CHECKED_DISCRIMINATOR = 12;
const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
