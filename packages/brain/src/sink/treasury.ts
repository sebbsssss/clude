// Treasury transfer — sends accumulated $CLUDE from the hot wallet
// to the treasury multisig. Standard SPL token transfer; no custom
// program. Idempotent at the application layer (we record the tx
// signature in sink_ledger).

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} from '@solana/web3.js';
// @ts-ignore — @solana/spl-token is ESM-only, works via CJS/ESM interop
import * as splToken from '@solana/spl-token';
const { createTransferInstruction, getAssociatedTokenAddress, getAccount, TOKEN_PROGRAM_ID } = splToken;
import { CLUDE_MINT } from './types.js';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('sink:treasury');

export interface TransferOptions {
  hotWallet: Keypair;
  treasuryPubkey: string;       // base58
  connection: Connection;
  amountLamports: bigint;
}

export interface TransferResult {
  txSig: string;
  treasuryAta: string;
  amountLamports: bigint;
}

export async function transferToTreasury(opts: TransferOptions): Promise<TransferResult> {
  const mint = new PublicKey(CLUDE_MINT);
  const treasury = new PublicKey(opts.treasuryPubkey);

  const sourceAta = await getAssociatedTokenAddress(mint, opts.hotWallet.publicKey);
  const destAta = await getAssociatedTokenAddress(mint, treasury);

  // Sanity: confirm hot wallet has enough.
  const sourceAcc = await getAccount(opts.connection, sourceAta);
  if (sourceAcc.amount < opts.amountLamports) {
    throw new Error(
      `Hot wallet CLUDE balance ${sourceAcc.amount} < transfer ${opts.amountLamports}`,
    );
  }

  // Note: we assume the destination ATA already exists. For a brand-new
  // treasury it must be created once (a separate one-time bootstrap).
  // The cron does NOT include create-ATA as a fallback — that would
  // mean spending hot-wallet SOL to create an account we don't own,
  // and any failure mid-flight is annoying. Keep bootstrap manual.

  const ix = createTransferInstruction(
    sourceAta,
    destAta,
    opts.hotWallet.publicKey,
    opts.amountLamports,
    [],
    TOKEN_PROGRAM_ID,
  );

  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await opts.connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = opts.hotWallet.publicKey;
  tx.sign(opts.hotWallet);

  const sig = await opts.connection.sendRawTransaction(tx.serialize());
  await opts.connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    'confirmed',
  );

  log.info(
    { sig, treasuryAta: destAta.toBase58(), amount: String(opts.amountLamports) },
    'Treasury transfer confirmed',
  );

  return {
    txSig: sig,
    treasuryAta: destAta.toBase58(),
    amountLamports: opts.amountLamports,
  };
}
