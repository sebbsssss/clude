/**
 * Encryption key registry + provider keypair loader (PMP memory encryption-at-rest).
 *
 * - Owner public keys live in `encryption_keys` (published from the dashboard).
 * - The provider's X25519 secret key lives in env (PMP_PROVIDER_ENC_SECRET).
 *   Distinct from the bot's Solana wallet — separates "signs txns" from
 *   "decrypts delegated memories" (spec §4.2).
 */
import nacl from 'tweetnacl';
import { getDb } from './database';
import { createChildLogger } from './logger';

const log = createChildLogger('encryption-keys');

let providerKeypair: nacl.BoxKeyPair | null = null;

/** Load (and memoize) the provider X25519 keypair from PMP_PROVIDER_ENC_SECRET (base64, 32 bytes). */
export function loadProviderKeypair(): nacl.BoxKeyPair {
  if (providerKeypair) return providerKeypair;
  const b64 = process.env.PMP_PROVIDER_ENC_SECRET;
  if (!b64) throw new Error('PMP_PROVIDER_ENC_SECRET is not set');
  const secret = Buffer.from(b64, 'base64');
  if (secret.length !== nacl.box.secretKeyLength) {
    throw new Error(`PMP_PROVIDER_ENC_SECRET must decode to 32 bytes (got ${secret.length})`);
  }
  providerKeypair = nacl.box.keyPair.fromSecretKey(new Uint8Array(secret));
  log.info('Provider encryption keypair loaded');
  return providerKeypair;
}

/** Base64 of the provider's public key (for wrapping DEKs to the provider). */
export function providerPublicKeyBase64(): string {
  return Buffer.from(loadProviderKeypair().publicKey).toString('base64');
}

export interface OwnerEncryptionKey {
  x25519_pubkey: string;
  verifier_ct: string;
}

/** Read an owner's published encryption key, or null if they haven't published one. */
export async function getOwnerEncryptionKey(ownerWallet: string): Promise<OwnerEncryptionKey | null> {
  const { data, error } = await getDb()
    .from('encryption_keys')
    .select('x25519_pubkey, verifier_ct')
    .eq('owner_wallet', ownerWallet)
    .maybeSingle();
  if (error) throw new Error(`getOwnerEncryptionKey failed: ${error.message}`);
  if (!data) return null;
  return { x25519_pubkey: data.x25519_pubkey, verifier_ct: data.verifier_ct };
}

/** Publish (upsert) an owner's public key + verifier token. */
export async function publishOwnerEncryptionKey(
  ownerWallet: string,
  x25519Pubkey: string,
  verifierCt: string
): Promise<void> {
  const { error } = await getDb()
    .from('encryption_keys')
    .upsert(
      {
        owner_wallet: ownerWallet,
        x25519_pubkey: x25519Pubkey,
        verifier_ct: verifierCt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'owner_wallet' }
    );
  if (error) throw new Error(`publishOwnerEncryptionKey failed: ${error.message}`);
}

/** Test-only: reset the memoized provider keypair. */
export function __resetProviderKeypairForTests(): void {
  providerKeypair = null;
}
