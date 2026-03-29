import { createContext, useContext } from 'react';

export interface AuthState {
  ready: boolean;
  authenticated: boolean;
  walletAddress: string | null;
  authMode: 'privy' | 'cortex' | null;
  cortexKey: string | null;
  login: () => void;
  logout: () => void;
  loginWithApiKey: (apiKey: string) => Promise<boolean>;
}

const defaultState: AuthState = {
  ready: false,
  authenticated: false,
  walletAddress: null,
  authMode: null,
  cortexKey: null,
  login: () => {},
  logout: () => {},
  loginWithApiKey: async () => false,
};

export const AuthContext = createContext<AuthState>(defaultState);
export const useAuthContext = () => useContext(AuthContext);
