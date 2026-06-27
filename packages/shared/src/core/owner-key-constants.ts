/**
 * Cross-platform owner-key derivation constants (single source of truth).
 *
 * Dependency-free leaf module: NO imports whatsoever. This is what keeps it
 * browser-safe — the dashboard's client-side .pmp decrypt imports these strings
 * to derive keys with the EXACT salt/info the server uses, without dragging the
 * Node-`crypto` code in memory-envelope.ts into the browser bundle.
 *
 * Do not add imports to this file.
 */

/** Message the owner signs to derive their encryption keypair (sign-to-derive). */
export const OWNER_SIGN_MESSAGE = 'clude-pmp-owner-v1';

/** HKDF salt for owner-key + verifier-key derivation (UTF-8 encoded at use sites). */
export const HKDF_SALT = 'clude-cortex-v1';

/** HKDF info for the X25519 box keypair. Distinct from the legacy symmetric scheme. */
export const HKDF_INFO = 'memory-encryption-x25519-v2';

/** HKDF info for the DEDICATED secretbox verifier key (separate from the box secret). */
export const VERIFIER_HKDF_INFO = 'memory-key-verifier-v1';
