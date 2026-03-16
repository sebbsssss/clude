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
  const [tokenReady, setTokenReady] = useState(false);

  // Extract wallet address from connected wallets (prefer Solana)
  const walletAddress = useMemo(() => {
    if (!wallets || wallets.length === 0) return null;
    const solanaWallet = wallets.find(w => w.walletClientType === 'solana' || (w as any).chainType === 'solana');
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
          setTokenReady(true);
          // Refresh data with the validated key
          api.emitRefresh();
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

  // Privy auth: set token then signal refresh
  useEffect(() => {
    if (privyAuth && !cortexAuth) {
      setAuthMode('privy');
      api.setMode('legacy');
      getAccessToken().then(token => {
        if (token) {
          api.setToken(token);
          setTokenReady(true);
          // Token is set — now safe to fetch scoped data
          api.emitRefresh();
        }
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
      setTokenReady(true);
      // Clear stale data and re-fetch with new key
      api.emitRefresh();
    } else {
      api.setMode('legacy');
    }
    return valid;
  }, []);

  const handleLogin = useCallback(() => {
    login();
  }, [login]);

  const handleLogout = useCallback(() => {
    setTokenReady(false);
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
    api.emitRefresh();
  }, [authMode, logout]);

  const isAuthenticated = privyAuth || cortexAuth;

  return {
    authenticated: isAuthenticated,
    // Ready when: (1) not authenticated and Privy+cortex init done, or (2) authenticated and token is set
    ready: isAuthenticated ? (tokenReady && cortexReady) : (ready && cortexReady),
    walletAddress,
    userId: user?.id || null,
    email,
    authMode,
    login: handleLogin,
    logout: handleLogout,
    loginWithApiKey,
  };
}
