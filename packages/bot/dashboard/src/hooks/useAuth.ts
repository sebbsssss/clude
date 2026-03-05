import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { api } from '../lib/api';
import type { AuthState, AuthMode } from './AuthContext';

export function useAuth(): AuthState {
  const { ready, authenticated: privyAuth, login, logout, user, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const [cortexAuth, setCortexAuth] = useState(false);
  const [cortexReady, setCortexReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>(null);

  // Extract wallet address from connected wallets (prefer Solana)
  const walletAddress = useMemo(() => {
    if (!wallets || wallets.length === 0) return null;
    const solanaWallet = wallets.find(w => w.walletClientType === 'solana' || w.chainType === 'solana');
    if (solanaWallet) return solanaWallet.address;
    return wallets[0]?.address || null;
  }, [wallets]);

  const email = useMemo(() => {
    return user?.email?.address || null;
  }, [user]);

  // On mount: check localStorage for saved cortex API key
  useEffect(() => {
    const savedKey = localStorage.getItem('cortex_api_key');
    const savedEndpoint = localStorage.getItem('cortex_endpoint');
    if (savedKey) {
      api.setToken(savedKey);
      if (savedEndpoint) api.setAgentEndpoint(savedEndpoint);
      api.setMode('cortex');
      api.validateApiKey().then(valid => {
        if (valid) {
          setCortexAuth(true);
          setAuthMode('cortex');
        } else {
          localStorage.removeItem('cortex_api_key');
          localStorage.removeItem('cortex_endpoint');
          api.setMode('legacy');
        }
        setCortexReady(true);
      });
    } else {
      setCortexReady(true);
    }
  }, []);

  // Privy auth sets legacy mode
  useEffect(() => {
    if (privyAuth && !cortexAuth) {
      setAuthMode('privy');
      api.setMode('legacy');
      getAccessToken().then(token => {
        if (token) api.setToken(token);
      });
    }
  }, [privyAuth, cortexAuth, getAccessToken]);

  const loginWithApiKey = useCallback(async (apiKey: string, endpoint?: string): Promise<boolean> => {
    api.setToken(apiKey);
    if (endpoint) api.setAgentEndpoint(endpoint);
    api.setMode('cortex');
    const valid = await api.validateApiKey();
    if (valid) {
      localStorage.setItem('cortex_api_key', apiKey);
      if (endpoint) localStorage.setItem('cortex_endpoint', endpoint);
      setCortexAuth(true);
      setAuthMode('cortex');
    } else {
      api.setMode('legacy');
    }
    return valid;
  }, []);

  const handleLogin = useCallback(() => {
    login();
  }, [login]);

  const handleLogout = useCallback(() => {
    if (authMode === 'cortex') {
      localStorage.removeItem('cortex_api_key');
      localStorage.removeItem('cortex_endpoint');
      setCortexAuth(false);
      setAuthMode(null);
      api.setToken('');
      api.setMode('legacy');
    } else {
      api.setToken('');
      logout();
    }
  }, [authMode, logout]);

  return {
    authenticated: privyAuth || cortexAuth,
    ready: (ready && cortexReady) || cortexAuth,
    walletAddress,
    userId: user?.id || null,
    email,
    authMode,
    login: handleLogin,
    logout: handleLogout,
    loginWithApiKey,
  };
}
