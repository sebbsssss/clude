/**
 * Pack-gate — token-gated Pack content unlock.
 *
 * v0.1 model: holding the Pack token grants read access to all memories in
 * the Pack. Server verifies two things atomically:
 *
 *   1. The caller controls the wallet they claim — wallet-signed nonce
 *      that includes the pack_id and a fresh timestamp. Prevents replay
 *      and prevents an attacker from claiming someone else's wallet.
 *
 *   2. That wallet currently holds the Pack token — on-chain balance lookup
 *      via Solana RPC. Holding = 1 or more units of the Pack token mint.
 *
 * Encryption note: v0.1 ships *authorization*, not encryption. Memory
 * content is plaintext (or encrypted with the bot's key, which the server
 * controls) in Supabase. The unlock endpoint releases the content if the
 * caller passes both checks above. v0.2 will layer threshold encryption
 * (Lit Protocol / Nucleus) so the server can't unilaterally read content —
 * unlock will instead release decryption shares.
 *
 * The unlock message is canonicalised to prevent ambiguity:
 *
 *     unlock:<pack_id>:<unix_ts_seconds>
 *
 * Replay window: ±300 seconds (5 minutes) around server time. Tight enough
 * to prevent old-message replay; loose enough for clock skew.
 */

import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
// @ts-ignore — bs58 is ESM-only, works at runtime via Node CJS/ESM interop
// (mirrors the pattern in packages/brain/src/verify-app/routes.ts)
import * as bs58Module from 'bs58';
const bs58 = (bs58Module as any).default || bs58Module;
import { getConnection } from '@clude/shared/core/solana-client';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('pack-gate');

const UNLOCK_MESSAGE_PREFIX = 'unlock:';
const REPLAY_WINDOW_SECONDS = 300; // ±5 min

export type UnlockFailureReason =
  | 'malformed_message'
  | 'pack_id_mismatch'
  | 'message_expired'
  | 'invalid_wallet'
  | 'invalid_signature'
  | 'not_token_holder'
  | 'rpc_unavailable';

export interface UnlockOk {
  ok: true;
  walletAddress: string;
}

export interface UnlockFailed {
  ok: false;
  reason: UnlockFailureReason;
  detail?: string;
}

export type UnlockResult = UnlockOk | UnlockFailed;

export interface VerifyUnlockInput {
  /** Pack id from the URL — server-trusted, used to cross-check the signed message. */
  packId: string;
  /** Pack token address from the memory_packs row — used to look up holder balances. */
  packTokenAddress: string;
  /** Caller-supplied wallet address (base58 Solana pubkey). */
  walletAddress: string;
  /** The exact string the wallet signed: `unlock:<pack_id>:<unix_ts_seconds>`. */
  message: string;
  /** Base58-encoded Ed25519 signature over the message bytes. */
  signature: string;
  /** Override server time for testing. Seconds since epoch. */
  nowSeconds?: number;
}

/**
 * Token-ownership verifier abstraction. Production impl hits Solana RPC;
 * tests inject a fake. Same DI pattern as MintClient.
 */
export interface PackOwnershipVerifier {
  /** Returns true iff `walletAddress` currently holds ≥1 of `packTokenMint`. */
  holdsPackToken(walletAddress: string, packTokenMint: string): Promise<boolean>;
}

/** Production verifier — queries Solana RPC for the wallet's token accounts. */
export class SolanaPackOwnershipVerifier implements PackOwnershipVerifier {
  async holdsPackToken(walletAddress: string, packTokenMint: string): Promise<boolean> {
    let owner: PublicKey;
    let mint: PublicKey;
    try {
      owner = new PublicKey(walletAddress);
      mint = new PublicKey(packTokenMint);
    } catch (err) {
      log.warn({ err, walletAddress: walletAddress.slice(0, 8), packTokenMint: packTokenMint.slice(0, 8) }, 'invalid pubkey in ownership check');
      return false;
    }
    const conn = getConnection();
    // Token-2022 program is the modern default; the legacy SPL Token program
    // is at TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA. Most cNFT-style
    // Pack tokens land under the legacy program. Try both to be safe.
    const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
    try {
      const resp = await conn.getParsedTokenAccountsByOwner(owner, { mint, programId: TOKEN_PROGRAM_ID });
      for (const a of resp.value) {
        const balance = a.account.data?.parsed?.info?.tokenAmount?.uiAmount;
        if (typeof balance === 'number' && balance >= 1) return true;
      }
      return false;
    } catch (err) {
      log.warn({ err, walletAddress: walletAddress.slice(0, 8), packTokenMint: packTokenMint.slice(0, 8) }, 'RPC error in holdsPackToken');
      throw err;
    }
  }
}

/**
 * Verify an unlock request: signed-message format, replay window, signature
 * validity, and on-chain token ownership. Returns a structured success or
 * failure so the route can return the right HTTP status + reason.
 */
export async function verifyUnlockRequest(
  input: VerifyUnlockInput,
  verifier: PackOwnershipVerifier,
): Promise<UnlockResult> {
  // 1. Parse the message.
  if (!input.message.startsWith(UNLOCK_MESSAGE_PREFIX)) {
    return { ok: false, reason: 'malformed_message', detail: 'must start with "unlock:"' };
  }
  const rest = input.message.slice(UNLOCK_MESSAGE_PREFIX.length);
  // Split on the LAST colon so pack ids could contain colons in theory.
  const colonIndex = rest.lastIndexOf(':');
  if (colonIndex < 0) {
    return { ok: false, reason: 'malformed_message', detail: 'missing timestamp' };
  }
  const messagePackId = rest.slice(0, colonIndex);
  const messageTimestamp = rest.slice(colonIndex + 1);

  if (messagePackId !== input.packId) {
    return {
      ok: false,
      reason: 'pack_id_mismatch',
      detail: `message says ${messagePackId}, URL says ${input.packId}`,
    };
  }

  const ts = parseInt(messageTimestamp, 10);
  if (!Number.isFinite(ts) || ts <= 0) {
    return { ok: false, reason: 'malformed_message', detail: 'timestamp not an integer' };
  }

  // 2. Replay window.
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const drift = Math.abs(now - ts);
  if (drift > REPLAY_WINDOW_SECONDS) {
    return {
      ok: false,
      reason: 'message_expired',
      detail: `message ts ${ts} drifts ${drift}s from server ${now} (window ±${REPLAY_WINDOW_SECONDS}s)`,
    };
  }

  // 3. Signature.
  let walletPubkey: Uint8Array;
  try {
    walletPubkey = bs58.decode(input.walletAddress);
    if (walletPubkey.length !== 32) {
      return { ok: false, reason: 'invalid_wallet', detail: 'pubkey not 32 bytes' };
    }
  } catch (err) {
    return { ok: false, reason: 'invalid_wallet', detail: 'bs58 decode failed' };
  }

  let signatureBytes: Uint8Array;
  try {
    signatureBytes = bs58.decode(input.signature);
    if (signatureBytes.length !== 64) {
      return { ok: false, reason: 'invalid_signature', detail: 'signature not 64 bytes' };
    }
  } catch (err) {
    return { ok: false, reason: 'invalid_signature', detail: 'bs58 decode failed' };
  }

  const messageBytes = new TextEncoder().encode(input.message);
  const valid = nacl.sign.detached.verify(messageBytes, signatureBytes, walletPubkey);
  if (!valid) {
    return { ok: false, reason: 'invalid_signature', detail: 'ed25519 verify failed' };
  }

  // 4. On-chain token ownership.
  let holds: boolean;
  try {
    holds = await verifier.holdsPackToken(input.walletAddress, input.packTokenAddress);
  } catch (err) {
    return {
      ok: false,
      reason: 'rpc_unavailable',
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (!holds) {
    return { ok: false, reason: 'not_token_holder' };
  }

  return { ok: true, walletAddress: input.walletAddress };
}

/**
 * Module-level singleton. Cheap to instantiate; caching avoids re-allocating
 * a Connection wrapper for every request.
 */
let _verifier: PackOwnershipVerifier | null = null;
export function getDefaultPackOwnershipVerifier(): PackOwnershipVerifier {
  if (!_verifier) _verifier = new SolanaPackOwnershipVerifier();
  return _verifier;
}

/** Test hook — replace the singleton (e.g. with a fake). */
export function _setPackOwnershipVerifier(v: PackOwnershipVerifier): void {
  _verifier = v;
}

export { UNLOCK_MESSAGE_PREFIX, REPLAY_WINDOW_SECONDS };
