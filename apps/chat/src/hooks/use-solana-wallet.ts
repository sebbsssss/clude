/**
 * Centralized Solana wallet hook — single abstraction over Privy's wallet APIs.
 *
 * All Privy solana-specific imports live here. If we ever swap wallet providers,
 * only this file needs to change.
 */
import { useRef, useCallback, useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets, useSignMessage, useSignAndSendTransaction } from '@privy-io/react-auth/solana';
import type { ConnectedStandardSolanaWallet } from '@privy-io/react-auth/solana';

export interface SolanaWalletState {
  /** Privy initialization status. */
  ready: boolean;
  /** Whether the user is currently authenticated via Privy. */
  authenticated: boolean;
  /** Login with Privy (opens modal). */
  login: () => void;
  /** Logout from Privy. */
  logout: () => Promise<void>;
  /** Get the Privy access token for backend requests. */
  getAccessToken: () => Promise<string | null>;

  /** All connected Solana wallets. */
  wallets: ConnectedStandardSolanaWallet[];
  /** Find a wallet by address. */
  findWallet: (address: string) => ConnectedStandardSolanaWallet | undefined;
  /** Sign a message with a specific wallet (by address). Prompts the user. */
  signMessage: (message: Uint8Array, walletAddress: string) => Promise<Uint8Array>;
  /** Sign and send a transaction with a specific wallet (by address). */
  signAndSendTransaction: (transaction: Uint8Array, walletAddress: string, chain: string) => Promise<string>;
}

export function useSolanaWallet(): SolanaWalletState {
  const { ready, authenticated, login, logout, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { signMessage } = useSignMessage();
  const { signAndSendTransaction } = useSignAndSendTransaction();

  // Stable refs so consumers don't re-render when Privy returns new function refs
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;
  const signMessageRef = useRef(signMessage);
  signMessageRef.current = signMessage;
  const signAndSendRef = useRef(signAndSendTransaction);
  signAndSendRef.current = signAndSendTransaction;

  const loginRef = useRef(login);
  loginRef.current = login;
  const logoutRef = useRef(logout);
  logoutRef.current = logout;
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  const findWallet = useCallback(
    (address: string) => walletsRef.current?.find((w: { address: string }) => w.address === address),
    [],
  );

  const stableLogin = useCallback(() => loginRef.current(), []);
  const stableLogout = useCallback(() => logoutRef.current(), []);
  const stableGetAccessToken = useCallback(() => getAccessTokenRef.current(), []);

  const stableSignMessage = useCallback(
    async (message: Uint8Array, walletAddress: string): Promise<Uint8Array> => {
      const wallet = walletsRef.current?.find((w: { address: string }) => w.address === walletAddress);
      if (!wallet) throw new Error('Wallet not connected');
      const { signature } = await signMessageRef.current({ message, wallet });
      return signature instanceof Uint8Array ? signature : new Uint8Array(signature as ArrayBuffer);
    },
    [],
  );

  const stableSignAndSendTransaction = useCallback(
    async (transaction: Uint8Array, walletAddress: string, chain: string): Promise<string> => {
      const wallet = walletsRef.current?.find((w: { address: string }) => w.address === walletAddress);
      if (!wallet) throw new Error('Wallet not connected');
      const { signature } = await signAndSendRef.current({ transaction, wallet, chain });
      if (typeof signature === 'string') return signature;
      // Encode Uint8Array signature to base58
      const { default: bs58 } = await import('bs58');
      return bs58.encode(signature as Uint8Array);
    },
    [],
  );

  // Memoize the return object so consumers don't re-render on every useSolanaWallet call
  // unless the underlying data (wallets, auth status) changes.
  return useMemo(() => ({
    ready,
    authenticated,
    login: stableLogin,
    logout: stableLogout,
    getAccessToken: stableGetAccessToken,
    wallets,
    findWallet,
    signMessage: stableSignMessage,
    signAndSendTransaction: stableSignAndSendTransaction,
  }), [ready, authenticated, wallets, findWallet, stableLogin, stableLogout, stableGetAccessToken, stableSignMessage, stableSignAndSendTransaction]);
}

