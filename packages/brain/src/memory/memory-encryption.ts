/**
 * Brain-level orchestration for owner-held envelope encryption (PMP §4–§5).
 * Wraps the pure crypto in @clude/shared/core/memory-envelope + the registry/
 * provider keypair in encryption-keys. Gated by PMP_ENCRYPTION_ENABLED so it is
 * a no-op until Plan 3b (recall decrypt) is also deployed.
 */
import nacl from 'tweetnacl';
import {
  deriveOwnerEncryptionKeypair,
} from '@clude/shared/core/memory-envelope';
import {
  loadProviderKeypair,
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
