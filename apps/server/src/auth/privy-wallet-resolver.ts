/**
 * Privy wallet ownership resolver.
 *
 * Determines which Solana wallets belong to a Privy user.
 *
 * Two strategies (in priority order):
 *  1. Identity token (X-Privy-Id-Token header) — verified and parsed locally
 *     via verifyIdentityToken(), no API call, no rate limits.
 *  2. DID-based API lookup — calls client.users._get(userId).
 *     Rate-limited by Privy, so results are cached aggressively (5 min TTL).
 */

import { PrivyClient, type User } from '@privy-io/node';
import { config } from '../config';
import { createChildLogger } from '../core/logger';

const log = createChildLogger('privy-wallet-resolver');

// ---- Privy client (singleton) ---- //

let privyClient: PrivyClient | null = null;

function getPrivyClient(): PrivyClient | null {
  if (!privyClient && config.privy.appId && config.privy.appSecret) {
    privyClient = new PrivyClient({
      appId: config.privy.appId,
      appSecret: config.privy.appSecret,
    });
  }
  return privyClient;
}

// ---- In-memory cache: DID → wallet addresses ---- //

interface CacheEntry {
  wallets: string[];
  ts: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 500;
const cache = new Map<string, CacheEntry>();

function getCached(did: string): string[] | null {
  const entry = cache.get(did);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(did);
    return null;
  }
  // Move to end for LRU behaviour
  cache.delete(did);
  cache.set(did, entry);
  return entry.wallets;
}

function setCache(did: string, wallets: string[]) {
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(did, { wallets, ts: Date.now() });
}

/** Extract Solana wallet addresses from a Privy user's linked accounts. */
function extractSolanaWallets(user: User): string[] {
  const wallets: string[] = [];
  for (const account of user.linked_accounts) {
    if (account.type === 'wallet' && account.chain_type === 'solana' && account.address) {
      wallets.push(account.address);
    }
  }
  return wallets;
}

// ---- Public API ---- //

/**
 * Resolve the Solana wallet addresses linked to a Privy user.
 *
 * @param did       The Privy DID (e.g. "did:privy:...")
 * @param idToken   Optional identity token from X-Privy-Id-Token header.
 *                  When provided, wallets are parsed locally (no API call).
 */
export async function resolveWalletsForDid(did: string, idToken?: string): Promise<string[]> {
  // 1. Check cache first
  const cached = getCached(did);
  if (cached !== null) return cached;

  const client = getPrivyClient();
  if (!client) {
    log.warn('Privy client not configured (missing appId or appSecret)');
    return [];
  }

  try {
    // Preferred: parse identity token locally (no API call, no rate limits)
    if (idToken) {
      try {
        const user = await client.users().get({ id_token: idToken });
        const wallets = extractSolanaWallets(user);
        setCache(did, wallets);
        return wallets;
      } catch (err: any) {
        log.warn({ err: err.message, did }, 'Identity token parse failed, falling back to API');
      }
    }

    // Fallback: DID-based API lookup (rate-limited, but cached)
    const user = await client.users()._get(did);
    const wallets = extractSolanaWallets(user);
    setCache(did, wallets);
    return wallets;
  } catch (err: any) {
    log.error({ err: err.message, did }, 'Failed to resolve wallets from Privy');
    return [];
  }
}

/**
 * Check whether a specific wallet address belongs to the given Privy user.
 */
export async function didOwnsWallet(did: string, wallet: string, idToken?: string): Promise<boolean> {
  const wallets = await resolveWalletsForDid(did, idToken);
  return wallets.includes(wallet);
}
