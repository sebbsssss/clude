import { createContext, useContext } from 'react';

export type AuthMode = 'privy' | 'cortex' | null;

export interface AuthState {
  authenticated: boolean;
  ready: boolean;
  walletAddress: string | null;
  userId: string | null;
  email: string | null;
  authMode: AuthMode;
  login: () => void;
  logout: () => void;
  loginWithApiKey: (apiKey: string, endpoint?: string) => Promise<boolean>;
}

export const AuthContext = createContext<AuthState>({
  authenticated: false,
  ready: false,
  walletAddress: null,
  userId: null,
  email: null,
  authMode: null,
  login: () => {},
  logout: () => {},
  loginWithApiKey: async () => false,
});

export function useAuthContext() {
  return useContext(AuthContext);
}
