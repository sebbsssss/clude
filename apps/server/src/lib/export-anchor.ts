/**
 * Per-export on-chain anchoring (Memory 3.0 · Track B1.4).
 *
 * Writes a Solana memo committing (merkle_root, manifest_hash) for a .pmp
 * export, giving every pack a tamper-proof, timestamped public receipt.
 *
 * SIGNER POLICY (the entire point of this module): anchors are signed by a
 * DEDICATED low-balance keypair (ANCHOR_WALLET_PRIVATE_KEY) and NEVER by
 * BOT_WALLET_PRIVATE_KEY — that key is the treasury. loadAnchorSigner()
 * refuses, in code, to load a key equal to the treasury key, mirroring the
 * loadTitleMinter() precedent (the bot wallet must never gain new spend
 * paths). No env combination can route anchor volume through the treasury.
 *
 * Rollout: default OFF. Enable with ANCHOR_EXPORTS_ON_CHAIN=true AFTER the
 * dedicated keypair exists and is funded with dust (each anchor costs one
 * memo-tx fee, ~5000 lamports).
 *
 * Memo format (NOT truncated — a truncated hash is a destroyed proof; the
 * SPL memo program accepts far more than the 100-byte cap writeMemo uses
 * for social memos):
 *   clude-anchor|v1|<artifact_id>|<merkle_root>|<manifest_hash>
 */
import {
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { getConnection } from '@clude/shared/core/solana-client';
import { MEMO_PROGRAM_ID } from '@clude/shared/utils/constants';
import { createChildLogger } from '@clude/shared/core/logger';
import { getDb } from '@clude/shared/core/database';

const log = createChildLogger('export-anchor');

export const ANCHOR_MEMO_VERSION = 'v1';
/** Sanity bound well under the SPL memo/tx limit; a v1 anchor memo is ~180 bytes. */
const ANCHOR_MEMO_MAX_BYTES = 500;

export function isExportAnchoringEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.ANCHOR_EXPORTS_ON_CHAIN === 'true';
}

function decodeSecret(raw: string): Uint8Array {
  return raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw);
}

/**
 * Load the dedicated export-anchor signer from ANCHOR_WALLET_PRIVATE_KEY.
 *
 * REFUSES to load if unset, invalid, or equal to BOT_WALLET_PRIVATE_KEY (the
 * treasury). The treasury comparison happens on RAW env values before any
 * decoding, so a formatting trick (bs58 vs JSON array of the same key) is
 * also caught by comparing derived public keys after decode.
 */
export function loadAnchorSigner(env: NodeJS.ProcessEnv = process.env): Keypair {
  const raw = (env.ANCHOR_WALLET_PRIVATE_KEY ?? '').trim();
  if (!raw) {
    throw new Error('ANCHOR_WALLET_PRIVATE_KEY is not set (the dedicated export-anchor signer)');
  }

  const treasury = (env.BOT_WALLET_PRIVATE_KEY ?? '').trim();
  if (treasury && raw === treasury) {
    throw new Error(
      'ANCHOR_WALLET_PRIVATE_KEY must NOT equal BOT_WALLET_PRIVATE_KEY — that key is the TREASURY; anchors are signed by a dedicated low-balance keypair only',
    );
  }

  let kp: Keypair;
  try {
    kp = Keypair.fromSecretKey(decodeSecret(raw));
  } catch (err) {
    log.error({ err }, 'loadAnchorSigner: failed to decode ANCHOR_WALLET_PRIVATE_KEY');
    throw new Error('ANCHOR_WALLET_PRIVATE_KEY is not a valid bs58 / JSON-array secret key');
  }

  // Same-key-different-encoding guard: compare derived pubkeys too.
  if (treasury) {
    try {
      const treasuryKp = Keypair.fromSecretKey(decodeSecret(treasury));
      if (treasuryKp.publicKey.equals(kp.publicKey)) {
        throw new Error(
          'ANCHOR_WALLET_PRIVATE_KEY resolves to the TREASURY public key — anchors must use a dedicated keypair',
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('TREASURY')) throw err;
      // Treasury key undecodable here is not this module's problem.
    }
  }

  return kp;
}

export interface AnchorResult {
  status: 'anchored' | 'disabled' | 'error';
  txSig?: string;
  error?: string;
}

export function buildAnchorMemo(artifactId: string, merkleRoot: string, manifestHash: string): string {
  const memo = `clude-anchor|${ANCHOR_MEMO_VERSION}|${artifactId}|${merkleRoot}|${manifestHash}`;
  if (Buffer.byteLength(memo, 'utf8') > ANCHOR_MEMO_MAX_BYTES) {
    // Never truncate: a truncated hash is a destroyed proof.
    throw new Error(`anchor memo exceeds ${ANCHOR_MEMO_MAX_BYTES} bytes; refusing to truncate a commitment`);
  }
  return memo;
}

/**
 * Anchor one export on-chain. Never throws — export flows must not fail
 * because anchoring hiccuped; failures return {status:'error'} and log.
 */
export async function anchorExportOnChain(
  input: { artifactId: string; merkleRoot: string; manifestHash: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AnchorResult> {
  if (!isExportAnchoringEnabled(env)) return { status: 'disabled' };

  try {
    const signer = loadAnchorSigner(env);
    const memo = buildAnchorMemo(input.artifactId, input.merkleRoot, input.manifestHash);

    const instruction = new TransactionInstruction({
      keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: true }],
      programId: new PublicKey(MEMO_PROGRAM_ID),
      data: Buffer.from(memo, 'utf-8'),
    });
    const tx = new Transaction().add(instruction);
    const txSig = await sendAndConfirmTransaction(getConnection(), tx, [signer]);

    log.info({ artifactId: input.artifactId, txSig }, 'Export anchored on-chain');
    return { status: 'anchored', txSig };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ artifactId: input.artifactId, err: message }, 'Export anchoring failed (export unaffected)');
    return { status: 'error', error: message };
  }
}

/**
 * Fire-and-forget wrapper for the export route: anchors, then persists the
 * txSig onto the artifact row (unlike the title mint's detached void, the
 * result is CAPTURED — the Solscan surface in B2 reads anchor_tx_sig).
 */
export async function anchorExportBestEffort(
  artifactId: string,
  merkleRoot: string,
  manifestHash: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const result = await anchorExportOnChain({ artifactId, merkleRoot, manifestHash }, env);
  if (result.status !== 'anchored' || !result.txSig) return;

  const db = getDb();
  const { error } = await db
    .from('pmp_artifacts')
    .update({ anchor_tx_sig: result.txSig, anchor_chain: 'solana' })
    .eq('artifact_id', artifactId);
  if (error) {
    log.error({ artifactId, txSig: result.txSig, err: error.message }, 'Anchored but failed to persist anchor_tx_sig');
  }
}
