/**
 * Solana network configuration — single source of truth for the chat frontend.
 *
 * Driven by env vars:
 *   VITE_SOLANA_NETWORK  — 'mainnet-beta' | 'devnet'  (default: mainnet-beta)
 *   VITE_SOLANA_RPC_URL  — override RPC endpoint
 */

import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';

export const SOLANA_NETWORK = (import.meta.env.VITE_SOLANA_NETWORK ?? 'mainnet-beta') as 'mainnet-beta' | 'devnet';
export const IS_DEVNET = SOLANA_NETWORK === 'devnet';

// The public mainnet-beta endpoint blocks browser requests with 403 (CORS +
// rate-limiting), so we ship a Helius public-tier URL as the fallback when
// VITE_SOLANA_RPC_URL isn't set in the deploy env. This is a domain-scoped
// read key — fine to embed client-side; rotate via the Helius dashboard if
// it gets abused.
const MAINNET_FALLBACK_RPC = 'https://mainnet.helius-rpc.com/?api-key=1e0cda16-6469-457c-8ef8-c6ecbc4a624e';

// Individual RPC URLs
export const MAINNET_RPC_URL = !IS_DEVNET && import.meta.env.VITE_SOLANA_RPC_URL
  ? import.meta.env.VITE_SOLANA_RPC_URL
  : MAINNET_FALLBACK_RPC;

export const DEVNET_RPC_URL = IS_DEVNET && import.meta.env.VITE_SOLANA_RPC_URL
  ? import.meta.env.VITE_SOLANA_RPC_URL
  : 'https://api.devnet.solana.com';

// Derive WSS URLs from HTTP RPC URLs — Helius and Solana public endpoints
// expose the same path on wss:// for subscriptions. Privy's React hook
// requires both rpc + rpcSubscriptions in PrivyProvider's solana.rpcs config.
const toWss = (url: string) => url.replace(/^https?:/, 'wss:');

// Individual RPC Instances
export const MAINNET_RPC = createSolanaRpc(MAINNET_RPC_URL);
export const DEVNET_RPC = createSolanaRpc(DEVNET_RPC_URL);
export const MAINNET_RPC_SUBSCRIPTIONS = createSolanaRpcSubscriptions(toWss(MAINNET_RPC_URL));
export const DEVNET_RPC_SUBSCRIPTIONS = createSolanaRpcSubscriptions(toWss(DEVNET_RPC_URL));

/**
 * Privy chain IDs — friendly aliases (`solana:mainnet`, `solana:devnet`).
 * Privy's React `useSignAndSendTransaction` looks up RPCs by these exact
 * strings at runtime; the CAIP-2 genesis-hash form (`solana:5eykt...`) is
 * for the server-side SDK only.
 */
export const SOLANA_CHAIN_IDS = {
  mainnet: 'solana:mainnet',
  devnet: 'solana:devnet',
} as const;

/** Current active Chain ID based on environment */
export const SOLANA_CHAIN = IS_DEVNET ? SOLANA_CHAIN_IDS.devnet : SOLANA_CHAIN_IDS.mainnet;

/** Current active RPC URL based on environment */
export const SOLANA_RPC_URL = IS_DEVNET ? DEVNET_RPC_URL : MAINNET_RPC_URL;

/** Current active RPC instance from @solana/kit (v2) */
export const SOLANA_RPC = IS_DEVNET ? DEVNET_RPC : MAINNET_RPC;

/** USDC SPL token mint address — auto-selected by VITE_SOLANA_NETWORK or override if needed */
export const USDC_MINT_ADDRESS = IS_DEVNET
  ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'   // devnet USDC (Circle faucet)
  : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';  // mainnet USDC
