/**
 * Solana network configuration — single source of truth for the chat frontend.
 *
 * Driven by env vars:
 *   VITE_SOLANA_NETWORK  — 'mainnet-beta' | 'devnet'  (default: mainnet-beta)
 *   VITE_SOLANA_RPC_URL  — override RPC endpoint
 */

import { createSolanaRpc } from '@solana/kit';

export const SOLANA_NETWORK = (import.meta.env.VITE_SOLANA_NETWORK ?? 'mainnet-beta') as 'mainnet-beta' | 'devnet';
export const IS_DEVNET = SOLANA_NETWORK === 'devnet';

// Individual RPC URLs
export const MAINNET_RPC_URL = !IS_DEVNET && import.meta.env.VITE_SOLANA_RPC_URL
  ? import.meta.env.VITE_SOLANA_RPC_URL
  : 'https://api.mainnet-beta.solana.com';

export const DEVNET_RPC_URL = IS_DEVNET && import.meta.env.VITE_SOLANA_RPC_URL
  ? import.meta.env.VITE_SOLANA_RPC_URL
  : 'https://api.devnet.solana.com';

// Individual RPC Instances
export const MAINNET_RPC = createSolanaRpc(MAINNET_RPC_URL);
export const DEVNET_RPC = createSolanaRpc(DEVNET_RPC_URL);

/** Standard Chain IDs */
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
