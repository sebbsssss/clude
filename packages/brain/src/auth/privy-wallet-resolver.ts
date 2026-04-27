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
import { config } from '@clude/shared/config';
import { createChildLogger } from '@clude/shared/core/logger';

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

/**
 * Find or create a Privy user by email address.
 *
 * Idempotent: tries lookup first via getByEmailAddress, falls back to create
 * when the email is not yet registered. Returns the Privy DID.
 *
 * @throws if Privy is not configured or the API call fails
 */
export async function findOrCreatePrivyUserByEmail(email: string): Promise<string> {
  const client = getPrivyClient();
  if (!client) {
    throw new Error('Privy not configured (missing PRIVY_APP_ID or PRIVY_APP_SECRET)');
  }

  // Lookup first — this makes the function idempotent
  try {
    const user = await client.users().getByEmailAddress({ address: email });
    if (user?.id) return user.id;
  } catch (err: any) {
    const status = err?.status ?? err?.statusCode;
    if (status !== 404) {
      throw err;
    }
    // 404 = not found, fall through to create
  }

  // Create new user
  const user = await client.users().create({
    linked_accounts: [{ type: 'email', address: email }],
  });

  if (!user?.id) {
    throw new Error('Privy user creation returned no DID');
  }

  return user.id;
}

/**
 * Ensure a Privy user has a Solana embedded wallet, returning its address.
 *
 * Strategy:
 *   1. Look up the user via Privy and return any existing Solana wallet.
 *   2. If none exists, mint a new embedded Solana wallet via the Wallets API
 *      and link it to the user. Returns the new address.
 *
 * Lets every email-signup user reach a real Solana address from day one,
 * so /api/chat/topup/intent (which requires a base58 address) always works.
 *
 * Uses the Privy REST API directly — the node SDK's wallets().create input
 * shape is awkward to type when targeting an existing user.
 *
 * @throws if Privy isn't configured or both lookup and creation fail.
 */
export async function ensurePrivySolanaWalletForDid(did: string): Promise<string> {
  const appId = config.privy.appId;
  const appSecret = config.privy.appSecret;
  if (!appId || !appSecret) {
    throw new Error('Privy not configured (missing PRIVY_APP_ID or PRIVY_APP_SECRET)');
  }

  // 1. Try the cache + linked-accounts path first.
  const linked = await resolveWalletsForDid(did);
  if (linked.length > 0) return linked[0];

  // 2. Mint a new embedded Solana wallet linked to this DID.
  const basicAuth = Buffer.from(`${appId}:${appSecret}`).toString('base64');
  const res = await fetch('https://api.privy.io/v1/wallets', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basicAuth}`,
      'privy-app-id': appId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chain_type: 'solana',
      owner: { user_id: did },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Privy wallet creation failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const wallet = (await res.json()) as { address?: string; chain_type?: string };
  if (!wallet.address || wallet.chain_type !== 'solana') {
    throw new Error('Privy wallet creation returned no Solana address');
  }

  // Invalidate the cache so the next resolveWalletsForDid sees the new wallet.
  cache.delete(did);
  log.info({ did, wallet: wallet.address }, 'Provisioned Privy Solana wallet for DID');
  return wallet.address;
}
