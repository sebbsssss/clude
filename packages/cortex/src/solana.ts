// ============================================================
// SOLANA INTEGRATION — On-chain memory proofs
//
// Commit memory pack hashes to Solana for:
//   - Provable existence (timestamp proof)
//   - Ownership verification (wallet signature)
//   - Public memory registry
//
// Uses Ed25519 signatures natively (Solana keypair).
// Falls back to HMAC for local-only mode.
// ============================================================

import { createHash } from 'crypto';
import type { MemoryPack } from './pack.js';

export interface SolanaConfig {
  /** RPC endpoint (mainnet, devnet, etc.) */
  rpcUrl: string;
  /** Base58-encoded private key */
  privateKey?: string;
  /** Program ID for on-chain registry (optional) */
  registryProgramId?: string;
}

export interface OnChainProof {
  /** Solana transaction signature */
  tx: string;
  /** Content hash that was committed */
  content_hash: string;
  /** Wallet that signed */
  wallet: string;
  /** Slot when committed */
  slot: number;
  /** Block time */
  timestamp: number;
}

/**
 * Commit a memory pack hash to Solana via memo instruction.
 * Returns the transaction signature.
 *
 * Requires @solana/web3.js as a peer dependency.
 */
export async function commitPackToChain(
  pack: MemoryPack,
  config: SolanaConfig,
): Promise<OnChainProof> {
  // Dynamic import to keep @solana/web3.js optional
  const { Connection, Keypair, Transaction, TransactionInstruction, PublicKey, sendAndConfirmTransaction } =
    await import('@solana/web3.js');

  if (!config.privateKey) throw new Error('Private key required for on-chain commitment');

  const connection = new Connection(config.rpcUrl, 'confirmed');
  const keypair = Keypair.fromSecretKey(
    Buffer.from(config.privateKey, 'base64'),
  );

  const memo = JSON.stringify({
    program: 'clude-memory',
    version: 1,
    wallet: pack.wallet,
    content_hash: pack.meta.content_hash,
    memory_count: pack.meta.memory_count,
    timestamp: new Date().toISOString(),
  });

  // Memo program ID
  const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

  const tx = new Transaction().add(
    new TransactionInstruction({
      keys: [{ pubkey: keypair.publicKey, isSigner: true, isWritable: true }],
      programId: MEMO_PROGRAM_ID,
      data: Buffer.from(memo, 'utf-8'),
    }),
  );

  const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);

  // Get slot info
  const txInfo = await connection.getTransaction(signature, { commitment: 'confirmed' });

  return {
    tx: signature,
    content_hash: pack.meta.content_hash,
    wallet: keypair.publicKey.toBase58(),
    slot: txInfo?.slot ?? 0,
    timestamp: txInfo?.blockTime ?? Math.floor(Date.now() / 1000),
  };
}

/**
 * Verify an on-chain proof by checking the memo content.
 */
export async function verifyOnChainProof(
  proof: OnChainProof,
  config: Pick<SolanaConfig, 'rpcUrl'>,
): Promise<boolean> {
  const { Connection } = await import('@solana/web3.js');
  const connection = new Connection(config.rpcUrl, 'confirmed');

  try {
    const tx = await connection.getTransaction(proof.tx, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) return false;

    // Check that the memo contains our content hash
    const logs = tx.meta?.logMessages || [];
    return logs.some((log: string) => log.includes(proof.content_hash));
  } catch {
    return false;
  }
}

/**
 * Sign a pack with Ed25519 (Solana keypair).
 * This is the production-grade alternative to HMAC signing.
 */
export async function signPackEd25519(
  contentHash: string,
  privateKey: string,
): Promise<string> {
  const { Keypair } = await import('@solana/web3.js');
  const { sign } = await import('tweetnacl');

  const keypair = Keypair.fromSecretKey(Buffer.from(privateKey, 'base64'));
  const message = Buffer.from(contentHash, 'hex');
  const signature = sign.detached(message, keypair.secretKey);

  return Buffer.from(signature).toString('hex');
}

/**
 * Verify an Ed25519 signature on a pack.
 */
export async function verifyPackEd25519(
  contentHash: string,
  signature: string,
  walletAddress: string,
): Promise<boolean> {
  const { PublicKey } = await import('@solana/web3.js');
  const { sign } = await import('tweetnacl');

  const message = Buffer.from(contentHash, 'hex');
  const sig = Buffer.from(signature, 'hex');
  const pubkey = new PublicKey(walletAddress).toBytes();

  return sign.detached.verify(message, sig, pubkey);
}
