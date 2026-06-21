/**
 * base-title-identity — bridge an app user to a CUSTODIAL Base title identity in the DB.
 *
 * The title DEK re-wrap (title-saga.ts) seals the `title_holder` wrap to a public key looked up in
 * `encryption_keys` by `owner_wallet = <the Base address>`. A custodial title holder doesn't publish
 * their own key (the server custodies it), so we publish the DERIVED custodial X25519 public key
 * under their Base address here. On unlock the server recovers the DEK with the matching custodial
 * SECRET (resolver.keysFor(appWallet).x25519SecretKey) — no user key is ever involved.
 *
 * No mapping table is needed: every direction is either forward-derivable (app wallet → Base addr,
 * via the resolver) or already on hand (the SELLER's app wallet is on the listing; the BUYER's is the
 * authenticated caller). This helper only persists the one thing the saga reads from the DB — the
 * recipient public key.
 *
 * Idempotent: re-publishing the same derived key is a harmless upsert (PK owner_wallet).
 */

import type { BaseIdentityResolver } from './base-identity.js';
import { createChildLogger } from '@clude/shared/core/logger';

const log = createChildLogger('base-title-identity');

/** Marks an encryption_keys row as a server-custodied title key (vs a user-published owner key). */
export const CUSTODIAL_VERIFIER = 'custodial:v1';

/** A minimal Supabase-shaped handle (same structural type the saga uses). */
export interface DbLike {
  from(table: string): any;
}

export interface CustodialTitleIdentity {
  appWallet: string;
  /** The checksummed Base address that owns the title on-chain + keys the DEK wrap. */
  baseAddress: string;
  x25519PublicKeyB64: string;
}

/**
 * Ensure an app user has a custodial Base title identity: their derived Base address + a published
 * custodial X25519 key under that address, so a `title_holder` DEK wrap can be sealed to them.
 * Returns the Base address (the on-chain owner / order party for this user). Idempotent.
 */
export async function ensureCustodialTitleIdentity(
  db: DbLike,
  resolver: BaseIdentityResolver,
  appWallet: string,
): Promise<CustodialTitleIdentity> {
  const keys = resolver.keysFor(appWallet); // throws on empty wallet
  const baseAddress = keys.address;

  const { error } = await db.from('encryption_keys').upsert(
    {
      owner_wallet: baseAddress,
      x25519_pubkey: keys.x25519PublicKeyB64,
      verifier_ct: CUSTODIAL_VERIFIER,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'owner_wallet' },
  );
  if (error) {
    log.error({ err: error, baseAddress }, 'ensureCustodialTitleIdentity: failed to publish custodial encryption key');
    throw new Error('ensureCustodialTitleIdentity: failed to publish custodial encryption key');
  }

  log.info({ appWallet: appWallet.slice(0, 10), baseAddress }, 'ensureCustodialTitleIdentity: custodial title identity ensured');
  return { appWallet, baseAddress, x25519PublicKeyB64: keys.x25519PublicKeyB64 };
}
