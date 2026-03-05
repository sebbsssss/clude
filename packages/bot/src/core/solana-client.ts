/**
 * Solana client — MEMO WRITES + MEMORY REGISTRY.
 *
 * SECURITY: This module can only:
 *   1. Write memo data to Solana
 *   2. Initialize/interact with the memory registry PDA
 * It has NO fund transfer, token transfer, or swap capability.
 * The bot wallet is used exclusively for signing memo/registry transactions.
 * Any attempt to add transfer functionality should be rejected in code review.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as bs58Module from 'bs58';
const bs58 = bs58Module.default || bs58Module;
import { config } from '../config';
import { createChildLogger } from './logger';
import nacl from 'tweetnacl';
import { MEMO_PROGRAM_ID as MEMO_PROGRAM_ID_STRING, MEMO_MAX_LENGTH, SOLSCAN_TX_BASE_URL } from '../utils/constants';

const log = createChildLogger('solana-client');

let connection: Connection;
let botWallet: Keypair | null = null;

const MEMO_PROGRAM_ID = new PublicKey(MEMO_PROGRAM_ID_STRING);

export function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(config.solana.rpcUrl, 'confirmed');
  }
  return connection;
}

/** @internal SDK escape hatch — allows Cortex to inject Solana config. */
export function _configureSolana(rpcUrl: string, privateKey?: string): void {
  connection = new Connection(rpcUrl, 'confirmed');
  if (privateKey) {
    try {
      const raw = privateKey.trim();
      let secretKey: Uint8Array;
      if (raw.startsWith('[')) {
        secretKey = Uint8Array.from(JSON.parse(raw));
      } else {
        secretKey = bs58.decode(raw);
      }
      botWallet = Keypair.fromSecretKey(secretKey);
    } catch (err) {
      log.error({ err }, 'SDK: Failed to load bot wallet');
    }
  }
}

export function getBotWallet(): Keypair | null {
  if (!botWallet && config.solana.botWalletPrivateKey) {
    try {
      let secretKey: Uint8Array;
      const raw = config.solana.botWalletPrivateKey.trim();
      if (raw.startsWith('[')) {
        // JSON array format: [1,2,3,...]
        secretKey = Uint8Array.from(JSON.parse(raw));
      } else {
        // Base58 encoded format
        secretKey = bs58.decode(raw);
      }
      botWallet = Keypair.fromSecretKey(secretKey);
      log.info({ publicKey: botWallet.publicKey.toBase58() }, 'Bot wallet loaded');
    } catch (err) {
      log.error({ err }, 'Failed to load bot wallet');
    }
  }
  return botWallet;
}

export async function writeMemo(memo: string): Promise<string | null> {
  const wallet = getBotWallet();
  if (!wallet) {
    log.error('No bot wallet configured, cannot write memo');
    return null;
  }

  const conn = getConnection();
  const truncatedMemo = memo.slice(0, MEMO_MAX_LENGTH);

  const instruction = new TransactionInstruction({
    keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(truncatedMemo, 'utf-8'),
  });

  const transaction = new Transaction().add(instruction);

  try {
    const signature = await sendAndConfirmTransaction(conn, transaction, [wallet]);
    log.info({ signature, memoLength: truncatedMemo.length }, 'Memo written on-chain');
    return signature;
  } catch (err) {
    log.error({ err }, 'Failed to write memo');
    return null;
  }
}

let devnetConnection: Connection;

function getDevnetConnection(): Connection {
  if (!devnetConnection) {
    devnetConnection = new Connection('https://api.devnet.solana.com', 'confirmed');
  }
  return devnetConnection;
}

export async function writeMemoDevnet(memo: string): Promise<string | null> {
  const wallet = getBotWallet();
  if (!wallet) {
    log.error('No bot wallet configured, cannot write devnet memo');
    return null;
  }

  const conn = getDevnetConnection();
  const truncatedMemo = memo.slice(0, MEMO_MAX_LENGTH);

  const instruction = new TransactionInstruction({
    keys: [{ pubkey: wallet.publicKey, isSigner: true, isWritable: true }],
    programId: MEMO_PROGRAM_ID,
    data: Buffer.from(truncatedMemo, 'utf-8'),
  });

  const transaction = new Transaction().add(instruction);

  try {
    const signature = await sendAndConfirmTransaction(conn, transaction, [wallet]);
    log.info({ signature, memoLength: truncatedMemo.length }, 'Memo written on devnet');
    return signature;
  } catch (err) {
    log.error({ err }, 'Failed to write devnet memo');
    return null;
  }
}

export function verifySignature(
  message: string,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  const messageBytes = new TextEncoder().encode(message);
  return nacl.sign.detached.verify(messageBytes, signature, publicKey);
}

export function solscanTxUrl(signature: string): string {
  return `${SOLSCAN_TX_BASE_URL}/${signature}`;
}

// ============================================================
// ON-CHAIN MEMORY REGISTRY (Anchor program — raw instructions)
//
// Uses raw TransactionInstruction to avoid @coral-xyz/anchor client
// dependency, keeping the SDK lightweight. The instruction data layout
// matches the Anchor program's Borsh serialization.
// ============================================================

let registryProgramId: PublicKey | null = null;
let registryInitialized = false;

/** @internal SDK escape hatch — configure the memory registry program ID. */
export function _configureMemoryRegistry(programId: string): void {
  try {
    registryProgramId = new PublicKey(programId);
    log.info({ programId: programId.slice(0, 12) + '...' }, 'Memory registry program configured');
  } catch (err) {
    log.error({ err }, 'Invalid memory registry program ID');
  }
}

/** Check if memory registry is configured. */
export function isRegistryEnabled(): boolean {
  return registryProgramId !== null;
}

/**
 * Derive the registry PDA for a wallet.
 */
function deriveRegistryPDA(authority: PublicKey): [PublicKey, number] {
  if (!registryProgramId) throw new Error('Registry program not configured');
  return PublicKey.findProgramAddressSync(
    [Buffer.from('memory-registry'), authority.toBuffer()],
    registryProgramId,
  );
}

/**
 * Compute Anchor instruction discriminator: sha256("global:<method_name>")[0..8]
 */
function anchorDiscriminator(name: string): Buffer {
  const { createHash } = require('crypto');
  const hash = createHash('sha256').update(`global:${name}`).digest();
  return hash.subarray(0, 8);
}

/**
 * Initialize the registry PDA for the bot wallet (one-time).
 * Silently succeeds if already initialized.
 */
export async function initializeRegistry(): Promise<void> {
  if (registryInitialized) return;
  const wallet = getBotWallet();
  if (!wallet || !registryProgramId) return;

  const conn = getConnection();
  const [registryPDA] = deriveRegistryPDA(wallet.publicKey);

  // Check if PDA already exists
  const accountInfo = await conn.getAccountInfo(registryPDA);
  if (accountInfo) {
    registryInitialized = true;
    log.info({ registry: registryPDA.toBase58() }, 'Registry PDA already exists');
    return;
  }

  const discriminator = anchorDiscriminator('initialize');

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: registryPDA, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: registryProgramId,
    data: discriminator,
  });

  const transaction = new Transaction().add(instruction);

  try {
    const signature = await sendAndConfirmTransaction(conn, transaction, [wallet]);
    registryInitialized = true;
    log.info({ signature, registry: registryPDA.toBase58() }, 'Registry PDA initialized on-chain');
  } catch (err) {
    log.error({ err }, 'Failed to initialize registry PDA');
    throw err;
  }
}

/**
 * Memory type string to on-chain u8 index.
 */
function memoryTypeToU8(type: string): number {
  switch (type) {
    case 'episodic': return 0;
    case 'semantic': return 1;
    case 'procedural': return 2;
    case 'self_model': return 3;
    default: return 0;
  }
}

/**
 * Importance float to tier u8.
 */
function importanceToTier(importance: number): number {
  if (importance > 0.7) return 2; // high
  if (importance >= 0.3) return 1; // medium
  return 0; // low
}

/**
 * Register a memory's content hash in the on-chain registry.
 * Returns the transaction signature or null on failure.
 */
export async function registerMemoryOnChain(
  contentHash: Buffer,
  memoryType: string,
  importance: number,
  memoryId: number,
  encrypted: boolean,
): Promise<string | null> {
  const wallet = getBotWallet();
  if (!wallet || !registryProgramId) return null;

  const conn = getConnection();
  const [registryPDA] = deriveRegistryPDA(wallet.publicKey);

  const discriminator = anchorDiscriminator('register_memory');

  // Borsh-serialize arguments:
  // content_hash: [u8; 32]
  // memory_type: u8
  // importance_tier: u8
  // memory_id: u64 (LE)
  // encrypted: bool (u8)
  const data = Buffer.alloc(8 + 32 + 1 + 1 + 8 + 1); // discriminator + args
  discriminator.copy(data, 0);
  contentHash.copy(data, 8, 0, 32);
  data.writeUInt8(memoryTypeToU8(memoryType), 40);
  data.writeUInt8(importanceToTier(importance), 41);
  data.writeBigUInt64LE(BigInt(memoryId), 42);
  data.writeUInt8(encrypted ? 1 : 0, 50);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: registryPDA, isSigner: false, isWritable: true },
      { pubkey: wallet.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: registryProgramId,
    data,
  });

  const transaction = new Transaction().add(instruction);

  try {
    const signature = await sendAndConfirmTransaction(conn, transaction, [wallet]);
    log.info({ signature: signature.slice(0, 16), memoryId }, 'Memory registered on-chain');
    return signature;
  } catch (err) {
    log.warn({ err, memoryId }, 'Failed to register memory on-chain');
    return null;
  }
}

/**
 * Verify a content hash exists in the on-chain registry.
 * Returns true if found, false otherwise.
 */
export async function verifyMemoryOnChain(
  contentHash: Buffer,
  authority?: PublicKey,
): Promise<boolean> {
  const wallet = getBotWallet();
  const authPubkey = authority || wallet?.publicKey;
  if (!authPubkey || !registryProgramId) return false;

  const conn = getConnection();
  const [registryPDA] = deriveRegistryPDA(authPubkey);

  try {
    const accountInfo = await conn.getAccountInfo(registryPDA);
    if (!accountInfo || !accountInfo.data) return false;

    // Parse the account data (Anchor discriminator + Borsh)
    // Skip 8 bytes discriminator + 32 bytes authority + 8 bytes memory_count + 1 byte bump
    // Then 4 bytes vec length prefix, then entries
    const data = accountInfo.data;
    if (data.length < 53) return false; // Too small to contain any entries

    const vecLen = data.readUInt32LE(49);
    const ENTRY_SIZE = 56; // Matches MemoryEntry on-chain size
    const entriesStart = 53;

    for (let i = 0; i < vecLen; i++) {
      const offset = entriesStart + i * ENTRY_SIZE;
      if (offset + 32 > data.length) break;

      const hash = data.subarray(offset, offset + 32);
      if (contentHash.equals(hash)) return true;
    }

    return false;
  } catch (err) {
    log.warn({ err }, 'Failed to verify memory on-chain');
    return false;
  }
}
