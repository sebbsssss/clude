/**
 * Brain-level orchestration for owner-held envelope encryption (PMP §4–§5).
 * Wraps the pure crypto in @clude/shared/core/memory-envelope + the registry/
 * provider keypair in encryption-keys. Gated by PMP_ENCRYPTION_ENABLED so it is
 * a no-op until Plan 3b (recall decrypt) is also deployed.
 */
import nacl from 'tweetnacl';
import {
  generateDek,
  encryptField,
  wrapDek,
  deriveOwnerEncryptionKeypair,
} from '@clude/shared/core/memory-envelope';
import {
  loadProviderKeypair,
  getOwnerEncryptionKey,
} from '@clude/shared/core/encryption-keys';
import { getBotWallet } from '@clude/shared/core/solana-client';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('memory-encryption');
const DERIVE_MESSAGE = 'clude-memory-encryption-v1';

let botKeypair: nacl.BoxKeyPair | null = null;

/** Encryption is active only when explicitly enabled AND a provider key exists. */
export function isMemoryEncryptionEnabled(): boolean {
  if (process.env.PMP_ENCRYPTION_ENABLED !== 'true') return false;
  try {
    loadProviderKeypair();
    return true;
  } catch {
    return false;
  }
}

/** The bot's owner X25519 keypair, derived by signing the domain message with its Solana key (§4.4). */
export async function getBotOwnerKeypair(): Promise<nacl.BoxKeyPair | null> {
  if (botKeypair) return botKeypair;
  const wallet = getBotWallet();
  if (!wallet) return null;
  const sig = nacl.sign.detached(new TextEncoder().encode(DERIVE_MESSAGE), wallet.secretKey);
  botKeypair = await deriveOwnerEncryptionKeypair(sig);
  return botKeypair;
}

/** Test-only: reset the memoized bot keypair. */
export function __resetForTests(): void {
  botKeypair = null;
}

export interface WrapRow { recipient: 'owner' | 'provider'; wrapped_dek: string; wrap_pubkey: string; }
export interface EncryptedMemory { ciphertext: string; ownerPubkey: string; wraps: WrapRow[]; }

/** Resolve the owner's X25519 *public* key (base64). Bot derives its own; users come from the registry. */
export async function resolveOwnerPublicKey(ownerWallet: string | null): Promise<string | null> {
  const botWallet = getBotWallet();
  const botAddr = botWallet?.publicKey.toBase58();
  // Bot-owned memories (owner_wallet null or the bot's own address) → the bot's derived key (§4.4).
  // getBotOwnerKeypair() returns null when no bot wallet is configured (pure SDK consumer), so those
  // null-owner writes fall through to plaintext — we never encrypt to the bot key without the bot wallet.
  if (!ownerWallet || (botAddr && ownerWallet === botAddr)) {
    const kp = await getBotOwnerKeypair();
    return kp ? Buffer.from(kp.publicKey).toString('base64') : null;
  }
  // A specific (non-bot) user wallet → their published registry key, or null → plaintext (§5 step 6).
  const row = await getOwnerEncryptionKey(ownerWallet);
  return row?.x25519_pubkey ?? null;
}

/**
 * Build the at-rest envelope for a memory's content. Returns null (caller stores plaintext,
 * encrypted:false) when encryption is disabled or no owner key is resolvable (§5 step 6).
 * The DEK is local-only — never logged, never part of the return value.
 */
export async function encryptForStorage(
  plaintext: string,
  ownerWallet: string | null,
): Promise<EncryptedMemory | null> {
  if (!isMemoryEncryptionEnabled()) return null;
  const ownerPubkey = await resolveOwnerPublicKey(ownerWallet);
  if (!ownerPubkey) {
    log.warn('No owner encryption key resolvable — storing plaintext (encrypted:false)');
    return null;
  }
  const dek = generateDek();
  const ciphertext = encryptField(plaintext, dek);
  const ownerWrap = wrapDek(dek, Buffer.from(ownerPubkey, 'base64'));
  const provWrap = wrapDek(dek, loadProviderKeypair().publicKey);
  return {
    ciphertext,
    ownerPubkey,
    wraps: [
      { recipient: 'owner', wrapped_dek: ownerWrap.wrapped, wrap_pubkey: ownerWrap.wrapPubkey },
      { recipient: 'provider', wrapped_dek: provWrap.wrapped, wrap_pubkey: provWrap.wrapPubkey },
    ],
  };
}
