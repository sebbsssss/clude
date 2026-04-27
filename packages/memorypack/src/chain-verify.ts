// Chain anchor verification for MemoryPack v0.2.
//
// Out-of-band by design: readMemoryPack() is sync + offline. Callers
// who care about chain proofs invoke this function separately and merge
// the returned Set<string> into result.verifiedAnchors.
//
// What we actually verify (the v0.1 reader was just regex-matching the
// memo string in tx.meta.logMessages, which trusted any program's
// arbitrary log output — that's not a security primitive). The v0.2
// verifier:
//
//   1. Fetches the transaction via getTransaction(sig).
//   2. Walks the message instructions and requires AT LEAST ONE
//      instruction whose programId is the canonical SPL Memo program
//      (or the v1 legacy memo program). Logs are not consulted.
//   3. Decodes the Memo instruction's data and exact-matches it
//      against `clude:v1:sha256:<hex>`.
//   4. Requires the producer's public key (or a caller-supplied
//      expectedSigner) is one of the transaction's signers — i.e. the
//      anchor was actually committed by the producer, not a stranger
//      who happened to fit the regex.
//   5. Optionally cross-checks the cluster via getGenesisHash() so a
//      devnet RPC can't accept a mainnet anchor (or vice versa).

import { Connection, PublicKey, type GetVersionedTransactionConfig } from '@solana/web3.js';
import { MemoryPackAnchor } from './types.js';

// Canonical SPL Memo programs.
//   v3 (current): MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr
//   v1 (legacy):  Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo
const MEMO_PROGRAM_IDS = new Set([
  'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
]);

// Genesis hashes for cluster validation. Mismatch → reject.
const GENESIS_HASHES: Record<string, string> = {
  mainnet: '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
  testnet: '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY',
};

export interface VerifyChainAnchorsOptions {
  rpcUrl: string;
  /**
   * Cross-check the RPC's cluster matches what we expect. When set,
   * we call getGenesisHash() once and reject all anchors if it doesn't
   * match the known hash for this cluster. Default: no cross-check.
   */
  cluster?: 'mainnet' | 'mainnet-beta' | 'devnet' | 'testnet';
  /**
   * Required signer on every verified anchor. Typically
   * `manifest.producer.public_key`. When unset, signer-binding is
   * skipped — useful for anchor probes / monitoring, but in
   * production callers SHOULD pin this to bind anchors to the
   * producer identity.
   */
  expectedSigner?: string;
  /**
   * If true, the first verification failure throws. Default: collect
   * warnings, return what verified, callers decide.
   */
  strict?: boolean;
}

export interface VerifyChainAnchorsResult {
  /** Record hashes confirmed on-chain. */
  verified: Set<string>;
  /** Per-anchor failure reasons. */
  warnings: string[];
}

/**
 * Verify a list of anchors against a Solana RPC.
 *
 * Sequential by default to keep RPC pressure low. For 100+ anchors,
 * callers MAY chunk and parallelize — the result Sets merge cleanly.
 */
export async function verifyChainAnchors(
  anchors: MemoryPackAnchor[],
  opts: VerifyChainAnchorsOptions,
): Promise<VerifyChainAnchorsResult> {
  const verified = new Set<string>();
  const warnings: string[] = [];

  if (anchors.length === 0) return { verified, warnings };

  const conn = new Connection(opts.rpcUrl, { commitment: 'confirmed' });

  // Cluster cross-check (one RPC call, applies to all anchors).
  if (opts.cluster) {
    try {
      const genesis = await conn.getGenesisHash();
      const expected = GENESIS_HASHES[opts.cluster];
      if (!expected) {
        const msg = `unknown cluster '${opts.cluster}' — cannot cross-check genesis`;
        if (opts.strict) throw new Error(msg);
        warnings.push(msg);
      } else if (genesis !== expected) {
        const msg = `cluster mismatch: rpc reports genesis ${genesis}, expected ${expected} for ${opts.cluster}`;
        if (opts.strict) throw new Error(msg);
        warnings.push(msg);
        return { verified, warnings };
      }
    } catch (e) {
      const msg = `getGenesisHash failed: ${(e as Error).message}`;
      if (opts.strict) throw new Error(msg);
      warnings.push(msg);
    }
  }

  // Fetch + verify each anchor.
  for (const anchor of anchors) {
    try {
      await verifyOne(anchor, conn, opts, verified);
    } catch (e) {
      const msg = `${anchor.tx} → ${(e as Error).message}`;
      if (opts.strict) throw new Error(msg);
      warnings.push(msg);
    }
  }

  return { verified, warnings };
}

// ────────────────────────────────────────────────────────────────────
// Per-anchor verification
// ────────────────────────────────────────────────────────────────────

async function verifyOne(
  anchor: MemoryPackAnchor,
  conn: Connection,
  opts: VerifyChainAnchorsOptions,
  verified: Set<string>,
): Promise<void> {
  if (anchor.anchor_format !== 'memo-v1') {
    throw new Error(`unsupported anchor_format '${anchor.anchor_format}'`);
  }

  const cfg: GetVersionedTransactionConfig = {
    commitment: 'confirmed',
    maxSupportedTransactionVersion: 0,
  };
  const tx = await conn.getTransaction(anchor.tx, cfg);
  if (!tx) {
    throw new Error('transaction not found');
  }

  // Resolve account keys + instructions across legacy + versioned tx
  // shapes. We treat the message as a structural duck-type so this
  // works against current and future @solana/web3.js minor versions.
  const message = tx.transaction.message as unknown as {
    accountKeys?: PublicKey[];
    getAccountKeys?: (opts: { accountKeysFromLookups?: unknown }) => {
      staticAccountKeys: PublicKey[];
    };
    header: { numRequiredSignatures: number };
    instructions?: Array<{ programIdIndex: number; data: unknown }>;
    compiledInstructions?: Array<{ programIdIndex: number; data: unknown }>;
  };
  let accountKeys: PublicKey[];
  if (Array.isArray(message.accountKeys)) {
    accountKeys = message.accountKeys;
  } else if (typeof message.getAccountKeys === 'function') {
    accountKeys = message.getAccountKeys({
      accountKeysFromLookups: tx.meta?.loadedAddresses,
    }).staticAccountKeys;
  } else {
    throw new Error('cannot resolve account keys from transaction message');
  }

  // Header carries the signer count (numRequiredSignatures); the first
  // N accountKeys are the signers.
  const numSigners = message.header.numRequiredSignatures;
  const signerKeys = accountKeys.slice(0, numSigners).map((k) => k.toBase58());

  // Find at least one Memo program instruction whose decoded data
  // exactly matches `clude:v1:sha256:<hex>` for this anchor's record.
  const expectedMemo = expectedMemoForRecordHash(anchor.record_hash);
  const instructions = message.compiledInstructions ?? message.instructions ?? [];

  let memoInstructionFound = false;
  let memoMatched = false;
  for (const ix of instructions) {
    const programId = accountKeys[ix.programIdIndex]?.toBase58();
    if (!programId || !MEMO_PROGRAM_IDS.has(programId)) continue;
    memoInstructionFound = true;

    const dataStr = decodeMemoInstructionData(ix.data);
    if (dataStr === expectedMemo) {
      memoMatched = true;
      break;
    }
  }

  if (!memoInstructionFound) {
    throw new Error('no SPL Memo program instruction in transaction');
  }
  if (!memoMatched) {
    throw new Error(`no Memo instruction with data exactly equal to "${expectedMemo}"`);
  }

  // Signer-binding: the producer must have signed this tx. Without
  // this check, anyone can mint a tx with a matching memo and present
  // it as a "verified" anchor.
  if (opts.expectedSigner) {
    if (!signerKeys.includes(opts.expectedSigner)) {
      throw new Error(
        `expectedSigner ${opts.expectedSigner} is not among tx signers [${signerKeys.join(', ')}]`,
      );
    }
  }

  verified.add(anchor.record_hash);
}

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

/**
 * The exact memo string a producer should commit on-chain for a given
 * record hash. Format: `clude:v1:sha256:<hex>` — 73 bytes for SHA-256.
 */
export function expectedMemoForRecordHash(recordHash: string): string {
  // record_hash is "sha256:<hex>"; the on-chain memo is "clude:v1:sha256:<hex>".
  return `clude:v1:${recordHash}`;
}

/**
 * Decode an instruction's `data` field to the UTF-8 string the program
 * received. Solana web3 represents legacy instruction data as a base58
 * string; compiled (v0+) instructions surface it as Uint8Array.
 */
function decodeMemoInstructionData(data: unknown): string {
  if (typeof data === 'string') {
    // Legacy: data is base58-encoded instruction data.
    // Use bs58 the same way sign.ts does.
    const bs58 = loadBs58();
    const bytes = bs58.decode(data);
    return Buffer.from(bytes).toString('utf-8');
  }
  if (data instanceof Uint8Array || Buffer.isBuffer(data)) {
    return Buffer.from(data as Uint8Array).toString('utf-8');
  }
  // Some web3 versions return a typed object; coerce defensively.
  if (data && typeof data === 'object' && 'type' in data && 'data' in data) {
    return Buffer.from((data as { data: number[] }).data).toString('utf-8');
  }
  throw new Error(`unrecognized instruction data shape: ${typeof data}`);
}

let _bs58: { decode: (s: string) => Uint8Array } | null = null;
function loadBs58(): { decode: (s: string) => Uint8Array } {
  if (_bs58) return _bs58;
  // @ts-ignore — bs58 is ESM-only, works at runtime via Node CJS/ESM interop
  const mod = require('bs58');
  _bs58 = (mod.default || mod) as { decode: (s: string) => Uint8Array };
  return _bs58;
}
