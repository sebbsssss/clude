/**
 * solana-title-transfer — the non-custodial transfer primitives.
 *
 * The security-critical bit is verifyTitleTransferTx: a seller signs client-side, so before the server
 * submits we must confirm the signed tx ONLY moves this 1-of-1 seller→buyer and nothing else. Covers the
 * build→verify round-trip, a wrong-buyer reject, a foreign-instruction reject (the drain guard), an
 * undecodable reject, and submit. Connection is mocked — no live chain.
 */
import { describe, it, expect, vi } from 'vitest';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, createTransferCheckedInstruction, createApproveInstruction } from '@solana/spl-token';

vi.mock('@clude/shared/core/logger', () => ({
  createChildLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  buildTitleTransferTransaction,
  verifyTitleTransferTx,
  submitSignedTitleTransfer,
} from '../solana-title-transfer.js';

const mint = Keypair.generate().publicKey.toBase58();
const seller = Keypair.generate().publicKey.toBase58();
const buyer = Keypair.generate().publicKey.toBase58();
const BLOCKHASH = PublicKey.default.toBase58(); // 32-byte base58, valid for recentBlockhash in a test

const buildConn = { getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1 }) } as any;

describe('buildTitleTransferTransaction + verifyTitleTransferTx', () => {
  it('builds an unsigned transfer that verifies as exactly seller→buyer for this mint', async () => {
    const r = await buildTitleTransferTransaction(buildConn, mint, seller, buyer);
    expect(r.unsignedTxBase64).toBeTruthy();
    expect(r.fromAta).toBe(getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(seller)).toBase58());
    expect(r.toAta).toBe(getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(buyer)).toBase58());
    expect(verifyTitleTransferTx(r.unsignedTxBase64, { mintAddress: mint, fromWallet: seller, toWallet: buyer })).toBe(true);
  });

  it('rejects the same tx when checked against a DIFFERENT buyer', async () => {
    const r = await buildTitleTransferTransaction(buildConn, mint, seller, buyer);
    const other = Keypair.generate().publicKey.toBase58();
    expect(verifyTitleTransferTx(r.unsignedTxBase64, { mintAddress: mint, fromWallet: seller, toWallet: other })).toBe(false);
  });

  it('rejects a tx carrying a FOREIGN instruction (e.g. a SOL drain riding along)', () => {
    const m = new PublicKey(mint), s = new PublicKey(seller), b = new PublicKey(buyer);
    const fromAta = getAssociatedTokenAddressSync(m, s), toAta = getAssociatedTokenAddressSync(m, b);
    const tx = new Transaction();
    tx.add(createTransferCheckedInstruction(fromAta, m, toAta, s, 1, 0));
    tx.add(SystemProgram.transfer({ fromPubkey: s, toPubkey: b, lamports: 1_000_000_000 })); // the attack
    tx.feePayer = s;
    tx.recentBlockhash = BLOCKHASH;
    const b64 = tx.serialize({ requireAllSignatures: false }).toString('base64');
    expect(verifyTitleTransferTx(b64, { mintAddress: mint, fromWallet: seller, toWallet: buyer })).toBe(false);
  });

  it('rejects a tx with an extra TOKEN-program instruction riding along (e.g. Approve)', () => {
    const m = new PublicKey(mint), s = new PublicKey(seller), b = new PublicKey(buyer);
    const fromAta = getAssociatedTokenAddressSync(m, s), toAta = getAssociatedTokenAddressSync(m, b);
    const tx = new Transaction();
    tx.add(createTransferCheckedInstruction(fromAta, m, toAta, s, 1, 0));
    tx.add(createApproveInstruction(fromAta, b, s, 1)); // a same-program rider — must be rejected, not just counted
    tx.feePayer = s;
    tx.recentBlockhash = BLOCKHASH;
    const b64 = tx.serialize({ requireAllSignatures: false }).toString('base64');
    expect(verifyTitleTransferTx(b64, { mintAddress: mint, fromWallet: seller, toWallet: buyer })).toBe(false);
  });

  it('rejects an undecodable transaction', () => {
    expect(verifyTitleTransferTx('@@not-a-tx@@', { mintAddress: mint, fromWallet: seller, toWallet: buyer })).toBe(false);
  });
});

describe('submitSignedTitleTransfer', () => {
  it('broadcasts the raw tx and waits for confirmation, returning the signature', async () => {
    const sendRawTransaction = vi.fn(async () => 'SIG_OK');
    const confirmTransaction = vi.fn(async () => ({ value: { err: null } }));
    const conn = { sendRawTransaction, confirmTransaction } as any;
    const sig = await submitSignedTitleTransfer(conn, Buffer.from('signed').toString('base64'));
    expect(sig).toBe('SIG_OK');
    expect(sendRawTransaction).toHaveBeenCalledOnce();
    expect(confirmTransaction).toHaveBeenCalledWith('SIG_OK', 'confirmed');
  });
});
