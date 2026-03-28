/**
 * Solana network configuration — single source of truth for the chat frontend.
 *
 * Driven by env vars:
 *   VITE_SOLANA_NETWORK  — 'mainnet-beta' | 'devnet'  (default: mainnet-beta)
 *   VITE_SOLANA_RPC_URL  — override RPC endpoint
 */

export const SOLANA_NETWORK = (import.meta.env.VITE_SOLANA_NETWORK ?? 'mainnet-beta') as 'mainnet-beta' | 'devnet';
export const IS_DEVNET = SOLANA_NETWORK === 'devnet';

export const SOLANA_RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL
  ?? (IS_DEVNET ? 'https://api.devnet.solana.com' : `${window.location.origin}/api/solana-rpc`);

/** CAIP-2 chain identifier for Privy wallet operations */
export const SOLANA_CHAIN = IS_DEVNET ? 'solana:devnet' : 'solana:mainnet';

/** USDC SPL token mint address — auto-selected by VITE_SOLANA_NETWORK */
export const USDC_MINT_ADDRESS = IS_DEVNET
  ? '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'   // devnet USDC (Circle faucet)
  : 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';  // mainnet USDC
