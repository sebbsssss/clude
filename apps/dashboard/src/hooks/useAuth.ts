import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useSolanaWallets } from '@privy-io/react-auth/solana';
import { api } from '../lib/api';
import type { AuthState, AuthMode } from './AuthContext';

export function useAuth(): AuthState {
  const { ready, authenticated: privyAuth, login, logout, user, getAccessToken } = usePrivy();
  const { wallets: solanaWallets } = useSolanaWallets();
  const [cortexAuth, setCortexAuth] = useState(false);
  const [cortexReady, setCortexReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>(null);
  const [tokenReady, setTokenReady] = useState(false);

  const hasRefreshed = useRef(false);
  const getAccessTokenRef = useRef(getAccessToken);
  getAccessTokenRef.current = getAccessToken;

  // Track whether cortex init is in progress — blocks Privy from overriding
  const cortexInitRef = useRef(false);

  // Extract Solana wallet address
  const walletAddress = useMemo(() => {
    if (!solanaWallets || solanaWallets.length === 0) return null;
    return solanaWallets[0]?.address || null;
  }, [solanaWallets]);

  const email = useMemo(() => {
    return user?.email?.address || null;
  }, [user]);

  // On mount: check localStorage for saved cortex API key
  useEffect(() => {
    const savedKey = localStorage.getItem('cortex_api_key');
    const savedEndpoint = localStorage.getItem('cortex_endpoint');
    if (savedKey) {
      // Block Privy from overriding while we validate
      cortexInitRef.current = true;
      api.setToken(savedKey);
      if (savedEndpoint) api.setAgentEndpoint(savedEndpoint);
      api.setMode('cortex');
      api.setWalletAddress(null);
      api.validateApiKey().then(valid => {
        if (valid) {
          setCortexAuth(true);
          setAuthMode('cortex');
          setTokenReady(true);
          if (!hasRefreshed.current) {
            hasRefreshed.current = true;
            api.emitRefresh();
          }
        } else {
          cortexInitRef.current = false;
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

  // Privy auth: ONLY if cortex is not active or initializing
  useEffect(() => {
    if (cortexInitRef.current || cortexAuth) return;
    if (privyAuth && !tokenReady) {
      setAuthMode('privy');
      api.setMode('legacy');
      getAccessTokenRef.current().then(token => {
        if (token) {
          api.setToken(token);
          api.setWalletAddress(walletAddress);
          setTokenReady(true);
          if (walletAddress && !hasRefreshed.current) {
            hasRefreshed.current = true;
            api.emitRefresh();
          }
        }
      });
    }
  }, [privyAuth, cortexAuth, tokenReady, walletAddress]);

  // Update wallet when it loads (Privy wallets are async)
  useEffect(() => {
    if (authMode === 'privy' && walletAddress) {
      api.setWalletAddress(walletAddress);
      if (tokenReady) {
        hasRefreshed.current = true;
        api.emitRefresh();
      }
    }
  }, [walletAddress, authMode, tokenReady]);

  const loginWithApiKey = useCallback(async (apiKey: string, endpoint?: string): Promise<boolean> => {
    // Fully switch to cortex — clear all privy state
    cortexInitRef.current = true;
    api.setWalletAddress(null);
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
      if (privyAuth) {
        try { logout(); } catch {}
      }
      hasRefreshed.current = true;
      api.emitRefresh();
    } else {
      cortexInitRef.current = false;
      api.setMode('legacy');
    }
    return valid;
  }, [privyAuth, logout]);

  const handleLogin = useCallback(() => {
    login();
  }, [login]);

  const handleLogout = useCallback(() => {
    // Clear everything
    cortexInitRef.current = false;
    setTokenReady(false);
    hasRefreshed.current = false;
    setCortexAuth(false);
    setAuthMode(null);
    api.setWalletAddress(null);
    api.setToken('');
    api.setMode('legacy');
    api.setAgentEndpoint(import.meta.env.VITE_API_BASE || '');
    localStorage.removeItem('cortex_api_key');
    localStorage.removeItem('cortex_endpoint');
    localStorage.removeItem('cortex_wallet');
    if (privyAuth) {
      logout();
    }
    api.emitRefresh();
  }, [privyAuth, logout]);

  const isAuthenticated = privyAuth || cortexAuth;

  return {
    authenticated: isAuthenticated,
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
