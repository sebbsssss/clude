import { createContext, useContext } from 'react';
import { SOLANA_NETWORK } from '../lib/solana-config';

export interface AuthState {
  ready: boolean;
  authenticated: boolean;
  walletAddress: string | null;
  authMode: 'privy' | 'cortex' | null;
  cortexKey: string | null;
  network: 'mainnet-beta' | 'devnet';
  login: () => void;
  logout: () => void;
  loginWithApiKey: (apiKey: string) => Promise<boolean>;
  setNetwork: (network: 'mainnet-beta' | 'devnet') => void;
}

const defaultState: AuthState = {
  ready: false,
  authenticated: false,
  walletAddress: null,
  authMode: null,
  cortexKey: null,
  network: SOLANA_NETWORK,
  login: () => {},
  logout: () => {},
  loginWithApiKey: async () => false,
  setNetwork: () => {},
};

export const AuthContext = createContext<AuthState>(defaultState);
export const useAuthContext = () => useContext(AuthContext);
